require("../services/testDatabaseSafety").prepareIntegrationTestEnvironment();

if (!process.env.DATABASE_URL) {
  console.log("Skipping ERSS dispatcher workflow verification: DATABASE_URL not set");
  process.exit(0);
}

process.env.JWT_SECRET = process.env.JWT_SECRET || "erss-dispatcher-verify-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { query, closePool } = require("../services/postgres.service");
const { readDatabase, writeSelectedRecords } = require("../services/core.service");
const controller = require("../controllers/erss.controller");
const usersRepository = require("../repositories/users.repository");
const policeStationsRepository = require("../repositories/policeStations.repository");
const responseUnitsRepository = require("../repositories/responseUnits.repository");
const erssEventsRepository = require("../repositories/erssEvents.repository");
const auditLogsRepository = require("../repositories/auditLogs.repository");

function bearer(user) {
  const token = jwt.sign(
    { role: user.role, email: user.email, name: user.name, sessionVersion: user.sessionVersion || null, authMethod: "password" },
    process.env.JWT_SECRET,
    { subject: user.id, expiresIn: "1h" }
  );
  return { authorization: `Bearer ${token}` };
}

function call(handler, { user, params = {}, body = {}, headers = {}, method = "POST" }) {
  const req = { method, headers, params, body, query: {} };
  if (user) Object.assign(req.headers, bearer(user));
  let statusCode = null;
  let payload = null;
  let threw = null;
  const res = {
    status(code) { statusCode = code; return res; },
    json(data) { payload = data; return res; }
  };
  return handler(req, res, (error) => { threw = error; }).then(() => {
    if (process.env.ERSS_VERIFY_DEBUG === "1") {
      console.log("[verify]", handler.name, { statusCode, threw: threw?.message, payloadKeys: payload && Object.keys(payload) });
    }
    if (threw) {
      if (Number.isFinite(threw.status)) return { statusCode: threw.status, payload: { error: threw.message } };
      throw threw;
    }
    return { statusCode: statusCode ?? (payload !== null ? 200 : null), payload };
  });
}

