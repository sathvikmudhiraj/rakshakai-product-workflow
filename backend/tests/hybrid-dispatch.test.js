const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  comparePrimaryDispatchCandidates,
  unitUnavailableReason,
  recommendStationSupport,
  responseRequirementsForIncident,
  stationCapacitySnapshot
} = require("../services/hybridDispatch.service");

function fixture() {
  const users = Array.from({ length: 7 }, (_, index) => ({ id: `officer-${index + 1}`, role: "Police Officer", status: "active" }));
  const policeOfficers = users.map((user, index) => ({
    id: user.id,
    userId: user.id,
    stationId: index < 2 ? "station-a" : "station-b",
    active: true,
    dutyStatus: "on_duty",
    availabilityStatus: "available"
  }));
  const responseUnits = [
    { id: "unit-a", stationId: "station-a", status: "available", operational: true },
    { id: "unit-b1", stationId: "station-b", status: "available", operational: true },
    { id: "unit-b2", stationId: "station-b", status: "available", operational: true }
  ];
  return {
    users,
    policeOfficers,
    responseUnits,
    responseUnitMembers: [],
    unitCapabilities: [],
    incidents: [],
    policeStations: [
      { id: "station-a", stationId: "STA", stationName: "Near Station", lat: 17.5, lng: 78.3, operational: true },
      { id: "station-b", stationId: "STB", stationName: "Capacity Station", lat: 17.6, lng: 78.4, operational: true }
    ]
  };
}

const routeForStation = async (station) => ({
  durationSeconds: station.id === "station-a" ? 300 : 480,
  distanceMeters: station.id === "station-a" ? 2000 : 5000,
  provider: "osrm",
  approximate: false
});

test("incident response requirements are explicit and severity-sensitive", () => {
  assert.deepEqual(responseRequirementsForIncident({ severity: "high" }), {
    primaryResponderRequired: true,
    supportingOfficers: 3,
    responseUnits: 1,
    requiredCapabilities: []
  });
  assert.equal(responseRequirementsForIncident({ severity: "critical" }).supportingOfficers, 4);
  assert.equal(responseRequirementsForIncident({ responseRequirements: { supportingOfficers: 6, responseUnits: 3 } }).supportingOfficers, 6);
});

test("primary ranking prefers route ETA over shorter physical distance", () => {
  const closerSlow = { etaSeconds: 720, route: { distanceMeters: 1500 }, stationEligibility: { beatMatch: true }, capabilityMatch: { matches: true }, loadScore: 0, sourcePriority: 0, unit: { unitCode: "P-1" } };
  const fartherFast = { etaSeconds: 360, route: { distanceMeters: 3000 }, stationEligibility: {}, capabilityMatch: { matches: true }, loadScore: 0, sourcePriority: 0, unit: { unitCode: "P-2" } };
  assert.equal([closerSlow, fartherFast].sort(comparePrimaryDispatchCandidates)[0].unit.unitCode, "P-2");
});

test("station capacity excludes busy officers and units from canonical records", () => {
  const db = fixture();
  db.policeOfficers[0].availabilityStatus = "busy";
  db.responseUnits[0].status = "busy";
  const capacity = stationCapacitySnapshot(db, db.policeStations[0]);
  assert.equal(capacity.totalOfficers, 2);
  assert.equal(capacity.availableOfficers, 1);
  assert.equal(capacity.totalUnits, 1);
  assert.equal(capacity.availableUnits, 0);
});

test("nearest partial station is combined with minimum overflow support without duplicate resources", async () => {
  const db = fixture();
  const result = await recommendStationSupport({
    db,
    incident: { id: "incident-1", lat: 17.51, lng: 78.31 },
    requirements: { supportingOfficers: 4, responseUnits: 2, requiredCapabilities: [] },
    routeForStation
  });
  assert.equal(result.complete, true);
  assert.equal(result.allocations.length, 2);
  assert.equal(result.allocations[0].stationId, "station-a");
  assert.equal(result.allocations[0].recommendedOfficers, 2);
  assert.equal(result.allocations[0].recommendedUnits, 1);
  assert.equal(result.allocations[1].recommendedOfficers, 2);
  assert.equal(result.allocations[1].recommendedUnits, 1);
  const officerIds = result.allocations.flatMap((allocation) => allocation.officerIds);
  const unitIds = result.allocations.flatMap((allocation) => allocation.unitIds);
  assert.equal(new Set(officerIds).size, officerIds.length);
  assert.equal(new Set(unitIds).size, unitIds.length);
});

test("station with no deployable capacity is skipped for the next capable station", async () => {
  const db = fixture();
  db.policeOfficers.filter((officer) => officer.stationId === "station-a").forEach((officer) => { officer.dutyStatus = "off_duty"; });
  db.responseUnits[0].status = "maintenance";
  const result = await recommendStationSupport({
    db,
    incident: { id: "incident-2", lat: 17.51, lng: 78.31 },
    requirements: { supportingOfficers: 2, responseUnits: 1, requiredCapabilities: [] },
    routeForStation
  });
  assert.equal(result.allocations[0].stationId, "station-b");
  assert.equal(result.candidates.find((candidate) => candidate.stationId === "station-a").rejectionReason, "INSUFFICIENT CAPACITY");
});

test("maintenance and decommissioned units are never deployable", () => {
  assert.equal(unitUnavailableReason({ id: "maintained", status: "maintenance", operational: true }, new Set()), "MAINTENANCE");
  assert.equal(unitUnavailableReason({ id: "retired", status: "decommissioned", operational: true }, new Set()), "DECOMMISSIONED");
});

test("hybrid dispatch schema and migration persist typed recommendation and workload fields", () => {
  const schema = fs.readFileSync(path.join(__dirname, "..", "database", "schema.sql"), "utf8");
  const migration = fs.readFileSync(path.join(__dirname, "..", "database", "migrations", "007_hybrid_rapid_dispatch.sql"), "utf8");
  for (const source of [schema, migration]) {
    assert.match(source, /response_requirements JSONB/i);
    assert.match(source, /dispatch_recommendation JSONB/i);
    assert.match(source, /support_allocations JSONB/i);
    assert.match(source, /duty_status TEXT/i);
    assert.match(source, /availability_status TEXT/i);
    assert.match(source, /assigned_incident_id TEXT/i);
  }
});
