const test = require("node:test");
const assert = require("node:assert/strict");
const { acknowledgeHealthAlert, applyHealthSample, evaluateCameraHealth, setMaintenance } = require("../services/cameraHealth.service");

function database(camera = {}) {
  return { cameraSources: [{ id: "cam_1", cameraId: "CAM-C19", name: "Main Junction", criticality: "NORMAL", healthStatus: "UNKNOWN", ...camera }], cameraHealthEvents: [], cameraHealthAlerts: [], cameraHealthThresholds: {} };
}
function healthy() { return { heartbeatAvailable: true, heartbeatAt: "2026-01-01T00:00:00.000Z", streamAvailable: true, frameAvailable: true, storageHealthy: true, fps: 25, lowFpsSamples: 0 }; }
function status(sample, camera = {}) { return evaluateCameraHealth(camera, sample, { now: "2026-01-01T00:00:01.000Z" }).status; }

test("healthy camera remains ONLINE", () => assert.equal(status(healthy()), "ONLINE"));
test("missing heartbeat is OFFLINE", () => assert.equal(status({ heartbeatAvailable: false }), "OFFLINE"));
test("reachable camera without stream is NO_SIGNAL", () => assert.equal(status({ ...healthy(), streamAvailable: false }), "NO_SIGNAL"));
test("connected stream without frames is NO_VIDEO_FRAMES", () => assert.equal(status({ ...healthy(), frameAvailable: false }), "NO_VIDEO_FRAMES"));
test("low FPS needs configured confirmation samples", () => {
  assert.equal(status({ ...healthy(), fps: 4, lowFpsSamples: 2 }), "ONLINE");
  assert.equal(status({ ...healthy(), fps: 4, lowFpsSamples: 3 }), "LOW_FPS");
});
test("high latency, blur, dark and storage failures remain distinct", () => {
  assert.equal(status({ ...healthy(), latencyMs: 2501 }), "HIGH_LATENCY");
  assert.equal(status({ ...healthy(), blurScore: 0.1 }), "BLURRY");
  assert.equal(status({ ...healthy(), brightnessScore: 0.01 }), "TOO_DARK");
  assert.equal(status({ ...healthy(), storageHealthy: false }), "STORAGE_ERROR");
});
test("black or obstructed video alone does not claim tampering", () => assert.equal(status({ ...healthy(), obstructionPercent: 0.95 }), "OBSTRUCTED"));
test("recent activity followed by obstruction is tamper suspected", () => assert.equal(status({ ...healthy(), obstructionPercent: 0.95, recentVisualActivity: true, suddenVisualChange: true }), "TAMPER_SUSPECTED"));
test("large camera angle displacement is tamper suspected", () => assert.equal(status({ ...healthy(), angleDisplacement: 0.8 }), "TAMPER_SUSPECTED"));
test("critical camera offline is escalated to CRITICAL", () => {
  const db = database({ criticality: "CRITICAL" }); const result = applyHealthSample(db, "cam_1", { heartbeatAvailable: false });
  assert.equal(result.severity, "CRITICAL"); assert.equal(result.createdAlerts[0].severity, "CRITICAL");
});
test("a health episode creates one alert and recovery resolves it without deleting history", () => {
  const db = database(); const failure = applyHealthSample(db, "cam_1", { heartbeatAvailable: false }, { now: "2026-01-01T00:01:00.000Z" });
  applyHealthSample(db, "cam_1", { heartbeatAvailable: false }, { now: "2026-01-01T00:02:00.000Z" });
  assert.equal(db.cameraHealthAlerts.length, 1); assert.equal(failure.createdAlerts.length, 1);
  applyHealthSample(db, "cam_1", { ...healthy(), heartbeatAt: "2026-01-01T00:03:00.000Z" }, { now: "2026-01-01T00:03:00.000Z" });
  assert.equal(db.cameraHealthAlerts[0].active, false); assert.equal(db.cameraHealthAlerts[0].status, "RESOLVED"); assert.ok(db.cameraHealthEvents.length >= 2);
});
test("acknowledgement keeps an active health alert unresolved", () => {
  const db = database(); const result = applyHealthSample(db, "cam_1", { heartbeatAvailable: false });
  const alert = acknowledgeHealthAlert(db, result.createdAlerts[0].id, { id: "admin" });
  assert.equal(alert.status, "ACKNOWLEDGED"); assert.equal(alert.active, true); assert.equal(alert.resolvedAt, undefined);
});
test("maintenance suppresses failure alert escalation while preserving telemetry", () => {
  const db = database(); const result = setMaintenance(db, "cam_1", { enabled: true, reason: "Lens replacement" }, { id: "admin" });
  assert.equal(result.status, "MAINTENANCE"); assert.equal(db.cameraHealthAlerts.length, 0); assert.equal(db.cameraSources[0].maintenanceReason, "Lens replacement");
});
test("failure preservation keeps metadata only and never invents camera bytes", () => {
  const db = database(); const result = applyHealthSample(db, "cam_1", { ...healthy(), streamAvailable: false, frameReferences: ["frame-a"] }, { now: "2026-01-01T00:00:01.000Z" });
  assert.equal(result.preservation.available, true); assert.deepEqual(result.preservation.frameReferences, ["frame-a"]);
});
