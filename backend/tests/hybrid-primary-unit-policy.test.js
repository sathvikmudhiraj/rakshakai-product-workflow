const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { canCreateHybridSupport, primaryUnitRequired } = require("../services/hybridSupportPolicy.service");
const { recommendStationSupport } = require("../services/hybridDispatch.service");

test("hybrid support creation rejects an incident without a primary unit", () => {
  assert.deepEqual(primaryUnitRequired({ id: "incident-1", assignedUnitId: null }), {
    status: 409,
    payload: {
      error: "Assign a primary response unit before requesting hybrid support",
      code: "PRIMARY_UNIT_REQUIRED"
    }
  });
  assert.equal(canCreateHybridSupport({ id: "incident-1" }), false);
});

test("hybrid support is allowed only after a primary unit exists", () => {
  assert.equal(primaryUnitRequired({ id: "incident-1", assignedUnitId: "P-01" }), null);
  assert.equal(canCreateHybridSupport({ id: "incident-1", assignedUnitId: "P-01" }), true);
});

test("the hybrid confirmation endpoint applies the primary-unit guard before support mutation", () => {
  const core = fs.readFileSync(path.join(__dirname, "..", "services", "core.service.js"), "utf8");
  const confirmation = core.slice(core.indexOf("async function confirmHybridDispatch"), core.indexOf("async function rejectHybridDispatchRecommendation"));
  assert.match(confirmation, /const primaryRequired = primaryUnitRequired\(incident\);/);
  assert.match(confirmation, /if \(primaryRequired\) return primaryRequired;/);
  assert.doesNotMatch(confirmation, /incident\.assignedUnitId\s*=/);
  assert.match(confirmation, /"DISPATCH_CONFIRMED"/);
});

test("station support remains calculable after primary assignment and excludes primary resources", async () => {
  const db = {
    users: [
      { id: "primary-officer", role: "Police Officer", status: "active" },
      { id: "support-officer", role: "Police Officer", status: "active" }
    ],
    policeOfficers: [
      { id: "primary-officer", userId: "primary-officer", stationId: "station-a", active: true, dutyStatus: "on_duty", availabilityStatus: "available" },
      { id: "support-officer", userId: "support-officer", stationId: "station-b", active: true, dutyStatus: "on_duty", availabilityStatus: "available" }
    ],
    responseUnits: [
      { id: "P-01", stationId: "station-a", status: "busy", operational: true, assignedIncidentId: "incident-1" },
      { id: "FX-P-01", stationId: "station-b", status: "available", operational: true }
    ],
    responseUnitMembers: [{ unitId: "P-01", officerUserId: "primary-officer" }],
    unitCapabilities: [],
    incidents: [{ id: "incident-1", assignedUnitId: "P-01", status: "Assigned" }],
    policeStations: [{ id: "station-b", stationId: "ST-B", stationName: "Support Station", lat: 17.5, lng: 78.3, operational: true }]
  };
  const result = await recommendStationSupport({
    db,
    incident: db.incidents[0],
    primaryUnitId: "P-01",
    requirements: { supportingOfficers: 1, responseUnits: 1, requiredCapabilities: [] },
    routeForStation: async () => ({ durationSeconds: 300, distanceMeters: 2000, provider: "osrm", approximate: false })
  });

  assert.equal(result.allocations.length, 1);
  assert.deepEqual(result.allocations[0].unitIds, ["FX-P-01"]);
  assert.deepEqual(result.allocations[0].officerIds, ["support-officer"]);
  assert.equal(result.allocations[0].unitIds.includes("P-01"), false);
  assert.equal(result.allocations[0].officerIds.includes("primary-officer"), false);
});
