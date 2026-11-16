const crypto = require("node:crypto");

const CAMERA_HEALTH_STATES = Object.freeze([
  "ONLINE", "DEGRADED", "LOW_FPS", "HIGH_LATENCY", "NO_SIGNAL", "NO_VIDEO_FRAMES",
  "OBSTRUCTED", "TAMPER_SUSPECTED", "TAMPER_CONFIRMED", "BLURRY", "TOO_DARK",
  "STORAGE_ERROR", "OFFLINE", "MAINTENANCE", "UNKNOWN"
]);

const DEFAULT_THRESHOLDS = Object.freeze({
  offlineAfterMs: 60_000,
  lowFpsRatio: 0.4,
  lowFpsSamples: 3,
  highLatencyMs: 2_000,
  warningLatencyMs: 500,
  blurScoreMax: 0.22,
  brightnessScoreMin: 0.08,
  obstructionPercent: 0.9,
  angleDisplacementThreshold: 0.65,
  preEventBufferSeconds: 10,
  postEventBufferSeconds: 5
});

function iso(value, fallback = new Date().toISOString()) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? fallback : new Date(timestamp).toISOString();
}

function healthSeverity(status, criticality = "NORMAL") {
  if (["ONLINE", "UNKNOWN"].includes(status)) return "NORMAL";
  if (status === "MAINTENANCE") return "INFO";
  if (["TAMPER_CONFIRMED"].includes(status)) return criticality === "CRITICAL" ? "CRITICAL" : "HIGH";
  if (["TAMPER_SUSPECTED", "OFFLINE", "NO_SIGNAL", "NO_VIDEO_FRAMES", "STORAGE_ERROR"].includes(status)) {
    return criticality === "CRITICAL" ? "CRITICAL" : "HIGH";
  }
  return "MEDIUM";
}

function evaluateCameraHealth(camera = {}, sample = {}, options = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) };
  const now = iso(options.now);
  const expectedFps = Number(sample.expectedFps ?? camera.expectedFps ?? 25);
  const fps = Number(sample.fps);
  const streamAvailable = sample.streamAvailable;
  const frameAvailable = sample.frameAvailable;
  const heartbeatAt = sample.heartbeatAt || camera.lastHeartbeatAt;
  const heartbeatAge = heartbeatAt ? Date.parse(now) - Date.parse(heartbeatAt) : Infinity;
  const lowFpsConfirmed = Number(sample.lowFpsSamples || 0) >= thresholds.lowFpsSamples;
  const obstructed = sample.obstructionDetected === true || Number(sample.obstructionPercent || 0) >= thresholds.obstructionPercent;
  const suspiciousChange = sample.tamperDetected === true
    || Number(sample.angleDisplacement || 0) >= thresholds.angleDisplacementThreshold
    || (obstructed && sample.recentVisualActivity === true && sample.suddenVisualChange === true);

  if (camera.maintenanceMode) return { status: "MAINTENANCE", reason: camera.maintenanceReason || "Camera is in scheduled maintenance", thresholds };
  if (sample.heartbeatAvailable === false || heartbeatAge > thresholds.offlineAfterMs) return { status: "OFFLINE", reason: "Camera heartbeat is unavailable", thresholds };
  if (streamAvailable === false) return { status: "NO_SIGNAL", reason: "Camera is reachable but the video stream is unavailable", thresholds };
  if (streamAvailable === true && frameAvailable === false) return { status: "NO_VIDEO_FRAMES", reason: "Stream is connected but usable video frames are not arriving", thresholds };
  if (sample.storageHealthy === false) return { status: "STORAGE_ERROR", reason: "Camera recording or evidence storage reported a write failure", thresholds };
  if (sample.tamperConfirmed === true) return { status: "TAMPER_CONFIRMED", reason: "Camera tamper was confirmed by an authorised operator", thresholds };
  if (suspiciousChange) return { status: "TAMPER_SUSPECTED", reason: "Sudden obstruction or camera orientation change requires operator review", thresholds };
  if (obstructed) return { status: "OBSTRUCTED", reason: "Camera view is substantially obstructed", thresholds };
  if (Number.isFinite(fps) && expectedFps > 0 && fps < expectedFps * thresholds.lowFpsRatio && lowFpsConfirmed) return { status: "LOW_FPS", reason: "Frame rate remains below the configured threshold", thresholds };
  if (Number(sample.latencyMs) > thresholds.highLatencyMs) return { status: "HIGH_LATENCY", reason: "Camera latency exceeds the configured threshold", thresholds };
  if (Number(sample.blurScore) > 0 && Number(sample.blurScore) <= thresholds.blurScoreMax) return { status: "BLURRY", reason: "Frame quality remains below the configured blur threshold", thresholds };
  if (Number(sample.brightnessScore) >= 0 && Number(sample.brightnessScore) < thresholds.brightnessScoreMin && sample.isNightScene !== true) return { status: "TOO_DARK", reason: "Frame brightness remains below the configured threshold", thresholds };
  if (Number(sample.latencyMs) > thresholds.warningLatencyMs) return { status: "DEGRADED", reason: "Camera latency is above the healthy operating range", thresholds };
  return { status: "ONLINE", reason: "Heartbeat, stream, frames, and configured quality checks are healthy", thresholds };
}

