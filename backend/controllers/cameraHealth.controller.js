const { readDatabase, writeDatabase, userFromReq, hasRole } = require("../services/core.service");
const { acknowledgeHealthAlert, applyHealthSample, setMaintenance } = require("../services/cameraHealth.service");
const realtimeEvents = require("../services/realtimeEvents.service");

function requireRole(req, db, roles) {
  const user = userFromReq(req, db);
  if (!user) throw Object.assign(new Error("Authentication required"), { status: 401 });
  if (!hasRole(user, roles)) throw Object.assign(new Error("You do not have permission for this action"), { status: 403 });
  return user;
}

function emitResult(result) {
  const payload = { camera: result.camera, status: result.status, severity: result.severity, preservation: result.preservation };
  realtimeEvents.emit("camera_health_changed", payload);
  if (result.changed) realtimeEvents.emit(`camera_${String(result.status).toLowerCase()}`, payload);
  for (const alert of result.createdAlerts) realtimeEvents.emit("camera_health_alert_created", { alert, camera: result.camera });
  for (const alert of result.resolvedAlerts) realtimeEvents.emit("camera_health_alert_resolved", { alert, camera: result.camera });
}

exports.summary = async (req, res, next) => {
  try {
    const db = await readDatabase(); requireRole(req, db, ["Admin", "Police Officer"]);
    const cameras = db.cameraSources || [];
    const counts = cameras.reduce((result, camera) => { const key = String(camera.healthStatus || "UNKNOWN").toUpperCase(); result[key] = (result[key] || 0) + 1; return result; }, {});
    res.json({ cameras, counts, activeAlerts: (db.cameraHealthAlerts || []).filter((alert) => alert.active), thresholds: db.cameraHealthThresholds || {} });
  } catch (error) { next(error); }
};

exports.camera = async (req, res, next) => {
  try {
    const db = await readDatabase(); requireRole(req, db, ["Admin", "Police Officer"]);
    const camera = (db.cameraSources || []).find((item) => item.id === req.params.id || item.cameraId === req.params.id);
    if (!camera) return res.status(404).json({ error: "Camera source not found" });
    res.json({ camera, alerts: (db.cameraHealthAlerts || []).filter((alert) => alert.cameraId === camera.id), history: (db.cameraHealthEvents || []).filter((event) => event.cameraId === camera.id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)) });
  } catch (error) { next(error); }
};

exports.observe = async (req, res, next) => {
  try {
    const db = await readDatabase(); requireRole(req, db, ["Admin", "Police Officer"]);
    const result = applyHealthSample(db, req.params.id, req.body || {});
    await writeDatabase(db); emitResult(result); res.status(200).json(result);
  } catch (error) { next(error); }
};

exports.acknowledge = async (req, res, next) => {
  try {
    const db = await readDatabase(); const user = requireRole(req, db, ["Admin", "Police Officer"]);
    const alert = acknowledgeHealthAlert(db, req.params.id, user); await writeDatabase(db);
    realtimeEvents.emit("camera_health_alert_acknowledged", { alert }); res.json({ alert });
  } catch (error) { next(error); }
};

exports.maintenance = async (req, res, next) => {
  try {
    const db = await readDatabase(); const user = requireRole(req, db, ["Admin"]);
    const result = setMaintenance(db, req.params.id, req.body || {}, user); await writeDatabase(db); emitResult(result); res.json(result);
  } catch (error) { next(error); }
};

exports.thresholds = async (req, res, next) => {
  try {
    const db = await readDatabase(); requireRole(req, db, ["Admin"]);
    db.cameraHealthThresholds = { ...(db.cameraHealthThresholds || {}), ...(req.body || {}) }; await writeDatabase(db);
    res.json({ thresholds: db.cameraHealthThresholds });
  } catch (error) { next(error); }
};

exports.simulate = async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") return res.status(404).json({ error: "Not found" });
    const db = await readDatabase(); requireRole(req, db, ["Admin"]);
    const states = {
      healthy: { heartbeatAvailable: true, heartbeatAt: new Date().toISOString(), streamAvailable: true, frameAvailable: true, storageHealthy: true, fps: 25, lowFpsSamples: 0 },
      offline: { heartbeatAvailable: false }, no_signal: { heartbeatAvailable: true, heartbeatAt: new Date().toISOString(), streamAvailable: false },
      no_frames: { heartbeatAvailable: true, heartbeatAt: new Date().toISOString(), streamAvailable: true, frameAvailable: false },
      low_fps: { heartbeatAvailable: true, heartbeatAt: new Date().toISOString(), streamAvailable: true, frameAvailable: true, fps: 4, lowFpsSamples: 3 },
      high_latency: { heartbeatAvailable: true, heartbeatAt: new Date().toISOString(), streamAvailable: true, frameAvailable: true, latencyMs: 2501 },
      obstruction: { heartbeatAvailable: true, heartbeatAt: new Date().toISOString(), streamAvailable: true, frameAvailable: true, obstructionPercent: 0.95 },
      tamper: { heartbeatAvailable: true, heartbeatAt: new Date().toISOString(), streamAvailable: true, frameAvailable: true, obstructionPercent: 0.95, recentVisualActivity: true, suddenVisualChange: true },
      storage_failure: { heartbeatAvailable: true, heartbeatAt: new Date().toISOString(), streamAvailable: true, frameAvailable: true, storageHealthy: false }
    };
    const state = states[String(req.body?.state || "").toLowerCase()];
    if (!state) return res.status(400).json({ error: "Unsupported camera health simulation state" });
    const result = applyHealthSample(db, req.params.id, { ...state, simulated: true }); await writeDatabase(db); emitResult(result); res.json(result);
  } catch (error) { next(error); }
};