test("ERSS dispatcher workflow: review creates recommendation, approval requests primary unit", async () => {
  const db = await readDatabase();
  db.users = db.users.filter((user) => !user.email.endsWith("@verify.local"));
  const users = [
    { id: "u_verify_dispatcher", name: "Verify Dispatcher", email: "dispatcher@verify.local", role: "Police Officer", operationalRole: "DISPATCHER", passwordHash: "x" },
    { id: "u_verify_calltaker", name: "Verify Call Taker", email: "calltaker@verify.local", role: "Police Officer", operationalRole: "CALL_TAKER", passwordHash: "x" },
    { id: "u_verify_field", name: "Verify Field Officer", email: "field@verify.local", role: "Police Officer", operationalRole: "FIELD_OFFICER", passwordHash: "x" },
    { id: "u_verify_citizen", name: "Verify Citizen", email: "citizen@verify.local", role: "Citizen", passwordHash: "x" },
    { id: "u_verify_admin", name: "Verify Admin", email: "admin@verify.local", role: "Admin", passwordHash: "x" }
  ];
  for (const user of users) db.users.push(user);
  db.policeStations = (db.policeStations || []).filter((station) => station.id !== "verify_station");
  db.policeStations.push({ id: "verify_station", stationCode: "PS-VERIFY", name: "Verify Station", jurisdiction: "Verify Area", operational: true, latitude: 17.5285, longitude: 78.2636 });
  db.responseUnits = (db.responseUnits || []).filter((unit) => !unit.id.startsWith("verify_unit_"));
  db.responseUnits.push(
    { id: "verify_unit_alpha", unitCode: "VERIFY-01", name: "Verify Patrol 01", stationId: "verify_station", status: "available", operational: true, latitude: 17.5285, longitude: 78.2636, unitType: "police_patrol" },
    { id: "verify_unit_beta", unitCode: "VERIFY-02", name: "Verify Patrol 02", stationId: "verify_station", status: "available", operational: true, latitude: 17.5200, longitude: 78.2700, unitType: "police_patrol" }
  );
  db.erssEvents = (db.erssEvents || []).filter((event) => event.id !== "erss_verify_event");
  const event = {
    id: "erss_verify_event",
    externalEventId: "ERSS-VERIFY-1",
    channel: "VOICE_CALL",
    simulated: true,
    incidentLatitude: 17.5285,
    incidentLongitude: 78.2636,
    incidentLocationText: "Verify incident location",
    locationSource: "GPS",
    jurisdictionId: "verify_station",
    emergencyType: "POLICE",
    priority: "CRITICAL",
    triageStatus: "ACTIONABLE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.erssEvents.push(event);
  await writeSelectedRecords(db, [
    [usersRepository, users],
    [policeStationsRepository, db.policeStations.filter((station) => station.id === "verify_station")],
    [responseUnitsRepository, db.responseUnits.filter((unit) => unit.id.startsWith("verify_unit_"))],
    [erssEventsRepository, [event]]
  ]);

  const dispatcher = users[0];
  const callTaker = users[1];
  const fieldOfficer = users[2];
  const citizen = users[3];
  const admin = users[4];

  // 1. listEvents now returns the workflow collections the frontend state expects.
  if (process.env.ERSS_VERIFY_DEBUG === "1") console.log("[verify] listEvents type:", typeof controller.listEvents, "events in db:", (await readDatabase()).erssEvents.length);
  const listing = await call(controller.listEvents, { user: dispatcher, method: "GET" });
  assert.equal(listing.statusCode, 200);
  assert.ok(Array.isArray(listing.payload.dispatchRequests));
  assert.ok(Array.isArray(listing.payload.unitRequests));

  // 2. RBAC: call taker may not create dispatch requests.
  const callTakerAttempt = await call(controller.createDispatchRequest, { user: callTaker, params: { id: event.id }, body: {} });
  assert.equal(callTakerAttempt.statusCode, 403);

  // 3. RBAC: citizen gets 403.
  const citizenAttempt = await call(controller.createDispatchRequest, { user: citizen, params: { id: event.id }, body: {} });
  assert.equal(citizenAttempt.statusCode, 403);

  // 4. Dispatcher Review & Dispatch with no body: recommendation generated by the existing engine.
  const created = await call(controller.createDispatchRequest, { user: dispatcher, params: { id: event.id }, body: {} });
  assert.equal(created.statusCode, 201);
  const request = created.payload.request;
  assert.ok(request.id);
  assert.equal(request.status, "PENDING");
  assert.ok(request.primaryRecommendation, "primary recommendation must exist");
  const verifyUnitIds = ["verify_unit_alpha", "verify_unit_beta"];
  assert.ok(verifyUnitIds.includes(request.primaryRecommendation.unitId), "primary must be a verify unit");
  assert.ok(Number.isFinite(request.primaryRecommendation.distanceKm));
  assert.ok(typeof request.primaryRecommendation.selectionReason === "string");
  assert.ok(Array.isArray(request.fallbackRecommendations));
  const fallbackIds = request.fallbackRecommendations.map((fb) => fb.unitId);
  assert.ok(fallbackIds.some((unitId) => unitId !== request.primaryRecommendation.unitId && verifyUnitIds.includes(unitId)));
  // ETA honesty: without real road routing the ETA must be null, never fabricated.
  if (request.primaryRecommendation.route?.approximate) {
    assert.equal(request.primaryRecommendation.etaMinutes, null);
  }

  // 5. Idempotency: a second review returns the same request.
  const again = await call(controller.createDispatchRequest, { user: dispatcher, params: { id: event.id }, body: {} });
  assert.equal(again.statusCode, 200);
  assert.equal(again.payload.existing, true);
  assert.equal(again.payload.request.id, request.id);

  // 6. RBAC: field officer may not approve.
  const fieldAttempt = await call(controller.approveDispatchRequest, { user: fieldOfficer, params: { requestId: request.id }, body: {} });
  assert.equal(fieldAttempt.statusCode, 403);

  // 7. Dispatcher approval: canonical incident + REQUESTED unit request with ACK timeout.
  const approved = await call(controller.approveDispatchRequest, { user: dispatcher, params: { requestId: request.id }, body: {} });
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.payload.request.status, "APPROVED");
  const unitRequest = approved.payload.unitRequest;
  assert.ok(unitRequest, "approval must create the primary unit request");
  assert.equal(unitRequest.status, "REQUESTED");
  assert.equal(unitRequest.unitId, request.primaryRecommendation.unitId);
  assert.ok(unitRequest.timeoutAt, "ACK timeout must be recorded");
  const eventAfter = (await readDatabase()).erssEvents.find((item) => item.id === event.id);
  assert.ok(eventAfter.incidentId, "canonical incident must be linked");
  assert.notEqual(eventAfter.incidentId, event.id);
  assert.equal(eventAfter.triageStatus, "DISPATCH_RECOMMENDED");
  assert.equal(eventAfter.dispatcherId, dispatcher.id);

  // 8. Admin follows existing policy and may approve too.
  const adminApproval = await call(controller.approveDispatchRequest, { user: admin, params: { requestId: request.id }, body: {} });
  assert.equal(adminApproval.statusCode, 200);

  // 9. Audit trail recorded.
  const finalDb = await readDatabase();
  const actions = finalDb.auditLogs.map((entry) => entry.action);
  assert.ok(actions.includes("erss_dispatch_approved"));
  assert.ok(actions.includes("erss_unit_requested"));
  assert.ok(actions.includes("erss_incident_created"));

  // 10. Unit request persisted with monitoring fields.
  const persisted = await query("SELECT status, unit_id, timeout_at FROM erss_unit_requests WHERE id = $1", [unitRequest.id]);
  assert.equal(persisted.rows.length, 1);
  assert.equal(persisted.rows[0].status, "REQUESTED");
  assert.ok(persisted.rows[0].timeout_at);

  await closePool();
});
