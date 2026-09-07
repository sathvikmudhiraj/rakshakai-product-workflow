const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  __testables: {
    MIGRATION_LOCK_ID,
    applyMigration,
    getMigrationFiles,
    isRetryablePostgresStartupError,
    runMigrations,
    withMigrationLock
  }
} = require("../scripts/migrate");

function makeTempMigrationDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-migrations-"));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

function makeTempSchema(content = "CREATE TABLE base_schema_table (id TEXT PRIMARY KEY);") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-schema-"));
  const schemaPath = path.join(dir, "schema.sql");
  fs.writeFileSync(schemaPath, content);
  return schemaPath;
}

function createFakeClient({
  appliedVersions = [],
  failMigrationSql = false,
  failTrackingInsert = false,
  sharedState,
  lockController
} = {}) {
  const state = sharedState || {
    tables: new Set(),
    migrations: new Set(appliedVersions),
    queries: [],
    locked: false,
    released: false,
    transactionSnapshot: null
  };

  const client = {
    state,
    async query(sql, params = []) {
      const text = String(sql).trim();
      state.queries.push({ sql: text, params });

      if (/^SELECT pg_advisory_lock/i.test(text)) {
        assert.deepEqual(params, [MIGRATION_LOCK_ID]);
        if (lockController) await lockController.lock();
        state.locked = true;
        return { rows: [] };
      }

      if (/^SELECT pg_advisory_unlock/i.test(text)) {
        assert.deepEqual(params, [MIGRATION_LOCK_ID]);
        if (lockController) lockController.unlock();
        state.released = true;
        return { rows: [] };
      }

      if (text === "BEGIN") {
        state.transactionSnapshot = {
          tables: new Set(state.tables),
          migrations: new Set(state.migrations)
        };
        return { rows: [] };
      }

      if (text === "COMMIT") {
        state.transactionSnapshot = null;
        return { rows: [] };
      }

      if (text === "ROLLBACK") {
        state.tables = new Set(state.transactionSnapshot?.tables || []);
        state.migrations = new Set(state.transactionSnapshot?.migrations || []);
        state.transactionSnapshot = null;
        return { rows: [] };
      }

      if (/SELECT version FROM schema_migrations/i.test(text)) {
        return {
          rows: [...state.migrations].sort().map((version) => ({ version }))
        };
      }

      if (/INSERT INTO schema_migrations/i.test(text)) {
        if (failTrackingInsert) {
          throw new Error("tracking insert failed");
        }
        state.migrations.add(params[0]);
        return { rows: [] };
      }

      if (/CREATE TABLE/i.test(text)) {
        if (failMigrationSql && /created_by_migration/i.test(text)) {
          throw new Error("migration sql failed");
        }
        const tableMatches = [...text.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)/gi)];
        for (const match of tableMatches) {
          state.tables.add(match[1]);
        }
        return { rows: [] };
      }

      return { rows: [] };
    },
    release() {
      state.clientReleased = true;
    }
  };

  return client;
}

function createLockController() {
  let locked = false;
  const waiters = [];
  return {
    async lock() {
      while (locked) {
        await new Promise((resolve) => waiters.push(resolve));
      }
      locked = true;
    },
    unlock() {
      locked = false;
      waiters.shift()?.();
    }
  };
}

test("migration files are discovered and ordered by filename", () => {
  const dir = makeTempMigrationDir({
    "002_second.sql": "CREATE TABLE second_table (id TEXT);",
    "001_first.sql": "CREATE TABLE first_table (id TEXT);"
  });

  const files = getMigrationFiles(dir);

  assert.deepEqual(files.map((file) => file.version), ["001", "002"]);
  assert.deepEqual(files.map((file) => file.name), ["001_first", "002_second"]);
});

test("fresh migration path applies base schema and pending migrations", async () => {
  const schemaPath = makeTempSchema();
  const migrationsDir = makeTempMigrationDir({
    "001_initial.sql": "CREATE TABLE created_by_migration (id TEXT PRIMARY KEY);"
  });
  const client = createFakeClient();

  await runMigrations({ client, schemaPath, migrationsDir });

  assert.equal(client.state.tables.has("base_schema_table"), true);
  assert.equal(client.state.tables.has("created_by_migration"), true);
  assert.equal(client.state.migrations.has("001"), true);
});

