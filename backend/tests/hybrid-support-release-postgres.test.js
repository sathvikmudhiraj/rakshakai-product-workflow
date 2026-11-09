require('../services/testDatabaseSafety').prepareIntegrationTestEnvironment();
const test = require('node:test');
const assert = require('node:assert/strict');
const postgresTest = process.env.TEST_DATABASE_URL ? test : test.skip;
const { withTransaction, query, closePool } = require('../services/postgres.service');
const incidents = require('../repositories/incidents.repository');
const officers = require('../repositories/policeOfficers.repository');
const units = require('../repositories/responseUnits.repository');
const { releaseHybridSupportResources } = require('../services/hybridSupportRelease.service');
test.after(closePool);
postgresTest('support release persists while primary unit and investigation remain assigned', async () => {
  await withTransaction(async (client) => {
    await client.query(`
      INSERT INTO police_stations(id,station_code,name) VALUES ('st_a','PS-A','Station A'),('st_b','PS-B','Station B');
      INSERT INTO officer_ranks(id,code,name,level) VALUES ('rank_test','TEST-SI','Sub Inspector',1);
      INSERT INTO users(id,name,email,role,password_hash) VALUES ('a','A','a@test.invalid','Police Officer','x'),('b','B','b@test.invalid','Police Officer','x'),('c','C','c@test.invalid','Police Officer','x'),('d','D','d@test.invalid','Police Officer','x'),('e','E','e@test.invalid','Police Officer','x');
      INSERT INTO response_units(id,status,station_id,data) VALUES ('p1','busy','st_a','{"unitCode":"P-01"}'),('s1','busy','st_b','{}');
      INSERT INTO incidents(id,status,assigned_unit_id,investigating_officer_id,support_allocations) VALUES ('INC-TEST-1','Assigned','p1','e','[{"stationId":"st_a","officerIds":["c"],"unitIds":[]},{"stationId":"st_b","officerIds":["d"],"unitIds":["s1"]}]');
      UPDATE response_units SET assigned_incident_id='INC-TEST-1' WHERE id IN ('p1','s1');
      INSERT INTO police_officers(id,user_id,station_id,rank_id,availability_status,assigned_incident_id) VALUES ('a','a','st_a','rank_test','available',NULL),('b','b','st_a','rank_test','available',NULL),('c','c','st_a','rank_test','busy','INC-TEST-1'),('d','d','st_b','rank_test','busy','INC-TEST-1'),('e','e','st_a','rank_test','available',NULL);
      INSERT INTO response_unit_members(id,unit_id,officer_user_id,role) VALUES ('m1','p1','a','member'),('m2','p1','b','member');
    `);
    const db = { incidents: await incidents.list({}), responseUnits: await units.list({}), policeOfficers: await officers.list({}), responseUnitMembers: [{unitId:'p1',officerUserId:'a'},{unitId:'p1',officerUserId:'b'}] };
    const incident = db.incidents.find((item) => item.id === 'INC-TEST-1');
    assert.equal(db.policeOfficers.find((item) => item.id === 'a').assignedIncidentId, null);
    const released = releaseHybridSupportResources(db, incident, new Date().toISOString());
    await incidents.upsert(incident, client);
    for (const item of released.units) await units.upsert(item, client);
    for (const item of released.officers) await officers.upsert(item, client);
    const stored = (await incidents.list({})).find((item) => item.id === incident.id);
    const storedOfficers = await officers.list({});
    assert.equal(stored.assignedUnitId,'p1'); assert.equal(stored.investigatingOfficerId,'e'); assert.equal(stored.status,'Assigned');
    assert.deepEqual(stored.supportAllocations, []); assert.equal(stored.supportReleaseHistory[0].allocations.length,2);
    for (const id of ['c','d']) { const officer = storedOfficers.find((item) => item.id === id); assert.equal(officer.assignedIncidentId,null); assert.equal(officer.availabilityStatus,'available'); }
    assert.equal((await units.list({})).find((item) => item.id === 'p1').assignedIncidentId,'INC-TEST-1');
  });
});

