const crypto = require("node:crypto");
const aiService = require("../services/ai.service");
const alertsRepository = require("../repositories/alerts.repository");
const incidentsRepository = require("../repositories/incidents.repository");
const missingPersonsRepository = require("../repositories/missingPersons.repository");
const { getDatabaseMode, withTransaction } = require("../services/postgres.service");
const {
  readDatabase,
  writeDatabase,
  userFromReq,
  hasRole
} = require("../services/core.service");

const VALID_SOURCE_TYPES = new Set([
  "live_camera",
  "phone_camera",
  "cctv",
  "uploaded_video",
  "upload",
  "missing_person_scan",
  "missing_object_scan"
]);
const DEDUPE_WINDOW_MS = 60_000;

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_500_000) {
        reject(Object.assign(new Error("Request payload is too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(Object.assign(new Error("Invalid JSON payload"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function imageBase64(body) {
  return String(body.imageBase64 || body.image || "").trim();
}

function validatePayload(body, user) {
  const sourceType = String(body.sourceType || "").trim();
  const sourceId = String(body.sourceId || "").trim().slice(0, 120);
  const sourceName = String(body.sourceName || "").trim().slice(0, 120);
  const zone = String(body.zone || "").trim().slice(0, 120);
  const image = imageBase64(body);
  if (!VALID_SOURCE_TYPES.has(sourceType)) throw Object.assign(new Error("Invalid sourceType"), { status: 400 });
  if (!sourceName) throw Object.assign(new Error("sourceName is required"), { status: 400 });
  if (!image || (!image.startsWith("data:image/") && image.length < 32)) {
    throw Object.assign(new Error("Valid base64 image frame is required"), { status: 400 });
  }
  if (image.length > 1_200_000) throw Object.assign(new Error("Image frame is too large"), { status: 413 });
  const citizenSource = ["live_camera", "phone_camera"].includes(sourceType) && body.sosMode === true;
  if (user.role === "Citizen" && !citizenSource) {
    throw Object.assign(new Error("Citizens can only submit emergency live-camera scans in SOS mode"), { status: 403 });
  }
  return {
    sourceType: sourceType === "phone_camera" ? "live_camera"
      : sourceType === "upload" ? "uploaded_video"
        : sourceType,
    sourceId: sourceId || null,
    sourceName,
    zone: zone || "Unassigned",
    timestamp: body.timestamp && !Number.isNaN(Date.parse(body.timestamp))
      ? new Date(body.timestamp).toISOString()
      : new Date().toISOString(),
    imageBase64: image,
    missingPersonContext: {
      enabled: Boolean(body.missingPersonContext?.enabled),
      missingPersonIds: Array.isArray(body.missingPersonContext?.missingPersonIds)
        ? body.missingPersonContext.missingPersonIds.map(String).slice(0, 100)
        : []
    },
    missingObjectContext: {
      enabled: Boolean(body.missingObjectContext?.enabled),
      missingObjectIds: Array.isArray(body.missingObjectContext?.missingObjectIds)
        ? body.missingObjectContext.missingObjectIds.map(String).slice(0, 100)
        : [],
      description: String(body.missingObjectContext?.description || "").slice(0, 500),
      referenceImageBase64: String(body.missingObjectContext?.referenceImageBase64 || "").slice(0, 1_200_000) || null
    }
  };
}

function active(record) {
  return !["closed", "resolved"].includes(String(record.status || "").toLowerCase());
}

function dedupeKey(payload, threatType) {
  return [payload.sourceId || payload.sourceName, threatType, payload.zone]
    .map((value) => String(value || "").trim().toLowerCase())
    .join("|");
}

function persistActionableDetection(db, result, payload) {
  const timestamp = payload.timestamp;
  const key = dedupeKey(payload, result.threatType);
  const cutoff = new Date(timestamp).getTime() - DEDUPE_WINDOW_MS;
  const existingAlert = db.alerts.find((alert) =>
    active(alert)
    && alert.dedupeKey === key
    && new Date(alert.lastDetectedAt || alert.createdAt || 0).getTime() >= cutoff
  );
  if (existingAlert) {
    existingAlert.occurrenceCount = Math.max(1, Number(existingAlert.occurrenceCount) || 1) + 1;
    existingAlert.lastDetectedAt = timestamp;
    existingAlert.maxConfidence = Math.max(Number(existingAlert.maxConfidence) || 0, result.confidence);
    existingAlert.confidence = existingAlert.maxConfidence;
    const incident = db.incidents.find((item) => item.id === existingAlert.incidentId);
    if (incident) {
      incident.occurrenceCount = existingAlert.occurrenceCount;
      incident.lastDetectedAt = timestamp;
      incident.maxConfidence = Math.max(Number(incident.maxConfidence) || 0, result.confidence);
      incident.confidence = incident.maxConfidence;
    }
    return { alert: existingAlert, incident: incident || null, deduplicated: true };
  }

  const possiblePersonMatch = result.threatType === "missing_person_possible_match";
  const possibleObjectMatch = result.threatType === "missing_object_possible_match";
  const possibleDamagedObject = result.threatType === "damaged_object_possible";
  const possibleDamagedObjectMatch = result.threatType === "missing_object_damaged_possible_match";
  const verificationRequired = possiblePersonMatch
    || possibleObjectMatch
    || possibleDamagedObject
    || possibleDamagedObjectMatch;
  const forceHighSeverity = possiblePersonMatch
    || possibleObjectMatch
    || possibleDamagedObjectMatch;
  const message = possiblePersonMatch
    ? "Possible missing person match detected. Human verification required."
    : possibleObjectMatch
      ? "Possible Missing Object Match - Human Verification Required"
      : possibleDamagedObject
        ? "Object detected with possible damage. Human verification required."
        : possibleDamagedObjectMatch
          ? "Possible missing object match detected with possible damage. Human verification required."
          : result.message;
  const alert = {
    id: id("alt"),
    incidentId: null,
    title: message,
    message,
    type: result.threatType,
    threatType: result.threatType,
    severity: forceHighSeverity ? "high" : result.severity,
    zone: payload.zone,
    sourceId: payload.sourceId,
    sourceType: payload.sourceType,
    sourceName: payload.sourceName,
    confidence: result.confidence,
    maxConfidence: result.confidence,
    occurrenceCount: 1,
    lastDetectedAt: timestamp,
    status: "Pending Review",
    reviewStatus: "pending_review",
    verificationStatus: verificationRequired ? "human_verification_required" : null,
    personMatch: possiblePersonMatch ? result.personMatch : null,
    objectMatch: possibleObjectMatch || possibleDamagedObjectMatch ? result.objectMatch : null,
    objectCondition: possibleDamagedObject || possibleDamagedObjectMatch ? result.objectCondition : null,
    detections: result.detections,
    vehicleAnalysis: result.vehicleAnalysis,
    personAnalysis: result.personAnalysis,
    objectAnalysis: result.objectAnalysis,
    personIdentity: result.personIdentity,
    alertClassification: result.alertClassification,
    performance: result.performance,
    frameTimestamp: timestamp,
    threatLevel: forceHighSeverity ? "high" : result.severity,
    acknowledged: false,
    createdAt: timestamp,
    dedupeKey: key
  };
  db.alerts.unshift(alert);
  return { alert, incident: null, deduplicated: false };
}

async function writeAiChanges(db, alert, incident, report = null) {
  if (getDatabaseMode() === "json") {
    await writeDatabase(db);
    return;
  }
  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [724211]);
    if (incident) await incidentsRepository.upsert(incident, client);
    if (alert) await alertsRepository.upsert(alert, client);
    if (report) await missingPersonsRepository.upsert(report, client);
    await client.query(
      `INSERT INTO app_state (key, data)
       VALUES ('operational', jsonb_build_object('detections', $1::jsonb))
       ON CONFLICT (key) DO UPDATE
       SET data = jsonb_set(app_state.data, '{detections}', $1::jsonb, true),
           updated_at = NOW()`,
      [JSON.stringify(db.detections || [])]
    );
  });
}

