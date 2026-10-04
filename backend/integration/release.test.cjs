const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");

// Refuse to run this mutating suite against an operational database.
const database = new URL(process.env.DATABASE_URL || "http://missing");
if (database.hostname !== "postgres" || database.pathname !== "/rakshakai_test_release" || !process.env.RELEASE_TEST_PASSWORD) {
  throw new Error("Release tests require the isolated compose.test.yaml database");
}
const { query, getPool, closePool } = require("../services/postgres.service");
const { readDatabase, writeDatabase } = require("../services/core.service");
const { __testables: { withMigrationLock, runMigrations, applyMigration } } = require("../scripts/migrate");
const { buildRakshakaiCsp } = require("../../csp.config.cjs");
const base = "http://backend:5000";
const password = process.env.RELEASE_TEST_PASSWORD;
let users;
let admin;

async function request(route, { cookie, body, method = "GET" } = {}) {
  return fetch(base + route, { method, headers: {
    ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {})
  }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
}
async function login(role) {
  const user = users.find((user) => user.role === role);
  const response = await request("/api/login", { method: "POST", body: { email: user.email, password } });
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("rakshakai_session=") && !value.startsWith("rakshakai_session=;"));
  assert.ok(cookie);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  return cookie.split(";")[0];
}
test.before(async () => {
  users = (await readDatabase()).users;
  admin = await login("Admin");
});
test.after(closePool);

test("production Nginx sends the exact restrictive CSP on HTML and SPA responses", async () => {
  const expected = buildRakshakaiCsp({ environment: "production", connectSrc: "", imgSrc: "" }).header;
  for (const route of ["/", "/index.html", "/rakshak/live-vision"]) {
    const response = await fetch(`http://frontend${route}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-security-policy"), expected);
    assert.match(response.headers.get("content-type"), /text\/html/);
    const html = await response.text();
    const css = html.match(/href="([^\"]+\.css)"/);
    assert.ok(css, "built CSS reference exists");
    const stylesheet = await fetch(new URL(css[1], "http://frontend"));
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get("content-type"), /text\/css/);
  }
});

test("production readiness covers PostgreSQL and writable evidence storage", async () => {
  assert.equal((await request("/api/health")).status, 200);
  assert.equal((await request("/api/live")).status, 200);
});

test("evidence custody relation rejects mutation and deletion", async () => {
  const id = "custody_release_append_only";
  await query(
    `INSERT INTO evidence_custody_events
      (id, evidence_id, action, actor_name, actor_role, occurred_at, notes, data)
     VALUES ($1, 'evd_release_fixture', 'release_check', 'Release Test', 'System', NOW(), 'original', '{}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [id]
  );
  await assert.rejects(query("UPDATE evidence_custody_events SET notes = 'changed' WHERE id = $1", [id]), /append-only/);
  await assert.rejects(query("DELETE FROM evidence_custody_events WHERE id = $1", [id]), /append-only/);
  await assert.rejects(query("TRUNCATE evidence_custody_events"), /append-only/);
  const stored = await query("SELECT notes FROM evidence_custody_events WHERE id = $1", [id]);
  assert.equal(stored.rows[0].notes, "original");
});

test("production readiness rejects unwritable evidence while liveness remains available", async () => {
  const directory = process.env.EVIDENCE_STORAGE_DIR;
  const originalMode = fs.statSync(directory).mode & 0o777;
  fs.chmodSync(directory, 0o500);
  try {
    assert.equal((await request("/api/health")).status, 503);
    assert.equal((await request("/api/live")).status, 200);
  } finally { fs.chmodSync(directory, originalMode); }
  assert.equal((await request("/api/health")).status, 200);
});

test("two real PostgreSQL login sessions: logout revokes only session A", async () => {
  const a = await login("Police Officer");
  const b = await login("Police Officer");
  assert.notEqual(a, b);
  assert.equal((await request("/api/me", { cookie: a })).status, 200);
  assert.equal((await request("/api/logout", { method: "POST", cookie: a })).status, 200);
  assert.equal((await (await request("/api/me", { cookie: a })).json()).user, null);
  assert.equal((await request("/api/maps/route", { method: "POST", cookie: a, body: {} })).status, 401);
  const remainingSession = await request("/api/me", { cookie: b });
  assert.equal(remainingSession.status, 200);
  assert.equal((await remainingSession.json()).user.id, users.find((user) => user.role === "Police Officer").id);
  assert.equal((await request("/api/incidents", { cookie: b })).status, 200);
  const citizen = await login("Citizen");
  assert.equal((await request("/api/ai/run-scan", { method: "POST", cookie: citizen })).status, 403);
  assert.equal((await request("/api/maps/route", { method: "POST", cookie: citizen, body: {} })).status, 403);
});

test("a real deferred PostgreSQL constraint failure cannot send success or a login cookie", async () => {
  await query(`CREATE FUNCTION release_reject_user() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'release test deferred constraint' USING ERRCODE = '23514'; END $$`);
  await query(`CREATE CONSTRAINT TRIGGER release_reject_user AFTER INSERT ON users DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION release_reject_user()`);
  try {
    const before = (await query("SELECT count(*)::int AS count FROM users")).rows[0].count;
    const response = await request("/api/register", { method: "POST", body: { name: "Release Test", email: "release-test@example.invalid", password: "ReleaseCitizen123" } });
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal((await query("SELECT count(*)::int AS count FROM users")).rows[0].count, before);
    assert.deepEqual(await response.json(), { error: "Internal server error" });
  } finally {
    await query("DROP TRIGGER release_reject_user ON users");
    await query("DROP FUNCTION release_reject_user()");
  }
});

const videoData = `data:video/mp4;base64,${Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom0000release-test")]).toString("base64")}`;
function evidenceFiles() {
  return fs.readdirSync(process.env.EVIDENCE_STORAGE_DIR, { recursive: true }).filter((file) => file.endsWith(".mp4")).sort();
}

test("fresh non-root Docker evidence volume accepts upload, checksum preview and PostgreSQL metadata", async () => {
  assert.notEqual(process.getuid(), 0);
  const response = await request("/api/video-evidence", { cookie: admin, method: "POST", body: { videoData, fileName: "release.mp4" } });
  assert.equal(response.status, 201);
  const { evidence } = await response.json();
  const preview = await request(`/api/video-evidence/${evidence.id}/preview`, { cookie: admin });
  assert.equal(preview.status, 200);
  const bytes = Buffer.from(await preview.arrayBuffer());
  const saved = (await readDatabase()).videoEvidence.find((item) => item.id === evidence.id);
  assert.equal("fileData" in saved, false);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), saved.checksum);
});

