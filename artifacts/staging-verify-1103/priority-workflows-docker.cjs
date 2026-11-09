const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { Pool } = require('../../backend/node_modules/pg');
const { checkPoliceManagementWorkflow } = require('../../scripts/browser-release-no-map-provider.cjs');

const root = path.resolve(__dirname, '../..');
const evidenceDir = __dirname;
const password = process.env.RELEASE_TEST_PASSWORD;
const issues = [];

function watch(page, label) {
  const result = { label, pageErrors: [], consoleErrors: [], requests: [], failedRequests: [], httpErrors: [], responseBodies: [] };
  page.on('pageerror', error => result.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push({ text: message.text(), location: message.location() }); });
  page.on('requestfailed', request => result.failedRequests.push({ url: request.url(), error: request.failure()?.errorText || 'failed' }));
  page.on('request', request => result.requests.push({ method: request.method(), url: request.url() }));
  page.on('response', response => {
    if (response.status() < 400) return;
    const entry = { status: response.status(), method: response.request().method(), url: response.url() };
    result.httpErrors.push(entry);
    result.responseBodies.push(response.text().then(body => { entry.body = body.slice(0, 10000); }).catch(() => {}));
  });
  issues.push(result);
  return result;
}

async function login(browser, role, width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 960 }, permissions: ['geolocation'], geolocation: { latitude: 17.5109, longitude: 78.3276 } });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  watch(page, `${role}-${width}`);
  await page.goto(process.env.RELEASE_TEST_FRONTEND_URL || 'http://127.0.0.1:3002', { waitUntil: 'networkidle' });
  const user = JSON.parse(fs.readFileSync(path.join(root, 'backend/data/db.example.json'), 'utf8')).users.find(item => item.role === role);
  await page.locator('#loginForm input[name="email"]').fill(user.email);
  await page.locator('#loginForm input[name="password"]').fill(role === 'Citizen' ? process.env.RELEASE_TEST_CITIZEN_PASSWORD : role === 'Police Officer' ? process.env.RELEASE_TEST_POLICE_PASSWORD : password);
  await page.locator('#loginForm button[type="submit"]').click();
  await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible' });
  return { context, page };
}

async function nav(page, view) {
  const item = page.locator(`.nav-item[data-view="${view}"]`);
  const group = item.locator('xpath=ancestor::details[1]');
  if (await group.count() && !await group.evaluate(node => node.open)) await group.locator('summary').click();
  await item.click();
  await page.waitForFunction(value => document.body.dataset.view === value, view);
}

async function request(page, url, method = 'GET', body) {
  return page.evaluate(async ({ url, method, body }) => {
    const response = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json().catch(() => ({}));
    return { status: response.status, payload };
  }, { url, method, body });
}

async function loginCredentials(browser, email, password, width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 960 }, permissions: ['geolocation'], geolocation: { latitude: 17.5109, longitude: 78.3276 } });
  const page = await context.newPage();
  watch(page, `Synthetic-Police-${width}`);
  await page.goto(process.env.RELEASE_TEST_FRONTEND_URL || 'http://127.0.0.1:3002', { waitUntil: 'networkidle' });
  await page.locator('#loginForm input[name="email"]').fill(email);
  await page.locator('#loginForm input[name="password"]').fill(password);
  await page.locator('#loginForm button[type="submit"]').click();
  await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible' });
  return { context, page };
}

