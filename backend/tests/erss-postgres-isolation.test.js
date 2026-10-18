const test = require("node:test");
const assert = require("node:assert/strict");
const { query, closePool } = require("../services/postgres.service");
const { readDatabase, writeErssChanges } = require("../services/core.service");

test.after(closePool);

test("ERSS PostgreSQL saves preserve concurrent data and reject stale edits", {
  skip: !process.env.DATABASE_URL || !process.env.RAKSHAKAI_TEST_SCHEMA
}, async () => {
  const id = "erss_isolation_incident";
  await query("INSERT INTO incidents (id, status, severity, data) VALUES ($1, 'New', 'medium', $2::jsonb)", [id, JSON.stringify({ id, title: "Original", status: "New", severity: "medium" })]);
  const baseline = await readDatabase();
  const pending = structuredClone(baseline);
  pending.incidents.find((record) => record.id === id).title = "ERSS update";
  await query("INSERT INTO incidents (id, status, severity, data) VALUES ('erss_concurrent_incident', 'New', 'medium', $1::jsonb)", [JSON.stringify({ id: "erss_concurrent_incident", title: "Concurrent" })]);
  await query("INSERT INTO app_state (key, data) VALUES ('operational', '{\"erssMarker\":true}'::jsonb) ON CONFLICT (key) DO UPDATE SET data = app_state.data || EXCLUDED.data");
  await writeErssChanges(pending, baseline);
  assert.equal((await query("SELECT data FROM incidents WHERE id = $1", [id])).rows[0].data.title, "ERSS update");
  assert.equal((await query("SELECT id FROM incidents WHERE id = 'erss_concurrent_incident'")).rows.length, 1);
  assert.equal((await query("SELECT data FROM app_state WHERE key = 'operational'")).rows[0].data.erssMarker, true);
  pending.incidents.find((record) => record.id === id).title = "Stale update";
  await assert.rejects(writeErssChanges(pending, baseline), { status: 409 });
  assert.equal((await query("SELECT data FROM incidents WHERE id = $1", [id])).rows[0].data.title, "ERSS update");
});
