const test = require("node:test");
const assert = require("node:assert/strict");
const policeManagement = require("../services/policeManagement.service");

function fixture() {
  return {
    users: [{ id: "officer-1", role: "Police Officer", name: "Test Officer", status: "active", active: true }],
    policeOfficers: [{ id: "officer-1", userId: "officer-1", stationId: "station-1", rankId: "rank-1", active: true, dutyStatus: "on_duty" }],
    policeStations: [{ id: "station-1", name: "Central Station" }],
    officerRanks: [{ id: "rank-1", name: "Inspector", active: true }],
    responseUnits: [{ id: "unit-1", unitCode: "FX-P-02", stationId: "station-1", operational: true }],
    responseUnitMembers: [],
    incidents: [],
    incidentOfficerAssignments: []
  };
}

test("membership eligibility accepts an active registered officer with a registered rank at the unit station", () => {
  const db = fixture();
  const eligibility = policeManagement.membershipEligibility(db, db.responseUnits[0], "officer-1");
  assert.equal(eligibility.eligible, true);
  assert.deepEqual(eligibility.reasons, []);
  assert.equal(policeManagement.validateMember(db, db.responseUnits[0], "officer-1", "member").profile.rankId, "rank-1");
  db.responseUnits[0].operational = false;
  assert.equal(policeManagement.membershipEligibility(db, db.responseUnits[0], "officer-1").reasons[0].code, "UNIT_NOT_OPERATIONAL");
});

test("membership eligibility reports missing account profile, registered station and active rank", () => {
  const db = fixture();
  db.policeOfficers = [];
  const profileMissing = policeManagement.membershipEligibility(db, db.responseUnits[0], "officer-1");
  assert.deepEqual(profileMissing.reasons.map((reason) => reason.code), ["OFFICER_PROFILE_MISSING"]);
  assert.throws(() => policeManagement.validateMember(db, db.responseUnits[0], "officer-1", "member"), { code: "OFFICER_PROFILE_MISSING", status: 409 });

  db.policeOfficers = [{ id: "officer-1", userId: "officer-1", stationId: "unknown", rankId: "missing", active: true }];
  const refsMissing = policeManagement.membershipEligibility(db, db.responseUnits[0], "officer-1");
  assert.deepEqual(refsMissing.reasons.map((reason) => reason.code), ["OFFICER_STATION_UNREGISTERED", "OFFICER_RANK_MISSING"]);
});

test("membership eligibility prevents inactive, wrong-station, duplicate and deployed assignments with reasons", () => {
  const db = fixture();
  db.policeOfficers[0].stationId = "station-2";
  db.policeOfficers[0].dutyStatus = "suspended";
  const ineligible = policeManagement.membershipEligibility(db, db.responseUnits[0], "officer-1");
  assert.deepEqual(ineligible.reasons.map((reason) => reason.code), ["OFFICER_INACTIVE", "OFFICER_STATION_UNREGISTERED"]);

  db.policeStations.push({ id: "station-2", name: "West Station" });
  db.policeOfficers[0].dutyStatus = "on_duty";
  assert.equal(policeManagement.membershipEligibility(db, db.responseUnits[0], "officer-1").reasons[0].code, "STATION_MISMATCH");

  db.policeOfficers[0].stationId = "station-1";
  db.responseUnitMembers.push({ id: "member-1", unitId: "unit-1", officerUserId: "officer-1", role: "member" });
  assert.equal(policeManagement.membershipEligibility(db, db.responseUnits[0], "officer-1").reasons[0].code, "ALREADY_A_MEMBER");
  assert.equal(policeManagement.membershipEligibility(db, db.responseUnits[0], "officer-1", { ignoreMemberId: "member-1" }).eligible, true);
  db.responseUnitMembers = [];
  db.incidentOfficerAssignments.push({ id: "deployment-1", officerId: "officer-1", incidentId: "incident-1", status: "assigned" });
  assert.equal(policeManagement.membershipEligibility(db, db.responseUnits[0], "officer-1").reasons[0].code, "ACTIVE_DEPLOYMENT");
});