async function authenticate(req, roles) {
  const db = await readDatabase();
  const user = userFromReq(req, db);
  if (!user) throw Object.assign(new Error("Authentication required"), { status: 401 });
  if (roles && !hasRole(user, roles)) {
    throw Object.assign(new Error("You do not have permission for this action"), { status: 403 });
  }
  return { db, user };
}

exports.health = async (req, res, next) => {
  try {
    await authenticate(req);
    res.json(await aiService.health());
  } catch (error) {
    next(error);
  }
};

exports.analyzeFrame = async (req, res, next) => {
  try {
    const { db, user } = await authenticate(req);
    if (!hasRole(user, ["Police Officer", "Admin"])) {
      return res.status(403).json({ message: "Access denied" });
    }
    const body = await readBody(req);
    const payload = validatePayload(body, user);
    if (["cctv", "uploaded_video", "missing_person_scan", "missing_object_scan"].includes(payload.sourceType)
      && !hasRole(user, ["Police Officer", "Admin"])) {
      return res.status(403).json({ error: "CCTV and monitoring AI is restricted to Police and Admin users" });
    }
    const analyzed = await aiService.analyzeFrame(payload);
    const result = aiService.evaluateResult(analyzed);
    let alert = null;
    let incident = null;
    let deduplicated = false;

    const reviewableObservation = !result.actionable
      && result.threatType !== "no_threat"
      && result.detections.length > 0;
    if ((result.actionable || reviewableObservation) && !result.duplicateSuppressed) {
      ({ alert, incident, deduplicated } = persistActionableDetection(db, result, payload));
      if (reviewableObservation && alert) {
        alert.operationalAlert = false;
        alert.alertClassification = "observation";
        alert.severity = "low";
        alert.title = `${result.message}. Human review available.`;
        alert.message = alert.title;
      }
    } else if ((result.actionable || reviewableObservation) && result.duplicateSuppressed) {
      deduplicated = true;
    }

    const detection = {
      id: id("det"),
      sourceId: payload.sourceId,
      sourceType: payload.sourceType,
      sourceName: payload.sourceName,
      zone: payload.zone,
      timestamp: payload.timestamp,
      configured: result.configured,
      threatDetected: result.threatDetected,
      threatType: result.threatType,
      confidence: result.confidence,
      threshold: result.threshold,
      actionable: result.actionable,
      reason: result.reason,
      message: result.message,
      detections: result.detections,
      personMatch: result.personMatch,
      objectMatch: result.objectMatch,
      objectCondition: result.objectCondition,
      alertClassification: result.alertClassification,
      performance: result.performance,
      vehicleAnalysis: result.vehicleAnalysis,
      personAnalysis: result.personAnalysis,
      objectAnalysis: result.objectAnalysis,
      personIdentity: result.personIdentity,
      duplicateSuppressed: result.duplicateSuppressed
    };
    db.detections = [detection, ...(db.detections || [])].slice(0, 100);
    if (alert) await writeAiChanges(db, alert, incident);

    res.json({ ...result, detection, alert, incident, deduplicated });
  } catch (error) {
    next(error);
  }
};

