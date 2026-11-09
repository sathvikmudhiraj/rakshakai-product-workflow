const test = require('node:test');
const assert = require('node:assert/strict');
const { releaseHybridSupportResources } = require('../services/hybridSupportRelease.service');

test('support-only release preserves primary crew and investigation, deduplicates and is idempotent', () => {
  const incident = { id: 'INC-TEST-1', status: 'Assigned', assignedUnitId: 'p1', investigatingOfficerId: 'e', dispatchRecommendation: { primary: { officerIds: ['a'] } }, supportAllocations: [{ stationId: 'A', unitIds: ['p1','s1'], officerIds: ['a','b','c'] }, { stationId: 'B', unitIds: ['s1'], officerIds: ['c','d'] }] };
  const db = { incidents: [incident], responseUnitMembers: [{ unitId: 'p1', officerUserId: 'a' }, { unitId: 'p1', officerUserId: 'b' }], responseUnits: [{ id:'p1', status:'busy', assignedIncidentId:incident.id }, { id:'s1', status:'busy', assignedIncidentId:incident.id, assigned_incident_id:incident.id }], policeOfficers: ['a','b','c','d'].map((id) => ({ id, userId:id, active:true, dutyStatus:'on_duty', availabilityStatus:'busy', availability_status:'busy', assignedIncidentId:incident.id, assigned_incident_id:incident.id })) };
  const result = releaseHybridSupportResources(db, incident, '2026-01-01T00:00:00Z');
  assert.deepEqual(result.units.map((u) => u.id), ['s1']);
  assert.deepEqual(result.officers.map((o) => o.id), ['a','b','c','d']);
  assert.equal(incident.assignedUnitId, 'p1'); assert.equal(incident.investigatingOfficerId, 'e'); assert.equal(incident.status, 'Assigned');
  assert.equal(db.responseUnits[0].status, 'busy');
  assert.equal(db.policeOfficers[0].assignedIncidentId, null); assert.equal(db.policeOfficers[1].assignedIncidentId, null);
  assert.equal(db.policeOfficers[2].availabilityStatus, 'available'); assert.equal(db.policeOfficers[2].assigned_incident_id, null);
  assert.equal(incident.supportAllocations.length, 0); assert.equal(incident.supportReleaseHistory[0].allocations.length, 2);
  assert.equal(releaseHybridSupportResources(db, incident, '2026-01-02T00:00:00Z').allocations.length, 0);
  assert.equal(incident.supportReleaseHistory.length, 1);
});

test('support release fails closed on shared resources, then respects off-duty status', () => {
  const incident = { id:'I1', status:'Assigned', assignedUnitId:'p1', supportAllocations:[{ unitIds:['u2'], officerIds:['shared','off'] }] };
  const db = { incidents:[incident,{id:'I2',status:'Assigned',assignedUnitId:'u2'}], responseUnitMembers:[{unitId:'u2',officerUserId:'shared'}], responseUnits:[{id:'u2',assignedIncidentId:'I1',status:'busy'}], policeOfficers:[{id:'shared',assignedIncidentId:'I1',availabilityStatus:'busy'},{id:'off',assignedIncidentId:'I1',active:true,dutyStatus:'off_duty',availabilityStatus:'busy'}] };
  const result = releaseHybridSupportResources(db,incident,'2026-01-01T00:00:00Z');
  assert.equal(result.conflict,true); assert.equal(incident.supportAllocations.length,1);
  db.incidents.pop(); db.responseUnitMembers = [];
  const released = releaseHybridSupportResources(db,incident,'2026-01-01T00:00:00Z');
  assert.deepEqual(released.officers.map((o) => o.id),['shared','off']);
  assert.equal(db.policeOfficers[1].availabilityStatus,'unavailable');
});

test('legacy primary direct assignment without a support allocation is not guessed away', () => {
  const incident = { id:'I1', status:'Assigned', assignedUnitId:'p1', supportAllocations:[{officerIds:['support'],unitIds:[]}] };
  const db = { incidents:[incident], responseUnitMembers:[{unitId:'p1',officerUserId:'legacy'}], responseUnits:[{id:'p1',assignedIncidentId:'I1'}], policeOfficers:[{id:'legacy',assignedIncidentId:'I1',availabilityStatus:'busy'}, {id:'support',assignedIncidentId:'I1',availabilityStatus:'busy'}] };
  releaseHybridSupportResources(db,incident,'2026-01-01T00:00:00Z');
  assert.equal(db.policeOfficers[0].assignedIncidentId,'I1');
  assert.equal(db.policeOfficers[1].assignedIncidentId,null);
});
