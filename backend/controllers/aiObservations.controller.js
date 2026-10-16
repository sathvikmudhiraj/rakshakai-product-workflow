const { readDatabase, writeSelectedRecords, userFromReq, hasRole } = require("../services/core.service");
const {
  reviewObservation,
  safeObservation,
  observationFrame,
  repositories
} = require("../services/aiObservation.service");
const realtimeEvents = require("../services/realtimeEvents.service");

function requireOperator(req, db) {
  const user = userFromReq(req, db);
  if (!user) throw Object.assign(new Error("Authentication required"), { status: 401 });
  if (!hasRole(user, ["Admin", "Police Officer"])) {
    throw Object.assign(new Error("You do not have permission for this action"), { status: 403 });
  }
  return user;
}

function findObservation(db, id) {
  const observation = (db.aiObservations || []).find((item) => item.id === id);
  if (!observation) throw Object.assign(new Error("AI observation not found"), { status: 404 });
  return observation;
}

exports.list = async (req, res, next) => {
  try {
    const db = await readDatabase(); requireOperator(req, db);
    const status = String(req.query.status || "").toUpperCase();
    const cameraId = String(req.query.cameraId || "");
    const observations = (db.aiObservations || [])
      .filter((item) => !status || item.status === status)
      .filter((item) => !cameraId || item.cameraId === cameraId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 250)
      .map(safeObservation);
    res.json({ observations, pendingCount: observations.filter((item) => item.status === "PENDING_REVIEW").length });
  } catch (error) { next(error); }
};
exports.get = async (req, res, next) => {
  try {
    const db = await readDatabase(); requireOperator(req, db);
    res.json({ observation: safeObservation(findObservation(db, req.params.id)) });
  } catch (error) { next(error); }
};

exports.frame = async (req, res, next) => {
  try {
    const db = await readDatabase(); requireOperator(req, db);
    const observation = findObservation(db, req.params.id);
    const frame = await observationFrame(observation);
    if (!frame) return res.status(404).json({ error: "Observation frame is not available" });
    res.setHeader("Content-Type", observation.frameStorage?.mimeType || "image/jpeg");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(frame);
  } catch (error) { next(error); }
};

exports.review = async (req, res, next) => {
  try {
    const db = await readDatabase(); const user = requireOperator(req, db);
    const result = reviewObservation(db, findObservation(db, req.params.id), req.body?.decision, user, req.body?.notes);
    const records = [[repositories.aiObservationsRepository, [result.observation]], [repositories.auditLogsRepository, result.audits || [result.audit]]];
    if (result.alert) records.push([repositories.alertsRepository, [result.alert]]);
    await writeSelectedRecords(db, records);
    const payload = { observation: safeObservation(result.observation), alert: result.alert };
    realtimeEvents.emit("observation_reviewed", payload);
    if (result.alert) realtimeEvents.emit("alert_created_from_observation", payload);
    res.json(payload);
  } catch (error) { next(error); }
};

