const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { io: createClient } = require("socket.io-client");
const { query, closePool, getPool } = require("../services/postgres.service");
const { __testables: { runMigrations } } = require("../scripts/migrate");
const { start, emitSlaSweepEvents } = require("../server");
const realtimeEvents = require("../services/realtimeEvents.service");

function once(socket, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeout);
    socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
  });
}

test("authenticated Socket.IO carries critical and SLA events and REST restores persisted state", async (t) => {
  if (!process.env.DATABASE_URL) return t.skip("PostgreSQL test schema is required");
  const migrationClient = await getPool().connect();
  try { await runMigrations({ client: migrationClient }); } finally { migrationClient.release(); }
  process.env.AI_SERVICE_ALLOW_INSECURE = "true";
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const userId = `socket_admin_${suffix}`;
  const incidentId = `socket_inc_${suffix}`;
  const alertId = `socket_alert_${suffix}`;
  const email = `${userId}@example.test`;
  const policeEmail = `socket_police_${suffix}@example.test`;
  const citizenEmail = `socket_citizen_${suffix}@example.test`;
  const password = "SocketTest123!";
  const passwordHash = await bcrypt.hash(password, 4);
  await query(
    "INSERT INTO users (id,name,email,role,password_hash,data) VALUES ($1,$2,$3,'Admin',$4,$5::jsonb)",
    [userId, "Socket Admin", email, passwordHash, JSON.stringify({ id: userId, name: "Socket Admin", email, role: "Admin", passwordHash })]
  );
  for (const [id, name, role, accountEmail] of [
    [`socket_police_${suffix}`, "Socket Police", "Police Officer", policeEmail],
    [`socket_citizen_${suffix}`, "Socket Citizen", "Citizen", citizenEmail]
  ]) {
    await query(
      "INSERT INTO users (id,name,email,role,password_hash,data) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
      [id, name, accountEmail, role, passwordHash, JSON.stringify({ id, name, email: accountEmail, role, passwordHash })]
    );
  }
  await query(
    "INSERT INTO incidents (id,status,severity,data) VALUES ($1,'Verified','CRITICAL',$2::jsonb)",
    [incidentId, JSON.stringify({ id: incidentId, title: "Possible Murder", status: "Verified", severity: "CRITICAL" })]
  );
  const alert = {
    id: alertId, incidentId, alertType: "ASSIGNMENT_BREACH", severity: "CRITICAL",
    escalationLevel: "L2", title: "SLA BREACH - NO RESPONSE TEAM ASSIGNED",
    message: "No response team assigned", uniqueKey: `${incidentId}:ASSIGNMENT_BREACH:L2`,
    acknowledged: false, resolved: false, active: true,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  await query(
    `INSERT INTO escalation_alerts
      (id,incident_id,alert_type,severity,escalation_level,title,message,unique_key,active,data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9::jsonb)`,
    [alert.id, incidentId, alert.alertType, alert.severity, alert.escalationLevel, alert.title, alert.message, alert.uniqueKey, JSON.stringify(alert)]
  );

  const server = await start(0);
  const port = server.address().port;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await closePool();
  });

  const login = await fetch(`http://127.0.0.1:${port}/api/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").match(/rakshakai_session=[^;]+/)[0];
  const loginCookie = async (accountEmail) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: accountEmail, password })
    });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").match(/rakshakai_session=[^;]+/)[0];
  };

  const unauthenticated = createClient(`http://127.0.0.1:${port}`, { transports: ["websocket"], reconnection: false });
  const unauthorizedError = await once(unauthenticated, "connect_error");
  assert.match(unauthorizedError.message, /Authentication/);
  unauthenticated.close();

  const socket = createClient(`http://127.0.0.1:${port}`, {
    transports: ["websocket"], reconnection: true,
    extraHeaders: { Cookie: cookie }
  });
  await once(socket, "connect");
  socket.emit("join_dashboard", "Citizen");
  await new Promise((resolve) => setTimeout(resolve, 30));

  const criticalPromise = once(socket, "critical_incident_created");
  realtimeEvents.emit("critical_incident_created", { id: incidentId, title: "Possible Murder", severity: "CRITICAL" });
  assert.equal((await criticalPromise).incident.id, incidentId);

  const genericPromise = once(socket, "escalation_alert_created");
  const specificPromise = once(socket, "incident_assignment_breached");
  emitSlaSweepEvents({ createdAlerts: [alert], resolvedAlerts: [] });
  assert.equal((await genericPromise).alert.id, alertId);
  assert.equal((await specificPromise).alert.alertType, "ASSIGNMENT_BREACH");

  const cameraHealthPromise = once(socket, "camera_health_changed");
  realtimeEvents.emit("camera_health_changed", { camera: { id: "cam_c19", healthStatus: "NO_VIDEO_FRAMES" }, status: "NO_VIDEO_FRAMES", severity: "HIGH" });
  assert.equal((await cameraHealthPromise).camera.healthStatus, "NO_VIDEO_FRAMES");

  socket.close();
  const persisted = await fetch(`http://127.0.0.1:${port}/api/escalation/alerts?active=true`, { headers: { Cookie: cookie } });
  assert.equal(persisted.status, 200);
  const body = await persisted.json();
  assert.ok(body.alerts.some((item) => item.id === alertId && item.active));

  const citizenCookie = await loginCookie(citizenEmail);
  const citizenQueue = await fetch(`http://127.0.0.1:${port}/api/escalation/alerts`, { headers: { Cookie: citizenCookie } });
  assert.equal(citizenQueue.status, 403);
  const citizenSeverity = await fetch(`http://127.0.0.1:${port}/api/incidents/${incidentId}/severity`, {
    method: "POST", headers: { Cookie: citizenCookie, "content-type": "application/json" },
    body: JSON.stringify({ severity: "HIGH", reason: "unauthorized" })
  });
  assert.equal(citizenSeverity.status, 403);

  const policeCookie = await loginCookie(policeEmail);
  const policeQueue = await fetch(`http://127.0.0.1:${port}/api/escalation/alerts`, { headers: { Cookie: policeCookie } });
  assert.equal(policeQueue.status, 200);
  const acknowledged = await fetch(`http://127.0.0.1:${port}/api/escalation/alerts/${alertId}/acknowledge`, {
    method: "POST", headers: { Cookie: policeCookie, "content-type": "application/json" }, body: "{}"
  });
  const acknowledgedBody = await acknowledged.json();
  assert.equal(acknowledged.status, 200, acknowledgedBody.error);
  const acknowledgedAlert = acknowledgedBody.alert;
  assert.equal(acknowledgedAlert.acknowledged, true);
  assert.equal(acknowledgedAlert.active, true);
  assert.equal(acknowledgedAlert.resolved, false);

  const timelineResponse = await fetch(`http://127.0.0.1:${port}/api/incidents/${incidentId}/timeline`, {
    headers: { Cookie: policeCookie }
  });
  const timelineBody = await timelineResponse.json();
  assert.equal(timelineResponse.status, 200, timelineBody.error);
  assert.ok(Array.isArray(timelineBody.events));
  assert.ok(Array.isArray(timelineBody.timeline));
  assert.ok(timelineBody.timeline.some((event) => event.eventType === "ESCALATION_ACKNOWLEDGED"));
});
