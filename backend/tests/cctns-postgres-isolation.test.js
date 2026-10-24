require("../services/testDatabaseSafety").prepareIntegrationTestEnvironment();

const test = require("node:test");
const assert = require("node:assert/strict");
const { query, closePool } = require("../services/postgres.service");
const { withCctnsState, addAuditLog, readDatabase } = require("../services/core.service");

test.after(async () => { await closePool(); });

test("CCTNS PostgreSQL persistence keeps unrelated operational data and rejected-link audits", {
  skip: !process.env.DATABASE_URL || !process.env.RAKSHAKAI_TEST_SCHEMA
}, async () => {
  await query("INSERT INTO incidents (id, status, severity, data) VALUES ($1, $2, $3, $4::jsonb)", [
    "cctns_isolation_incident", "New", "medium", JSON.stringify({ id: "cctns_isolation_incident", title: "Preserve me" })
  ]);
  await query("INSERT INTO app_state (key, data) VALUES ('operational', $1::jsonb) ON CONFLICT (key) DO UPDATE SET data = app_state.data || EXCLUDED.data", [JSON.stringify({ cctnsIsolationMarker: "preserve" })]);
  await withCctnsState((db) => {
    // A stale unrelated collection must never be written by this operation.
    db.incidents = [];
    db.cctnsLinks.push({ id: "isolation_link", cctnsRecordId: "CCTNS-VEH-2026-4587", incidentId: "cctns_isolation_incident" });
    addAuditLog(db, "cctns_link_confirmed", { id: "test", role: "Admin" }, null, "safe test metadata");
  }, { writeLinks: true });
  const incident = await query("SELECT data FROM incidents WHERE id = $1", ["cctns_isolation_incident"]);
  const operational = await query("SELECT data FROM app_state WHERE key = 'operational'");
  assert.equal(incident.rows[0].data.title, "Preserve me");
  assert.equal(operational.rows[0].data.cctnsIsolationMarker, "preserve");
  assert.ok((await readDatabase()).cctnsLinks.some((link) => link.id === "isolation_link"));

  await assert.rejects(withCctnsState((db) => {
    addAuditLog(db, "cctns_link_rejected", { id: "test", role: "Admin" }, null, "safe rejection metadata");
    throw new Error("Rejected test link");
  }, { writeLinks: true }), /Rejected test link/);
  const audit = await query("SELECT id FROM audit_logs WHERE action = $1", ["cctns_link_rejected"]);
  assert.ok(audit.rows.length > 0);
});
