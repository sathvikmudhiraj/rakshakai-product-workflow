const test = require("node:test");
const assert = require("node:assert/strict");
const { seedDb } = require("../services/core.service");
const {
  createTriage,
  approveDispatchRequest,
  createUnitRequest,
  acceptUnitRequest,
  createErssEvent,
  updateErssEvent,
  determineJurisdiction,
  calculateUnitRecommendations,
  TRIAGE_STATUS_BY_ACTION
} = require("../services/erss.service");
const { ERSS_REALTIME_EVENT_NAMES } = require("../services/erssRealtimeEvents.service");
const fs = require("node:fs");
const path = require("node:path");

function erssFixture() {
  const db = seedDb();
  const actor = db.users.find((user) => user.role === "Admin") || db.users[0];
  const station = db.policeStations[0];
  db.responseUnits = [{ id: "unit_erss_test", unitCode: "ERSS-TEST-1", stationId: station.id, status: "available", operational: true, latitude: 17.53, longitude: 78.26 }];
  db.dispatchEvents = [];
  const unit = db.responseUnits[0];
  assert.ok(actor, "seed needs an admin user");
  assert.ok(unit, "seed needs a response unit");
  db.erssEvents = [{
    id: "erss_test_event", priority: "HIGH", emergencyType: "POLICE",
    incidentLatitude: 17.5285, incidentLongitude: 78.2636,
    incidentLocationText: "ERSS test location", locationSource: "GPS",
    jurisdictionId: unit.stationId, triageStatus: "RECEIVED", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }];
  db.erssDispatchRequests = [{
    id: "dispatch_test_request", erssEventId: "erss_test_event", dispatcherId: actor.id,
    status: "PENDING", recommendedServices: ["POLICE"], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }];
  db.erssUnitRequests = [];
  db.erssTriage = [];
  return { db, actor, unit, event: db.erssEvents[0] };
}

test("ERSS location confidence only accepts high, medium, low and stores lowercase", async () => {
  const { db, actor } = erssFixture();
  for (const invalid of [0.9, "0.95", 1, "CERTAIN", "unknown"]) {
    await assert.rejects(
      createErssEvent(db, { channel: "VOICE_CALL", incidentLatitude: 17.5, incidentLongitude: 78.26, incidentLocationText: "x", locationConfidence: invalid }, actor),
      /location confidence/i
    );
  }
  const event = await createErssEvent(db, { channel: "VOICE_CALL", incidentLatitude: 17.5, incidentLongitude: 78.26, incidentLocationText: "x", locationConfidence: "HIGH" }, actor);
  assert.equal(event.locationConfidence, "high");
  db.erssEvents.push(event);
  const medium = await createErssEvent(db, { channel: "VOICE_CALL", incidentLatitude: 17.5, incidentLongitude: 78.26, incidentLocationText: "y", locationConfidence: "Medium" }, actor);
  assert.equal(medium.locationConfidence, "medium");
  await updateErssEvent(db, event.id, { locationConfidence: "LOW" }, actor);
  assert.equal(event.locationConfidence, "low");
  await assert.rejects(updateErssEvent(db, event.id, { locationConfidence: 0.9 }, actor), /location confidence/i);
  assert.equal(event.locationConfidence, "low");
});

test("ERSS dispatch creates one canonical incident and never writes an ERSS id into a response unit FK", async () => {
  const { db, actor, unit, event } = erssFixture();
  await approveDispatchRequest(db, "dispatch_test_request", actor);
  const incidentId = event.incidentId;
  assert.ok(incidentId);
  assert.ok(db.incidents.some((incident) => incident.id === incidentId));
  assert.notEqual(incidentId, event.id);

  const request = await createUnitRequest(db, "dispatch_test_request", event.id, unit.id, "POLICE", 60, actor);
  unit.status = "idle";
  await acceptUnitRequest(db, request.id, unit.id, actor);
  assert.equal(unit.assignedIncidentId, incidentId);
  assert.equal(unit.currentIncidentId, incidentId);
  assert.ok(db.auditLogs.some((entry) => entry.action === "erss_unit_accepted"));
});

test("ERSS triage actions map to valid workflow statuses and forwarding requires human confirmation", async () => {
  const { db, actor, event } = erssFixture();
  for (const humanConfirmed of ["false", "true", 1, {}]) {
    await assert.rejects(createTriage(db, event.id, actor.id, { actionTaken: "FORWARD_TO_DISPATCH", humanConfirmed }), { status: 409 });
  }
  await assert.rejects(
    createTriage(db, event.id, actor.id, { emergencyType: "POLICE", priority: "HIGH", actionTaken: "FORWARD_TO_DISPATCH", humanConfirmed: false }),
    /Human confirmation/
  );
  const triage = await createTriage(db, event.id, actor.id, {
    emergencyType: "POLICE", priority: "HIGH", actionTaken: "FORWARD_TO_DISPATCH", humanConfirmed: true
  });
  assert.equal(triage.actionTaken, "FORWARD_TO_DISPATCH");
  assert.equal(event.triageStatus, TRIAGE_STATUS_BY_ACTION.FORWARD_TO_DISPATCH);
  assert.ok(db.auditLogs.some((entry) => entry.action === "erss_triage_completed"));
});

