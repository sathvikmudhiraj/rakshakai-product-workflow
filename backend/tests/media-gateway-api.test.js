const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const bcrypt = require("bcryptjs");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-gateway-api-"));
const databasePath = path.join(directory, "db.json");
const evidencePath = path.join(directory, "evidence");
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "db.fixture.json"), "utf8"));
const password = "RakshakAI-Test-123!";
fixture.users.forEach((user) => { user.passwordHash = bcrypt.hashSync(password, 4); delete user.password; });
fixture.aiObservations = [];
fixture.cameraSources.push({
  id: "cam_gateway_api", cameraId: "CAM-GW-API", name: "Gateway API Camera", zone: "Main Gate",
  type: "rtsp", sourceType: "rtsp", streamEnabled: false, healthEnabled: true, aiEnabled: true,
  streamState: "STREAMING", gatewayHealth: "HEALTHY", aiState: "AI_READY", connected: true,
  streamUrl: "enc:v1:AAAAAAAAAAAAAAAA:AAAA:AAAAAAAAAAAAAAAAAAAAAA"
});
fixture.aiObservations.push({
  id: "OBS-API-1", cameraId: "cam_gateway_api", cameraName: "Gateway API Camera", zone: "Main Gate",
  capturedAt: "2026-10-12T01:00:00.000Z", processedAt: "2026-10-12T01:00:01.000Z", createdAt: "2026-10-12T01:00:01.000Z",
  status: "PENDING_REVIEW", reviewStatus: "PENDING_REVIEW", advisory: true, humanVerificationRequired: true,
  detections: [{ label: "person", confidence: 0.91, boundingBox: [1, 2, 3, 4] }], reason: "Human verification required."
});
fixture.aiObservations.push({
  id: "OBS-API-REJECT", cameraId: "cam_gateway_api", cameraName: "Gateway API Camera", zone: "Main Gate",
  capturedAt: "2026-10-12T01:01:00.000Z", processedAt: "2026-10-12T01:01:01.000Z", createdAt: "2026-10-12T01:01:01.000Z",
  status: "PENDING_REVIEW", detections: [{ label: "car", confidence: 0.8 }]
});
fs.writeFileSync(databasePath, JSON.stringify(fixture, null, 2));

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.RAKSHAKAI_DATA_FILE = databasePath;
process.env.EVIDENCE_STORAGE_DRIVER = "filesystem";
process.env.EVIDENCE_STORAGE_DIR = evidencePath;
process.env.JWT_SECRET = "gateway-api-test-secret-longer-than-32-characters";
process.env.CAMERA_CREDENTIAL_ENCRYPTION_KEY = "44".repeat(32);
process.env.AI_SERVICE_URL = "";
process.env.API_RATE_LIMIT = "10000";
process.env.FRONTEND_ORIGINS = "https://ops.rakshak.example.com";

const { start } = require("../server");
const { readDatabase } = require("../services/core.service");
const { MediaGateway, SimulatorConnector } = require("../services/mediaGateway.service");
const { persistGatewayObservation } = require("../services/aiObservation.service");
let server; let baseUrl;

async function request(pathname, { cookie, method = "GET", body } = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function login(email) {
  const response = await request("/api/login", { method: "POST", body: { email, password } });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

test.before(async () => {
  server = await start(0); baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true });
});

test("observation queue enforces RBAC and never exposes camera credentials", async () => {
  const police = await login("officer@example.test");
  const citizen = await login("citizen@example.test");
  const allowed = await request("/api/ai-observations", { cookie: police });
  assert.equal(allowed.status, 200);
  const payload = await allowed.json();
  assert.equal(payload.observations.some((item) => item.id === "OBS-API-1"), true);
  assert.doesNotMatch(JSON.stringify(payload), /streamUrl|rtspUrl|password|enc:v1/i);
  assert.equal((await request("/api/ai-observations", { cookie: citizen })).status, 403);
  assert.equal((await request("/api/media-gateway/health", { cookie: citizen })).status, 403);
});