async function ensureFreshTestDispatchUnit(browser, page, officer) {
  const suffix = `QA-RECOMMEND-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
  const units = await request(page, '/api/response-units');
  assert.equal(units.status, 200, `Admin must load response units before preparing dispatch fixtures: ${JSON.stringify(units.payload)}`);
  const reference = units.payload.units.find(unit => unit.id === 'fixture_unit_alpha') || units.payload.units[0];
  assert.ok(reference?.stationId || reference?.linkedStationId, 'A registered station is required for the synthetic dispatch unit');
  const created = await request(page, '/api/response-units', 'POST', {
    unitId: suffix,
    unitName: `Synthetic Fresh Dispatch Unit ${suffix}`,
    unitType: 'police_patrol',
    officerName: 'Synthetic E2E Unit',
    linkedStationId: reference.stationId || reference.linkedStationId,
    stationName: 'Patancheru Police Station',
    beat: 'Industrial Area',
    jurisdiction: 'Patancheru',
    lat: 17.5109,
    lng: 78.3276,
    address: 'Synthetic isolated acceptance fixture',
    status: 'available',
    source: 'admin_registry',
    operational: true
  });
  assert.equal(created.status, 201, `A fresh isolated response unit must be available for dispatch recommendation: ${JSON.stringify(created.payload)}`);
  const unit = created.payload.unit;
  const member = await request(page, `/api/admin/response-units/${unit.id}/members`, 'POST', { officerUserId: officer.officerId, role: 'commander' });
  assert.equal(member.status, 201, `The synthetic on-duty officer must be registered in the dispatch unit: ${JSON.stringify(member.payload)}`);
  const police = await loginCredentials(browser, officer.email, 'Synthetic-QA-Password-2026!');
  try {
    const capturedAt = new Date().toISOString();
    const telemetry = await request(police.page, `/api/response-units/${unit.id}/location`, 'POST', {
      latitude: 17.5109,
      longitude: 78.3276,
      accuracy: 8,
      speed: 0,
      heading: 0,
      capturedAt
    });
    assert.equal(telemetry.status, 200, `Authorized synthetic officer GPS must be accepted for test dispatch: ${JSON.stringify(telemetry.payload)}`);
    assert.equal(telemetry.payload.unit.locationSource, 'live_gps');
    assert.equal(telemetry.payload.unit.locationFreshnessState, 'FRESH');
  } finally {
    await police.context.close();
  }
  return unit;
}

async function reportIncidentJourney(browser, databaseUrl) {
  const citizen = await login(browser, 'Citizen');
  const citizenPage = citizen.page;
  await nav(citizenPage, 'missing');
  const tag = `QA-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
  const personName = `Synthetic E2E ${tag}`;
  const createReport = citizenPage.waitForResponse(response => /\/api\/(?:missing-persons|report-missing)$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST', { timeout: 15000 });
  await citizenPage.locator('#missingForm [name="personName"]').fill(personName);
  await citizenPage.locator('#missingForm [name="age"]').fill('31');
  await citizenPage.locator('#missingForm [name="lastSeen"]').fill(`QA Test Sector ${tag}`);
  await citizenPage.locator('#missingForm [name="lat"]').fill('17.5109');
  await citizenPage.locator('#missingForm [name="lng"]').fill('78.3276');
  await citizenPage.locator('#missingForm [name="description"]').fill('Synthetic acceptance fixture only; no real person data.');
  await citizenPage.locator('#registerReportBtn').click();
  const created = await createReport.catch(async error => {
    const details = { statusText: await citizenPage.locator('#missingFormStatus').innerText().catch(() => ''), buttonDisabled: await citizenPage.locator('#registerReportBtn').isDisabled().catch(() => null), view: await citizenPage.evaluate(() => document.body.dataset.view).catch(() => ''), recentRequests: issues[0].requests.slice(-15) };
    fs.writeFileSync(path.join(evidenceDir, 'priority-browser-diagnostics.json'), `${JSON.stringify(issues, null, 2)}\n`);
    throw new Error(`Citizen report submit did not reach expected endpoint: ${JSON.stringify(details)}`, { cause: error });
  });
  assert.equal(created.status(), 201, 'Citizen report creation must return 201');
  const createdPayload = await created.json();
  const reportId = createdPayload.report.id;
  await citizenPage.locator('#missingFormStatus').getByText('Submitted for review', { exact: true }).waitFor({ state: 'visible' });
  await citizenPage.screenshot({ path: path.join(evidenceDir, 'priority-citizen-report-submitted.png'), fullPage: true });
  const denied = await request(citizenPage, '/api/admin/police-users');
  assert.equal(denied.status, 403, 'Citizen must be denied access to Admin police management data');
  await citizen.context.tracing.stop({ path: path.join(evidenceDir, 'priority-citizen-report.zip') });
  await citizen.context.close();

  const admin = await login(browser, 'Admin');
  const page = admin.page;
  const officer = await checkPoliceManagementWorkflow(page, { width: 1440, height: 960 }, path.join(evidenceDir, 'screenshots'), 'chromium', {
    retainMembership: true, dutyStatus: 'on_duty', availabilityStatus: 'available'
  });
  const dispatchUnit = await ensureFreshTestDispatchUnit(browser, page, officer);
  officer.unitId = dispatchUnit.id;
  await nav(page, 'incident-command');
  const reviewCard = page.locator('#commandReviewQueue .command-review-card').filter({ hasText: personName });
  await reviewCard.waitFor({ state: 'visible' });
  const verify = page.waitForResponse(response => response.url().includes(`/api/reports/${reportId}/create-incident`) && response.request().method() === 'POST');
  await reviewCard.getByRole('button', { name: 'Verify Report' }).click();
  const verifiedResponse = await verify;
  assert.equal(verifiedResponse.status(), 201, 'Admin verification must create a linked incident');
  const verified = await verifiedResponse.json();
  const incidentId = verified.incident.id;
  assert.equal(verified.report.status, 'verified');
  await page.locator('#commandReviewStatus').getByText(/Report verified/i).waitFor({ state: 'visible' });
  const commandRefresh = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/api/incidents') && response.request().method() === 'GET' && response.status() === 200);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible' });
  await nav(page, 'incident-command');
  const refreshedResponse = await commandRefresh;
  const visibleApiIncidents = (await refreshedResponse.json()).incidents || [];
  assert.ok(visibleApiIncidents.some(item => item.id === incidentId), `Admin refreshed live incident API must return the newly verified incident ${incidentId}; got ${visibleApiIncidents.length}`);
  await page.screenshot({ path: path.join(evidenceDir, 'priority-admin-verified-report.png'), fullPage: true });
  await page.locator('#commandIncidentSearch').fill(incidentId);
  await page.screenshot({ path: path.join(evidenceDir, 'priority-admin-incident-search.png'), fullPage: true });

  const reviewedIncidentRow = page.locator('#commandIncidentQueue .command-incident-row').filter({ hasText: incidentId });
  await reviewedIncidentRow.waitFor({ state: 'visible', timeout: 5000 }).catch(async error => {
    const apiRecord = visibleApiIncidents.find(item => item.id === incidentId);
    throw new Error(`Incident API returned ${JSON.stringify({ id: apiRecord?.id, title: apiRecord?.title, status: apiRecord?.status, source: apiRecord?.source, severity: apiRecord?.severity })}, but UI queue did not: ${await page.locator('#commandIncidentQueue').innerText()}`, { cause: error });
  });
  await reviewedIncidentRow.click();
  page.once('dialog', dialog => dialog.accept());
  const confirmLocation = page.waitForResponse(response => response.url().endsWith(`/api/incidents/${incidentId}/confirm-location`) && response.request().method() === 'POST');
  await page.locator('#commandIncidentDetail').getByRole('button', { name: 'Use My Current Location' }).click();
  assert.equal((await confirmLocation).status(), 200, 'Admin must confirm the report coordinates before dispatch');
  await page.waitForTimeout(250);

  const unitResponse = await request(page, '/api/response-units');
  assert.equal(unitResponse.status, 200);
  const unit = unitResponse.payload.units.find(item => item.id === officer.unitId);
  assert.ok(unit, 'Synthetic officer unit must exist');
  const unitLabel = unit.unitCode || unit.name || unit.id;
  const reassignTag = `QA-REASSIGN-${Date.now()}`;
  const alternateUnit = await request(page, '/api/response-units', 'POST', {
    unitId: reassignTag, unitName: `Synthetic Reassignment Unit ${reassignTag}`, unitType: 'police_patrol',
    officerName: 'Synthetic E2E Unit', linkedStationId: officer.stationId, stationName: 'Patancheru Police Station', beat: 'Industrial Area',
    jurisdiction: 'Patancheru', lat: 17.512, lng: 78.329, address: 'Synthetic test fixture only',
    status: 'available', source: 'admin_registry', operational: true
  });
  assert.equal(alternateUnit.status, 201, `Synthetic alternate unit must be created: ${JSON.stringify(alternateUnit.payload)}`);

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible' });
  await nav(page, 'unit-assignment');
  const incidentCard = page.locator('#assignmentIncidentList .assignment-incident-card').filter({ hasText: incidentId });
  await incidentCard.waitFor({ state: 'visible' });
  await incidentCard.click();
  const unitCard = page.locator('#assignmentUnitList .assignment-unit-card').filter({ hasText: unitLabel });
  await unitCard.waitFor({ state: 'visible' });
  page.once('dialog', dialog => dialog.accept());
  const assign = page.waitForResponse(response => response.url().includes(`/api/incidents/${incidentId}/assign-unit`) && response.request().method() === 'POST');
  await unitCard.getByRole('button').click();
  const assigned = await assign;
  assert.equal(assigned.status(), 200, 'Unit Assignment UI must persist primary unit assignment');
  const initialAssignment = await assigned.json();
  assert.equal(initialAssignment.incident.assignedUnitId, officer.unitId);
  await page.waitForTimeout(250);

  const active = page.locator('#assignmentActiveList .assignment-active-card').filter({ hasText: incidentId });
  await active.waitFor({ state: 'visible' });
  await active.getByRole('button', { name: 'Change Unit' }).click();
  const alternateCard = page.locator('#assignmentUnitList .assignment-unit-card').filter({ hasText: reassignTag });
  console.log(`Unit reassignment candidates: ${(await page.locator('#assignmentUnitList').innerText()).slice(0, 2500)}`);
  await page.screenshot({ path: path.join(evidenceDir, 'priority-unit-reassignment-candidates.png'), fullPage: true });
  await alternateCard.waitFor({ state: 'visible' });
  const unitReassignDialog = dialog => dialog.type() === 'prompt' ? dialog.accept('Synthetic reassignment verification') : dialog.accept();
  page.on('dialog', unitReassignDialog);
  const reassignResponse = page.waitForResponse(response => response.url().includes(`/api/incidents/${incidentId}/assign-unit`) && response.request().method() === 'POST');
  await alternateCard.getByRole('button').click();
  const reassigned = await reassignResponse;
  page.off('dialog', unitReassignDialog);
  assert.equal(reassigned.status(), 200, 'Unit reassignment must persist through the Unit Assignment UI');
  assert.equal((await reassigned.json()).incident.assignedUnitId, alternateUnit.payload.unit.id);
  await page.waitForTimeout(200);
  const reassignPersisted = await request(page, `/api/incidents/${incidentId}`);
  assert.equal(reassignPersisted.payload.incident.assignedUnitId, alternateUnit.payload.unit.id, 'Reassignment must survive a live API read');
  const releaseDialog = dialog => dialog.type() === 'prompt' ? dialog.accept('Synthetic unit release verification') : dialog.accept();
  page.on('dialog', releaseDialog);
  const releaseUnit = page.waitForResponse(response => response.url().endsWith(`/api/incidents/${incidentId}/release-unit`) && response.request().method() === 'POST');
  await page.locator('#assignmentActiveList .assignment-active-card').filter({ hasText: incidentId }).getByRole('button', { name: 'Release Unit' }).click();
  assert.equal((await releaseUnit).status(), 200, 'Unit release must persist through the Unit Assignment UI');
  page.off('dialog', releaseDialog);
  const releasedUnit = await request(page, `/api/incidents/${incidentId}`);
  assert.equal(releasedUnit.payload.incident.assignedUnitId, null, 'Release must clear the incident primary unit');

  const restorePrimary = await request(page, `/api/incidents/${incidentId}/assign-unit`, 'POST', {
    unitId: officer.unitId, expectedAssignedUnitId: null, reason: 'Restore synthetic deployment fixture after UI reassignment and release'
  });
  assert.equal(restorePrimary.status, 200, `Primary test unit must be restored before officer deployment: ${JSON.stringify(restorePrimary.payload)}`);
  assert.equal(restorePrimary.payload.incident.assignedUnitId, officer.unitId);
  await page.waitForTimeout(250);

  const activeAfterRestore = page.locator('#assignmentActiveList .assignment-active-card').filter({ hasText: incidentId });
  await activeAfterRestore.waitFor({ state: 'visible' });
  await activeAfterRestore.getByRole('button', { name: 'Manage Police Assignment' }).click();
  await page.waitForFunction(() => document.body.dataset.view === 'police-assignment');
  const officerRow = page.locator('#policeAssignmentMembers .police-assignment-row').filter({ hasText: officer.officerName });
  await officerRow.waitFor({ state: 'visible' });
  await officerRow.locator('input[data-officer-id]').check();
  await officerRow.locator('select[data-role-for]').selectOption('TEAM_LEAD');
  page.once('dialog', dialog => dialog.accept());
  const deploy = page.waitForResponse(response => response.url().endsWith(`/api/incidents/${incidentId}/officer-assignments`) && response.request().method() === 'POST');
  await page.locator('#assignSelectedOfficers').click();
  const deployed = await deploy;
  assert.equal(deployed.status(), 201, 'Officer deployment UI must persist deployment');
  const deployedBody = await deployed.json();
  const deployment = deployedBody.assignments.find(item => item.officerId === officer.officerId);
  assert.ok(deployment?.id, 'Deployment must return a persisted assignment ID');
  await page.screenshot({ path: path.join(evidenceDir, 'priority-officer-deployed.png'), fullPage: true });

  const expected = { assignments: [{ officerId: officer.officerId, responseRole: 'TEAM_LEAD' }] };
  const [concurrentA, concurrentB] = await Promise.all([
    request(page, `/api/incidents/${incidentId}/officer-assignments`, 'POST', expected),
    request(page, `/api/incidents/${incidentId}/officer-assignments`, 'POST', expected)
  ]);
  assert.ok([400, 409].includes(concurrentA.status) && [400, 409].includes(concurrentB.status), `Concurrent duplicate deployments must both be rejected, received ${concurrentA.status}, ${concurrentB.status}`);

  await officerRow.locator('select[data-role-for]').selectOption('DRIVER');
  const roleDialog = dialog => dialog.type() === 'prompt' ? dialog.accept('Synthetic role change verification') : dialog.accept();
  page.on('dialog', roleDialog);
  const roleChange = page.waitForResponse(response => response.url().includes(`/api/incidents/${incidentId}/officer-assignments/${deployment.id}`) && response.request().method() === 'PATCH');
  await officerRow.getByRole('button', { name: 'Update Role' }).click();
  assert.equal((await roleChange).status(), 200, 'Officer response role update must persist through the UI');
  await page.waitForTimeout(200);
  page.off('dialog', roleDialog);
  const releaseOfficerDialog = dialog => dialog.type() === 'prompt' ? dialog.accept('Synthetic officer release verification') : dialog.accept();
  page.on('dialog', releaseOfficerDialog);
  const releaseOfficer = page.waitForResponse(response => response.url().endsWith(`/api/incidents/${incidentId}/officer-assignments/${deployment.id}/release`) && response.request().method() === 'POST');
  await officerRow.getByRole('button', { name: 'Release Officer' }).click();
  assert.equal((await releaseOfficer).status(), 200, 'Officer release must persist through the UI');
  page.off('dialog', releaseOfficerDialog);
  await page.screenshot({ path: path.join(evidenceDir, 'priority-officer-released.png'), fullPage: true });

  await nav(page, 'incident-command');
  const incidentQueueRow = page.locator('#commandIncidentQueue .command-incident-row').filter({ hasText: incidentId });
  await incidentQueueRow.waitFor({ state: 'visible' });
  await incidentQueueRow.click();
  for (const [label, status] of [['Mark En Route', 'En Route'], ['Mark On Scene', 'On Scene'], ['Resolve', 'Resolved']]) {
    const mutation = page.waitForResponse(response => response.url().endsWith(`/api/incidents/${incidentId}/status`) && response.request().method() === 'PATCH');
    await page.locator('#commandIncidentDetail').getByRole('button', { name: label }).click();
    const response = await mutation;
    assert.equal(response.status(), 200, `${label} transition must persist`);
    await page.locator('#commandIncidentDetail').getByText(status, { exact: true }).waitFor({ state: 'visible' }).catch(() => {});
    await page.waitForTimeout(200);
  }
  const persisted = await request(page, `/api/incidents/${incidentId}`);
  assert.equal(persisted.status, 200);
  assert.equal(persisted.payload.incident.status, 'Resolved');
  await page.goBack({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.view === 'police-assignment');
  await page.goForward({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.view === 'incident-command');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.view === 'incident-command', { timeout: 15000 });
  await nav(page, 'incident-command');
  const citizenAfter = await login(browser, 'Citizen');
  await nav(citizenAfter.page, 'missing');
  await citizenAfter.page.reload({ waitUntil: 'networkidle' });
  await citizenAfter.page.waitForFunction(() => document.body.dataset.view === 'missing', { timeout: 15000 });
  const citizenReport = citizenAfter.page.locator('#caseList .report-card').filter({ hasText: personName });
  await citizenReport.waitFor({ state: 'visible' });
  assert.match(await citizenReport.innerText(), /Resolved|resolved/i, 'Citizen report status must reflect the resolved incident after refresh');
  await citizenAfter.page.screenshot({ path: path.join(evidenceDir, 'priority-citizen-resolved.png'), fullPage: true });

  const pool = new Pool({ connectionString: databaseUrl, ssl: false });
  let databaseEvidence;
  try {
    const report = await pool.query("SELECT id, status, data->>'incidentId' AS incident_id FROM missing_persons WHERE id=$1", [reportId]);
    const incident = await pool.query('SELECT id, status, assigned_unit_id FROM incidents WHERE id=$1', [incidentId]);
    const audits = await pool.query('SELECT action FROM audit_logs WHERE incident_id=$1 ORDER BY created_at', [incidentId]);
    const deployments = await pool.query('SELECT id, officer_id, response_role, status FROM incident_officer_assignments WHERE incident_id=$1 ORDER BY created_at', [incidentId]);
    const timeline = await pool.query("SELECT event_type, data->>'message' AS description FROM dispatch_events WHERE incident_id=$1 ORDER BY created_at", [incidentId]);
    const notifications = await pool.query("SELECT type, entity_type, entity_id FROM notifications WHERE (entity_type='report' AND entity_id=$1) OR (entity_type='incident' AND entity_id=$2) ORDER BY created_at", [reportId, incidentId]);
    assert.equal(report.rowCount, 1);
    assert.equal(report.rows[0].status, 'resolved');
    assert.equal(report.rows[0].incident_id, incidentId);
    assert.equal(incident.rows[0].status, 'Resolved');
    assert.ok(timeline.rows.some(item => item.event_type === 'status_updated' && /Resolved/.test(item.description)), 'Resolution must persist in the dispatch timeline');
    assert.ok(notifications.rows.some(item => item.type === 'report_verified' && item.entity_id === reportId), 'Report verification notification must be persisted');
    assert.ok(notifications.rows.some(item => item.type === 'incident_unassigned' && item.entity_id === incidentId), 'Dispatch-required incident notification must be persisted');
    const activeDeploymentCount = deployments.rows.filter(item => item.status !== 'RELEASED').length;
    assert.equal(activeDeploymentCount, 0, 'Released synthetic officer must not remain deployed');
    const assignedAuditCount = audits.rows.filter(item => item.action === 'incident_officer_assigned').length;
    assert.equal(assignedAuditCount, 1, 'Rejected concurrent duplicates must not emit extra assignment audit records');
    assert.ok(audits.rows.some(item => item.action === 'incident_resolved'), 'Resolution audit record must be persisted');
    databaseEvidence = { report: report.rows[0], incident: incident.rows[0], audits: audits.rows.map(row => row.action), timeline: timeline.rows, notifications: notifications.rows, officerDeploymentRows: deployments.rows, duplicateConcurrencyStatus: [concurrentA.status, concurrentB.status], atomicDeploymentAuditCount: assignedAuditCount };
  } finally { await pool.end(); }
  fs.writeFileSync(path.join(evidenceDir, 'priority-workflow-postgres-evidence.json'), `${JSON.stringify(databaseEvidence, null, 2)}\n`);

  // Keep the incident's primary unit attached through resolution, then prepare a
  // separate fresh synthetic unit for the independent simulated ERSS dispatch.
  const erssReserveUnit = await ensureFreshTestDispatchUnit(browser, admin.page, officer);
  await admin.page.screenshot({ path: path.join(evidenceDir, 'priority-admin-resolved.png'), fullPage: true });
  await citizenAfter.context.tracing.stop({ path: path.join(evidenceDir, 'priority-citizen-final.zip') });
  await citizenAfter.context.close();
  console.log(`Citizen/Admin/Police resolution workflow passed: report=${reportId}, incident=${incidentId}, unit=${officer.unitId}, officer=${officer.officerId}, duplicate deployment responses=${concurrentA.status}/${concurrentB.status}`);
  return { page, context: admin.context, incidentId, reportId, officer, unitId: officer.unitId, erSSReserveUnitId: erssReserveUnit.id, databaseEvidence };
}

