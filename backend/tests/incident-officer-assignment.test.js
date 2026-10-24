const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const service = require("../services/incidentOfficerAssignment.service");

const dispatcher = { id: "dispatcher", role: "Police Officer", data: { operationalRole: "DISPATCHER" } };
function fixture() { return {
  incidents: [{ id: "inc-1", assignedUnitId: "unit-1", status: "Assigned" }, { id: "inc-2", assignedUnitId: "unit-1", status: "Assigned" }],
  responseUnits: [{ id: "unit-1", unitCode: "P-01" }], users: [{ id: "o-1", name: "Ravi", role: "Police Officer" }, { id: "o-2", name: "Arjun", role: "Police Officer" }, { id: "outsider", name: "Other", role: "Police Officer" }],
  policeOfficers: [{ id: "p-1", userId: "o-1", active: true, dutyStatus: "on_duty", availabilityStatus: "available" }, { id: "p-2", userId: "o-2", active: true, dutyStatus: "on_duty", availabilityStatus: "available" }],
  responseUnitMembers: [{ id: "m-1", unitId: "unit-1", officerUserId: "o-1" }, { id: "m-2", unitId: "unit-1", officerUserId: "o-2" }], incidentOfficerAssignments: []
}; }
function code(fn, expected) { assert.throws(fn, (error) => error.code === expected); }

test("canonical members come only from response_unit_members", () => assert.deepEqual(service.getUnitMembersForIncident(fixture(), "inc-1").members.map((x) => x.officerId), ["o-1", "o-2"]));
test("multiple available members deploy with controlled roles", () => { const db=fixture(); const rows=service.assignIncidentOfficers(db,"inc-1",[{officerId:"o-1",responseRole:"TEAM_LEAD"},{officerId:"o-2",responseRole:"DRIVER"}],dispatcher); assert.equal(rows.length,2); assert.equal(rows[0].responseRole,"TEAM_LEAD"); });
test("non-member and invalid role are rejected atomically", () => { const db=fixture(); code(()=>service.assignIncidentOfficers(db,"inc-1",[{officerId:"o-1",responseRole:"TEAM_LEAD"},{officerId:"outsider",responseRole:"DRIVER"}],dispatcher),"OFFICER_NOT_UNIT_MEMBER"); assert.equal(db.incidentOfficerAssignments.length,0); code(()=>service.assignIncidentOfficers(db,"inc-1",[{officerId:"o-1",responseRole:"COMMANDER"}],dispatcher),"INVALID_RESPONSE_ROLE"); });
test("duplicate and cross-incident primary deployments are rejected", () => { const db=fixture(); service.assignIncidentOfficers(db,"inc-1",[{officerId:"o-1",responseRole:"TEAM_LEAD"}],dispatcher); code(()=>service.assignIncidentOfficers(db,"inc-1",[{officerId:"o-1",responseRole:"DRIVER"}],dispatcher),"DUPLICATE_DEPLOYMENT"); code(()=>service.assignIncidentOfficers(db,"inc-2",[{officerId:"o-1",responseRole:"DRIVER"}],dispatcher),"OFFICER_BUSY"); });
test("hybrid support commitment blocks primary deployment without mutation", () => { const db=fixture(); db.policeOfficers[0].assignedIncidentId="support-inc"; code(()=>service.assignIncidentOfficers(db,"inc-1",[{officerId:"o-1",responseRole:"TEAM_LEAD"}],dispatcher),"OFFICER_BUSY"); assert.equal(db.policeOfficers[0].assignedIncidentId,"support-inc"); });
test("role change and release preserve membership and primary unit", () => { const db=fixture(); const [row]=service.assignIncidentOfficers(db,"inc-1",[{officerId:"o-1",responseRole:"TEAM_LEAD"}],dispatcher); service.updateIncidentOfficerRole(db,"inc-1",row.id,"RESPONSE_OFFICER",dispatcher,"rotation"); assert.equal(row.responseRole,"RESPONSE_OFFICER"); service.releaseIncidentOfficer(db,"inc-1",row.id,"Shift ended",dispatcher); assert.equal(row.status,"RELEASED"); assert.equal(db.responseUnitMembers.length,2); assert.equal(db.incidents[0].assignedUnitId,"unit-1"); assert.equal(db.policeOfficers[0].assignedIncidentId,undefined); });
test("released history does not block a later deployment", () => { const db=fixture(); const [row]=service.assignIncidentOfficers(db,"inc-1",[{officerId:"o-1",responseRole:"TEAM_LEAD"}],dispatcher); service.releaseIncidentOfficer(db,"inc-1",row.id,"Rotation",dispatcher); assert.equal(service.assignIncidentOfficers(db,"inc-1",[{officerId:"o-1",responseRole:"DRIVER"}],dispatcher).length,1); });