test("real outer commit failure cleans up newly uploaded evidence", async () => {
  const before = evidenceFiles();
  await query(`CREATE FUNCTION release_reject_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'release test deferred constraint' USING ERRCODE = '23514'; END $$`);
  await query(`CREATE CONSTRAINT TRIGGER release_reject_evidence AFTER UPDATE ON app_state DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION release_reject_evidence()`);
  try {
    const response = await request("/api/video-evidence", { cookie: admin, method: "POST", body: { videoData, fileName: "rollback.mp4" } });
    assert.equal(response.status, 500);
    assert.deepEqual(evidenceFiles(), before);
    assert.equal((await readDatabase()).videoEvidence.some((item) => item.fileName === "rollback.mp4"), false);
  } finally {
    await query("DROP TRIGGER release_reject_evidence ON app_state");
    await query("DROP FUNCTION release_reject_evidence()");
  }
});

async function assignmentFixture(suffix) {
  const db = await readDatabase();
  const timestamp = new Date().toISOString();
  const incident = { id: `release_incident_${suffix}`, title: "Release test incident", type: "manual", category: "manual", severity: "medium", status: "Verified", source: "Manual", sourceType: "manual", lat: 17.5285, lng: 78.2636, locationSource: "manual_latlng", locationStatus: "Verified", assignedUnitId: null, createdAt: timestamp, updatedAt: timestamp, occurrenceCount: 1 };
  const unit = { id: `release_unit_${suffix}`, unitCode: `RELEASE-${suffix}`, unitId: `RELEASE-${suffix}`, name: "Release test unit", unitName: "Release test unit", type: "police_patrol", unitType: "police_patrol", status: "available", lat: 17.5285, lng: 78.2636, source: "admin_registry", operational: true, isDemo: false, lastSeen: timestamp, lastUpdated: timestamp, lastLocationUpdatedAt: timestamp, assignedIncidentId: null, currentIncidentId: null };
  db.incidents.push(incident);
  db.responseUnits.push(unit);
  await writeDatabase(db);
  return { incident, unit };
}
test("real PostgreSQL concurrent assignment produces one winner and one audit/event", async () => {
  const { incident, unit } = await assignmentFixture("same-incident");
  const police = await login("Police Officer");
  const responses = await Promise.all([admin, police].map((cookie) => request(`/api/incidents/${incident.id}/assign-unit`, { cookie, method: "POST", body: { unitId: unit.id, expectedAssignedUnitId: null } })));
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const db = await readDatabase();
  assert.equal(db.incidents.find((item) => item.id === incident.id).assignedUnitId, unit.id);
  assert.equal(db.responseUnits.find((item) => item.id === unit.id).status, "busy");
  assert.equal(db.auditLogs.filter((item) => item.incidentId === incident.id && item.action === "unit_assigned").length, 1);
  assert.equal(db.dispatchEvents.filter((item) => item.incidentId === incident.id && item.type === "unit_assigned").length, 1);
});

