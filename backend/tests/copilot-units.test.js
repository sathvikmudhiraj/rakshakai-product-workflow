const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-unit-copilot-"));
process.env.RAKSHAKAI_DATA_FILE = path.join(directory, "db.json");
process.env.DATABASE_URL = "";
process.env.NODE_ENV = "test";
const { answer } = require("../services/copilotRead.service");
const { dispatchEligibilitySnapshot, unitForResponse } = require("../services/core.service");

function fixture() {
  const current = new Date().toISOString(), old = new Date(Date.now() - 3600000).toISOString();
  return {
    users: [{ id: "officer", role: "Police Officer", status: "active" }],
    policeOfficers: [{ id: "officer", userId: "officer", active: true, dutyStatus: "on_duty", availabilityStatus: "available" }],
    responseUnitMembers: [{ unitId: "live", officerUserId: "officer" }],
    responseUnits: [
      { id: "live", unitCode: "P-01", unitType: "police_patrol", status: "available", operational: true, source: "admin_registry", lat: 17.5, lng: 78.3, latitude: 17.5, longitude: 78.3, locationSource: "live_gps", locationAccuracy: 20, locationCapturedAt: current },
      { id: "stale", unitCode: "FX-P-02", unitType: "police_patrol", status: "available", operational: true, source: "admin_registry", lat: 17.5, lng: 78.3, latitude: 17.5, longitude: 78.3, locationSource: "live_gps", locationAccuracy: 20, locationCapturedAt: old },
      { id: "busy", unitCode: "P-03", unitType: "police_patrol", status: "busy", operational: true, assignedIncidentId: "INC-OTHER" },
      { id: "offline", unitCode: "P-04", unitType: "police_patrol", status: "offline", operational: false }
    ],
    policeStations: [], incidents: [{ id: "INC-SELECTED", status: "Verified", stationId: "allowed" }, { id: "INC-OTHER", status: "Assigned", assignedUnitId: "busy", stationId: "other" }], unitCapabilities: [], slaConfig: [], cameraSources: [], trackingSessions: []
  };
}
const opts = { actor: { role: "Admin" }, dispatchEligibilitySnapshot, unitForResponse };
const query = (db, message, extra = {}) => answer(db, message, { ...opts, ...extra });

test("unit totals ignore incident context and distinguish overlapping categories", () => {
  const db = fixture();
  for (const prompt of ["total units", "how many units"]) {
    const value = query(db, prompt, { pageContext: { page: "unit-assignment", entityId: "INC-SELECTED" } });
    assert.match(value.answer, /Total registered response units: 4/);
    assert.match(value.answer, /Registry-available: 2/);
    assert.match(value.answer, /Busy or committed: 1/);
    assert.match(value.answer, /categories can overlap/i);
  }
});

test("all, available, busy, offline and stale lists represent distinct recorded states", () => {
  const db = fixture();
  const all = query(db, "all units").answer;
  for (const id of ["P-01", "FX-P-02", "P-03", "P-04"]) assert.match(all, new RegExp(id));
  const available = query(db, "available units").answer;
  assert.match(available, /FX-P-02.*GPS STALE.*Not live dispatch-eligible/);
  assert.doesNotMatch(available, /P-03|P-04/);
  assert.match(query(db, "busy units").answer, /P-03/);
  assert.doesNotMatch(query(db, "busy units").answer, /FX-P-02/);
  assert.match(query(db, "offline units").answer, /P-04/);
  assert.match(query(db, "stale units").answer, /FX-P-02.*GPS STALE/);
  assert.match(query(db, "show FX-P-02").answer, /GPS freshness: STALE/);
});

test("Copilot eligibility is the canonical live dispatch snapshot and excludes committed units", () => {
  const db = fixture();
  const snapshot = dispatchEligibilitySnapshot(db, {});
  assert.deepEqual(snapshot.eligible.map(x => x.id), ["live"], JSON.stringify({ available: snapshot.available, excluded: snapshot.primaryEligibilityExcluded, capabilities: snapshot.capabilityExcluded }));
  const response = query(db, "dispatch eligible units");
  assert.match(response.answer, /P-01/);
  assert.doesNotMatch(response.answer, /FX-P-02|P-03|P-04/);
  db.responseUnits[0].assignedIncidentId = "INC-OTHER";
  assert.equal(dispatchEligibilitySnapshot(db, {}).eligible.length, 0);
  assert.doesNotMatch(query(db, "dispatch eligible units").answer, /P-01/);
});

test("selected recommendations distinguish missing, timeout, and no eligible units", () => {
  const db = fixture(), pageContext = { page: "unit-assignment", entityId: "INC-SELECTED" };
  assert.match(query(db, "which unit is recommended?", { pageContext }).answer, /No current dispatch recommendation.*INC-SELECTED/);
  assert.match(query(db, "which unit is recommended?", { pageContext: { ...pageContext, recommendationTimedOut: true } }).answer, /temporarily unavailable.*timed out/i);
  db.responseUnits[0].locationCapturedAt = "2020-01-01T00:00:00Z";
  assert.match(query(db, "which unit is recommended?", { pageContext }).answer, /No dispatch-eligible response unit/);
  db.incidents[0].dispatchRecommendation = { primary: { unitId: "live", unit: { unitCode: "P-01" } } };
  assert.match(query(db, "which unit is recommended?", { pageContext }).answer, /Recommended Unit: P-01/);
});

test("unit questions remain read-only and Citizen receives no unit details", () => {
  const db = fixture(), before = JSON.stringify(db);
  assert.doesNotMatch(JSON.stringify(query(db, "all units", { actor: { role: "Citizen" } })), /FX-P-02|P-01/);
  assert.doesNotMatch(JSON.stringify(query(db, "show P-01", { actor: { role: "Citizen" } })), /GPS|location/i);
  assert.equal(query(db, "assign P-01").blockedWriteRequest, true);
  query(db, "total units");
  assert.equal(JSON.stringify(db), before);
});

test("Telugu totals retain the real unit count", () => {
  assert.match(query(fixture(), "మొత్తం యూనిట్లు ఎన్ని?", { selectedLanguage: "te" }).answer, /మొత్తం నమోదైన response units: 4/);
});
