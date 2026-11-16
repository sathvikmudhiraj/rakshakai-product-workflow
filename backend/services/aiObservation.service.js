const crypto = require("node:crypto");
const aiObservationsRepository = require("../repositories/aiObservations.repository");
const alertsRepository = require("../repositories/alerts.repository");
const auditLogsRepository = require("../repositories/auditLogs.repository");
const { readDatabase, writeSelectedRecords, addAuditLog } = require("./core.service");
const { writeEvidenceObject, readEvidenceObject, cleanupEvidenceObject } = require("./evidenceStorage.service");

// YOLOv8n uses the COCO label set. Keep this allow-list explicit so the UI
// never claims support for a class the deployed detector cannot identify.
const SUPPORTED_LABELS = new Set([
  "person", "car", "truck", "bus", "motorcycle", "bicycle",
  "backpack", "handbag", "suitcase", "umbrella", "bottle", "cell phone", "laptop",
  "bird", "cat", "dog", "horse", "sheep", "cow"
]);
const REVIEW_STATES = new Set(["PENDING_REVIEW", "CONFIRMED", "REJECTED", "UNCERTAIN"]);
const DEDUPE_WINDOW_MS = Math.max(1_000, Number(process.env.AI_OBSERVATION_DEDUPE_MS || 15_000));
let persistenceQueue = Promise.resolve();

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function iso(value, fallback = new Date().toISOString()) {
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : fallback;
}

function confidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed > 1 ? parsed / 100 : parsed));
}

function normalizedBox(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const box = value.map(Number);
  return box.every(Number.isFinite) ? box : null;
}

function normalizeDetections(result) {
  return (Array.isArray(result?.detections) ? result.detections : [])
    .map((item) => ({
      label: String(item?.label || item?.className || "").trim().toLowerCase(),
      confidence: confidence(item?.confidence ?? item?.score),
      boundingBox: normalizedBox(item?.boundingBox || item?.box),
      classId: Number.isInteger(Number(item?.classId)) ? Number(item.classId) : null
    }))
    .filter((item) => SUPPORTED_LABELS.has(item.label));
}

function normalizeAiResult(result, { camera, capturedAt, processedAt = new Date().toISOString(), frameReference = null } = {}) {
  if (!camera?.id) throw new Error("Registered camera is required for an AI observation");
  const detections = normalizeDetections(result);
  return {
    cameraId: camera.id,
    cameraName: camera.name || camera.cameraId || camera.id,
    zone: camera.zone || camera.location || "Unassigned",
    capturedAt: iso(capturedAt),
    processedAt: iso(processedAt),
    model: String(result?.model || "YOLO detector").slice(0, 80),
    modelVersion: result?.modelVersion ? String(result.modelVersion).slice(0, 80) : null,
    frameReference,
    detections,
    reason: camera.restrictedZone
      ? "Potential restricted-zone activity. Human verification required."
      : "Supported object detection requires human verification.",
    cameraHealthAtCapture: {
      streamState: camera.streamState || "UNKNOWN",
      gatewayHealth: camera.gatewayHealth || "UNKNOWN",
      frameAgeMs: Number.isFinite(Number(camera.frameAgeMs)) ? Number(camera.frameAgeMs) : null,
      fps: Number.isFinite(Number(camera.measuredFps ?? camera.fps)) ? Number(camera.measuredFps ?? camera.fps) : null,
      latencyMs: Number.isFinite(Number(camera.latencyMs)) ? Number(camera.latencyMs) : null
    },
    aiStateAtCapture: camera.aiState || "AI_READY"
  };
}

function signature(record) {
  return record.detections.map((item) => item.label).sort().join("|");
}

function isWithinDedupeWindow(existing, capturedAt) {
  const existingMs = Date.parse(existing?.lastDetectedAt || existing?.capturedAt);
  const capturedAtMs = Date.parse(capturedAt);
  return Number.isFinite(existingMs)
    && Number.isFinite(capturedAtMs)
    && Math.abs(existingMs - capturedAtMs) <= DEDUPE_WINDOW_MS;
}

function safeObservation(record) {
  if (!record) return null;
  const { frameStorage, ...safe } = record;
  return {
    ...safe,
    previewAvailable: Boolean(frameStorage?.storageKey),
    previewUrl: frameStorage?.storageKey ? `/api/ai-observations/${encodeURIComponent(record.id)}/frame` : null
  };
}

