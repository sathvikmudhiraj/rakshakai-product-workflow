require('../services/testDatabaseSafety').prepareIntegrationTestEnvironment();
const test = require('node:test');
const assert = require('node:assert/strict');
const { query, closePool } = require('../services/postgres.service');
const { readDatabase } = require('../services/core.service');
const { policeManagementUsers } = require('../services/copilotOfficers.service');
const { answer } = require('../services/copilotRead.service');
test.after(closePool);

test('actual hybrid confirmation and releases preserve membership and separate support roles', async () => {
  process.env.JWT_SECRET = 'disposable-test-only-secret';
  process.env.PUBLIC_OSRM_FALLBACK = 'false';
  const jwt = require('jsonwebtoken');
  const { app } = require('../server');
  const realtime = require('../services/realtimeEvents.service');
  const events = [];
  const listener = (payload) => events.push(payload);
  realtime.on('incident_assignment_changed', listener);
  await query(`
    INSERT INTO police_stations(id,station_code,name,latitude,longitude,operational) VALUES
      ('ha','PS-HA','Station A',17.500,78.300,true),('hb','PS-HB','Station B',17.520,78.320,true);
    INSERT INTO officer_ranks(id,code,name,level) VALUES ('hr','H-RANK','Sub Inspector',1);
    INSERT INTO users(id,name,email,role,password_hash) VALUES
      ('adm','Admin','adm@fixture.invalid','Admin','x'),('cit','Citizen','cit@fixture.invalid','Citizen','x'),
      ('hm_a','Officer A','a@fixture.invalid','Police Officer','x'),('hm_b','Officer B','b@fixture.invalid','Police Officer','x'),
      ('hm_c','Officer C','c@fixture.invalid','Police Officer','x'),('hm_d','Officer D','d@fixture.invalid','Police Officer','x'),('hm_e','Officer E','e@fixture.invalid','Police Officer','x');
    INSERT INTO police_officers(id,user_id,station_id,rank_id,duty_status,availability_status) VALUES
      ('hm_a','hm_a','ha','hr','on_duty','available'),('hm_b','hm_b','ha','hr','on_duty','available'),
      ('hm_c','hm_c','ha','hr','on_duty','available'),('hm_d','hm_d','hb','hr','on_duty','available'),('hm_e','hm_e','ha','hr','off_duty','unavailable');
    INSERT INTO response_units(id,status,station_id,latitude,longitude,location_accuracy,location_captured_at,location_received_at,location_source,data)
      VALUES ('hp','available','ha',17.501,78.301,10,now(),now(),'live_gps','{"unitCode":"P-01","unitType":"police_patrol","source":"live_gps","operational":true}');
    INSERT INTO response_unit_members(id,unit_id,officer_user_id,role) VALUES ('hma','hp','hm_a','commander'),('hmb','hp','hm_b','driver');
    INSERT INTO incidents(id,status,severity,investigating_officer_id,response_requirements,data) VALUES
      ('INC-1042','Verified','high','hm_e','{"supportingOfficers":2,"responseUnits":0}',
       '{"lat":17.505,"lng":78.305,"locationStatus":"Verified","locationSource":"map_click","stationId":"ha"}');
  `);
  const server = await new Promise(resolve => { const s = app.listen(0,'127.0.0.1',() => resolve(s)); });
  const call = (path, id='adm', role='Admin', body={}) => fetch(`http://127.0.0.1:${server.address().port}/api/incidents/INC-1042/${path}`, {method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${jwt.sign({role},process.env.JWT_SECRET,{subject:id})}`},body:JSON.stringify(body)});
  try {
    const recommended = await call('recommend-unit');
    assert.equal(recommended.status,200,await recommended.clone().text());
    const rec = (await recommended.json()).recommendation;
    assert.equal(rec.primary.unitId,'hp');
    assert.deepEqual(rec.stationSupport.allocations,[]);
    const primary = await call('assign-unit','adm','Admin',{unitId:'hp',expectedAssignedUnitId:null});
    assert.equal(primary.status,200,await primary.clone().text());
    const supportRecommended = await call('recommend-unit');
    assert.equal(supportRecommended.status,200,await supportRecommended.clone().text());
    const supportRec = (await supportRecommended.json()).recommendation;
    assert.deepEqual(supportRec.stationSupport.allocations.flatMap(x => x.officerIds).sort(),['hm_c','hm_d']);
    const confirmed = await call('assign-unit','adm','Admin',{recommendationId:supportRec.id,expectedAssignedUnitId:'hp'});
    assert.equal(confirmed.status,200,await confirmed.clone().text());
    assert.ok(events.some(event => event.action === 'confirmed' && event.incident.assignedUnitId === 'hp'));
    let db = await readDatabase();
    let incident = db.incidents.find(x => x.id === 'INC-1042');
    assert.equal(incident.assignedUnitId,'hp'); assert.equal(incident.investigatingOfficerId,'hm_e');
    for (const id of ['hm_a','hm_b']) assert.equal(db.policeOfficers.find(x => x.userId === id).assignedIncidentId,null);
    for (const id of ['hm_c','hm_d']) assert.equal(db.policeOfficers.find(x => x.userId === id).assignedIncidentId,'INC-1042');
    for (const id of ['hm_c','hm_d']) assert.equal(db.policeOfficers.find(x => x.userId === id).availabilityStatus,'busy');
    let profiles = policeManagementUsers(db);
    for (const id of ['hm_a','hm_b']) { const p = profiles.find(x => x.id === id); assert.equal(p.deployments[0].unitId,'hp'); assert.equal(p.availabilityStatus,'busy'); }
    for (const id of ['hm_c','hm_d']) assert.equal(profiles.find(x => x.id === id).supportDeployments[0].id,'INC-1042');
    assert.equal(profiles.find(x => x.id === 'hm_e').investigations[0].id,'INC-1042');
    const response = answer(db,'Who is responding to INC-1042?',{actor:{id:'adm',role:'Admin'}}).answer;
    for (const name of ['Officer A','Officer B','Officer C','Officer D','Officer E']) assert.match(response,new RegExp(name));
    const body = {expectedAssignedUnitId:'hp',reason:'Fixture lifecycle'};
    const blocked = await call('release-unit','adm','Admin',body); assert.equal(blocked.status,409); assert.equal((await blocked.json()).code,'ACTIVE_HYBRID_SUPPORT');
    for (const [id,role] of [['hm_a','Police Officer'],['cit','Citizen']]) assert.equal((await call('release-support',id,role,body)).status,403);
    const support = await call('release-support','adm','Admin',body); assert.equal(support.status,200,await support.clone().text());
    assert.ok(events.some(event => event.action === 'support_released' && event.incident.assignedUnitId === 'hp'));
    db = await readDatabase(); incident = db.incidents.find(x => x.id === 'INC-1042');
    assert.equal(incident.assignedUnitId,'hp'); assert.equal(incident.investigatingOfficerId,'hm_e');
    for (const id of ['hm_c','hm_d']) assert.equal(db.policeOfficers.find(x => x.userId === id).assignedIncidentId,null);
    for (const id of ['hm_c','hm_d']) assert.equal(db.policeOfficers.find(x => x.userId === id).availabilityStatus,'available');
    profiles = policeManagementUsers(db); assert.equal(profiles.find(x => x.id === 'hm_a').deployments.length,1); assert.equal(profiles.find(x => x.id === 'hm_a').availabilityStatus,'busy');
    const afterSupport = answer(db,'Who is responding to INC-1042?',{actor:{id:'adm',role:'Admin'}}).answer;
    for (const name of ['Officer A','Officer B','Officer E']) assert.match(afterSupport,new RegExp(name));
    for (const name of ['Officer C','Officer D']) assert.doesNotMatch(afterSupport,new RegExp(name));
    const released = await call('release-unit','adm','Admin',body); assert.equal(released.status,200,await released.clone().text());
    assert.ok(events.some(event => event.action === 'released' && !event.incident.assignedUnitId));
    db = await readDatabase(); incident = db.incidents.find(x => x.id === 'INC-1042');
    assert.equal(incident.assignedUnitId,null); assert.equal(incident.investigatingOfficerId,'hm_e');
    profiles = policeManagementUsers(db); for (const id of ['hm_a','hm_b']) { assert.equal(profiles.find(x => x.id === id).deployments.length,0); assert.equal(profiles.find(x => x.id === id).availabilityStatus,'available'); assert.equal(db.policeOfficers.find(x => x.userId === id).assignedIncidentId,null); }
    const audits = db.auditLogs.filter(x => x.incidentId === 'INC-1042').map(x => x.action);
    for (const action of ['DISPATCH_CONFIRMED','PRIMARY_RESPONDER_SELECTED','STATION_SUPPORT_SELECTED','hybrid_support_released','unit_released']) assert.ok(audits.includes(action),action);
  } finally { realtime.off('incident_assignment_changed', listener); await new Promise(resolve => server.close(resolve)); }
});
