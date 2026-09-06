const fs = require("node:fs");
const path = require("node:path");
const { query, closePool } = require("../services/postgres.service");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const MIGRATIONS_DIR = path.join(__dirname, "..", "database", "migrations");

function ensureMigrationsDir() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
  }
}

function getMigrationFiles() {
  ensureMigrationsDir();
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((file) => {
    const version = file.split("_")[0];
    const name = file.replace(".sql", "");
    const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    return { version, name, file, content };
  });
}

async function ensureSchemaMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations() {
  const result = await query("SELECT version FROM schema_migrations ORDER BY version");
  return new Set(result.rows.map((row) => row.version));
}

async function applyMigration(migration) {
  console.log(`Applying migration ${migration.version}: ${migration.name}`);
  await query(migration.content);
  await query(
    "INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING",
    [migration.version, migration.name]
  );
  console.log(`Migration ${migration.version} applied successfully.`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Add the Neon connection string to backend/.env.");
  }

  const schemaPath = path.join(__dirname, "..", "database", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");

  const attempts = Math.max(1, Number(process.env.PG_MIGRATION_RETRIES || 20));
  const retryDelay = Math.max(250, Number(process.env.PG_MIGRATION_RETRY_MS || 1500));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await query(schema);
      console.log("Base schema applied successfully.");
      break;
    } catch (error) {
      if (attempt === attempts) throw error;
      console.warn(`PostgreSQL not ready for migration (attempt ${attempt}/${attempts}); retrying...`);
      await sleep(retryDelay);
    }
  }

  await ensureSchemaMigrationsTable();

  const appliedMigrations = await getAppliedMigrations();
  const migrationFiles = getMigrationFiles();

  for (const migration of migrationFiles) {
    if (!appliedMigrations.has(migration.version)) {
      await applyMigration(migration);
      appliedMigrations.add(migration.version);
    } else {
      console.log(`Migration ${migration.version} already applied, skipping.`);
    }
  }

  console.log("All migrations completed successfully.");
}

main()
  .catch((error) => {
    console.error("PostgreSQL migration failed:", error.message);
    process.exitCode = 1;
  })
  .finally(closePool);