async function persistGatewayObservation({ camera, result, frameBuffer, capturedAt, processedAt }) {
  const normalized = normalizeAiResult(result, { camera, capturedAt, processedAt });
  if (!normalized.detections.length) return null;
  const operation = persistenceQueue.then(async () => {
    const db = await readDatabase();
    db.aiObservations ||= [];
    const existing = db.aiObservations.find((item) =>
      item.cameraId === camera.id
      && item.status === "PENDING_REVIEW"
      && item.detectionSignature === signature(normalized)
      && isWithinDedupeWindow(item, normalized.capturedAt)
    );
    if (existing) {
      existing.occurrenceCount = Math.max(1, Number(existing.occurrenceCount) || 1) + 1;
      existing.lastDetectedAt = normalized.capturedAt;
      existing.processedAt = normalized.processedAt;
      existing.detections = normalized.detections;
      await writeSelectedRecords(db, [[aiObservationsRepository, [existing]]]);
      return safeObservation(existing);
    }

    const createdAt = new Date().toISOString();
    const observation = {
      id: uid("OBS"),
      ...normalized,
      status: "PENDING_REVIEW",
      reviewStatus: "PENDING_REVIEW",
      advisory: true,
      humanVerificationRequired: true,
      alertId: null,
      incidentId: null,
      occurrenceCount: 1,
      lastDetectedAt: normalized.capturedAt,
      detectionSignature: signature(normalized),
      createdAt
    };
    let storageReference = null;
    if (Buffer.isBuffer(frameBuffer) && frameBuffer.length) {
      const checksum = crypto.createHash("sha256").update(frameBuffer).digest("hex");
      storageReference = await writeEvidenceObject({
        buffer: frameBuffer,
        evidenceId: observation.id,
        mimeType: "image/jpeg",
        checksum,
        uploadedAt: createdAt
      });
      observation.frameStorage = { ...storageReference, checksum, mimeType: "image/jpeg", size: frameBuffer.length };
    }
    db.aiObservations.unshift(observation);
    const audit = addAuditLog(db, "ai_observation_created", null, null, `${observation.id}: ${camera.id}`, createdAt);
    try {
      await writeSelectedRecords(db, [[aiObservationsRepository, [observation]], [auditLogsRepository, [audit]]]);
    } catch (error) {
      if (storageReference) await cleanupEvidenceObject(storageReference).catch(() => {});
      throw error;
    }
    return safeObservation(observation);
  });
  persistenceQueue = operation.catch(() => {});
  return operation;
}

function reviewObservation(db, observation, action, user, notes = "") {
  const decision = String(action || "").toUpperCase();
  if (!REVIEW_STATES.has(decision) || decision === "PENDING_REVIEW") {
    throw Object.assign(new Error("Review decision must be CONFIRMED, REJECTED, or UNCERTAIN"), { status: 400 });
  }
  if (!["PENDING_REVIEW", "UNCERTAIN"].includes(observation.status)) {
    throw Object.assign(new Error("Observation has already received a final review decision"), { status: 409 });
  }
  const reviewedAt = new Date().toISOString();
  observation.status = decision;
  observation.reviewStatus = decision;
  observation.reviewedAt = reviewedAt;
  observation.reviewedBy = { id: user.id, name: user.name, role: user.role };
  observation.reviewNotes = String(notes || "").trim().slice(0, 500);
  let alert = null;
  if (decision === "CONFIRMED" && observation.sourceType !== "evidence_image") {
    const strongest = [...observation.detections].sort((a, b) => b.confidence - a.confidence)[0];
    alert = {
      id: uid("alt"), incidentId: null, linkedIncidentId: null,
      sourceObservationId: observation.id,
      sourceCameraId: observation.cameraId,
      title: `Confirmed camera observation: ${strongest?.label || "detection"}`,
      message: `${observation.cameraName} detection was confirmed by an authorized reviewer. Alert verification is still required before incident conversion.`,
      type: "confirmed_camera_observation", threatType: "confirmed_camera_observation",
      severity: "medium", zone: observation.zone, sourceId: observation.cameraId,
      source: "cctv_scan", sourceType: "media_gateway", sourceName: observation.cameraName,
      confidence: strongest?.confidence || 0, detections: observation.detections,
      status: "New", reviewStatus: "pending_review", verificationStatus: "pending_review",
      acknowledged: false, actionable: true, operationalAlert: true,
      humanVerificationRequired: false, alertClassification: "verified_observation",
      createdBy: user.id, createdByRole: user.role, createdAt: reviewedAt,
      lastDetectedAt: observation.capturedAt, frameTimestamp: observation.capturedAt
    };
    db.alerts.unshift(alert);
    observation.alertId = alert.id;
  }
  const auditAction = decision === "CONFIRMED" ? "observation_confirmed"
    : decision === "REJECTED" ? "observation_rejected" : "observation_marked_uncertain";
  const audit = addAuditLog(db, auditAction, user, null, `${observation.id}${alert ? ` -> ${alert.id}` : ""}`, reviewedAt);
  const audits = [audit];
  if (alert) audits.push(addAuditLog(db, "alert_created_from_observation", user, null, `${observation.id} -> ${alert.id}`, reviewedAt));
  return { observation, alert, audit, audits };
}

async function observationFrame(observation) {
  if (!observation?.frameStorage?.storageKey) return null;
  return readEvidenceObject({
    ...observation.frameStorage,
    checksum: observation.frameStorage.checksum
  });
}

module.exports = {
  SUPPORTED_LABELS,
  REVIEW_STATES,
  normalizeDetections,
  normalizeAiResult,
  isWithinDedupeWindow,
  persistGatewayObservation,
  reviewObservation,
  safeObservation,
  observationFrame,
  repositories: { aiObservationsRepository, alertsRepository, auditLogsRepository }
};