function alertCopy(camera, status, reason) {
  const cameraLabel = camera.cameraId || camera.id;
  const location = camera.location || camera.zone || "Unassigned location";
  const messages = {
    TAMPER_SUSPECTED: `Sudden camera obstruction or orientation change detected at ${location}. Possible physical tampering or damage requires operator review.`,
    TAMPER_CONFIRMED: `Camera tampering was confirmed at ${location}.`,
    NO_VIDEO_FRAMES: "Camera connection is active, but usable video frames are not being received. Inspect the encoder, video pipeline, or hardware.",
    NO_SIGNAL: "Camera is reachable, but its video stream is unavailable.",
    OFFLINE: "Camera cannot be reached. Check power, network, and camera hardware.",
    OBSTRUCTED: "Camera view is substantially obstructed. Inspect the camera and surrounding area.",
    STORAGE_ERROR: "Live monitoring may continue, but recording or evidence storage needs attention."
  };
  return { title: `${status.replaceAll("_", " ")} · ${cameraLabel}`, message: messages[status] || reason };
}

function preservePreFailureContext(camera, sample, result, timestamp) {
  if (!new Set(["TAMPER_SUSPECTED", "TAMPER_CONFIRMED", "OBSTRUCTED", "NO_VIDEO_FRAMES", "NO_SIGNAL"]).has(result.status)) return null;
  const refs = Array.isArray(sample.frameReferences) ? sample.frameReferences.slice(-20) : [];
  const capture = {
    id: `health_capture_${crypto.randomUUID()}`,
    status: result.status,
    capturedAt: timestamp,
    preEventSeconds: result.thresholds.preEventBufferSeconds,
    postEventSeconds: result.thresholds.postEventBufferSeconds,
    frameReferences: refs,
    available: refs.length > 0,
    note: refs.length ? "Frame references retained for evidence workflow review" : "No frame bytes were supplied by this camera telemetry adapter"
  };
  camera.healthPreservations = [...(camera.healthPreservations || []), capture].slice(-20);
  return capture;
}