async function erssWorkflow(browser, page, databaseUrl, expectedUnitId = null) {
  const suffix = `SIM-${Date.now()}`;
  const invalid = await request(page, '/api/erss/events/simulate', 'POST', { channel: 'VOICE_CALL', callerReference: `${suffix}-INVALID`, locationConfidence: 'invalid' });
  assert.equal(invalid.status, 400, 'Malformed simulated ERSS intake must return a validation failure before retry');
  const create = await request(page, '/api/erss/events/simulate', 'POST', {
    channel: 'VOICE_CALL', externalEventId: suffix, callerReference: `${suffix}-CALLER`, callerLocationText: 'Synthetic Test Zone',
    callerLatitude: 17.5109, callerLongitude: 78.3276, incidentLocationText: 'Synthetic Test Zone',
    incidentLatitude: 17.5109, incidentLongitude: 78.3276, locationSource: 'MANUAL_OPERATOR',
    locationConfidence: 'high', emergencyType: 'POLICE', priority: 'HIGH', callStatus: 'IN_PROGRESS'
  });
  assert.equal(create.status, 201, `Simulated ERSS intake create failed: ${JSON.stringify(create.payload)}`);
  const eventId = create.payload.event.id;
  assert.equal(create.payload.event.simulated, true, 'Emergency input must be labeled simulated');
  await nav(page, 'erss-call-taker');
  const refreshEvents = page.waitForResponse(response => new URL(response.url()).pathname === '/api/erss/events' && response.request().method() === 'GET' && response.status() === 200);
  await page.locator('#refreshErssCallTaker').click();
  await refreshEvents;
  const eventCard = page.locator('#erssCallInfo .erss-event-card').filter({ hasText: suffix });
  await eventCard.waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(evidenceDir, 'priority-erss-simulated-intake.png'), fullPage: true });
  const openCall = eventCard.getByRole('button', { name: 'Select / Open' });
  if (await openCall.count()) await openCall.click();
  else await eventCard.click();
  await page.locator('#triageForm form').waitFor({ state: 'visible' });
  await page.locator('#triageForm select').nth(0).selectOption('POLICE');
  await page.locator('#triageForm select').nth(1).selectOption('HIGH');
  await page.locator('#triageForm select').nth(2).selectOption('yes');
  await page.locator('#triageForm select').nth(3).selectOption('yes');
  await page.locator('#triageForm select').nth(4).selectOption('yes');
  await page.locator('#triageForm textarea').fill('Synthetic acceptance emergency; no live caller.');
  await page.locator('#triageForm select').nth(5).selectOption('FORWARD_TO_DISPATCH');
  await page.locator('#triageForm input[type="checkbox"]').check();
  const triageFormState = await page.locator('#triageForm form').evaluate(form => ({ valid: form.checkValidity(), action: form.querySelectorAll('select')[5]?.value, confirmation: form.querySelector('input[type="checkbox"]')?.checked, buttonDisabled: form.querySelector('button[type="submit"]')?.disabled }));
  const triage = page.waitForResponse(response => response.url().endsWith(`/api/erss/events/${eventId}/triage`) && response.request().method() === 'POST', { timeout: 8000 }).catch(() => null);
  await page.locator('#triageForm button[type="submit"]').click();
  const triageResponse = await triage;
  if (!triageResponse) {
    await page.screenshot({ path: path.join(evidenceDir, 'priority-erss-triage-submit-blocked.png'), fullPage: true });
    throw new Error(`ERSS triage produced no API response; form=${JSON.stringify(triageFormState)}, status=${await page.locator('#triageForm').innerText()}`);
  }
  assert.equal(triageResponse.status(), 201, 'Confirmed ERSS triage must persist');
  const triageDetails = await request(page, `/api/erss/events/${eventId}`);
  assert.equal(triageDetails.status, 200, `Triaged ERSS event must remain readable: ${JSON.stringify(triageDetails.payload)}`);
  assert.equal(triageDetails.payload.event.triageStatus, 'DISPATCH_RECOMMENDED', `Human-forwarded ERSS event must enter dispatch queue: ${JSON.stringify(triageDetails.payload.event)}`);
  await nav(page, 'erss-dispatcher');
  const refreshDispatcher = page.waitForResponse(response => new URL(response.url()).pathname === '/api/erss/events' && response.request().method() === 'GET' && response.status() === 200, { timeout: 10000 });
  await page.locator('#refreshErssDispatcher').click();
  await refreshDispatcher;
  const eventQueueCard = page.locator('#dispatcherQueue .erss-event-card').filter({ hasText: suffix });
  await eventQueueCard.waitFor({ state: 'visible' });
  await eventQueueCard.getByRole('button').click();
  await page.getByRole('button', { name: 'Review & Dispatch' }).waitFor({ state: 'visible' }).catch(() => {});
  const approve = page.getByRole('button', { name: 'Approve & Dispatch' });
  await approve.waitFor({ state: 'visible' });
  const approveResponse = page.waitForResponse(response => /\/api\/erss\/dispatch-requests\/[^/]+\/approve$/.test(response.url()) && response.request().method() === 'POST');
  await approve.click();
  const approved = await approveResponse;
  assert.equal(approved.status(), 200, 'ERSS dispatch approval must persist');
  await page.screenshot({ path: path.join(evidenceDir, 'priority-erss-dispatched.png'), fullPage: true });
  const details = await request(page, `/api/erss/events/${eventId}`);
  assert.equal(details.status, 200);
  assert.equal(details.payload.event.simulated, true);
  assert.equal(details.payload.event.triageStatus, 'DISPATCH_RECOMMENDED');
  const dispatchRequestId = details.payload.dispatchRequest?.id;
  assert.ok(dispatchRequestId, 'Approved ERSS event must be linked to its dispatch request');
  const unitRequestsBefore = await request(page, `/api/erss/dispatch-requests/${dispatchRequestId}/unit-requests`);
  assert.equal(unitRequestsBefore.status, 200);
  assert.equal(unitRequestsBefore.payload.requests.length, 1, 'Approval must create one primary unit request');
  const unitRequest = unitRequestsBefore.payload.requests[0];
  assert.equal(unitRequest.status, 'REQUESTED');
  if (expectedUnitId) assert.equal(unitRequest.unitId, expectedUnitId, 'Combined ERSS dispatch must use the reserved fresh synthetic unit, not the unit committed to the citizen incident');
  const acknowledged = await request(page, `/api/erss/unit-requests/${unitRequest.id}/acknowledge`, 'POST', { unitId: unitRequest.unitId });
  assert.equal(acknowledged.status, 200, 'Selected synthetic unit must acknowledge the dispatch request');
  assert.equal(acknowledged.payload.request.status, 'ACKNOWLEDGED');
  const accepted = await request(page, `/api/erss/unit-requests/${unitRequest.id}/accept`, 'POST', { unitId: unitRequest.unitId });
  assert.equal(accepted.status, 200, 'Acknowledged synthetic unit must accept the dispatch request');
  assert.equal(accepted.payload.request.status, 'ACCEPTED');
  const dispatchedDetails = await request(page, `/api/erss/events/${eventId}`);
  assert.equal(dispatchedDetails.status, 200);
  assert.equal(dispatchedDetails.payload.event.triageStatus, 'DISPATCHED', 'Unit acceptance must transition the simulated ERSS event to DISPATCHED');
  const pool = new Pool({ connectionString: databaseUrl, ssl: false });
  try {
    const persisted = await pool.query('SELECT simulated, triage_status, incident_id FROM erss_events WHERE id=$1', [eventId]);
    const triage = await pool.query('SELECT human_confirmed, action_taken FROM erss_triage WHERE erss_event_id=$1', [eventId]);
    const dispatch = await pool.query('SELECT id, status, incident_id FROM erss_dispatch_requests WHERE erss_event_id=$1', [eventId]);
    const unitRows = await pool.query('SELECT status, unit_id FROM erss_unit_requests WHERE erss_dispatch_request_id=$1', [dispatchRequestId]);
    const unit = await pool.query('SELECT status, assigned_incident_id FROM response_units WHERE id=$1', [unitRequest.unitId]);
    const audit = await pool.query("SELECT action FROM audit_logs WHERE incident_id=$1 AND action IN ('erss_dispatch_approved','erss_unit_requested','erss_unit_acknowledged','erss_unit_accepted') ORDER BY created_at", [persisted.rows[0]?.incident_id]);
    assert.equal(persisted.rows[0]?.simulated, true);
    assert.equal(persisted.rows[0]?.triage_status, 'DISPATCHED');
    assert.ok(persisted.rows[0]?.incident_id, 'ERSS event must link to the canonical incident');
    assert.equal(triage.rows[0]?.human_confirmed, true);
    assert.equal(dispatch.rowCount, 1);
    assert.equal(dispatch.rows[0]?.incident_id, persisted.rows[0]?.incident_id, 'Dispatch request must persist its canonical incident link');
    assert.equal(unitRows.rowCount, 1);
    assert.equal(unitRows.rows[0]?.status, 'ACCEPTED');
    assert.equal(unit.rows[0]?.status, 'busy');
    assert.equal(unit.rows[0]?.assigned_incident_id, persisted.rows[0]?.incident_id);
    for (const action of ['erss_dispatch_approved', 'erss_unit_requested', 'erss_unit_acknowledged', 'erss_unit_accepted']) assert.ok(audit.rows.some(row => row.action === action), `Missing persisted audit action ${action}`);
    console.log(`ERSS PostgreSQL evidence: ${JSON.stringify({ event: persisted.rows[0], triage: triage.rows[0], dispatch: dispatch.rows[0], unitRequest: unitRows.rows[0], unit: unit.rows[0], audit: audit.rows.map(row => row.action) })}`);
  } finally { await pool.end(); }
  console.log(`ERSS simulated workflow passed: event=${eventId}, triage=${dispatchedDetails.payload.event.triageStatus}, dispatchRequest=${details.payload.dispatchRequest?.status || 'recorded'}, unitRequest=${accepted.payload.request.status}`);
  return { eventId, status: dispatchedDetails.payload.event.triageStatus, simulated: details.payload.event.simulated, unitRequestStatus: accepted.payload.request.status };
}

