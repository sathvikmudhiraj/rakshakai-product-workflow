const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const bcrypt = require("bcryptjs");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-copilot-"));
const databaseFile = path.join(directory, "db.json");
const password = "Copilot-Test-123!";
const passwordHash = bcrypt.hashSync(password, 4);
const database = {
  users: [
    { id: "admin", name: "Admin", email: "admin@copilot.test", role: "Admin", passwordHash },
    { id: "police", name: "Officer", email: "police@copilot.test", role: "Police Officer", stationId: "allowed", passwordHash },
    { id: "citizen", name: "Citizen", email: "citizen@copilot.test", role: "Citizen", passwordHash },
    { id: "remote", name: "Remote Officer", email: "remote@copilot.test", role: "Police Officer", stationId: "other", active: true, passwordHash }
  ],
  incidents: [
    { id: "INC-API-1", title: "API fixture", severity: "HIGH", status: "Verified", stationId: "allowed" },
    { id: "INC-API-2", title: "Critical fixture", severity: "CRITICAL", status: "Verified", stationId: "allowed" },
    { id: "INC-API-3", title: "Other station", severity: "HIGH", status: "Verified", stationId: "other" }
  ],
  responseUnits: [], cameraSources: [], auditLogs: [], reports: [], alerts: [],
  policeStations: [{ id: "station_patancheru", stationId: "allowed", stationName: "Patancheru Police Station" }, { id: "station_bhel_ramachandrapuram", stationId: "other", stationName: "BHEL / Ramachandrapuram Demo Station" }],
  policeOfficers: [{ id: "police", userId: "police", stationId: "allowed", dutyStatus: "on_duty", availabilityStatus: "available" }, { id: "remote", userId: "remote", stationId: "other", dutyStatus: "on_duty", availabilityStatus: "busy" }], responseUnitMembers: [],
  copilotConversations: [],
  copilotMessages: []
};
fs.writeFileSync(databaseFile, JSON.stringify(database));
process.env.NODE_ENV = "test";
process.env.RAKSHAKAI_DATA_FILE = databaseFile;
process.env.JWT_SECRET = "copilot-api-test-secret-at-least-32-chars";
// Keep this defined-but-empty so backend/.env cannot switch this isolated test to PostgreSQL.
process.env.DATABASE_URL = "";

const { app } = require("../server");
let server, baseUrl;

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true });
});