postgresTest('support release route enforces roles, records audit and preserves the primary unit', async () => {
  process.env.JWT_SECRET = 'disposable-test-only-secret';
  const jwt = require('jsonwebtoken');
  const { app } = require('../server');
  await query(`INSERT INTO users(id,name,email,role,password_hash) VALUES ('admin_test','Admin','admin@test.invalid','Admin','x'),('citizen_test','Citizen','citizen@test.invalid','Citizen','x')`);
  await query(`UPDATE incidents SET support_allocations='[{"stationId":"st_a","officerIds":["c"],"unitIds":[]},{"stationId":"st_b","officerIds":["d"],"unitIds":["s1"]}]', data=data-'support_allocations' WHERE id='INC-TEST-1'`);
  await query(`UPDATE police_officers SET assigned_incident_id='INC-TEST-1',availability_status='busy',data=data-'assigned_incident_id'-'availability_status' WHERE id IN ('c','d')`);
  await query(`UPDATE response_units SET assigned_incident_id='INC-TEST-1',status='busy',data=data-'assigned_incident_id' WHERE id='s1'`);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const call = async (id,role) => fetch(`http://127.0.0.1:${server.address().port}/api/incidents/INC-TEST-1/release-support`, { method:'POST', headers:{ 'content-type':'application/json', authorization:`Bearer ${jwt.sign({role},process.env.JWT_SECRET,{subject:id})}` }, body:JSON.stringify({expectedAssignedUnitId:'p1',reason:'Support no longer needed'}) });
    const releaseUnit = () => fetch(`http://127.0.0.1:${server.address().port}/api/incidents/INC-TEST-1/release-unit`, { method:'POST', headers:{ 'content-type':'application/json', authorization:`Bearer ${jwt.sign({role:'Admin'},process.env.JWT_SECRET,{subject:'admin_test'})}` }, body:JSON.stringify({expectedAssignedUnitId:'p1',reason:'Primary no longer needed'}) });
    const denied = await releaseUnit();
    assert.equal(denied.status,409); assert.equal((await denied.json()).code,'ACTIVE_HYBRID_SUPPORT');
    assert.equal((await incidents.list({})).find((item) => item.id === 'INC-TEST-1').assignedUnitId,'p1');
    assert.equal((await officers.list({})).find((item) => item.id === 'c').assignedIncidentId,'INC-TEST-1');
    assert.equal((await call('citizen_test','Citizen')).status,403);
    assert.equal((await call('a','Police Officer')).status,403);
    const result = await call('admin_test','Admin'); assert.equal(result.status,200, await result.clone().text());
    const stored = (await incidents.list({})).find((item) => item.id === 'INC-TEST-1');
    assert.equal(stored.assignedUnitId,'p1'); assert.equal(stored.investigatingOfficerId,'e'); assert.equal(stored.status,'Assigned'); assert.deepEqual(stored.supportAllocations,[]);
    for (const id of ['c','d']) { const officer = (await officers.list({})).find((item) => item.id === id); assert.equal(officer.assignedIncidentId,null); assert.equal(officer.availabilityStatus,'available'); }
    const audits = await query(`SELECT data FROM audit_logs WHERE incident_id='INC-TEST-1'`);
    assert.ok(audits.rows.some((row) => row.data.action === 'hybrid_support_released'));
    assert.ok(!audits.rows.some((row) => row.data.action === 'unit_released'));
    assert.equal((await call('admin_test','Admin')).status,200);
    const repeated = await query(`SELECT data FROM audit_logs WHERE incident_id='INC-TEST-1'`);
    assert.equal(repeated.rows.filter((row) => row.data.action === 'hybrid_support_released').length,1);
    const releasedUnit = await releaseUnit(); assert.equal(releasedUnit.status,200,await releasedUnit.clone().text());
    const afterUnit = (await incidents.list({})).find((item) => item.id === 'INC-TEST-1');
    assert.equal(afterUnit.assignedUnitId,null); assert.equal(afterUnit.status,'Verified'); assert.equal(afterUnit.investigatingOfficerId,'e');
    assert.equal((await units.list({})).find((item) => item.id === 'p1').assignedIncidentId,null);
    const finalAudits = await query(`SELECT data FROM audit_logs WHERE incident_id='INC-TEST-1'`);
    assert.equal(finalAudits.rows.filter((row) => row.data.action === 'unit_released').length,1);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
