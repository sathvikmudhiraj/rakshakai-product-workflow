require('../services/testDatabaseSafety').prepareIntegrationTestEnvironment();
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const postgresTest = process.env.TEST_DATABASE_URL ? test : test.skip;
const jwt = require('jsonwebtoken');
const { query, closePool } = require('../services/postgres.service');
test.after(closePool);

postgresTest('same eligible officer cannot be deployed concurrently to different incidents; release and retry stay atomic', async () => {
  process.env.JWT_SECRET = 'disposable-concurrency-test-secret';
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const adminId = `qa_admin_${suffix}`;
  const officerId = `qa_officer_${suffix}`;
  const blockedOfficerId = `qa_blocked_${suffix}`;
  const stationId = `qa_station_${suffix}`;
  const unitIds = [`qa_unit_a_${suffix}`, `qa_unit_b_${suffix}`, `qa_unit_c_${suffix}`];
  const incidentIds = [`QA-INC-A-${suffix}`, `QA-INC-B-${suffix}`, `QA-INC-C-${suffix}`];
  const membershipIds = [`qa_mem_a_${suffix}`, `qa_mem_b_${suffix}`, `qa_mem_c_${suffix}`, `qa_mem_c2_${suffix}`];
  const serverApp = require('../server').app;
  const server = await new Promise(resolve => { const instance = serverApp.listen(0, '127.0.0.1', () => resolve(instance)); });
  const token = jwt.sign({ role: 'Admin' }, process.env.JWT_SECRET, { subject: adminId });
  const post = (incidentId, path = 'officer-assignments', body = {}) => fetch(
    `http://127.0.0.1:${server.address().port}/api/incidents/${incidentId}/${path}`,
    { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) }
  );
  const headers = { authorization: `Bearer ${token}` };
  try {
    await query(`INSERT INTO police_stations(id,station_code,name,operational) VALUES ($1,$2,'QA Concurrency Station',true)`, [stationId, `QA-${suffix}`]);
    await query(`INSERT INTO users(id,name,email,role,password_hash) VALUES
      ($1,'QA Dispatcher',$2,'Admin','x'),($3,'QA Eligible Officer',$4,'Police Officer','x'),($5,'QA Off Duty Officer',$6,'Police Officer','x')`,
    [adminId, `dispatcher-${suffix}@test.invalid`, officerId, `officer-${suffix}@test.invalid`, blockedOfficerId, `blocked-${suffix}@test.invalid`]);
    await query(`INSERT INTO police_officers(id,user_id,station_id,rank_id,badge_id,duty_status,availability_status,active) VALUES
      ($1,$1,$2,'rank_si',$4,'on_duty','available',true),($3,$3,$2,'rank_si',$5,'off_duty','unavailable',true)`, [officerId, stationId, blockedOfficerId, `BADGE-${suffix}`, `BADGE-B-${suffix}`]);
    for (const [index, unitId] of unitIds.entries()) {
      await query(`INSERT INTO response_units(id,status,station_id,data) VALUES ($1,'available',$2,$3::jsonb)`,
        [unitId, stationId, JSON.stringify({ unitCode: `QA-${String.fromCharCode(65 + index)}` })]);
    }
    for (const [index, membershipId] of membershipIds.entries()) {
      await query(`INSERT INTO response_unit_members(id,unit_id,officer_user_id,role) VALUES ($1,$2,$3,'member')`,
        [membershipId, unitIds[index === 3 ? 2 : index], index === 3 ? blockedOfficerId : officerId]);
    }
    for (const [index, incidentId] of incidentIds.entries()) {
      await query(`INSERT INTO incidents(id,status,severity,assigned_unit_id,data) VALUES ($1,'Assigned','medium',$2,$3::jsonb)`,
        [incidentId, unitIds[index], JSON.stringify({ lat: 17.51 + index / 100, lng: 78.32 + index / 100, locationStatus: 'Verified', locationSource: 'map_click' })]);
    }

    const deploy = incidentId => post(incidentId, 'officer-assignments', { assignments: [{ officerId, responseRole: 'TEAM_LEAD' }] });
    const simultaneous = await Promise.all([deploy(incidentIds[0]), deploy(incidentIds[1])]);
    const outcomes = await Promise.all(simultaneous.map(async response => ({ status: response.status, body: await response.json() })));
    assert.deepEqual(outcomes.map(item => item.status).sort(), [201, 409]);
    const conflict = outcomes.find(item => item.status === 409);
    assert.equal(conflict.body.code, 'OFFICER_BUSY');
    const winner = outcomes.find(item => item.status === 201).body.assignments[0];
    const firstState = await query(`SELECT incident_id,status,unit_id FROM incident_officer_assignments WHERE officer_id=$1 ORDER BY assigned_at`, [officerId]);
    assert.equal(firstState.rowCount, 1, 'Only one active deployment row may be created by competing requests');
    assert.equal(firstState.rows[0].status, 'ASSIGNED');
    const winnerIncidentId = firstState.rows[0].incident_id;
    const loserIncidentId = incidentIds.find(id => id !== winnerIncidentId);
    const firstRoundTimeline = await query(`SELECT event_type FROM dispatch_events WHERE incident_id=ANY($1::text[]) AND event_type='incident_officer_assigned'`, [incidentIds.slice(0, 2)]);
    assert.equal(firstRoundTimeline.rowCount, 1, 'A successful concurrent deployment must create one timeline event');
    const availability = await fetch(`http://127.0.0.1:${server.address().port}/api/incidents/${winnerIncidentId}/unit-members`, { headers });
    assert.equal(availability.status, 200);
    const member = (await availability.json()).members.find(item => item.officerId === officerId);
    assert.equal(member.availability, 'busy');
    assert.equal(member.currentIncidentId, winnerIncidentId);

    const release = await post(winnerIncidentId, `officer-assignments/${winner.id}/release`, { reason: 'QA atomic release before reassignment' });
    assert.equal(release.status, 200, await release.clone().text());
    assert.equal((await query(`SELECT status,released_at FROM incident_officer_assignments WHERE id=$1`, [winner.id])).rows[0].status, 'RELEASED');
    const retry = await deploy(loserIncidentId);
    assert.equal(retry.status, 201, await retry.clone().text());
    const retryAssignment = (await retry.json()).assignments[0];
    const afterRetry = await query(`SELECT incident_id,status FROM incident_officer_assignments WHERE officer_id=$1 ORDER BY assigned_at`, [officerId]);
    assert.deepEqual(afterRetry.rows.map(row => [row.incident_id, row.status]), [[winnerIncidentId, 'RELEASED'], [loserIncidentId, 'ASSIGNED']]);

    const rollback = await post(incidentIds[2], 'officer-assignments', { assignments: [
      { officerId, responseRole: 'DRIVER' }, { officerId: blockedOfficerId, responseRole: 'RESPONSE_OFFICER' }
    ] });
    assert.equal(rollback.status, 409);
    assert.equal((await query('SELECT count(*)::int AS count FROM incident_officer_assignments WHERE incident_id=$1', [incidentIds[2]])).rows[0].count, 0);
    assert.equal((await query("SELECT count(*)::int AS count FROM audit_logs WHERE incident_id=$1 AND data->>'action'='incident_officer_assigned'", [incidentIds[2]])).rows[0].count, 0);
    assert.equal((await query("SELECT count(*)::int AS count FROM dispatch_events WHERE incident_id=$1 AND event_type='incident_officer_assigned'", [incidentIds[2]])).rows[0].count, 0);

    const finalRelease = await post(loserIncidentId, `officer-assignments/${retryAssignment.id}/release`, { reason: 'QA final release' });
    assert.equal(finalRelease.status, 200, await finalRelease.clone().text());
    const final = await query(`SELECT count(*) FILTER (WHERE status IN ('ASSIGNED','EN_ROUTE','ON_SCENE'))::int AS active,
      count(*) FILTER (WHERE status='RELEASED')::int AS released FROM incident_officer_assignments WHERE officer_id=$1`, [officerId]);
    assert.deepEqual(final.rows[0], { active: 0, released: 2 });
    const audit = await query(`SELECT incident_id,data->>'action' AS action FROM audit_logs WHERE incident_id=ANY($1::text[])
      AND data->>'action' IN ('incident_officer_assigned','incident_officer_released')`, [[winnerIncidentId, loserIncidentId]]);
    assert.equal(audit.rows.filter(row => row.action === 'incident_officer_assigned').length, 2);
    assert.equal(audit.rows.filter(row => row.action === 'incident_officer_released').length, 2);
    const timeline = await query("SELECT event_type FROM dispatch_events WHERE incident_id=ANY($1::text[]) AND event_type IN ('incident_officer_assigned','incident_officer_released')", [[winnerIncidentId, loserIncidentId]]);
    assert.equal(timeline.rowCount, 4, 'Each successful assignment and release must persist exactly one timeline event');
    const fks = await query(`SELECT count(*)::int AS orphans FROM incident_officer_assignments a
      LEFT JOIN incidents i ON i.id=a.incident_id LEFT JOIN response_units u ON u.id=a.unit_id LEFT JOIN users p ON p.id=a.officer_id
      WHERE i.id IS NULL OR u.id IS NULL OR p.id IS NULL`);
    assert.equal(fks.rows[0].orphans, 0);
    console.log(JSON.stringify({ race: outcomes.map(({ status, body }) => ({ status, code: body.code || 'CREATED' })), winnerIncidentId, loserIncidentId, retryStatus: retry.status, final: final.rows[0], auditCount: audit.rowCount, timelineCount: timeline.rowCount }));
  } finally {
    await new Promise(resolve => server.close(resolve));
    await query('DELETE FROM audit_logs WHERE incident_id=ANY($1::text[])', [incidentIds]).catch(() => {});
    await query('DELETE FROM incident_officer_assignments WHERE incident_id=ANY($1::text[])', [incidentIds]).catch(() => {});
    await query('DELETE FROM incidents WHERE id=ANY($1::text[])', [incidentIds]).catch(() => {});
    await query('DELETE FROM response_unit_members WHERE unit_id=ANY($1::text[])', [unitIds]).catch(() => {});
    await query('DELETE FROM response_units WHERE id=ANY($1::text[])', [unitIds]).catch(() => {});
    await query('DELETE FROM police_officers WHERE user_id=ANY($1::text[])', [[officerId, blockedOfficerId]]).catch(() => {});
    await query('DELETE FROM users WHERE id=ANY($1::text[])', [[adminId, officerId, blockedOfficerId]]).catch(() => {});
    await query('DELETE FROM police_stations WHERE id=$1', [stationId]).catch(() => {});
  }
});