async function assignIncidentUnitInUi(page, incidentId, unitId) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible' });
  await nav(page, 'unit-assignment');
  const incidentCard = page.locator('#assignmentIncidentList .assignment-incident-card').filter({ hasText: incidentId });
  await incidentCard.waitFor({ state: 'visible' });
  await incidentCard.click();
  const unitList = await request(page, '/api/response-units');
  assert.equal(unitList.status, 200);
  const unit = unitList.payload.units.find(item => item.id === unitId);
  assert.ok(unit, `Synthetic primary unit ${unitId} must appear in the assignment list`);
  const label = unit.unitCode || unit.name || unit.id;
  const unitCard = page.locator('#assignmentUnitList .assignment-unit-card').filter({ hasText: label });
  await unitCard.waitFor({ state: 'visible' });
  const assigned = page.waitForResponse(response => response.url().endsWith(`/api/incidents/${incidentId}/assign-unit`) && response.request().method() === 'POST');
  await unitCard.getByRole('button').click();
  const response = await assigned;
  assert.equal(response.status(), 200, `Primary unit assignment must succeed through Unit Assignment UI: ${await response.text()}`);
}

async function openPoliceAssignmentForIncident(page, incidentId) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible' });
  await nav(page, 'unit-assignment');
  const cards = page.locator('#assignmentActiveList .assignment-active-card');
  let active = null;
  for (let index = 0; index < await cards.count(); index++) {
    const candidate = cards.nth(index);
    if ((await candidate.locator('strong').first().innerText()).startsWith(`${incidentId} ·`)) { active = candidate; break; }
  }
  assert.ok(active, `Assigned incident ${incidentId} must appear in the active unit list: ${await page.locator('#assignmentActiveList').innerText()}`);
  await active.getByRole('button', { name: 'Manage Police Assignment' }).click();
  await page.waitForFunction(() => document.body.dataset.view === 'police-assignment');
  await page.locator('#policeAssignmentMembers .police-assignment-row').first().waitFor({ state: 'visible' });
}