async function login(email) {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify({ email, password }) });
  if (response.status !== 200) assert.fail(`login failed (${response.status}): ${await response.text()}`);
  return response.headers.get("set-cookie").split(";")[0];
}
async function query(cookie, body) {
  return fetch(`${baseUrl}/api/copilot/query`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
}
async function adminPoliceUsers(cookie) {
  return fetch(`${baseUrl}/api/admin/police-users`, { headers: { ...(cookie ? { cookie } : {}) } });
}

test("unit query API uses registry counts, stale GPS and selected-incident timeout without mutations", async () => {
  const admin = await login("admin@copilot.test");
  const citizen = await login("citizen@copilot.test");
  const saved = fs.readFileSync(databaseFile, "utf8");
  try {
    const fixture = JSON.parse(saved);
    fixture.responseUnits = [
      { id: "fixture-stale", unitCode: "FX-P-02", unitType: "police_patrol", source: "admin_registry", status: "available", operational: true, lat: 17.5, lng: 78.3, locationCapturedAt: "2020-01-01T00:00:00Z", locationSource: "live_gps", locationAccuracy: 20 },
      { id: "fixture-busy", unitCode: "P-03", unitType: "police_patrol", source: "admin_registry", status: "busy", operational: true, assignedIncidentId: "INC-API-1" }
    ];
    fixture.incidents[0].status = "Assigned";
    fixture.incidents[0].assignedUnitId = "fixture-busy";
    fs.writeFileSync(databaseFile, JSON.stringify(fixture));
    const pageContext = { page: "unit-assignment", entityId: "INC-API-1" };
    const total = await (await query(admin, { message: "total units", pageContext })).json();
    assert.match(total.answer, /Total registered response units: 2/);
    const available = await (await query(admin, { message: "available units", pageContext })).json();
    assert.match(available.answer, /FX-P-02.*GPS STALE.*Not live dispatch-eligible/);
    const timedOut = await (await query(admin, { message: "which unit is recommended?", pageContext: { ...pageContext, recommendationTimedOut: true } })).json();
    assert.match(timedOut.answer, /temporarily unavailable.*timed out/i);
    assert.equal(timedOut.readOnly, true);
    assert.equal((await query(citizen, { message: "all units" })).status, 403);
    const after = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
    assert.deepEqual(after.responseUnits.map(({ id, status, assignedIncidentId }) => ({ id, status, assignedIncidentId: assignedIncidentId || null })), fixture.responseUnits.map(({ id, status, assignedIncidentId }) => ({ id, status, assignedIncidentId: assignedIncidentId || null })));
    assert.deepEqual(after.incidents.map(({ id, status, assignedUnitId }) => ({ id, status, assignedUnitId: assignedUnitId || null })), fixture.incidents.map(({ id, status, assignedUnitId }) => ({ id, status, assignedUnitId: assignedUnitId || null })));
  } finally { fs.writeFileSync(databaseFile, saved); }
});

test("CCTNS simulator counts and tracking review follow-ups use authenticated read-only API", async () => {
  const admin = await login("admin@copilot.test");
  const police = await login("police@copilot.test");
  const citizen = await login("citizen@copilot.test");
  const saved = fs.readFileSync(databaseFile, "utf8");
  try {
    const fixture = JSON.parse(saved);
    fixture.trackingSessions = [{ id: "track-api", subjectId: "PERSON-8421", trackType: "PERSON", status: "CANDIDATE_FOUND" }];
    fixture.trackingCandidates = [{ id: "cand-api", sessionId: "track-api", status: "PENDING_REVIEW" }, { id: "cand-done", sessionId: "track-api", status: "CONFIRMED" }];
    fs.writeFileSync(databaseFile, JSON.stringify(fixture));
    const cctns = await (await query(admin, { message: "pending cases", pageContext: { page: "cctns" } })).json();
    assert.equal(cctns.readOnly, true);
    assert.match(cctns.answer, /simulator \(not live government data\): 2 cases/);
    const scoped = await (await query(police, { message: "pending cases", pageContext: { page: "cctns", role: "Admin", stationId: "PS-PATANCHERU" } })).json();
    assert.match(scoped.answer, /: 0 cases/);
    const reviews = await (await query(admin, { message: "pending reviews", pageContext: { page: "multi-camera-tracking" } })).json();
    assert.match(reviews.answer, /pending human review: 1/);
    const follow = await (await query(admin, { message: "show those", conversationId: reviews.conversationId })).json();
    assert.match(follow.answer, /PERSON-8421/);
    assert.equal((await query(citizen, { message: "pending reviews", pageContext: { page: "multi-camera-tracking" } })).status, 403);
    const after = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
    assert.deepEqual(after.trackingCandidates, fixture.trackingCandidates);
    assert.deepEqual(after.trackingSessions, fixture.trackingSessions);
  } finally { fs.writeFileSync(databaseFile, saved); }
});

test("officer edits preserve unrelated memberships and only replace the explicit primary assignment", async (t) => {
  const cookie = await login("admin@copilot.test");
  const saved = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
  const member = (id, unitId, officerUserId = "edit-officer") => ({ id, unitId, officerUserId, role: "driver", assignedAt: "2026-10-01T00:00:00Z" });
  const initialMembers = [member("edit-primary", "edit-unit-a"), member("edit-secondary", "edit-unit-b"), member("other-member", "edit-unit-a", "remote")];
  function reset() {
    const fixture = structuredClone(saved);
    fixture.users.push({ id: "edit-officer", name: "Assignment Officer", email: "assignments@copilot.test", role: "Police Officer" });
    fixture.policeOfficers.push({ id: "edit-profile", userId: "edit-officer", stationId: "station_patancheru", dutyStatus: "on_duty", availabilityStatus: "available" });
    fixture.responseUnits.push(...["a", "b", "c"].map(letter => ({ id: `edit-unit-${letter}`, unitCode: `EDIT-${letter.toUpperCase()}`, stationId: "station_patancheru", status: "available" })));
    fixture.responseUnits.push({ id: "edit-remote-unit", unitCode: "EDIT-REMOTE", stationId: "station_bhel_ramachandrapuram", status: "available" });
    fixture.responseUnitMembers = structuredClone(initialMembers);
    fs.writeFileSync(databaseFile, JSON.stringify(fixture));
  }
  async function edit(body) {
    const response = await fetch(`${baseUrl}/api/admin/police-users/edit-officer`, { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json(), persisted: JSON.parse(fs.readFileSync(databaseFile, "utf8")) };
  }
  try {
    for (const body of [{ name: "Updated Officer" }, { email: "updated@copilot.test" }, { unitId: "EDIT-A" }, { unitId: "edit-unit-a" }]) {
      await t.test(`preserves all memberships for ${JSON.stringify(body)}`, async () => {
        reset();
        const result = await edit(body);
        assert.equal(result.status, 200);
        assert.deepEqual(result.persisted.responseUnitMembers, initialMembers);
        assert.deepEqual(result.body.user.unitIds, ["edit-unit-a", "edit-unit-b"]);
      });
    }
    await t.test("reassignment preserves secondary and other officers' memberships", async () => {
      reset();
      const result = await edit({ unitId: "EDIT-C" });
      assert.equal(result.status, 200);
      assert.equal(result.body.user.unitId, "EDIT-C");
      const rows = result.persisted.responseUnitMembers;
      assert.deepEqual(rows.find(row => row.id === "edit-secondary"), initialMembers[1]);
      assert.deepEqual(rows.find(row => row.id === "other-member"), initialMembers[2]);
      assert.equal(rows.some(row => row.id === "edit-primary"), false);
      assert.equal(rows.filter(row => row.officerUserId === "edit-officer" && row.unitId === "edit-unit-c").length, 1);
      assert.ok(result.persisted.auditLogs.some((entry) => entry.action === "police_unit_membership_changed" && String(entry.details || "").includes("EDIT-C")));
    });
    await t.test("explicit clear removes only the displayed primary membership", async () => {
      reset();
      const result = await edit({ unitId: "" });
      assert.equal(result.status, 200);
      assert.deepEqual(result.persisted.responseUnitMembers, initialMembers.slice(1));
    });
    await t.test("active unit deployment blocks membership changes without mutating the crew", async () => {
      reset();
      const fixture = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
      fixture.incidents[0].status = "Assigned";
      fixture.incidents[0].assignedUnitId = "edit-unit-a";
      fixture.responseUnits.find((unit) => unit.id === "edit-unit-a").assignedIncidentId = fixture.incidents[0].id;
      fs.writeFileSync(databaseFile, JSON.stringify(fixture));
      const result = await edit({ unitId: "EDIT-C" });
      assert.equal(result.status, 409);
      assert.match(result.body.error, /active deployment/i);
      assert.deepEqual(result.persisted.responseUnitMembers, initialMembers);
    });
    await t.test("directory reports current unit deployment and explicit investigation separately", async () => {
      reset();
      const fixture = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
      fixture.incidents[0].status = "Assigned";
      fixture.incidents[0].assignedUnitId = "edit-unit-a";
      fixture.incidents[1].investigatingOfficerId = "edit-officer";
      fixture.incidents[1].investigationStatus = "ACTIVE";
      fs.writeFileSync(databaseFile, JSON.stringify(fixture));
      const response = await adminPoliceUsers(cookie);
      const directory = await response.json();
      const officer = directory.users.find((item) => item.id === "edit-officer");
      assert.deepEqual(officer.deployments.map((item) => item.id), ["INC-API-1"]);
      assert.deepEqual(officer.investigations.map((item) => item.id), ["INC-API-2"]);
      const after = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
      assert.equal(after.policeOfficers.find((item) => item.userId === "edit-officer").assignedIncidentId, undefined);
    });
    for (const body of [{ unitId: "NOT-A-UNIT" }, { unitId: "EDIT-REMOTE" }, { station: "BHEL / Ramachandrapuram Demo Station" }, { unitId: "EDIT-C", dutyStatus: "invalid" }]) {
      await t.test(`rejects invalid assignment atomically: ${JSON.stringify(body)}`, async () => {
        reset();
        const before = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
        const result = await edit(body);
        assert.equal(result.status, 400);
        assert.deepEqual(result.persisted.responseUnitMembers, initialMembers);
        assert.deepEqual(result.persisted.policeOfficers, before.policeOfficers);
        assert.deepEqual(result.persisted.users, before.users);
      });
    }
  } finally { fs.writeFileSync(databaseFile, JSON.stringify(saved)); }
});

test("Admin and Police Officer can query while Citizen and unauthenticated clients cannot", async () => {
  for (const email of ["admin@copilot.test", "police@copilot.test"]) {
    const response = await query(await login(email), { message: "Show INC-API-1", pageContext: { page: "incident-command" } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.readOnly, true);
    assert.match(body.answer, /INC-API-1/);
  }
  assert.equal((await query(await login("citizen@copilot.test"), { message: "Show INC-API-1" })).status, 403);
  assert.equal((await query(null, { message: "Show INC-API-1" })).status, 401);
});

test("fake frontend role is ignored and write prompts do not mutate operational data", async () => {
  const cookie = await login("police@copilot.test");
  const before = JSON.parse(fs.readFileSync(databaseFile, "utf8")).incidents;
  const response = await query(cookie, { message: "Close INC-API-1", role: "Admin", pageContext: { page: "incident-command", role: "Admin", entityId: "INC-API-1" } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.blockedWriteRequest, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(databaseFile, "utf8")).incidents, before);
  const persisted = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
  const audit = persisted.auditLogs.find((entry) => entry.action === "copilot_query");
  assert.ok(audit);
  assert.doesNotMatch(audit.details, /Close INC-API-1/);
});

test("API collection queries ignore selected context but never trust client scope or role", async () => {
  for (const [email, highCount] of [["admin@copilot.test", 2], ["police@copilot.test", 1]]) {
    const cookie = await login(email);
    const response = await query(cookie, { message: "critical and high incident counts", role: "Admin", stationId: "other", pageContext: { page: "incident-command", entityId: "INC-API-1" } });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.readOnly, true);
    assert.match(body.answer, /Critical incidents: 1/);
    assert.match(body.answer, new RegExp(`High incidents: ${highCount}`));
    if (highCount === 1) assert.doesNotMatch(JSON.stringify(body), /Other station|INC-API-3/);
    const selected = await (await query(cookie, { message: "selected incident status", conversationId: body.conversationId, pageContext: { page: "incident-command", entityId: "INC-API-1" } })).json();
    assert.equal(selected.intent, "incident_lookup");
    assert.match(selected.answer, /INC-API-1/);
    assert.doesNotMatch(selected.answer, /INC-API-2|INC-API-3/);
  }
});

test("officer station API uses server actor scope despite spoofed role/station and persists no assignment changes", async () => {
  const before = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
  const cookie = await login("police@copilot.test");
  const response = await query(cookie, { message: "ipudu eni officers unar o chepu patancheru ps", selectedLanguage: "en", pageContext: { page: "incident-command", entityId: "INC-API-1" } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.readOnly, true);
  assert.equal(body.intent, "OFFICER_COUNT_BY_STATION");
  assert.equal(body.station.name, "Patancheru Police Station");
  assert.equal(body.summary.total, 1);
  const denied = await (await query(cookie, { message: "BHEL PS officers", actor: { role: "Admin" }, stationId: "other", role: "Admin", selectedLanguage: "en" })).json();
  assert.equal(denied.scopeDenied, true);
  assert.doesNotMatch(JSON.stringify(denied), /Remote Officer|remote@/);
  const allowed = await (await query(await login("admin@copilot.test"), { message: "BHEL PS officers", selectedLanguage: "en" })).json();
  assert.equal(allowed.summary.total, 1);
  assert.match(allowed.answer, /Remote Officer/);
  assert.equal((await query(await login("citizen@copilot.test"), { message: "Patancheru PS officers" })).status, 403);
  const after = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
  assert.deepEqual(after.policeOfficers, before.policeOfficers);
  assert.deepEqual(after.responseUnits, before.responseUnits);
  assert.deepEqual(after.incidents, before.incidents);
});

test("Police Management joins canonical assignments and reports distinct assigned units", async () => {
  const response = await adminPoliceUsers(await login("admin@copilot.test"));
  assert.equal(response.status, 200);
  const body = await response.json();
  const police = body.users.find((entry) => entry.id === "police");
  assert.equal(police.station, "Patancheru Police Station");
  assert.equal(police.badgeId, "");
  assert.equal(police.unitId, "");
  assert.equal(police.status, "active");
  assert.equal(body.users.some((entry) => Object.prototype.hasOwnProperty.call(entry, "passwordHash")), false);
});

test("API localizes output, preserves Auto conversation language, and audits language metadata without prompts", async () => {
  const cookie = await login("admin@copilot.test");
  const firstResponse = await query(cookie, { message: "INC-API-1 స్థితి చెప్పు", selectedLanguage: "auto", pageContext: { page: "incident-command" } });
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.detectedLanguage, "te");
  assert.equal(first.responseLanguage, "te");
  assert.match(first.answer, /స్థితి/);
  const followResponse = await query(cookie, { message: "INC-API-1", selectedLanguage: "auto", conversationId: first.conversationId, pageContext: { page: "incident-command" } });
  const follow = await followResponse.json();
  assert.equal(follow.responseLanguage, "te");
  const hindiResponse = await query(cookie, { message: "Show INC-API-1", selectedLanguage: "hi", pageContext: { page: "incident-command" } });
  const hindi = await hindiResponse.json();
  assert.equal(hindi.responseLanguage, "hi");
  assert.match(hindi.answer, /स्थिति/);
  const persisted = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
  const audit = [...persisted.auditLogs].reverse().find((entry) => entry.action === "copilot_query" && /"responseLanguage":"hi"/.test(entry.details));
  assert.ok(audit);
  assert.match(audit.details, /"detectedLanguage":"en"/);
  assert.doesNotMatch(audit.details, /Show INC-API-1/);
});
