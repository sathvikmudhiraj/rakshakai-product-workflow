const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { getPool, closePool } = require("../services/postgres.service");

test.after(closePool);

test("jurisdiction timestamp forward migration preserves old rows and is repeatable", {
  skip: !process.env.DATABASE_URL || !process.env.RAKSHAKAI_TEST_SCHEMA
}, async () => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // A session-local table shadows the real one; never modify application records.
    await client.query(`CREATE TEMP TABLE erss_jurisdiction_history (
      id TEXT PRIMARY KEY, changed_at TIMESTAMPTZ NOT NULL, data JSONB NOT NULL
    ) ON COMMIT DROP`);
    await client.query(`INSERT INTO erss_jurisdiction_history VALUES
      ('historical', '2025-01-02T03:04:05Z', '{"reason":"unchanged"}')`);
    const migration = fs.readFileSync(path.join(__dirname, "../database/migrations/024_erss_jurisdiction_history_timestamps.sql"), "utf8");
    await client.query(migration);
    const row = (await client.query("SELECT * FROM erss_jurisdiction_history")).rows[0];
    assert.equal(row.created_at.toISOString(), "2025-01-02T03:04:05.000Z");
    assert.equal(row.updated_at.toISOString(), row.created_at.toISOString());
    assert.deepEqual(row.data, { reason: "unchanged" });
    await client.query("UPDATE erss_jurisdiction_history SET updated_at = '2025-02-01T00:00:00Z'");
    await client.query(migration);
    assert.equal((await client.query("SELECT updated_at FROM erss_jurisdiction_history")).rows[0].updated_at.toISOString(), "2025-02-01T00:00:00.000Z");
    await client.query("INSERT INTO erss_jurisdiction_history (id, changed_at, data) VALUES ('new', NOW(), '{}')");
    assert.equal((await client.query("SELECT COUNT(*)::int AS n FROM erss_jurisdiction_history WHERE created_at IS NOT NULL AND updated_at IS NOT NULL")).rows[0].n, 2);
    await assert.rejects(client.query("INSERT INTO erss_jurisdiction_history VALUES ('invalid', NOW(), '{}', NULL, NULL)"), { code: "23502" });
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