test("ERSS cannot reassign a unit committed to another incident", async () => {
  const { db, actor, unit, event } = erssFixture();
  await approveDispatchRequest(db, "dispatch_test_request", actor);
  const request = await createUnitRequest(db, "dispatch_test_request", event.id, unit.id, "POLICE", 60, actor);
  unit.status = "busy"; unit.assignedIncidentId = "another_incident";
  await assert.rejects(acceptUnitRequest(db, request.id, unit.id, actor), { status: 409 });
  assert.equal(unit.assignedIncidentId, "another_incident");
  assert.equal(request.status, "REQUESTED");
});

test("ERSS jurisdiction and unit recommendations use real routing helpers without fabricated fallback ETA", async () => {
  const { db, unit, event } = erssFixture();
  db.policeStations = [{ id: unit.stationId, name: "Test station", lat: 17.53, lng: 78.26, operational: true }];
  const jurisdiction = await determineJurisdiction(db, event.incidentLatitude, event.incidentLongitude);
  assert.equal(jurisdiction.station.id, unit.stationId);
  const previous = { OSRM_BASE_URL: process.env.OSRM_BASE_URL, PUBLIC_OSRM_FALLBACK: process.env.PUBLIC_OSRM_FALLBACK, GIS_ROUTING_PROVIDER: process.env.GIS_ROUTING_PROVIDER };
  try {
    process.env.OSRM_BASE_URL = "http://127.0.0.1:1";
    process.env.PUBLIC_OSRM_FALLBACK = "false";
    process.env.GIS_ROUTING_PROVIDER = "self_hosted";
    const result = await calculateUnitRecommendations(db, event, {});
    assert.equal(result.primary.unitId, unit.id);
    assert.equal(result.primary.etaMinutes, null);
    assert.equal(result.primary.route.approximate, true);
    assert.match(result.primary.selectionReason, /ETA: unavailable/);
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("ERSS deferred realtime events publish after success and disappear on save failure", async () => {
  const events = require("../services/realtimeEvents.service");
  const received = [];
  const listener = (payload) => received.push(payload);
  events.on("erss_test_commit", listener);
  try {
    await assert.rejects(events.withDeferredEvents(async () => {
      events.emit("erss_test_commit", { status: "not committed" });
      throw new Error("Save failed");
    }), /Save failed/);
    assert.deepEqual(received, []);
    await events.withDeferredEvents(async () => {
      const payload = { status: "committed" };
      events.emit("erss_test_commit", payload);
      payload.status = "modified after emission";
      assert.deepEqual(received, []);
    });
    assert.deepEqual(received, [{ status: "committed" }]);
  } finally { events.off("erss_test_commit", listener); }
});

test("ERSS realtime server and browser contracts include every emitted workflow event", () => {
  const browser = fs.readFileSync(path.join(__dirname, "../../frontend/src/app.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  for (const eventName of ERSS_REALTIME_EVENT_NAMES) {
    assert.match(browser, new RegExp(`\\\"${eventName}\\\"`));
  }
  assert.match(server, /ERSS_REALTIME_EVENT_NAMES/);
});

test("ERSS migration is versioned after prior releases and creates all workflow tables", () => {
  const migrationPath = path.join(__dirname, "../database/migrations/022_erss_112_workflow.sql");
  const migration = fs.readFileSync(migrationPath, "utf8");
  for (const table of ["erss_events", "erss_calls", "erss_triage", "erss_dispatch_requests", "erss_unit_requests", "erss_assistance_requests", "erss_jurisdiction_history", "erss_ownership_transfers"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /REFERENCES incidents\(id\)/);
  assert.match(migration, /JSONB/);
  assert.match(migration, /TIMESTAMPTZ/);
});

test("ERSS triage schema and forward migration accept the application workflow vocabulary", () => {
  const schema = fs.readFileSync(path.join(__dirname, "../database/schema.sql"), "utf8");
  const migration = fs.readFileSync(path.join(__dirname, "../database/migrations/023_align_erss_triage_constraints.sql"), "utf8");
  for (const value of ["ASSESSING", "MARK_ACTIONABLE", "ESCALATE_TO_SUPERVISOR"]) {
    assert.match(schema, new RegExp(`'${value}'`));
    assert.match(migration, new RegExp(`'${value}'`));
  }
  assert.match(migration, /ESCALATE_SUPERVISOR/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS erss_triage_action_taken_check/);
});

test("ERSS controller resolves the established authenticated session helper", () => {
  const controller = fs.readFileSync(path.join(__dirname, "../controllers/erss.controller.js"), "utf8");
  assert.match(controller, /userFromReq/);
  assert.doesNotMatch(controller, /req\.user\?\.id/);
});
