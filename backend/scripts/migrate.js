const fs = require("node:fs");
const path = require("node:path");
const { getPool, closePool } = require("../services/postgres.service");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const MIGRATIONS_DIR = path.join(__dirname, "..", "database", "migrations");
const SCHEMA_PATH = path.join(__dirname, "..", "database", "schema.sql");
const MIGRATION_LOCK_ID = 724211;
const RETRYABLE_POSTGRES_ERRORS = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "57P03"
]);

function ensureMigrationsDir(migrationsDir = MIGRATIONS_DIR) {
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }
}

function getMigrationFiles(migrationsDir = MIGRATIONS_DIR) {
  ensureMigrationsDir(migrationsDir);
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((file) => {
    const version = file.split("_")[0];
    const name = file.replace(".sql", "");
    const content = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    return { version, name, file, content };
  });
}

async function ensureSchemaMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query("SELECT version FROM schema_migrations ORDER BY version");
  return new Set(result.rows.map((row) => row.version));
}

async function runInTransaction(client, callback) {
  await client.query("BEGIN");
  try {
    const result = await callback();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function applyMigration(client, migration) {
  console.log(`Applying migration ${migration.version}: ${migration.name}`);
  await runInTransaction(client, async () => {
    await client.query(migration.content);
    await client.query(
      "INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING",
      [migration.version, migration.name]
    );
  });
  console.log(`Migration ${migration.version} applied successfully.`);
}

async function applyBaseSchema(client, schemaPath = SCHEMA_PATH) {
  const schema = fs.readFileSync(schemaPath, "utf8");
  await runInTransaction(client, async () => {
    await client.query(schema);
  });
}

async function runMigrations({ client, migrationsDir = MIGRATIONS_DIR, schemaPath = SCHEMA_PATH } = {}) {
  await applyBaseSchema(client, schemaPath);
  console.log("Base schema applied successfully.");

  await ensureSchemaMigrationsTable(client);

  const appliedMigrations = await getAppliedMigrations(client);
  const migrationFiles = getMigrationFiles(migrationsDir);

  for (const migration of migrationFiles) {
    if (!appliedMigrations.has(migration.version)) {
      await applyMigration(client, migration);
      appliedMigrations.add(migration.version);
    } else {
      console.log(`Migration ${migration.version} already applied, skipping.`);
    }
  }
}

async function withMigrationLock(callback, pool = getPool()) {
  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    lockAcquired = true;
    return await callback(client);
  } finally {
    try {
      if (lockAcquired) {
        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
      }
    } finally {
      client.release();
    }
  }
}

function isRetryablePostgresStartupError(error) {
  return RETRYABLE_POSTGRES_ERRORS.has(error?.code) || RETRYABLE_POSTGRES_ERRORS.has(error?.cause?.code);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Add the Neon connection string to backend/.env.");
  }

  const attempts = Math.max(1, Number(process.env.PG_MIGRATION_RETRIES || 20));
  const retryDelay = Math.max(250, Number(process.env.PG_MIGRATION_RETRY_MS || 1500));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await withMigrationLock(async (client) => {
        await runMigrations({ client });
      });
      break;
    } catch (error) {
      if (attempt === attempts || !isRetryablePostgresStartupError(error)) throw error;
      console.warn(`PostgreSQL not ready for migration (attempt ${attempt}/${attempts}); retrying...`);
      await sleep(retryDelay);
    }
  }

  console.log("All migrations completed successfully.");
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error("PostgreSQL migration failed:", error.message);
      process.exitCode = 1;
    })
    .finally(closePool);
}

module.exports = {
  __testables: {
    MIGRATION_LOCK_ID,
    applyBaseSchema,
    applyMigration,
    ensureSchemaMigrationsTable,
    getAppliedMigrations,
    getMigrationFiles,
    runInTransaction,
    runMigrations,
    isRetryablePostgresStartupError,
    withMigrationLock
  }
};