test("upgrade path applies only missing migrations", async () => {
  const schemaPath = makeTempSchema();
  const migrationsDir = makeTempMigrationDir({
    "001_initial.sql": "CREATE TABLE old_migration (id TEXT);",
    "002_add_table.sql": "CREATE TABLE created_by_migration (id TEXT);"
  });
  const client = createFakeClient({ appliedVersions: ["001"] });

  await runMigrations({ client, schemaPath, migrationsDir });

  assert.equal(client.state.tables.has("old_migration"), false);
  assert.equal(client.state.tables.has("created_by_migration"), true);
  assert.deepEqual([...client.state.migrations].sort(), ["001", "002"]);
});

test("repeated migration run has zero pending migration mutations", async () => {
  const schemaPath = makeTempSchema();
  const migrationsDir = makeTempMigrationDir({
    "001_initial.sql": "CREATE TABLE created_by_migration (id TEXT);"
  });
  const client = createFakeClient({ appliedVersions: ["001"] });

  await runMigrations({ client, schemaPath, migrationsDir });

  assert.equal(client.state.tables.has("created_by_migration"), false);
  assert.equal(
    client.state.queries.some((query) => /INSERT INTO schema_migrations/i.test(query.sql)),
    false
  );
});

test("migration SQL failure rolls back and does not mark migration applied", async () => {
  const client = createFakeClient({ failMigrationSql: true });

  await assert.rejects(
    applyMigration(client, {
      version: "002",
      name: "002_failure",
      content: "CREATE TABLE created_by_migration (id TEXT);"
    }),
    /migration sql failed/
  );

  assert.equal(client.state.tables.has("created_by_migration"), false);
  assert.equal(client.state.migrations.has("002"), false);
  assert.equal(client.state.queries.some((query) => query.sql === "ROLLBACK"), true);
});

test("tracking-row failure rolls back schema change and leaves migration unapplied", async () => {
  const client = createFakeClient({ failTrackingInsert: true });

  await assert.rejects(
    applyMigration(client, {
      version: "003",
      name: "003_tracking_failure",
      content: "CREATE TABLE created_by_migration (id TEXT);"
    }),
    /tracking insert failed/
  );

  assert.equal(client.state.tables.has("created_by_migration"), false);
  assert.equal(client.state.migrations.has("003"), false);
  assert.equal(client.state.queries.some((query) => query.sql === "ROLLBACK"), true);
});

test("migration lock uses one client and releases the advisory lock", async () => {
  const client = createFakeClient();
  const pool = {
    async connect() {
      return client;
    }
  };
  let callbackClient;

  await withMigrationLock((lockedClient) => {
    callbackClient = lockedClient;
  }, pool);

  assert.equal(callbackClient, client);
  assert.equal(client.state.locked, true);
  assert.equal(client.state.released, true);
  assert.equal(client.state.clientReleased, true);
});

test("concurrent migration runners do not apply the same migration twice", async () => {
  const schemaPath = makeTempSchema();
  const migrationsDir = makeTempMigrationDir({
    "001_initial.sql": "CREATE TABLE created_by_migration (id TEXT);"
  });
  const sharedState = {
    tables: new Set(),
    migrations: new Set(),
    queries: [],
    locked: false,
    released: false,
    transactionSnapshot: null
  };
  const lockController = createLockController();
  const pool = {
    async connect() {
      return createFakeClient({ sharedState, lockController });
    }
  };

  await Promise.all([
    withMigrationLock((client) => runMigrations({ client, schemaPath, migrationsDir }), pool),
    withMigrationLock((client) => runMigrations({ client, schemaPath, migrationsDir }), pool)
  ]);

  const migrationSqlExecutions = sharedState.queries.filter((query) => (
    /CREATE TABLE created_by_migration/i.test(query.sql)
  ));
  const trackingInserts = sharedState.queries.filter((query) => (
    /INSERT INTO schema_migrations/i.test(query.sql)
  ));

  assert.equal(migrationSqlExecutions.length, 1);
  assert.equal(trackingInserts.length, 1);
  assert.deepEqual([...sharedState.migrations], ["001"]);
});

test("readiness retries are limited to startup connection errors", () => {
  assert.equal(isRetryablePostgresStartupError({ code: "ECONNREFUSED" }), true);
  assert.equal(isRetryablePostgresStartupError({ cause: { code: "57P03" } }), true);
  assert.equal(isRetryablePostgresStartupError({ code: "23505" }), false);
  assert.equal(isRetryablePostgresStartupError(new Error("syntax error")), false);
});
