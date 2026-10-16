const test = require("node:test");
const assert = require("node:assert/strict");
const { MediaGateway } = require("../services/mediaGateway.service");
const { normalizeAiResult, reviewObservation, isWithinDedupeWindow } = require("../services/aiObservation.service");
const { validateCameraEndpoint, sanitizeGatewayError } = require("../services/cameraEndpointPolicy.service");
const { seedDb } = require("../services/core.service");

class FakeConnector {
  start(handlers) { this.handlers = handlers; return this; }
  stop() { this.stopped = true; }
}

const camera = (overrides = {}) => ({
  id: "cam_real_1", cameraId: "CAM-REAL-1", name: "Main Gate", zone: "Gate A",
  streamEnabled: true, enabled: true, aiEnabled: true, samplingIntervalMs: 1_000,
  ...overrides
});
const frame = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
const aiResult = (detections = [{ label: "person", confidence: 0.91, box: [1, 2, 3, 4] }]) => ({ configured: true, detections, model: "test-yolo" });
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

test("valid configured stream connects, reports real frames, and disabled stream does not connect", async () => {
  const connector = new FakeConnector(); let factoryCalls = 0;
  const gateway = new MediaGateway({ connectorFactory: () => { factoryCalls += 1; return connector; }, analyzeFrame: async () => aiResult(), persistObservation: async () => null });
  await gateway.startCamera(camera());
  assert.equal(gateway.state("cam_real_1").streamState, "CONNECTING");
  connector.handlers.onConnected(); await tick();
  assert.equal(gateway.state("cam_real_1").streamState, "STREAMING");
  await gateway.frame(gateway.sessions.get("cam_real_1"), frame, { capturedAt: new Date().toISOString() });
  assert.equal(gateway.state("cam_real_1").connected, true);
  await gateway.startCamera(camera({ id: "disabled", streamEnabled: false }));
  assert.equal(gateway.state("disabled").streamState, "DISABLED");
  assert.equal(factoryCalls, 1);
  await gateway.stopAll();
});