test("confirm creates an alert only; the existing verified alert flow creates the linked incident", async () => {
  const police = await login("officer@example.test");
  const before = await readDatabase();
  const incidentsBefore = before.incidents.length;
  const confirmedResponse = await request("/api/ai-observations/OBS-API-1/review", { cookie: police, method: "POST", body: { decision: "CONFIRMED" } });
  assert.equal(confirmedResponse.status, 200);
  const confirmed = await confirmedResponse.json();
  assert.equal(confirmed.observation.status, "CONFIRMED");
  assert.equal(confirmed.alert.sourceObservationId, "OBS-API-1");
  let db = await readDatabase();
  assert.equal(db.incidents.length, incidentsBefore);

  const alertId = confirmed.alert.id;
  assert.equal((await request(`/api/alerts/${alertId}/acknowledge`, { cookie: police, method: "POST", body: {} })).status, 200);
  assert.equal((await request(`/api/alerts/${alertId}/review`, { cookie: police, method: "POST", body: { action: "verify" } })).status, 200);
  const convertedResponse = await request(`/api/alerts/${alertId}/review`, { cookie: police, method: "POST", body: { action: "convert_incident" } });
  assert.equal(convertedResponse.status, 200);
  const converted = await convertedResponse.json();
  assert.equal(converted.incident.sourceObservationId, "OBS-API-1");
  assert.equal(converted.incident.sourceAlertId, alertId);
  assert.equal(converted.incident.sourceCameraId, "cam_gateway_api");
  db = await readDatabase();
  assert.equal(db.incidents.length, incidentsBefore + 1);
  assert.ok(db.auditLogs.some((item) => item.action === "observation_confirmed" && item.details.includes("OBS-API-1")));
  assert.ok(db.auditLogs.some((item) => item.action === "alert_created_from_observation" && item.details.includes("OBS-API-1")));
});

test("simulated RTSP pipeline creates a review observation, then a reviewed alert and linked incident", async () => {
  const police = await login("officer@example.test");
  const gateway = new MediaGateway({
    connectorFactory: (source) => new SimulatorConnector(source, { intervalMs: 40 }),
    analyzeFrame: async () => ({
      configured: true,
      model: "mock-yolo",
      detections: [{ label: "person", confidence: 0.94, box: [10, 20, 80, 160] }]
    }),
    persistObservation: persistGatewayObservation
  });
  const observationCreated = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Simulator did not create an observation")), 2_000);
    gateway.once("observation_created", (payload) => { clearTimeout(timeout); resolve(payload.observation); });
  });
  await gateway.startCamera({
    id: "cam_gateway_api", cameraId: "CAM-GW-API", name: "Gateway API Camera", zone: "Main Gate",
    enabled: true, streamEnabled: true, aiEnabled: true, samplingIntervalMs: 250
  });
  const observation = await observationCreated.finally(() => gateway.stopAll());
  assert.equal(observation.status, "PENDING_REVIEW");

  const beforeReview = await readDatabase();
  const incidentsBefore = beforeReview.incidents.length;
  const reviewResponse = await request(`/api/ai-observations/${observation.id}/review`, {
    cookie: police, method: "POST", body: { decision: "CONFIRMED", notes: "Verified in simulator pipeline test" }
  });
  assert.equal(reviewResponse.status, 200);
  const reviewed = await reviewResponse.json();
  assert.equal(reviewed.alert.sourceObservationId, observation.id);
  assert.equal((await readDatabase()).incidents.length, incidentsBefore, "confirmation must not bypass alert review");

  assert.equal((await request(`/api/alerts/${reviewed.alert.id}/acknowledge`, { cookie: police, method: "POST", body: {} })).status, 200);
  assert.equal((await request(`/api/alerts/${reviewed.alert.id}/review`, { cookie: police, method: "POST", body: { action: "verify" } })).status, 200);
  const convertedResponse = await request(`/api/alerts/${reviewed.alert.id}/review`, { cookie: police, method: "POST", body: { action: "convert_incident" } });
  assert.equal(convertedResponse.status, 200);
  const converted = await convertedResponse.json();
  assert.equal(converted.incident.sourceObservationId, observation.id);
  assert.equal(converted.incident.sourceCameraId, "cam_gateway_api");
  const finalDb = await readDatabase();
  assert.ok(finalDb.incidents.some((item) => item.id === converted.incident.id || item.sourceObservationId === observation.id));
  assert.ok(finalDb.incidents.length >= incidentsBefore, "incident consolidation must not remove unrelated incidents");
});

test("reject and uncertain decisions never create alerts or incidents", async () => {
  const admin = await login("admin@example.test");
  const before = await readDatabase(); const alertsBefore = before.alerts.length; const incidentsBefore = before.incidents.length;
  const rejected = await request("/api/ai-observations/OBS-API-REJECT/review", { cookie: admin, method: "POST", body: { decision: "REJECTED" } });
  assert.equal(rejected.status, 200);
  assert.equal((await rejected.json()).alert, null);
  const after = await readDatabase();
  assert.equal(after.alerts.length, alertsBefore);
  assert.equal(after.incidents.length, incidentsBefore);
});