test("real PostgreSQL concurrent incidents cannot claim the same unit", async () => {
  const a = await assignmentFixture("claim-a");
  const b = await assignmentFixture("claim-b");
  const responses = await Promise.all([a.incident, b.incident].map((incident) => request(`/api/incidents/${incident.id}/assign-unit`, { cookie: admin, method: "POST", body: { unitId: a.unit.id, expectedAssignedUnitId: null } })));
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const db = await readDatabase();
  assert.equal(db.incidents.filter((item) => item.assignedUnitId === a.unit.id).length, 1);
  const winner = db.incidents.find((item) => item.assignedUnitId === a.unit.id);
  const assignedUnit = db.responseUnits.find((item) => item.id === a.unit.id);
  assert.equal(assignedUnit.status, "busy");
  assert.equal(assignedUnit.assignedIncidentId, winner.id);
  assert.equal(db.auditLogs.filter((item) => [a.incident.id, b.incident.id].includes(item.incidentId) && item.action === "unit_assigned").length, 1);
  assert.equal(db.dispatchEvents.filter((item) => [a.incident.id, b.incident.id].includes(item.incidentId) && item.type === "unit_assigned").length, 1);
});

test("real PostgreSQL assignment COMMIT failure rolls back incident, unit, event and audit together", async () => {
  const { incident, unit } = await assignmentFixture("rollback");
  const before = await readDatabase();
  await query(`CREATE FUNCTION release_reject_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'test assignment commit failure' USING ERRCODE = '23514'; END $$`);
  await query(`CREATE CONSTRAINT TRIGGER release_reject_assignment AFTER UPDATE ON incidents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION release_reject_assignment()`);
  try {
    const response = await request(`/api/incidents/${incident.id}/assign-unit`, { cookie: admin, method: "POST", body: { unitId: unit.id, expectedAssignedUnitId: null } });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Internal server error" });
    const after = await readDatabase();
    for (const collection of ["incidents", "responseUnits", "dispatchEvents", "auditLogs"]) {
      assert.deepEqual(after[collection], before[collection], `${collection} must roll back`);
    }
  } finally {
    await query("DROP TRIGGER release_reject_assignment ON incidents");
    await query("DROP FUNCTION release_reject_assignment()");
  }
});

test("real PostgreSQL concurrent migration runners apply a pending migration exactly once", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-migration-test-"));
  const migrationsDir = path.join(directory, "migrations");
  const schemaPath = path.join(directory, "base.sql");
  fs.mkdirSync(migrationsDir);
  fs.writeFileSync(schemaPath, "SELECT 1;");
  fs.writeFileSync(path.join(migrationsDir, "release-pending_once.sql"), "CREATE TABLE release_pending_once (id INTEGER); INSERT INTO release_pending_once VALUES (1);");
  try {
    const run = () => withMigrationLock((client) => runMigrations({ client, migrationsDir, schemaPath }));
    await Promise.all([run(), run()]);
    await run();
    assert.equal((await query("SELECT count(*)::int AS count FROM release_pending_once")).rows[0].count, 1);
    assert.equal((await query("SELECT 1 FROM schema_migrations WHERE version = 'release-pending'")).rowCount, 1);
  } finally {
    await query("DROP TABLE IF EXISTS release_pending_once");
    await query("DELETE FROM schema_migrations WHERE version = 'release-pending'");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("real PostgreSQL migration tracking-row failure rolls back successful DDL", async () => {
  await query(`CREATE FUNCTION release_reject_migration() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'test migration tracking failure' USING ERRCODE = '23514'; END $$`);
  await query(`CREATE TRIGGER release_reject_migration BEFORE INSERT ON schema_migrations FOR EACH ROW EXECUTE FUNCTION release_reject_migration()`);
  try {
    await assert.rejects(withMigrationLock((client) => applyMigration(client, {
      version: "release-tracking-failure", name: "release-tracking-failure", content: "CREATE TABLE release_tracking_failed (id TEXT);"
    })), { code: "23514" });
    assert.equal((await query("SELECT to_regclass('release_tracking_failed') AS table_name")).rows[0].table_name, null);
    assert.equal((await query("SELECT 1 FROM schema_migrations WHERE version = 'release-tracking-failure'")).rowCount, 0);
  } finally {
    await query("DROP TRIGGER release_reject_migration ON schema_migrations");
    await query("DROP FUNCTION release_reject_migration()");
  }
});

test("real PostgreSQL migrations are repeatable and failing DDL is rolled back", async () => {
  await Promise.all([1, 2].map(() => withMigrationLock((client) => runMigrations({ client }))));
  const client = await getPool().connect();
  try {
    await assert.rejects(applyMigration(client, { version: "release-failure", name: "release-failure", content: "CREATE TABLE release_failed_ddl (id TEXT); SELECT 1 / 0;" }));
    assert.equal((await client.query("SELECT to_regclass('release_failed_ddl') AS table_name")).rows[0].table_name, null);
    assert.equal((await client.query("SELECT 1 FROM schema_migrations WHERE version = 'release-failure'")).rowCount, 0);
  } finally { client.release(); }
});
