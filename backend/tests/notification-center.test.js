const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const bcrypt = require("bcryptjs");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-notifications-"));
const databasePath = path.join(directory, "db.json");
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "db.fixture.json"), "utf8"));
const password = "Notification-Test-123!";
fixture.users.forEach((user) => { user.passwordHash = bcrypt.hashSync(password, 4); delete user.password; });
const admin = fixture.users.find((user) => user.role === "Admin");
const citizen = fixture.users.find((user) => user.role === "Citizen");
const now = new Date().toISOString();
fixture.incidents = [{ id: "inc_notification_1", title: "Possible Murder", type: "possible_murder", severity: "CRITICAL", status: "Verified", verificationStatus: "verified", sourceType: "manual", sourceName: "Command Center", reportedBy: admin.id, description: "Authoritative incident description", address: "Sector 7", lat: 17.5, lng: 78.3, locationStatus: "Verified", createdAt: now, updatedAt: now }];
fixture.escalationAlerts = [{ id: "sla_notification_1", incidentId: "inc_notification_1", alertType: "RESPONSE_BREACH", title: "Response SLA Breach", message: "Response SLA exceeded", severity: "HIGH", escalationLevel: "L2", active: true, createdAt: now }];
fixture.cameraSources = [{ id: "cam_notification_1", cameraId: "C-05", name: "Gate Camera", zone: "Sector 7", sourceType: "demo_seed", isDemo: true, status: "offline", healthStatus: "OFFLINE", createdAt: now }];
fixture.cameraHealthAlerts = [{ id: "camera_alert_1", cameraId: "cam_notification_1", status: "OFFLINE", healthStatus: "OFFLINE", message: "Camera stopped sending frames", severity: "HIGH", active: true, createdAt: now }];
fixture.trackingSessions = [{ id: "track_session_1", trackType: "VEHICLE", status: "HUMAN_REVIEW", referenceCameraId: "cam_notification_1", createdAt: now }];
fixture.trackingCandidates = [{ id: "track_candidate_1", sessionId: "track_session_1", status: "PENDING_REVIEW", overallConfidence: 0.86, scoreBreakdown: { plate: 0.9, timing: 0.8 }, createdAt: now }];
fixture.reports = [{ id: "report_notification_1", reportType: "missing_person", name: "Citizen report", status: "submitted_for_review", urgency: "HIGH", description: "Authorized report description", createdBy: citizen.id, createdAt: now, updatedAt: now }];
fixture.notifications = [];
fixture.notificationReceipts = [];
fs.writeFileSync(databasePath, JSON.stringify(fixture, null, 2));
process.env.RAKSHAKAI_DATA_FILE = databasePath;
process.env.JWT_SECRET = "notification-test-secret-that-is-long-enough";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.AI_SERVICE_URL = "";
process.env.AI_SERVICE_ALLOW_INSECURE = "true";

const { start } = require("../server");
const { readDb, writeDb } = require("../services/core.service");
let server;
let baseUrl;

async function request(url, options = {}) { return fetch(`${baseUrl}${url}`, options); }
function cookieFrom(response) { return response.headers.get("set-cookie")?.split(";")[0] || ""; }
async function login(user) {
  const response = await request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" }, body: JSON.stringify({ email: user.email, password }) });
  assert.equal(response.status, 200);
  return cookieFrom(response);
}

test.before(async () => { server = await start(0); baseUrl = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); fs.rmSync(directory, { recursive: true, force: true }); });

test("notification metadata is derived from real state and deduplicated", async () => {
  const cookie = await login(admin);
  const first = await request("/api/notifications", { headers: { Cookie: cookie } });
  const payload = await first.json();
  assert.equal(first.status, 200, payload.error);
  assert.ok(payload.notifications.some((item) => item.type === "critical_incident" && item.entityId === "inc_notification_1"));
  assert.ok(payload.notifications.some((item) => item.entityType === "camera"));
  assert.ok(payload.notifications.some((item) => item.entityType === "tracking_candidate"));
  assert.equal(new Set(payload.notifications.map((item) => item.id)).size, payload.notifications.length);
  const second = await (await request("/api/notifications", { headers: { Cookie: cookie } })).json();
  assert.equal(second.notifications.length, payload.notifications.length);
});

test("read state and mark-all persist across fresh list requests", async () => {
  const cookie = await login(admin);
  const initial = await (await request("/api/notifications", { headers: { Cookie: cookie } })).json();
  const target = initial.notifications[0];
  const marked = await request(`/api/notifications/${target.id}/read`, { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ read: true }) });
  assert.equal(marked.status, 200);
  const refreshed = await (await request("/api/notifications", { headers: { Cookie: cookie } })).json();
  assert.equal(refreshed.notifications.find((item) => item.id === target.id).read, true);
  const all = await request("/api/notifications/mark-all-read", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}" });
  assert.equal(all.status, 200);
  assert.equal((await (await request("/api/notifications", { headers: { Cookie: cookie } })).json()).unreadCount, 0);
});

test("View Details reloads current authoritative incident data", async () => {
  const cookie = await login(admin);
  const listed = await (await request("/api/notifications", { headers: { Cookie: cookie } })).json();
  const item = listed.notifications.find((entry) => entry.type === "critical_incident");
  const db = readDb();
  db.incidents.find((incident) => incident.id === "inc_notification_1").description = "Latest authoritative description";
  writeDb(db);
  const response = await request(`/api/notifications/${item.id}/details`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.detail.record.description, "Latest authoritative description");
  assert.ok(Array.isArray(payload.detail.timeline));
});

test("camera and tracking details are safe and human-verification explicit", async () => {
  const cookie = await login(admin);
  const listed = await (await request("/api/notifications", { headers: { Cookie: cookie } })).json();
  const camera = listed.notifications.find((entry) => entry.entityType === "camera");
  const cameraResponse = await request(`/api/notifications/${camera.id}/details`, { headers: { Cookie: cookie } });
  const cameraText = await cameraResponse.text();
  assert.equal(cameraResponse.status, 200);
  assert.doesNotMatch(cameraText, /apiKey|streamUrl|password|token|secret/i);
  const tracking = listed.notifications.find((entry) => entry.entityType === "tracking_candidate");
  const trackingPayload = await (await request(`/api/notifications/${tracking.id}/details`, { headers: { Cookie: cookie } })).json();
  assert.equal(trackingPayload.detail.candidate.status, "PENDING_REVIEW");
  assert.equal(trackingPayload.detail.humanVerificationRequired, true);
});

test("Citizen sees only own report notification and cannot fetch operator records", async () => {
  const adminCookie = await login(admin);
  const adminList = await (await request("/api/notifications", { headers: { Cookie: adminCookie } })).json();
  const camera = adminList.notifications.find((entry) => entry.entityType === "camera");
  const citizenCookie = await login(citizen);
  const citizenListResponse = await request("/api/notifications", { headers: { Cookie: citizenCookie } });
  assert.equal(citizenListResponse.status, 200);
  const citizenList = await citizenListResponse.json();
  assert.ok(citizenList.notifications.every((entry) => entry.entityType === "report"));
  assert.ok(citizenList.notifications.some((entry) => entry.entityId === "report_notification_1"));
  const forbidden = await request(`/api/notifications/${camera.id}/details`, { headers: { Cookie: citizenCookie } });
  assert.equal(forbidden.status, 404);
});