test("authentication failure is explicit and sanitized without credential exposure", async () => {
  const connector = new FakeConnector();
  const gateway = new MediaGateway({ connectorFactory: () => connector, maxReconnects: 0 });
  await gateway.startCamera(camera());
  connector.handlers.onError(new Error("401 Unauthorized rtsp://admin:secret@10.0.0.5/live")); await tick();
  const state = gateway.state("cam_real_1");
  assert.equal(state.streamState, "AUTH_FAILED");
  assert.match(state.lastError, /authentication failed/i);
  assert.doesNotMatch(JSON.stringify(state), /admin|secret|rtsp:\/\//i);
  await gateway.stopAll();
});

test("connection loss reconnects with bounded backoff, recovers, then sustained failure becomes offline", async () => {
  const connectors = [new FakeConnector(), new FakeConnector(), new FakeConnector()]; let index = 0;
  const gateway = new MediaGateway({ connectorFactory: () => connectors[index++], maxReconnects: 1, baseBackoffMs: 20, maxBackoffMs: 20 });
  await gateway.startCamera(camera()); connectors[0].handlers.onConnected(); await tick();
  connectors[0].handlers.onClose(); await tick();
  assert.equal(gateway.state("cam_real_1").streamState, "RECONNECTING");
  await new Promise((resolve) => setTimeout(resolve, 60)); connectors[1].handlers.onConnected(); await tick();
  assert.equal(gateway.state("cam_real_1").streamState, "STREAMING");
  assert.equal(gateway.state("cam_real_1").reconnectCount, 1);
  connectors[1].handlers.onClose(); await tick();
  assert.equal(gateway.state("cam_real_1").streamState, "OFFLINE");
  await gateway.stopAll();
});

test("late callbacks from a replaced connector cannot tear down the current stream", async () => {
  const connectors = [new FakeConnector(), new FakeConnector()]; let index = 0;
  const gateway = new MediaGateway({ connectorFactory: () => connectors[index++], maxReconnects: 2, baseBackoffMs: 20, maxBackoffMs: 20 });
  await gateway.startCamera(camera());
  connectors[0].handlers.onConnected(); await tick();
  connectors[0].handlers.onError(new Error("connection reset"));
  await new Promise((resolve) => setTimeout(resolve, 60));
  connectors[1].handlers.onConnected(); await tick();
  assert.equal(gateway.state("cam_real_1").streamState, "STREAMING");

  connectors[0].handlers.onClose();
  connectors[0].handlers.onError(new Error("late stale error"));
  await tick();

  assert.equal(connectors[1].stopped, undefined);
  assert.equal(gateway.state("cam_real_1").streamState, "STREAMING");
  await gateway.stopAll();
});

test("connected socket without frames becomes NO_FRAMES instead of healthy", async () => {
  const connector = new FakeConnector();
  const gateway = new MediaGateway({ connectorFactory: () => connector, noFramesMs: 500 });
  await gateway.startCamera(camera()); connector.handlers.onConnected();
  const session = gateway.sessions.get("cam_real_1");
  session.lastFrameAt = new Date(Date.now() - 1_000).toISOString();
  await gateway.checkFrames(session);
  assert.equal(gateway.state("cam_real_1").streamState, "NO_FRAMES");
  assert.equal(gateway.state("cam_real_1").connected, true);
  await gateway.stopAll();
});

test("sampling interval is respected and latest-frame backpressure stays bounded", async () => {
  let now = Date.now(); let requests = 0; const resolvers = [];
  const gateway = new MediaGateway({
    connectorFactory: () => new FakeConnector(), clock: () => now,
    analyzeFrame: () => { requests += 1; return new Promise((resolve) => resolvers.push(resolve)); },
    persistObservation: async () => null, aiTimeoutMs: 5_000
  });
  await gateway.startCamera(camera()); const session = gateway.sessions.get("cam_real_1");
  session.connected = true;
  const first = gateway.frame(session, frame, { capturedAt: new Date(now).toISOString() });
  now += 1_100; await gateway.frame(session, Buffer.from(frame), { capturedAt: new Date(now).toISOString() });
  now += 1_100; await gateway.frame(session, Buffer.from(frame), { capturedAt: new Date(now).toISOString() });
  assert.equal(requests, 1);
  assert.equal(session.metrics.droppedSamples, 2);
  resolvers.shift()(aiResult([])); await tick();
  assert.equal(requests, 2);
  resolvers.shift()(aiResult([])); await first; await tick();
  assert.equal(session.pendingFrame, null);
  assert.equal(gateway.health().droppedSamples, 2);
  await gateway.stopAll();
});

test("AI timeout and outage remain independent from streaming camera health", async () => {
  const connector = new FakeConnector();
  const gateway = new MediaGateway({ connectorFactory: () => connector, analyzeFrame: () => new Promise(() => {}), aiTimeoutMs: 100 });
  await gateway.startCamera(camera({ samplingIntervalMs: 250 })); connector.handlers.onConnected(); await tick();
  await gateway.frame(gateway.sessions.get("cam_real_1"), frame, { capturedAt: new Date().toISOString() });
  const state = gateway.state("cam_real_1");
  assert.equal(state.streamState, "STREAMING");
  assert.equal(state.gatewayHealth, "HEALTHY");
  assert.equal(state.aiState, "AI_TIMEOUT");
  await gateway.stopAll();
});

test("invalid AI responses create no observation and AI errors do not stop stream health", async () => {
  const connector = new FakeConnector(); let persisted = 0;
  const gateway = new MediaGateway({
    connectorFactory: () => connector,
    analyzeFrame: async () => { throw new Error("invalid inference response"); },
    persistObservation: async () => { persisted += 1; }
  });
  await gateway.startCamera(camera({ samplingIntervalMs: 250 })); connector.handlers.onConnected(); await tick();
  await gateway.frame(gateway.sessions.get("cam_real_1"), frame, { capturedAt: new Date().toISOString() });
  const state = gateway.state("cam_real_1");
  assert.equal(state.streamState, "STREAMING");
  assert.equal(state.gatewayHealth, "HEALTHY");
  assert.equal(state.aiState, "AI_ERROR");
  assert.equal(persisted, 0);
  assert.equal(normalizeAiResult(null, { camera: camera(), capturedAt: new Date().toISOString() }).detections.length, 0);
  await gateway.stopAll();
});

test("AI normalization permits supported object labels and ignores unsupported claims", () => {
  const result = normalizeAiResult({ detections: [
    { label: "person", confidence: 92, box: [1, 2, 3, 4] },
    { label: "murder", confidence: 0.99 },
    { label: "weapon use", confidence: 0.99 }
  ] }, { camera: camera(), capturedAt: new Date().toISOString() });
  assert.deepEqual(result.detections.map((item) => item.label), ["person"]);
  assert.equal(result.detections[0].confidence, 0.92);
});

test("observation deduplication rejects frames outside either side of the time window", () => {
  const existing = { capturedAt: "2026-10-12T01:00:00.000Z", lastDetectedAt: "2026-10-12T01:00:00.000Z" };
  assert.equal(isWithinDedupeWindow(existing, "2026-10-12T01:00:14.000Z"), true);
  assert.equal(isWithinDedupeWindow(existing, "2026-10-12T00:59:46.000Z"), true);
  assert.equal(isWithinDedupeWindow(existing, "2026-10-12T01:00:16.000Z"), false);
  assert.equal(isWithinDedupeWindow(existing, "2026-10-12T00:59:44.000Z"), false);
  assert.equal(isWithinDedupeWindow({ capturedAt: "invalid" }, "2026-10-12T01:00:00.000Z"), false);
});

test("camera endpoint policy rejects browser protocols and unauthorized public hosts", () => {
  assert.throws(() => validateCameraEndpoint("https://camera.example.com/live", { env: { NODE_ENV: "production" } }), /RTSP or RTSPS/);
  assert.throws(() => validateCameraEndpoint("rtsp://camera.example.com/live", { env: { NODE_ENV: "production" } }), /authorized camera network policy/);
  assert.deepEqual(
    validateCameraEndpoint("rtsps://camera.example.com:7441/live", { env: { NODE_ENV: "production", CAMERA_NETWORK_ALLOWLIST: "camera.example.com" } }),
    { protocol: "rtsps:", hostname: "camera.example.com", port: 7441 }
  );
});

test("gateway error sanitization never returns embedded RTSP credentials", () => {
  const safe = sanitizeGatewayError(new Error("connect failed rtsp://admin:super-secret@10.0.0.12/live"), "CAM-12");
  assert.match(safe, /CAM-12/);
  assert.doesNotMatch(safe, /admin|super-secret|rtsp:\/\//i);
});

test("review workflow keeps observation, alert, and incident stages separate", () => {
  const db = seedDb();
  const observation = {
    id: "OBS-1", cameraId: "cam_real_1", cameraName: "Main Gate", zone: "Gate A",
    capturedAt: new Date().toISOString(), processedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
    status: "PENDING_REVIEW", detections: [{ label: "person", confidence: 0.91 }], humanVerificationRequired: true
  };
  db.aiObservations = [observation];
  const user = db.users.find((item) => item.role === "Police Officer");
  const confirmed = reviewObservation(db, observation, "CONFIRMED", user);
  assert.equal(observation.status, "CONFIRMED");
  assert.equal(confirmed.alert.sourceObservationId, "OBS-1");
  assert.equal(confirmed.alert.status, "New");
  assert.equal(db.incidents.length, 0);
  const rejected = { ...observation, id: "OBS-2", status: "PENDING_REVIEW", alertId: null };
  db.aiObservations.push(rejected);
  assert.equal(reviewObservation(db, rejected, "REJECTED", user).alert, null);
  assert.equal(db.incidents.length, 0);
  const uncertain = { ...observation, id: "OBS-3", status: "PENDING_REVIEW", alertId: null };
  db.aiObservations.push(uncertain);
  assert.equal(reviewObservation(db, uncertain, "UNCERTAIN", user).observation.status, "UNCERTAIN");
});