exports.runScan = async (req, res, next) => {
  try {
    const { db } = await authenticate(req, ["Police Officer", "Admin"]);
    const report = db.reports.find((item) => !["found", "closed"].includes(String(item.status || "").toLowerCase()));
    if (!report?.image) {
      return res.status(400).json({ error: "An active missing-person report with a photo is required" });
    }
    const source = db.cameraSources.find((item) => item.type === "cctv");
    const payload = {
      sourceType: "missing_person_scan",
      sourceId: source?.id || null,
      sourceName: source?.name || "Missing Person Scan",
      zone: source?.zone || "Unassigned",
      timestamp: new Date().toISOString(),
      imageBase64: report.image,
      missingPersonContext: { enabled: true, missingPersonIds: [report.id] }
    };
    const result = aiService.evaluateResult(await aiService.analyzeFrame(payload));
    let persisted = { alert: null, incident: null, deduplicated: false };
    if (result.actionable && result.threatType === "missing_person_possible_match") {
      persisted = persistActionableDetection(db, result, payload);
      report.status = "possible_match";
      report.matchConfidence = result.confidence;
      report.verificationStatus = "human_verification_required";
      await writeAiChanges(db, persisted.alert, persisted.incident, report);
    }
    res.json({ ...result, report, ...persisted });
  } catch (error) {
    next(error);
  }
};
