const crypto = require("node:crypto");
const aiService = require("../services/ai.service");
const alertsRepository = require("../repositories/alerts.repository");
const incidentsRepository = require("../repositories/incidents.repository");
const missingPersonsRepository = require("../repositories/missingPersons.repository");
const auditLogsRepository = require("../repositories/auditLogs.repository");
const { getDatabaseMode, withTransaction } = require("../services/postgres.service");
const {
  readDatabase,
  writeDatabase,
  userFromReq,
  hasRole
} = require("../services/core.service");

const VALID_SOURCE_TYPES = new Set([
  "browser_camera",
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

function alertSourceForPayload(payload) {
  if (payload.isDemo) return "demo_seed";
  if (["uploaded_video", "upload"].includes(payload.sourceType)) return "video_upload";
  if (payload.sourceType === "cctv") return "cctv_scan";
  if (["browser_camera", "live_camera", "phone_camera"].includes(payload.sourceType)) return "browser_camera";
  return "ai_observation";
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
  return {
    sourceType: ["phone_camera", "live_camera", "browser_camera"].includes(sourceType) ? "browser_camera"
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

const GENERIC_OBJECT_TOKENS = new Set([
  "and",
  "case",
  "found",
  "item",
  "last",
  "lost",
  "match",
  "missing",
  "near",
  "object",
  "possible",
  "property",
  "report",
  "seen",
  "the",
  "thing",
  "with"
]);
const COLOR_TOKENS = new Set([
  "black",
  "blue",
  "brown",
  "gold",
  "green",
  "grey",
  "gray",
  "orange",
  "pink",
  "purple",
  "red",
  "silver",
  "white",
  "yellow"
]);
const OBJECT_TOKEN_ALIASES = {
  backpack: ["bag", "rucksack"],
  bicycle: ["bike", "cycle"],
  bike: ["bicycle", "cycle"],
  cellphone: ["cell", "mobile", "phone"],
  handbag: ["bag", "purse"],
  laptop: ["computer"],
  mobile: ["cell", "phone"],
  phone: ["cell", "mobile"],
  suitcase: ["bag", "luggage"],
  wallet: ["purse"]
};

function normalizeTextTokens(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function meaningfulObjectTokens(value) {
  return normalizeTextTokens(value).filter((token) => !GENERIC_OBJECT_TOKENS.has(token));
}

function expandObjectTokens(tokens) {
  const expanded = new Set(tokens);
  tokens.forEach((token) => {
    (OBJECT_TOKEN_ALIASES[token] || []).forEach((alias) => expanded.add(alias));
  });
  return expanded;
}

function tokenOverlap(left, right) {
  return [...left].filter((token) => right.has(token));
}

function colorTokens(value) {
  return new Set(meaningfulObjectTokens(value).filter((token) => COLOR_TOKENS.has(token)));
}

function dateWithinDays(left, right, days) {
  if (!left || !right || Number.isNaN(Date.parse(left)) || Number.isNaN(Date.parse(right))) return false;
  return Math.abs(new Date(left).getTime() - new Date(right).getTime()) <= days * 24 * 60 * 60 * 1000;
}

function activeMissingObjectReports(db, payload) {
  const allowed = payload.missingObjectContext?.enabled && payload.missingObjectContext.missingObjectIds.length
    ? new Set(payload.missingObjectContext.missingObjectIds)
    : null;
  return (db.reports || []).filter((report) => {
    if (allowed && !allowed.has(report.id)) return false;
    const status = String(report.status || "").toLowerCase();
    if (["closed", "resolved", "found", "rejected", "false_alarm"].includes(status)) return false;
    const kind = `${report.reportType || ""} ${report.category || ""} ${report.type || ""}`.toLowerCase();
    return /missing[_\s-]?object|lost[_\s-]?property|object|property/.test(kind);
  });
}

function objectDetections(result) {
  const vehicleLabels = new Set(["car", "truck", "bus", "motorcycle", "bicycle", "auto", "vehicle"]);
  const all = [
    ...(Array.isArray(result.objectAnalysis) ? result.objectAnalysis : []),
    ...(Array.isArray(result.detections) ? result.detections : [])
  ];
  const seen = new Set();
  return all
    .map((item) => ({
      label: String(item.label || item.objectType || item.detectedObject || item.type || "").toLowerCase(),
      confidence: Number(item.confidence) || Number(result.confidence) || 0,
      dominantColor: String(item.dominantColor || item.color || "").toLowerCase(),
      box: item.box || item.boundingBox || null
    }))
    .filter((item) => item.label && item.label !== "person" && !vehicleLabels.has(item.label))
    .filter((item) => {
      const key = `${item.label}|${item.dominantColor}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function missingObjectMatchForDetection(report, detection, payload) {
  const reportIdentityText = [
    report.name,
    report.description,
    report.category,
    report.reportType,
    report.objectType,
    report.itemType,
    report.brand,
    report.model,
    report.serialNumber,
    report.registrationNumber,
    report.identifyingMarks
  ].filter(Boolean).join(" ");
  const reportTokens = expandObjectTokens(meaningfulObjectTokens(reportIdentityText));
  const detectionTokens = expandObjectTokens(meaningfulObjectTokens(`${detection.label} ${detection.objectType || ""}`));
  const mandatoryOverlap = tokenOverlap(detectionTokens, reportTokens);
  if (!mandatoryOverlap.length) return null;

  const reportColorTokens = colorTokens([
    report.color,
    report.dominantColor,
    report.name,
    report.description
  ].filter(Boolean).join(" "));
  const detectionColorTokens = colorTokens(`${detection.dominantColor || ""} ${detection.color || ""}`);
  const colorOverlap = tokenOverlap(detectionColorTokens, reportColorTokens);
  if (reportColorTokens.size && detectionColorTokens.size && !colorOverlap.length) return null;

  const locationTokens = new Set(meaningfulObjectTokens(`${report.lastSeenLocation || ""} ${report.address || ""}`));
  const payloadLocationTokens = new Set(meaningfulObjectTokens(`${payload.zone || ""} ${payload.sourceName || ""}`));
  const locationOverlap = tokenOverlap(payloadLocationTokens, locationTokens);

  const distinctiveTokens = new Set(meaningfulObjectTokens([
    report.brand,
    report.model,
    report.serialNumber,
    report.registrationNumber,
    report.identifyingMarks
  ].filter(Boolean).join(" ")));
  const distinctiveOverlap = tokenOverlap(detectionTokens, distinctiveTokens);
  const timeRelevant = dateWithinDays(report.lastSeenAt || report.updatedAt || report.createdAt, payload.timestamp, 30);

  const supportAvailable = reportColorTokens.size
    || detectionColorTokens.size
    || locationTokens.size
    || distinctiveTokens.size
    || Boolean(report.lastSeenAt || report.updatedAt || report.createdAt);
  const supportCount = [
    colorOverlap.length > 0,
    locationOverlap.length > 0,
    distinctiveOverlap.length > 0,
    timeRelevant
  ].filter(Boolean).length;
  if (supportAvailable && supportCount === 0) return null;

  const detectorConfidence = Math.max(0, Math.min(1, Number(detection.confidence) || 0));
  const score = Math.min(0.94,
    0.36
    + Math.min(0.2, mandatoryOverlap.length * 0.1)
    + (colorOverlap.length ? 0.18 : 0)
    + (locationOverlap.length ? 0.12 : 0)
    + (distinctiveOverlap.length ? 0.1 : 0)
    + (timeRelevant ? 0.04 : 0)
    + detectorConfidence * 0.04
  );
  return score >= 0.58 ? { report, detection, confidence: score } : null;
}

function findMissingObjectMatches(db, result, payload) {
  const detections = objectDetections(result);
  if (!detections.length) return [];
  const reports = activeMissingObjectReports(db, payload);
  const matches = [];
  for (const detection of detections) {
    for (const report of reports) {
      const match = missingObjectMatchForDetection(report, detection, payload);
      if (match) matches.push(match);
    }
  }
  return matches
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 1);
}

function observationFromMissingObjectMatch(db, match, payload, result) {
  const timestamp = payload.timestamp;
  const alert = {
    id: id("alt"),
    incidentId: null,
    linkedIncidentId: null,
    linkedReportId: match.report.id,
    title: "Possible missing object match found - Please verify",
    message: "Possible missing object match found - Please verify",
    type: "missing_object_possible_match",
    threatType: "missing_object_possible_match",
    detectionType: "missing_object_possible_match",
    severity: "medium",
    zone: payload.zone,
    sourceId: payload.sourceId,
    source: "browser_camera",
    sourceType: "browser_camera",
    sourceName: payload.sourceName,
    locationSource: "browser_gps",
    confidence: match.confidence,
    maxConfidence: match.confidence,
    occurrenceCount: 1,
    lastDetectedAt: timestamp,
    status: "Pending Review",
    reviewStatus: "pending_review",
    verificationStatus: "human_verification_required",
    humanVerificationRequired: true,
    actionable: false,
    operationalAlert: false,
    alertClassification: "observation",
    objectMatch: {
      possibleMatch: true,
      linkedReportId: match.report.id,
      matchedObjectType: match.detection.label,
      confidence: match.confidence,
      status: "pending_review",
      message: "Possible missing object match found - Please verify"
    },
    matchedObjectType: match.detection.label,
    detections: [match.detection],
    objectAnalysis: result.objectAnalysis,
    personIdentity: { identified: false, status: "unsupported" },
    performance: result.performance,
    frameTimestamp: timestamp,
    threatLevel: "medium",
    acknowledged: false,
    createdBy: "system",
    createdByRole: "System/AI",
    createdAt: timestamp,
    dedupeKey: dedupeKey(payload, `missing_object_possible_match|${match.report.id}|${match.detection.label}`)
  };
  db.alerts.unshift(alert);
  db.auditLogs.unshift({
    id: id("aud"),
    actorName: "RakshakAI System",
    actorId: null,
    action: "ai_observation_created",
    incidentId: null,
    details: `${alert.id}: browser_camera missing object possible match ${match.report.id}`,
    timestamp
  });
  return alert;
}

function active(record) {
  return !["closed", "resolved"].includes(String(record.status || "").toLowerCase());
}

function cameraHasStreamConfig(source) {
  return Boolean(String(source?.streamUrl || source?.rtspUrl || source?.hlsUrl || source?.onvifUrl || "").trim());
}

function isDemoCameraSource(source) {
  const type = String(source?.type || source?.sourceType || "").toLowerCase();
  return source?.isDemo === true || source?.sourceType === "demo_seed" || type === "demo";
}

function validateCameraPayload(db, payload) {
  if (payload.sourceType !== "cctv") return payload;
  const source = db.cameraSources.find((item) =>
    (payload.sourceId && item.id === payload.sourceId)
    || item.name === payload.sourceName
  );
  if (!source) throw Object.assign(new Error("Registered camera source is required for CCTV analysis"), { status: 404 });
  if (isDemoCameraSource(source)) {
    return { ...payload, isDemo: true, sourceId: source.id, sourceName: source.name, zone: source.zone || source.location || payload.zone };
  }
  if (!cameraHasStreamConfig(source)) {
    throw Object.assign(new Error("Camera stream configuration is missing"), { status: 409 });
  }
  if (source.aiEnabled !== true) {
    throw Object.assign(new Error("AI analysis is disabled for this camera"), { status: 409 });
  }
  return {
    ...payload,
    isDemo: false,
    sourceId: source.id,
    sourceName: source.name,
    zone: source.zone || source.location || payload.zone
  };
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
    linkedIncidentId: null,
    title: message,
    message,
    type: result.threatType,
    threatType: result.threatType,
    severity: forceHighSeverity ? "high" : result.severity,
    zone: payload.zone,
    sourceId: payload.sourceId,
    source: alertSourceForPayload(payload),
    isDemo: Boolean(payload.isDemo),
    actionable: payload.isDemo ? false : result.operationalAlert !== false && result.alertClassification !== "observation",
    sourceType: payload.isDemo ? "demo_seed" : payload.sourceType,
    sourceName: payload.sourceName,
    locationSource: payload.sourceType === "browser_camera" ? "browser_gps" : "unknown",
    confidence: result.confidence,
    maxConfidence: result.confidence,
    occurrenceCount: 1,
    lastDetectedAt: timestamp,
    status: "Pending Review",
    reviewStatus: "pending_review",
    verificationStatus: verificationRequired ? "human_verification_required" : null,
    humanVerificationRequired: verificationRequired || payload.sourceType === "browser_camera",
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
    createdBy: "system",
    createdByRole: "System/AI",
    createdAt: timestamp,
    dedupeKey: key
  };
  db.alerts.unshift(alert);
  db.auditLogs.unshift({
    id: id("aud"),
    actorName: "RakshakAI System",
    actorId: null,
    action: "ai_alert_created",
    incidentId: null,
    details: `${alert.id}: ${alert.source}`,
    timestamp
  });
  return { alert, incident: null, deduplicated: false };
}

function uniqueById(records) {
  return [...new Map(records.filter(Boolean).map((record) => [record.id, record])).values()];
}

function auditLogsForAiAlerts(db, alerts) {
  const alertIds = new Set(alerts.filter(Boolean).map((alert) => alert.id));
  if (!alertIds.size) return [];
  return (db.auditLogs || []).filter((log) => {
    const details = String(log.details || "");
    return [...alertIds].some((alertId) => details.includes(alertId));
  });
}

async function persistAiAnalysisChanges(db, changes = {}, options = {}) {
  const alerts = uniqueById(changes.alerts || (changes.alert ? [changes.alert] : []));
  const incidents = uniqueById([
    ...(changes.incidents || []),
    changes.incident || null
  ]);
  const reports = uniqueById(changes.reports || (changes.report ? [changes.report] : []));
  const auditLogs = uniqueById(changes.auditLogs || auditLogsForAiAlerts(db, alerts));
  const detections = changes.detections || db.detections || [];
  const databaseMode = options.databaseMode || getDatabaseMode();
  if (databaseMode === "json") {
    await (options.writeDatabase || writeDatabase)(db);
    return;
  }
  const repositories = {
    incidents: incidentsRepository,
    alerts: alertsRepository,
    reports: missingPersonsRepository,
    auditLogs: auditLogsRepository,
    ...(options.repositories || {})
  };
  await (options.withTransaction || withTransaction)(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [724211]);
    for (const incident of incidents) await repositories.incidents.upsert(incident, client);
    for (const alert of alerts) await repositories.alerts.upsert(alert, client);
    for (const report of reports) await repositories.reports.upsert(report, client);
    for (const audit of auditLogs) await repositories.auditLogs.upsert(audit, client);
    await client.query(
      `INSERT INTO app_state (key, data)
       VALUES ('operational', jsonb_build_object('detections', $1::jsonb))
       ON CONFLICT (key) DO UPDATE
       SET data = jsonb_set(app_state.data, '{detections}', $1::jsonb, true),
            updated_at = NOW()`,
      [JSON.stringify(detections)]
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
    const { db, user } = await authenticate(req, ["Police Officer", "Admin"]);
    const body = await readBody(req);
    const payload = validateCameraPayload(db, validatePayload(body, user));
    const analyzed = await aiService.analyzeFrame(payload);
    const result = aiService.evaluateResult(analyzed);
    let alert = null;
    let incident = null;
    let deduplicated = false;
    const observations = [];

    const reviewableObservation = !result.actionable
      && result.threatType !== "no_threat"
      && result.detections.length > 0;
    if ((result.actionable || reviewableObservation) && !result.duplicateSuppressed) {
      ({ alert, incident, deduplicated } = persistActionableDetection(db, result, payload));
      if (reviewableObservation && alert) {
        alert.operationalAlert = false;
        alert.alertClassification = "observation";
        alert.actionable = false;
        alert.severity = "low";
        alert.verificationStatus = "human_verification_required";
        alert.humanVerificationRequired = true;
        alert.title = `Possible ${String(result.threatType || "detection").replace(/_/g, " ")} detected. Human review required.`;
        alert.message = alert.title;
      }
      if (payload.isDemo && alert) {
        alert.operationalAlert = false;
        alert.alertClassification = "observation";
        alert.actionable = false;
        alert.severity = "low";
        alert.title = `Demo AI observation sample: ${result.message}`;
        alert.message = `${alert.title}. Simulated feed only.`;
      }
      if (alert) observations.push(alert);
    } else if ((result.actionable || reviewableObservation) && result.duplicateSuppressed) {
      deduplicated = true;
    }

    if (payload.sourceType === "browser_camera" && result.configured && !result.serviceError && result.detections.length) {
      for (const match of findMissingObjectMatches(db, result, payload)) {
        const matchObservation = observationFromMissingObjectMatch(db, match, payload, result);
        observations.push(matchObservation);
      }
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
    if (observations.length) {
      await persistAiAnalysisChanges(db, {
        alerts: observations,
        incident,
        detections: db.detections
      });
    }

    res.json({ ...result, detection, alert, incident, observations, deduplicated });
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
      await persistAiAnalysisChanges(db, {
        alerts: [persisted.alert],
        incident: persisted.incident,
        reports: [report],
        detections: db.detections
      });
    }
    res.json({ ...result, report, ...persisted });
  } catch (error) {
    next(error);
  }
};

exports.__testables = {
  findMissingObjectMatches,
  missingObjectMatchForDetection,
  persistAiAnalysisChanges
};