async function runConcurrentBrowserWorkflow(browser, databaseUrl) {
  const adminA = await login(browser, 'Admin');
  const acceptSyntheticDialogs = page => page.on('dialog', dialog => {
    const action = dialog.type() === 'prompt' ? dialog.accept('Synthetic isolated concurrency verification') : dialog.accept();
    action.catch(error => { if (!/already handled|closed/i.test(error.message)) throw error; });
  });
  acceptSyntheticDialogs(adminA.page);
  const officer = await checkPoliceManagementWorkflow(adminA.page, { width: 1440, height: 960 }, path.join(evidenceDir, 'screenshots'), 'chromium', {
    retainMembership: true, dutyStatus: 'on_duty', availabilityStatus: 'available'
  });
  const units = [];
  for (let i = 0; i < 2; i++) units.push(await ensureFreshTestDispatchUnit(browser, adminA.page, officer));
  const incidents = [];
  for (let i = 0; i < 2; i++) {
    const created = await request(adminA.page, '/api/incidents', 'POST', {
      title: `Synthetic Concurrent Deployment ${i + 1} ${Date.now()}`,
      category: 'police_response', severity: 'HIGH', source: 'Manual', sourceType: 'manual',
      address: 'Synthetic isolated test coordinates', zone: 'Patancheru', lat: 17.5109 + i * 0.001,
      lng: 78.3276 + i * 0.001, locationSource: 'map_click', locationStatus: 'Verified', status: 'Verified'
    });
    assert.equal(created.status, 201, `Synthetic incident creation failed: ${JSON.stringify(created.payload)}`);
    incidents.push(created.payload.incident);
  }
  for (let i = 0; i < 2; i++) await assignIncidentUnitInUi(adminA.page, incidents[i].id, units[i].id);
  const adminB = await login(browser, 'Admin');
  acceptSyntheticDialogs(adminB.page);
  const pages = [adminA.page, adminB.page];
    const incidentsByRound = incidents;
  const pool = new Pool({ connectionString: databaseUrl, ssl: false });
  const roundEvidence = [];
  try {
    for (let round = 0; round < 2; round++) {
      await Promise.all(pages.map((page, index) => {
        const incident = incidentsByRound[index];
        return openPoliceAssignmentForIncident(page, incident.id);
      }));
      for (const [index, page] of pages.entries()) {
        const row = page.locator('#policeAssignmentMembers .police-assignment-row').filter({ hasText: officer.officerName });
        await row.waitFor({ state: 'visible' });
        const checkbox = row.locator('input[data-officer-id]');
        await checkbox.waitFor({ state: 'visible' });
        assert.ok(await checkbox.isEnabled(), `Synthetic officer must be selectable for race round ${round + 1} in browser ${index + 1}`);
        await checkbox.check();
        await row.locator('select[data-role-for]').selectOption(index ? 'RESPONSE_OFFICER' : 'TEAM_LEAD');
      }
      await Promise.all(pages.map(page => page.waitForFunction(() => {
        const button = document.querySelector('#assignSelectedOfficers');
        return Boolean(button && !button.disabled);
      })));
      const responses = await Promise.all(pages.map(async page => {
        const response = page.waitForResponse(item => /\/officer-assignments$/.test(new URL(item.url()).pathname) && item.request().method() === 'POST', { timeout: 15000 });
        await page.locator('#assignSelectedOfficers').click();
        return response;
      }));
      const results = await Promise.all(responses.map(async response => ({ status: response.status(), body: await response.json() })));
      assert.deepEqual(results.map(item => item.status).sort((a, b) => a - b), [201, 409], `Race round ${round + 1} must yield one creation and one conflict: ${JSON.stringify(results)}`);
      const winnerIndex = results.findIndex(item => item.status === 201);
      const loserIndex = 1 - winnerIndex;
      assert.equal(results[loserIndex].body.code, 'OFFICER_BUSY', `Losing UI request must receive OFFICER_BUSY: ${JSON.stringify(results[loserIndex])}`);
      await pages[loserIndex].locator('#policeAssignmentStatus').getByText(/already deployed|committed|not currently available/i).waitFor({ state: 'visible' });
      const incidentIds = incidents.map(item => item.id);
      const dbState = await pool.query(`SELECT incident_id,status,unit_id,response_role FROM incident_officer_assignments WHERE officer_id=$1 AND incident_id=ANY($2::text[]) ORDER BY assigned_at`, [officer.officerId, incidentIds]);
      const active = dbState.rows.filter(row => ['ASSIGNED','EN_ROUTE','ON_SCENE'].includes(row.status));
      assert.equal(active.length, 1, 'Exactly one competing incident may have an active deployment');
      const raceAudits = await pool.query(`SELECT incident_id,data->>'action' AS action FROM audit_logs WHERE incident_id=ANY($1::text[]) AND data->>'action'='incident_officer_assigned'`, [incidentIds]);
      assert.equal(raceAudits.rowCount, round + 1, 'Exactly one assignment audit must be added per successful race round');
      const raceTimeline = await pool.query(`SELECT incident_id,event_type FROM dispatch_events WHERE incident_id=ANY($1::text[]) AND event_type='incident_officer_assigned'`, [incidentIds]);
      assert.equal(raceTimeline.rowCount, round + 1, 'Exactly one assignment timeline event must be added per successful race round');
      await pages[winnerIndex].screenshot({ path: path.join(evidenceDir, `concurrent-deployment-round-${round + 1}-winner.png`), fullPage: true });
      await pages[loserIndex].screenshot({ path: path.join(evidenceDir, `concurrent-deployment-round-${round + 1}-conflict.png`), fullPage: true });
      roundEvidence.push({ round: round + 1, http: results.map(item => ({ status: item.status, code: item.body.code || 'CREATED' })), winnerIncidentId: active[0].incident_id, activeRows: active.length, assignmentAuditRows: raceAudits.rowCount, timelineRows: raceTimeline.rowCount, loserMessage: await pages[loserIndex].locator('#policeAssignmentStatus').innerText() });
      if (round === 0) {
        const winnerIncident = incidents.find(item => item.id === active[0].incident_id);
        const winnerDeployment = dbState.rows.find(row => row.incident_id === winnerIncident.id);
        // Release via the winner's real Police Assignment controls before repeating the race.
        const releaseContext = pages[winnerIndex];
        await releaseContext.reload({ waitUntil: 'networkidle' });
        await releaseContext.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible' });
        await openPoliceAssignmentForIncident(releaseContext, winnerIncident.id);
        const deployedRow = releaseContext.locator('#policeAssignmentMembers .police-assignment-row').filter({ hasText: officer.officerName });
        await deployedRow.locator('select[data-role-for]').selectOption(winnerDeployment.response_role);
        const release = releaseContext.waitForResponse(response => /\/officer-assignments\/[^/]+\/release$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
        await deployedRow.getByRole('button', { name: 'Release Officer' }).click();
        assert.equal((await release).status(), 200, 'First race winner must be released through the real UI before repetition');
        for (const page of pages) {
          await page.reload({ waitUntil: 'networkidle' });
          await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible' });
        }
      }
    }
    const finalState = await pool.query(`SELECT incident_id,status FROM incident_officer_assignments WHERE officer_id=$1 AND incident_id=ANY($2::text[]) ORDER BY assigned_at`, [officer.officerId, incidents.map(item => item.id)]);
    const index = await pool.query(`SELECT indexdef FROM pg_indexes WHERE schemaname=current_schema() AND indexname='uq_incident_officer_one_active_per_officer'`);
    const finalActive = finalState.rows.filter(row => ['ASSIGNED','EN_ROUTE','ON_SCENE'].includes(row.status));
    assert.equal(finalActive.length, 1, 'One active deployment must remain persisted after the repeated browser race and refresh');
    assert.equal(index.rowCount, 1, 'Database unique partial index must enforce one active incident per officer');
    const finalWinner = incidents.find(item => item.id === finalActive[0].incident_id);
    const winnerPage = pages[incidents.findIndex(item => item.id === finalWinner.id)];
    await winnerPage.reload({ waitUntil: 'networkidle' });
    await winnerPage.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible' });
    await openPoliceAssignmentForIncident(winnerPage, finalWinner.id);
    await winnerPage.locator('#policeAssignmentMembers .police-assignment-row').filter({ hasText: officer.officerName }).waitFor({ state: 'visible' });
    await Promise.all(issues.flatMap(result => result.responseBodies));
    const expectedCapacityConflict = item => {
      if (item.status !== 409 || item.method !== 'POST' || !/\/api\/incidents\/[^/]+\/recommend-unit$/.test(new URL(item.url).pathname)) return false;
      let body;
      try { body = JSON.parse(item.body || '{}'); } catch { return false; }
      assert.equal(body.code, 'PRIMARY_UNIT_RECOMMENDATION_UNAVAILABLE', 'Recommendation rejection must report the precise no-capacity code');
      assert.ok((body.primaryExcludedUnits || []).some(unit => unit.unitCode?.startsWith('QA-RECOMMEND-') && unit.exclusionReason === 'OFF DUTY OR NO AUTHORISED RESPONDER'), 'Recommendation rejection must be explained by the shared synthetic officer already committed to the other test incident');
      return true;
    };
    const expectedCapacityResponses = issues.flatMap(result => result.httpErrors).filter(expectedCapacityConflict);
    assert.ok(expectedCapacityResponses.length <= 2, `One bounded resource conflict per synthetic incident is expected at most: ${expectedCapacityResponses.length}`);
    const intentionalRaceConflict = entry => entry.status === 409 && entry.method === 'POST'
      && /\/api\/incidents\/[^/]+\/officer-assignments$/.test(entry.url)
      && ['OFFICER_BUSY','DUPLICATE_DEPLOYMENT'].some(code => String(entry.body || '').includes(code));
    const unexpected = issues.map(result => ({ label: result.label, pageErrors: result.pageErrors,
      consoleErrors: result.consoleErrors.filter(entry => {
        if (/status of 409 \(Conflict\)/.test(entry.text) && result.httpErrors.some(item => item.url === entry.location?.url && expectedCapacityConflict(item))) return false;
        if (!/status of 409 \(Conflict\)/.test(entry.text)) return true;
        const response = result.httpErrors.find(item => item.url === entry.location?.url && intentionalRaceConflict(item));
        return !response;
      }),
      failedRequests: result.failedRequests.filter(item => !/(?:tile\.openstreetmap\.org|server\.arcgisonline\.com)/i.test(item.url)),
      httpErrors: result.httpErrors.filter(item => !intentionalRaceConflict(item) && !expectedCapacityConflict(item)) }));
    fs.writeFileSync(path.join(evidenceDir, 'concurrent-deployment-browser-diagnostics.json'), `${JSON.stringify(issues, null, 2)}\n`);
    assert.ok(unexpected.every(item => !item.pageErrors.length && !item.consoleErrors.length && !item.failedRequests.length && !item.httpErrors.length), `Unexpected browser diagnostics in concurrency run: ${JSON.stringify(unexpected)}`);
    fs.writeFileSync(path.join(evidenceDir, 'concurrent-deployment-postgres-evidence.json'), `${JSON.stringify({ officerId: officer.officerId, incidentIds: incidents.map(item => item.id), unitIds: units.map(item => item.id), rounds: roundEvidence, finalRows: finalState.rows, uniqueIndex: index.rows[0].indexdef }, null, 2)}\n`);
    fs.writeFileSync(path.join(evidenceDir, 'concurrent-deployment-browser-diagnostics.json'), `${JSON.stringify(issues, null, 2)}\n`);
    await Promise.all(pages.map(async (page, index) => page.context().tracing.stop({ path: path.join(evidenceDir, `concurrent-deployment-browser-${index ? 'b' : 'a'}.zip`) })));
    console.log(`Concurrent Chromium deployment workflow passed: ${JSON.stringify({ officerId: officer.officerId, rounds: roundEvidence, finalActive: finalActive.length, index: index.rows[0].indexdef })}`);
  } finally {
    await pool.end();
    await Promise.all([adminA.context.close(), adminB.context.close().catch(() => {})]);
  }
}

async function runPriorityWorkflow({ databaseUrl } = {}) {
  if (!password) throw new Error('RELEASE_TEST_PASSWORD is required');
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//.test(databaseUrl)) throw new Error('Isolated PostgreSQL URL must be supplied by the release runner.');
  const browser = await chromium.launch({ channel: 'chromium', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  try {
    if (process.env.RELEASE_TEST_CONCURRENCY_ONLY === 'true') {
      await runConcurrentBrowserWorkflow(browser, databaseUrl);
      return;
    }
    if (process.env.RELEASE_TEST_ERSS_ONLY === 'true') {
      const admin = await login(browser, 'Admin');
      try {
        const officer = await checkPoliceManagementWorkflow(admin.page, { width: 1440, height: 960 }, path.join(evidenceDir, 'screenshots'), 'chromium', {
          retainMembership: true, dutyStatus: 'on_duty', availabilityStatus: 'available'
        });
        await ensureFreshTestDispatchUnit(browser, admin.page, officer);
        await nav(admin.page, 'incident-command');
        const erss = await erssWorkflow(browser, admin.page, databaseUrl);
        await Promise.all(issues.flatMap(result => result.responseBodies));
        for (const result of issues) {
          const unexpected = {
            pageErrors: result.pageErrors,
      consoleErrors: result.consoleErrors.filter(entry => !/(?:tile\.openstreetmap\.org|server\.arcgisonline\.com)/i.test(`${entry.text} ${entry.location?.url || ''}`)),
            failedRequests: result.failedRequests.filter(entry => !/(?:tile\.openstreetmap\.org|server\.arcgisonline\.com)/i.test(entry.url)),
            httpErrors: result.httpErrors.filter(entry => !((entry.status === 400 && /\/api\/erss\/events\/simulate/.test(entry.url))
              || (entry.status === 404 && entry.method === 'GET' && /\/api\/erss\/events\/[^/]+\/dispatch-request$/.test(entry.url))
              ))
          };
          const consoleUnexpected = unexpected.consoleErrors.filter(entry => !(/Failed to load resource: the server responded with a status of 400 \(Bad Request\)/.test(entry.text) && /\/api\/erss\/events\/simulate/.test(entry.location?.url || ''))
            && !(/Failed to load resource: the server responded with a status of 404 \(Not Found\)/.test(entry.text) && /\/api\/erss\/events\/[^/]+\/dispatch-request$/.test(entry.location?.url || ''))
            && !(/Failed to load resource: the server responded with a status of 409 \(Conflict\)/.test(entry.text)
              ));
          unexpected.consoleErrors = consoleUnexpected;
          if (Object.values(unexpected).some(entries => entries.length)) fs.writeFileSync(path.join(evidenceDir, 'priority-erss-browser-diagnostics.json'), `${JSON.stringify(issues, null, 2)}\n`);
          assert.deepEqual(unexpected, { pageErrors: [], consoleErrors: [], failedRequests: [], httpErrors: [] }, `${result.label} ERSS diagnostics`);
        }
        await admin.context.tracing.stop({ path: path.join(evidenceDir, 'priority-erss-only.zip') });
        await admin.context.close();
        fs.writeFileSync(path.join(evidenceDir, 'priority-erss-browser-diagnostics.json'), `${JSON.stringify(issues, null, 2)}\n`);
        console.log(`ERSS only workflow passed: ${JSON.stringify(erss)}`);
      } finally {
        await Promise.all(issues.flatMap(result => result.responseBodies));
        fs.writeFileSync(path.join(evidenceDir, 'priority-erss-browser-diagnostics.json'), `${JSON.stringify(issues, null, 2)}\n`);
        await admin.context.close().catch(() => {});
      }
      return;
    }
    const citizenWorkflow = await reportIncidentJourney(browser, databaseUrl);
    const erss = process.env.RELEASE_TEST_SKIP_ERSS === 'true' ? { skipped: true } : await erssWorkflow(browser, citizenWorkflow.page, databaseUrl, citizenWorkflow.erSSReserveUnitId);
    await Promise.all(issues.flatMap(result => result.responseBodies));
    const isExpectedCapacityRejection = entry => {
      if (entry.status !== 409 || entry.method !== 'POST' || !/\/api\/incidents\/[^/]+\/recommend-unit$/.test(new URL(entry.url).pathname)) return false;
      let body;
      try { body = JSON.parse(entry.body || '{}'); } catch { return false; }
      if (body.code === 'PRIMARY_UNIT_RECOMMENDATION_UNAVAILABLE') {
        assert.ok((body.primaryExcludedUnits || []).some(unit => unit.unitCode?.startsWith('QA-RECOMMEND-') && ['OFF DUTY OR NO AUTHORISED RESPONDER', 'Busy unit'].includes(unit.exclusionReason)), 'No-primary response must identify the synthetic unit and its exact exhausted-capacity reason');
      } else if (body.code === 'HYBRID_SUPPORT_UNAVAILABLE') {
        assert.equal(body.stationSupport?.complete, false, 'Hybrid-support rejection must report incomplete allocation');
        assert.equal(body.stationSupport?.reason, 'No capable station resources available');
        assert.ok(body.stationSupport?.candidates?.some(candidate => candidate.rejectionReason === 'INSUFFICIENT CAPACITY'), 'Hybrid-support rejection must identify insufficient station capacity');
      } else {
        assert.fail(`Unexpected recommendation conflict: ${JSON.stringify({ code: body.code, error: body.error })}`);
      }
      return true;
    };
    const capacityRejections = issues.flatMap(result => result.httpErrors.filter(isExpectedCapacityRejection));
    assert.ok(capacityRejections.length <= 2, `At most two explicit synthetic no-capacity recommendation conflicts are expected: ${capacityRejections.length}`);
    for (const result of issues) {
      const allowedFailure = entry => /(?:tile\.openstreetmap\.org|server\.arcgisonline\.com)/i.test(entry.url);
      const intentionalApiFailure = (status, url, label, body, method = "") => {
        const pathname = new URL(url).pathname;
        const code = /"code"\s*:\s*"([^"]+)"/.exec(String(body || ""))?.[1] || "";
        return (status === 403 && /\/api\/admin\/police-users$/.test(pathname) && /Citizen/.test(label))
          || (status === 400 && /\/api\/erss\/events\/simulate$/.test(pathname))
          || (status === 404 && method === "GET" && /\/api\/erss\/events\/[^/]+\/dispatch-request$/.test(pathname))
          || (status === 409 && /\/api\/incidents\/[^/]+\/unit-members$/.test(pathname) && code === "PRIMARY_UNIT_REQUIRED")
          || (status === 409 && /\/api\/incidents\/[^/]+\/officer-assignments$/.test(pathname) && code === "DUPLICATE_DEPLOYMENT")
          || isExpectedCapacityRejection({ status, method, url, body });
      };
      const allowedHttp = entry => intentionalApiFailure(entry.status, entry.url, result.label, entry.body, entry.method);
      const intentionalConsoleError = entry => {
        if (/(?:tile\.openstreetmap\.org|server\.arcgisonline\.com)/i.test(`${entry.text} ${entry.location?.url || ''}`)) return true;
        const status = [400, 403, 404, 409].find(value => entry.text.includes(`status of ${value} `));
        if (!status) return false;
        const http = result.httpErrors.find(item => item.url === entry.location?.url && item.status === status);
        return Boolean(http && intentionalApiFailure(status, entry.location?.url || "http://127.0.0.1/", result.label, http.body, http.method));
      };
      const unexpected = {
        pageErrors: result.pageErrors,
        consoleErrors: result.consoleErrors.filter(entry => !intentionalConsoleError(entry)),
        failedRequests: result.failedRequests.filter(entry => !allowedFailure(entry)),
        httpErrors: result.httpErrors.filter(entry => !allowedHttp(entry))
      };
      assert.deepEqual(unexpected, { pageErrors: [], consoleErrors: [], failedRequests: [], httpErrors: [] }, `${result.label} browser diagnostics`);
    }
    await citizenWorkflow.context.tracing.stop({ path: path.join(evidenceDir, 'priority-admin.zip') });
    await citizenWorkflow.context.close();
    fs.writeFileSync(path.join(evidenceDir, 'priority-browser-diagnostics.json'), `${JSON.stringify(issues, null, 2)}\n`);
    console.log(JSON.stringify({ citizenResolution: { reportId: citizenWorkflow.reportId, incidentId: citizenWorkflow.incidentId }, erss, browserDiagnostics: issues.map(item => ({ label: item.label, pageErrors: item.pageErrors.length, consoleErrors: item.consoleErrors.length, failedRequests: item.failedRequests.length, httpErrors: item.httpErrors.length })) }));
  } catch (error) {
    fs.writeFileSync(path.join(evidenceDir, 'priority-browser-diagnostics.json'), `${JSON.stringify(issues, null, 2)}\n`);
    throw error;
  } finally { await browser.close(); }
}

module.exports = { runPriorityWorkflow };