test("legacy orphan deployment can be released without recreating its primary assignment", () => {
  const db = fixture();
  const [row] = service.assignIncidentOfficers(db, "inc-1", [{ officerId: "o-1", responseRole: "DRIVER" }], dispatcher);
  db.incidents[0].assignedUnitId = null;
  const before = JSON.stringify(db.responseUnitMembers);
  assert.equal(service.listIncidentOfficerAssignments(db, "inc-1")[0].id, row.id);
  service.releaseIncidentOfficer(db, "inc-1", row.id, "Recover legacy orphan", dispatcher);
  assert.equal(row.status, "RELEASED");
  assert.equal(db.incidents[0].assignedUnitId, null);
  assert.equal(JSON.stringify(db.responseUnitMembers), before);
});

test("leave, suspended and missing officer profiles cannot be deployed", () => {
  for (const dutyStatus of ["off_duty", "leave", "suspended"]) {
    const db = fixture(); db.policeOfficers[0].dutyStatus = dutyStatus;
    code(() => service.assignIncidentOfficers(db, "inc-1", [{ officerId: "o-1", responseRole: "DRIVER" }], dispatcher), "OFFICER_UNAVAILABLE");
  }
  const db = fixture(); db.policeOfficers = [];
  code(() => service.assignIncidentOfficers(db, "inc-1", [{ officerId: "o-1", responseRole: "DRIVER" }], dispatcher), "OFFICER_UNAVAILABLE");
  const unknown = fixture(); delete unknown.policeOfficers[0].availabilityStatus;
  code(() => service.assignIncidentOfficers(unknown, "inc-1", [{ officerId: "o-1", responseRole: "DRIVER" }], dispatcher), "OFFICER_BUSY");
});

test("member metadata uses real badge and fixture provenance; current deployment is authoritative", () => {
  const db = fixture(); Object.assign(db.policeOfficers[0], { badgeId: "TEST-01", isDemo: true });
  service.assignIncidentOfficers(db, "inc-1", [{ officerId: "o-1", responseRole: "DRIVER" }], dispatcher);
  const member = service.getUnitMembersForIncident(db, "inc-2").members[0];
  assert.equal(member.currentIncidentId, "inc-1");
  assert.equal(member.availability, "busy");
  assert.equal(member.badgeId, "TEST-01");
  assert.equal(member.isDemo, true);
  assert.equal(member.deployment, null);
});
test("RBAC allows Admin/Dispatcher and denies call taker, field officer, Citizen", () => { service.assertAssignmentActor({id:"a",role:"Admin"}); service.assertAssignmentActor(dispatcher); for (const user of [{role:"Citizen"},{role:"Police Officer",data:{operationalRole:"CALL_TAKER"}},{role:"Police Officer",data:{operationalRole:"FIELD_OFFICER"}}]) code(()=>service.assertAssignmentActor(user),"OFFICER_ASSIGNMENT_FORBIDDEN"); });
test("API wiring records assignment, role-change, and release audits and emits realtime", () => { const source=fs.readFileSync(path.join(__dirname,"../services/core.service.js"),"utf8"); for(const action of ["incident_officer_assigned","incident_officer_role_changed","incident_officer_released"]) assert.match(source,new RegExp(`addAuditLog\\(db, \\"${action}\\"`)); assert.match(source,/realtimeEvents\.emit\("incident_officer_assignment_changed"/); });
test("Socket bridge broadcasts officer assignment changes to incident and dashboard rooms", () => { const source=fs.readFileSync(path.join(__dirname,"../server.js"),"utf8"); assert.match(source,/assignmentEvents = \[[^\]]*"incident_officer_assignment_changed"/); assert.match(source,/broadcastToAllDashboards\(event, payload\)/); assert.match(source,/payload\?\.incident\?\.id \|\| payload\?\.incidentId/); assert.match(source,/emitToIncidentRoom\(incidentId, event, payload\)/); });
