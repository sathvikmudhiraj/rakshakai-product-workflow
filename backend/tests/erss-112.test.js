const test = require("node:test");
const assert = require("node:assert/strict");
const { seedDb } = require("../services/core.service");
const {
  createTriage,
  approveDispatchRequest,
  createUnitRequest,
  acceptUnitRequest,
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

test("ERSS dispatch creates one canonical incident and never writes an ERSS id into a response unit FK", async () => {
  const { db, actor, unit, event } = erssFixture();
  await approveDispatchRequest(db, "dispatch_test_request", actor);
  const incidentId = event.incidentId;
  assert.ok(incidentId);
  assert.ok(db.incidents.some((incident) => incident.id === incidentId));
  assert.notEqual(incidentId, event.id);

  const request = await createUnitRequest(db, "dispatch_test_request", event.id, unit.id, "POLICE", 60, actor);
  await acceptUnitRequest(db, request.id, unit.id, actor);
  assert.equal(unit.assignedIncidentId, incidentId);
  assert.equal(unit.currentIncidentId, incidentId);
  assert.ok(db.auditLogs.some((entry) => entry.action === "erss_unit_accepted"));
});

test("ERSS triage actions map to valid workflow statuses and forwarding requires human confirmation", async () => {
  const { db, actor, event } = erssFixture();
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

test("ERSS controller resolves the established authenticated session helper", () => {
  const controller = fs.readFileSync(path.join(__dirname, "../controllers/erss.controller.js"), "utf8");
  assert.match(controller, /userFromReq/);
  assert.doesNotMatch(controller, /req\.user\?\.id/);
});