function applyHealthSample(db, cameraId, sample = {}, options = {}) {
  const camera = (db.cameraSources || []).find((item) => item.id === cameraId || item.cameraId === cameraId);
  if (!camera) throw Object.assign(new Error("Camera source not found"), { status: 404 });
  const timestamp = iso(options.now || sample.observedAt);
  const result = evaluateCameraHealth(camera, sample, { now: timestamp, thresholds: db.cameraHealthThresholds });
  const previousStatus = String(camera.healthStatus || "UNKNOWN").toUpperCase();
  const changed = previousStatus !== result.status;
  const severity = healthSeverity(result.status, String(camera.criticality || "NORMAL").toUpperCase());
  Object.assign(camera, {
    healthStatus: result.status,
    healthSeverity: severity,
    status: result.status === "ONLINE" ? "online" : result.status === "OFFLINE" ? "offline" : "warning",
    expectedFps: Number(sample.expectedFps ?? camera.expectedFps ?? 25),
    lastHealthCheckAt: timestamp,
    lastHeartbeatAt: sample.heartbeatAt ? iso(sample.heartbeatAt) : camera.lastHeartbeatAt,
    lastStreamReceivedAt: sample.streamAvailable ? timestamp : camera.lastStreamReceivedAt,
    lastFrameReceivedAt: sample.frameAvailable ? timestamp : camera.lastFrameReceivedAt,
    lastHealthyAt: result.status === "ONLINE" ? timestamp : camera.lastHealthyAt,
    healthIssueStartedAt: result.status === "ONLINE" || result.status === "MAINTENANCE" ? null : changed ? timestamp : camera.healthIssueStartedAt || timestamp,
    healthReason: result.reason,
    healthTelemetry: { ...camera.healthTelemetry, ...sample, observedAt: timestamp, simulated: Boolean(sample.simulated) }
  });
  db.cameraHealthEvents = db.cameraHealthEvents || [];
  db.cameraHealthAlerts = db.cameraHealthAlerts || [];
  const createdEvents = [];
  const createdAlerts = [];
  const resolvedAlerts = [];
  if (changed) {
    const event = { id: `che_${crypto.randomUUID()}`, cameraId: camera.id, previousStatus, newStatus: result.status, severity, reason: result.reason, metrics: camera.healthTelemetry, startedAt: camera.healthIssueStartedAt || timestamp, createdAt: timestamp };
    db.cameraHealthEvents.push(event);
    createdEvents.push(event);
  }
  const preservation = changed ? preservePreFailureContext(camera, sample, result, timestamp) : null;
  if (result.status === "ONLINE") {
    for (const alert of db.cameraHealthAlerts.filter((item) => item.cameraId === camera.id && item.active)) {
      alert.status = "RESOLVED"; alert.active = false; alert.resolvedAt = timestamp; alert.resolvedBy = "system"; alert.updatedAt = timestamp;
      resolvedAlerts.push(alert);
    }
  } else if (result.status !== "MAINTENANCE") {
    const existing = db.cameraHealthAlerts.find((item) => item.cameraId === camera.id && item.alertType === result.status && item.active);
    if (!existing) {
      const copy = alertCopy(camera, result.status, result.reason);
      const alert = { id: `cha_${crypto.randomUUID()}`, cameraId: camera.id, alertType: result.status, severity, status: "ACTIVE", active: true, uniqueKey: `${camera.id}:${result.status}:${camera.healthIssueStartedAt || timestamp}`, title: copy.title, message: copy.message, startedAt: camera.healthIssueStartedAt || timestamp, metadata: { simulated: Boolean(sample.simulated), preservation }, createdAt: timestamp, updatedAt: timestamp };
      db.cameraHealthAlerts.push(alert);
      createdAlerts.push(alert);
    }
  }
  return { camera, status: result.status, severity, changed, createdEvents, createdAlerts, resolvedAlerts, preservation };
}

function acknowledgeHealthAlert(db, alertId, actor) {
  const alert = (db.cameraHealthAlerts || []).find((item) => item.id === alertId);
  if (!alert) throw Object.assign(new Error("Camera health alert not found"), { status: 404 });
  if (!alert.active) throw Object.assign(new Error("Resolved camera health alerts cannot be acknowledged"), { status: 409 });
  alert.status = "ACKNOWLEDGED"; alert.acknowledgedAt = new Date().toISOString(); alert.acknowledgedBy = actor.id; alert.updatedAt = alert.acknowledgedAt;
  return alert;
}

function setMaintenance(db, cameraId, body, actor) {
  const camera = (db.cameraSources || []).find((item) => item.id === cameraId || item.cameraId === cameraId);
  if (!camera) throw Object.assign(new Error("Camera source not found"), { status: 404 });
  if (body.enabled) {
    if (!String(body.reason || "").trim()) throw Object.assign(new Error("Maintenance reason is required"), { status: 400 });
    camera.maintenanceMode = true; camera.maintenanceReason = String(body.reason).trim(); camera.maintenanceStartedBy = actor.id; camera.maintenanceStartedAt = new Date().toISOString(); camera.maintenanceExpectedReturnAt = body.expectedReturnAt ? iso(body.expectedReturnAt) : null;
  } else {
    camera.maintenanceMode = false; camera.maintenanceReason = null; camera.maintenanceStartedBy = null; camera.maintenanceStartedAt = null; camera.maintenanceExpectedReturnAt = null;
  }
  return applyHealthSample(db, camera.id, { heartbeatAvailable: true, streamAvailable: true, frameAvailable: true, storageHealthy: true, simulated: Boolean(body.simulated) });
}

module.exports = { CAMERA_HEALTH_STATES, DEFAULT_THRESHOLDS, acknowledgeHealthAlert, applyHealthSample, evaluateCameraHealth, healthSeverity, setMaintenance };
