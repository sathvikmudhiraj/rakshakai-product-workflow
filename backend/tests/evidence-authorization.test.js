const test = require("node:test");
const assert = require("node:assert/strict");
const { canAccessVideoEvidence, __testables: { migrateLegacyDemoUnit } } = require("../services/core.service");

test("legacy demo unit normalization preserves the PostgreSQL station identity", () => {
  const unit = migrateLegacyDemoUnit({ id: "unit_p04", station_id: "station_patancheru", stationId: "PS-PATANCHERU" });
  assert.equal(unit.stationId, "station_patancheru");
});

test("evidence authorization follows investigator and assigned unit at request time", () => {
  const a = { id: "officer_a", role: "Police Officer" };
  const b = { id: "officer_b", role: "Police Officer" };
  const admin = { id: "admin", role: "Admin" };
  const citizen = { id: "citizen", role: "Citizen" };
  const incident = { id: "case_a", investigatingOfficerId: a.id, assignedUnitId: null };
  const evidence = { id: "evidence_a", linkedIncidentId: incident.id };
  const db = { incidents: [incident], reports: [], responseUnitMembers: [] };
  assert.equal(canAccessVideoEvidence(db, a, evidence), true);
  assert.equal(canAccessVideoEvidence(db, b, evidence), false);
  assert.equal(canAccessVideoEvidence(db, admin, evidence), true);
  assert.equal(canAccessVideoEvidence(db, citizen, evidence), false);
  incident.investigatingOfficerId = b.id;
  assert.equal(canAccessVideoEvidence(db, a, evidence), false);
  assert.equal(canAccessVideoEvidence(db, b, evidence), true);
  incident.investigatingOfficerId = null;
  incident.assignedUnitId = "unit_a";
  db.responseUnitMembers.push({ unitId: "unit_a", officerUserId: a.id });
  assert.equal(canAccessVideoEvidence(db, a, evidence), true);
  assert.equal(canAccessVideoEvidence(db, b, evidence), false);
  incident.assignedUnitId = "unit_b";
  assert.equal(canAccessVideoEvidence(db, a, evidence), false);
  assert.equal(canAccessVideoEvidence(db, a, { id: "unlinked" }), false);
  db.reports.push({ id: "own_report", createdBy: citizen.id, incidentId: "case_a" });
  assert.equal(canAccessVideoEvidence(db, citizen, { linkedReportId: "own_report" }), true);
  assert.equal(canAccessVideoEvidence(db, a, { linkedReportId: "unknown", linkedIncidentId: "case_a" }), false);
  incident.assignedUnitId = "unit_a";
  assert.equal(canAccessVideoEvidence(db, a, evidence), true);
  db.responseUnitMembers = [];
  assert.equal(canAccessVideoEvidence(db, a, evidence), false);
  db.responseUnitMembers.push({ unitId: "unit_a", officerUserId: b.id });
  assert.equal(canAccessVideoEvidence(db, b, evidence), true);
  db.reports.push({ id: "conflicting_report", incidentId: "case_b" });
  db.incidents.push({ id: "case_b", investigatingOfficerId: a.id });
  assert.equal(canAccessVideoEvidence(db, a, { linkedReportId: "conflicting_report", linkedIncidentId: "case_a" }), false);
  assert.equal(canAccessVideoEvidence(db, b, { linkedReportId: "conflicting_report", linkedIncidentId: "case_a" }), false);
});
