// Read-only audit of production functions against the requested dispatch invariants.
// Uses in-memory fixtures and JSDOM only; never imports core or opens a database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const { JSDOM } = createRequire(path.join(root, 'frontend/package.json'))('jsdom');
const service = require('../backend/services/incidentOfficerAssignment.service');
const { stationCapacitySnapshot } = require('../backend/services/hybridDispatch.service');
const { policeManagementUsers } = require('../backend/services/copilotOfficers.service');
const app = fs.readFileSync(path.join(root, 'frontend/src/app.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'backend/services/core.service.js'), 'utf8');
const actor = { id: 'admin', role: 'Admin' };
function fixture() {
  return {
    incidents: [{ id: 'a', assignedUnitId: 'p', status: 'Assigned' }, { id: 'b', assignedUnitId: 'q', status: 'Assigned' }],
    users: [{ id: 'o', name: 'Audit fixture officer', role: 'Police Officer', status: 'active' }],
    responseUnits: [{ id: 'p', unitCode: 'AUDIT-P', status: 'busy', operational: true }, { id: 'q', unitCode: 'AUDIT-Q', status: 'busy', operational: true }],
    responseUnitMembers: [{ id: 'm', unitId: 'p', officerUserId: 'o' }],
    policeOfficers: [{ id: 'profile', userId: 'o', active: true, availabilityStatus: 'available', dutyStatus: 'on_duty', badgeId: 'AUDIT-1', stationId: 'st' }],
    officerRanks: [], policeStations: [{ id: 'st', name: 'Audit fixture station' }],
    incidentOfficerAssignments: [], alerts: [], reports: [], dispatchEvents: [], auditLogs: []
  };
}
function section(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Cannot locate ${start}`);
  return source.slice(from, to);
}
function domContext(state, api) {
  state.user ||= actor;
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8'), { url: 'http://localhost/police-assignment?incidentId=b' });
  const document = dom.window.document;
  const context = vm.createContext({
    state, api, document, window: dom.window, location: dom.window.location,
    URLSearchParams, Option: dom.window.Option, queueMicrotask,
    $: (s) => document.querySelector(s), $$: (s) => [...document.querySelectorAll(s)],
    node: (tag, className = '', text = '') => { const el = document.createElement(tag); el.className = className; el.textContent = text; return el; },
    incidentTitle: (i) => i.title || i.id, displayValue: (s) => s, displayLocation: (s) => s || '',
    unitLabel: (u) => u?.unitCode || u?.id || '', unitTypeLabel: () => 'Police',
    unitLocationAgeText: () => '', unitFreshnessText: () => '', unitDispatchStatus: (u) => u.status,
    isDispatchableIncident: () => true, isAdminRole: () => true, sevClass: () => '',
    assignmentMatchesSearch: () => true, assignmentIncidentMatchesFilter: () => true,
    assignmentIncidentPriority: () => [0, 0, 0], assignmentSlaLabel: () => '', assignmentEscalationLabel: () => '',
    INCIDENT_RESPONSE_ROLES: [...service.RESPONSE_ROLES], responseRoleLabel: (s) => s,
    openPoliceAssignment() {}, setView() {}, selectAssignmentIncident() {}, releaseUnitFromAssignmentPage() {},
    requestHybridSupportFromAssignmentPage() {}, releaseSupportFromAssignmentPage() {},
    assignUnitFromAssignmentPage() {}, confirmAssignmentRecommendation() {}
  });
  return { dom, document, context };
}

test('RBAC: CALL_TAKER cannot enter the primary-unit mutation handler', async () => {
  let entered = false;
  const context = vm.createContext({
    req: { method: 'POST' }, productAssignMatch: ['match', 'a'], body: { unitId: 'p' },
    user: { role: 'Police Officer', operationalRole: 'CALL_TAKER' }, res: {},
    incidentOfficerAssignmentService: service,
    forbidden: () => ({ status: 403 }), sendJson: (_res, status) => ({ status }),
    assignSelectedIncidentUnit: async () => { entered = true; return { status: 200, payload: {} }; }
  });
  vm.runInContext(section(core, 'function hasRole(', 'function forbidden('), context);
  vm.runInContext('async function invoke() {' + section(core, '  if (req.method === "POST" && productAssignMatch)', '  const releaseUnitMatch') + '}', context);
  const result = await context.invoke();
  assert.equal(entered, false, 'CALL_TAKER reached assignSelectedIncidentUnit');
  assert.equal(result.status, 403);
});

test('member response reports an active primary deployment on another incident', () => {
  const db = fixture();
  service.assignIncidentOfficers(db, 'a', [{ officerId: 'o', responseRole: 'DRIVER' }], actor);
  // Model a legacy orphan left by the old primary-release path, before these guards.
  db.incidents[0].assignedUnitId = null; db.incidents[0].status = 'Verified';
  db.responseUnits[0].status = 'available';
  db.responseUnitMembers[0].unitId = 'q';
  const member = service.getUnitMembersForIncident(db, 'b').members[0];
  assert.equal(member.currentIncidentId, 'a', 'Other-incident primary deployment is missing from member response');
});

test('Police Assignment disables an off-duty member whose availability field is available', async () => {
  const db = fixture(); db.policeOfficers[0].dutyStatus = 'off_duty';
  db.responseUnitMembers[0].unitId = 'q';
  const ui = domContext({ policeAssignment: {} }, async () => service.getUnitMembersForIncident(db, 'b'));
  Object.assign(ui.context, await import(pathToFileURL(path.join(root, 'frontend/src/unitAssignmentRecommendation.js'))));
  try {
    vm.runInContext(section(app, 'async function renderPoliceAssignment()', 'async function assignSelectedPoliceOfficers()'), ui.context);
    await ui.context.renderPoliceAssignment();
    assert.equal(ui.document.querySelector('[data-officer-id="o"]').disabled, true);
  } finally { ui.dom.window.close(); }
});

test('View Officers shows names of actual members before they are deployed', async () => {
  const helpers = await import(pathToFileURL(path.join(root, 'frontend/src/unitAssignmentRecommendation.js')));
  const db = fixture(); db.incidents = [db.incidents[0]];
  const state = { incidents: db.incidents, responseUnits: db.responseUnits, assignmentFilters: { search: '', incident: 'all', unit: 'all' }, assignmentSelectedIncidentId: 'a' };
  const ui = domContext(state, async () => service.getUnitMembersForIncident(db, 'a'));
  Object.assign(ui.context, { ...helpers, assignmentRecommendationCoordinator: { getSnapshot: () => ({ incidentId: 'a', status: 'idle' }) } });
  try {
    vm.runInContext(section(app, 'function renderUnitAssignment()', 'function renderUnitRegistry('), ui.context);
    ui.context.renderUnitAssignment();
    await new Promise(setImmediate);
    const button = [...ui.document.querySelectorAll('#assignmentActiveList button')].find((b) => b.textContent === 'View Officers');
    button.click();
    const summary = ui.document.querySelector('.assignment-member-summary');
    assert.equal(summary.hidden, false);
    assert.match(summary.textContent, /Audit fixture officer/);
  } finally { ui.dom.window.close(); }
});

test('Police Assignment ignores stale member responses after incident selection changes', async () => {
  const helpers = await import(pathToFileURL(path.join(root, 'frontend/src/unitAssignmentRecommendation.js')));
  const db = fixture();
  const pending = new Map();
  const ui = domContext({ policeAssignment: {} }, (url) => new Promise((resolve) => pending.set(url, resolve)));
  Object.assign(ui.context, helpers);
  try {
    vm.runInContext(section(app, 'async function renderPoliceAssignment()', 'async function assignSelectedPoliceOfficers()'), ui.context);
    const first = ui.context.renderPoliceAssignment();
    ui.dom.window.history.replaceState({}, '', '/police-assignment?incidentId=a');
    const second = ui.context.renderPoliceAssignment();
    pending.get('/api/incidents/a/unit-members')(service.getUnitMembersForIncident(db, 'a'));
    await second;
    pending.get('/api/incidents/b/unit-members')(service.getUnitMembersForIncident(db, 'b'));
    await first;
    assert.equal(ui.context.state.policeAssignment.context.incident.id, 'a');
    assert.ok(ui.document.querySelector('[data-officer-id="o"]'));
  } finally { ui.dom.window.close(); }
});

test('unit release cannot strand an active officer deployment with no release path', async () => {
  const db = fixture();
  const [deployment] = service.assignIncidentOfficers(db, 'a', [{ officerId: 'o', responseRole: 'DRIVER' }], actor);
  const context = vm.createContext({
    incidentOfficerAssignmentService: service,
    withAssignmentLock: (f) => f(), readDatabase: async () => db,
    canonicalIncidentStatus: (s) => s, normalizeExpectedAssignedUnitId: (body) => body.expectedAssignedUnitId,
    now: () => new Date().toISOString(), uid: () => 'audit',
    addDispatchEvent: () => ({}), addAuditLog: () => ({}), syncLinkedCitizenReportStatus: () => null,
    writeIncidentWorkflowRecords: async () => {}, incidentForResponse: (_db, i) => i,
    unitForResponse: (u) => u, realtimeEvents: { emit() {} }
  });
  vm.runInContext(section(core, 'function hasRole(', 'function forbidden('), context);
  vm.runInContext(section(core, 'async function releaseAssignedIncidentUnit(', 'async function writeIncidentWorkflowRecords('), context);
  const result = await context.releaseAssignedIncidentUnit('a', { expectedAssignedUnitId: 'p', reason: 'audit fixture' }, actor);
  assert.equal(result.status, 409);
  assert.equal(result.payload.code, 'ACTIVE_OFFICER_DEPLOYMENTS');
  assert.equal(db.incidents[0].assignedUnitId, 'p');
  service.releaseIncidentOfficer(db, 'a', deployment.id, 'audit fixture', actor);
  assert.equal((await context.releaseAssignedIncidentUnit('a', { expectedAssignedUnitId: 'p', reason: 'audit fixture' }, actor)).status, 200);
});

test('hybrid capacity excludes officers committed through incident_officer_assignments', () => {
  const db = fixture();
  service.assignIncidentOfficers(db, 'a', [{ officerId: 'o', responseRole: 'DRIVER' }], actor);
  // Model a legacy primary release that left deployment active but its unit available.
  // Keep permanent membership intact: eligibility must consult the deployment itself.
  db.incidents[0].assignedUnitId = null; db.incidents[0].status = 'Verified';
  db.responseUnits[0].status = 'available';
  const capacity = stationCapacitySnapshot(db, db.policeStations[0], { incidentId: 'b' });
  assert.equal(capacity.officerIds.includes('o'), false, 'Primary-deployed officer was offered as hybrid support');
});

test('Police Management does not infer officer deployment from permanent membership alone', () => {
  const db = fixture();
  db.incidents = [db.incidents[0]];
  const profile = policeManagementUsers(db).find((o) => o.id === 'o');
  assert.equal(profile.deployments.length, 0, 'Membership was reported as deployment without an incident_officer_assignments record');
});

test('recommendation API timeout covers response-body parsing as well as response headers', async () => {
  const previous = { window: global.window, fetch: global.fetch };
  let timerActive = false, completeBody;
  const body = new Promise((resolve) => { completeBody = resolve; });
  global.window = { setTimeout: () => { timerActive = true; return 1; }, clearTimeout: () => { timerActive = false; } };
  global.fetch = async () => ({ ok: true, headers: { get: () => 'application/json' }, json: () => body });
  let request;
  try {
    const { api } = await import(pathToFileURL(path.join(root, 'frontend/src/services/api.js')));
    request = api('/api/incidents/a/recommend-unit', { method: 'POST' });
    await new Promise(setImmediate);
    assert.equal(timerActive, true, 'Timeout was cleared while recommendation body was still pending');
  } finally {
    completeBody({}); await request;
    global.window = previous.window; global.fetch = previous.fetch;
  }
});

test('default selection requests recommendation once and unavailable result retains manual Assign Unit', async () => {
  const helpers = await import(pathToFileURL(path.join(root, 'frontend/src/unitAssignmentRecommendation.js')));
  const state = { incidents: [{ id: 'a', status: 'Verified' }], responseUnits: [{ id: 'p', unitCode: 'AUDIT-P', status: 'available', operational: true }], assignmentFilters: { search: '', incident: 'unassigned', unit: 'available' }, assignmentSelectedIncidentId: null };
  let calls = 0, finish;
  const ui = domContext(state, async () => { throw new Error('Unexpected API call'); });
  const coordinator = helpers.createUnitAssignmentRecommendationCoordinator({
    request: () => { calls++; return new Promise((resolve) => { finish = resolve; }); },
    onChange: (snapshot) => { state.assignmentRecommendation = snapshot.data; ui.context.renderUnitAssignment(); }
  });
  Object.assign(ui.context, helpers, { assignmentRecommendationCoordinator: coordinator, loadAssignmentRecommendation: (incident) => coordinator.select(incident) });
  try {
    vm.runInContext(section(app, 'function renderUnitAssignment()', 'function renderUnitRegistry('), ui.context);
    for (let i = 0; i < 10; i++) ui.context.renderUnitAssignment();
    await new Promise(setImmediate);
    assert.equal(calls, 1);
    assert.equal(coordinator.getSnapshot().status, 'loading');
    finish({ candidates: [] });
    await new Promise(setImmediate);
    assert.equal(coordinator.getSnapshot().status, 'unavailable');
    const button = ui.document.querySelector('#assignmentUnitList button');
    assert.equal(button.textContent, 'Assign Unit');
    assert.equal(button.disabled, false);
    assert.equal(calls, 1);
  } finally { ui.dom.window.close(); }
});

test('primary assignment publishes assigned state before clearing recommendation can rerender', async () => {
  const incident = { id: 'a', status: 'Verified' };
  let calls = 0, clears = 0;
  const context = vm.createContext({
    window: { confirm: () => true }, unitLabel: (unit) => unit?.id || '', incidentTitle: (item) => item.id,
    api: async () => { calls++; return { incident: { id: 'a', assignedUnitId: 'p', status: 'Assigned' } }; },
    assignmentRecommendationCoordinator: { clear: () => { clears++; assert.equal(incident.assignedUnitId, 'p'); } },
    refresh: async () => {}, alert: (message) => assert.fail(message)
  });
  vm.runInContext(section(app, 'async function assignUnitFromAssignmentPage(', 'async function confirmAssignmentRecommendation('), context);
  await context.assignUnitFromAssignmentPage(incident, { id: 'p' });
  assert.equal(calls, 1); assert.equal(clears, 1);
});

test('completed incidents cannot accept new primary officer deployments', () => {
  for (const status of ['Resolved', 'Closed', 'Rejected / False Alarm']) {
    const db = fixture(); db.incidents[0].status = status;
    assert.throws(() => service.assignIncidentOfficers(db, 'a', [{ officerId: 'o', responseRole: 'DRIVER' }], actor),
      (error) => error.code === 'INCIDENT_NOT_DEPLOYABLE', status);
    assert.equal(db.incidentOfficerAssignments.length, 0);
  }
});

test('rapid repeated officer confirmation submits only one request', async () => {
  const helpers = await import(pathToFileURL(path.join(root, 'frontend/src/unitAssignmentRecommendation.js')));
  const db = fixture(), data = service.getUnitMembersForIncident(db, 'a');
  const completions = [];
  const ui = domContext({ policeAssignment: { context: data } }, () => new Promise((resolve) => completions.push(resolve)));
  Object.assign(ui.context, helpers, { alert: (message) => assert.fail(message) });
  ui.dom.window.confirm = () => true;
  ui.document.querySelector('#policeAssignmentMembers').innerHTML = '<input type="checkbox" data-officer-id="o" checked><select data-role-for="o"><option value="DRIVER" selected>Driver</option></select>';
  let first, second;
  try {
    vm.runInContext(section(app, 'async function assignSelectedPoliceOfficers()', 'function renderUnitAssignment()'), ui.context);
    ui.context.renderPoliceAssignment = async () => {};
    first = ui.context.assignSelectedPoliceOfficers();
    second = ui.context.assignSelectedPoliceOfficers();
    await new Promise(setImmediate);
    assert.equal(completions.length, 1, 'Repeated confirmation sent duplicate mutations');
  } finally {
    completions.forEach((resolve) => resolve({}));
    await Promise.allSettled([first, second]);
    ui.dom.window.close();
  }
});

test('non-available status such as responding is disabled before backend rejection', async () => {
  const { memberUnavailable } = await import(pathToFileURL(path.join(root, 'frontend/src/unitAssignmentRecommendation.js')));
  assert.equal(memberUnavailable({ active: true, dutyStatus: 'on_duty', availability: 'responding' }, 'a'), true);
});

test('role-change and release failures show a controlled error and restore controls', async () => {
  const helpers = await import(pathToFileURL(path.join(root, 'frontend/src/unitAssignmentRecommendation.js')));
  const db = fixture(); db.responseUnitMembers[0].unitId = 'q';
  service.assignIncidentOfficers(db, 'b', [{ officerId: 'o', responseRole: 'TEAM_LEAD' }], actor);
  let mutations = 0;
  const ui = domContext({ policeAssignment: {} }, async (_path, options) => {
    if (options?.method) { mutations++; throw new Error('Fixture request failed; retry'); }
    return service.getUnitMembersForIncident(db, 'b');
  });
  Object.assign(ui.context, helpers);
  ui.dom.window.prompt = () => 'Fixture reason'; ui.dom.window.confirm = () => true;
  try {
    vm.runInContext(section(app, 'async function renderPoliceAssignment()', 'function renderUnitAssignment()'), ui.context);
    await ui.context.renderPoliceAssignment();
    for (const label of ['Update Role', 'Release Officer']) {
      ui.document.querySelector('[data-role-for="o"]').value = 'DRIVER';
      [...ui.document.querySelectorAll('#policeAssignmentMembers button')].find((button) => button.textContent === label).click();
      await new Promise(setImmediate);
      assert.match(ui.document.querySelector('#policeAssignmentStatus').textContent, /Fixture request failed/);
      assert.equal(ui.context.state.policeAssignment.mutationInFlight, false);
      assert.equal([...ui.document.querySelectorAll('#policeAssignmentMembers button')].find((button) => button.textContent === label).disabled, false);
    }
    assert.equal(mutations, 2);
  } finally { ui.dom.window.close(); }
});

test('completed incident screen disables new deployment while retaining release capability', async () => {
  const helpers = await import(pathToFileURL(path.join(root, 'frontend/src/unitAssignmentRecommendation.js')));
  const db = fixture(); db.responseUnitMembers[0].unitId = 'q';
  const [deployment] = service.assignIncidentOfficers(db, 'b', [{ officerId: 'o', responseRole: 'DRIVER' }], actor);
  db.incidents[1].status = 'Resolved';
  const ui = domContext({ policeAssignment: {} }, async () => service.getUnitMembersForIncident(db, 'b'));
  Object.assign(ui.context, helpers);
  try {
    vm.runInContext(section(app, 'async function renderPoliceAssignment()', 'function renderUnitAssignment()'), ui.context);
    await ui.context.renderPoliceAssignment();
    assert.equal(ui.document.querySelector('#assignSelectedOfficers').disabled, true);
    assert.match(ui.document.querySelector('#policeAssignmentStatus').textContent, /not active/);
    const buttons = [...ui.document.querySelectorAll('#policeAssignmentMembers button')];
    assert.equal(buttons.find((button) => button.textContent === 'Update Role').disabled, true);
    assert.equal(buttons.find((button) => button.textContent === 'Release Officer').disabled, false);
    assert.throws(() => service.updateIncidentOfficerRole(db, 'b', deployment.id, 'TEAM_LEAD', actor, 'Fixture'), (error) => error.code === 'INCIDENT_NOT_DEPLOYABLE');
    service.releaseIncidentOfficer(db, 'b', deployment.id, 'Legacy recovery', actor);
    assert.equal(deployment.status, 'RELEASED');
  } finally { ui.dom.window.close(); }
});
