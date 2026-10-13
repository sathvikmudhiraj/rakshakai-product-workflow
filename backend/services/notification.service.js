const crypto = require("node:crypto");
const { getDatabaseMode, query } = require("./postgres.service");
const { writeDb } = require("./core.service");

const OPERATOR_ROLES = ["Admin", "Police Officer"];
const CLOSED_INCIDENT_STATES = new Set(["closed", "resolved", "rejected / false alarm"]);
const SECRET_KEY = /(password|passwordhash|token|secret|api.?key|private.?key|connection.?string|filesystem|storage.?path|rtsp|stream.?url|username)/i;

function stableId(value) {
  return `ntf_${crypto.createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function iso(value, fallback = new Date().toISOString()) {
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : fallback;
}

function severity(value, fallback = "INFO") {
  const normalized = String(value || fallback).toUpperCase();
  return ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].includes(normalized) ? normalized : fallback;
}

function record({ dedupeKey, type, title, message, severity: level, entityType, entityId, createdAt, source, recipientRoles = OPERATOR_ROLES }) {
  return {
    id: stableId(dedupeKey), dedupeKey, type, title, message,
    severity: severity(level), entityType, entityId: String(entityId),
    createdAt: iso(createdAt), source: source || "RakshakAI", recipientRoles
  };
}

function isActiveIncident(incident) {
  return !CLOSED_INCIDENT_STATES.has(String(incident?.status || "").toLowerCase());
}

function titleWords(value) {
  return String(value || "Notification").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function deriveNotifications(db) {
  const notifications = [];
  for (const incident of db.incidents || []) {
    if (!isActiveIncident(incident)) continue;
    if (String(incident.severity).toUpperCase() === "CRITICAL") {
      notifications.push(record({
        dedupeKey: `critical_incident:${incident.id}`, type: "critical_incident",
        title: "Critical Incident", message: incident.title || incident.type || "Critical incident requires attention",
        severity: "CRITICAL", entityType: "incident", entityId: incident.id,
        createdAt: incident.createdAt, source: incident.sourceName || incident.sourceType
      }));
    }
    if (!incident.assignedUnitId && ["Verified", "Assigned", "New", "Verification Required"].includes(incident.status)) {
      notifications.push(record({
        dedupeKey: `incident_unassigned:${incident.id}`, type: "incident_unassigned",
        title: "Response Unit Required", message: `${incident.title || incident.id} has no response unit assigned`,
        severity: String(incident.severity).toUpperCase() === "CRITICAL" ? "CRITICAL" : "HIGH",
        entityType: "incident", entityId: incident.id, createdAt: incident.updatedAt || incident.createdAt,
        source: "Incident Command"
      }));
    }
  }

  for (const alert of db.escalationAlerts || []) {
    const type = String(alert.alertType || "sla_alert").toLowerCase();
    notifications.push(record({
      dedupeKey: `${type}:${alert.id || `${alert.incidentId}:${alert.escalationLevel || "state"}`}`,
      type, title: titleWords(alert.title || alert.alertType || "SLA Alert"),
      message: alert.message || `${alert.incidentId} requires SLA attention`,
      severity: alert.severity || (type.includes("breach") ? "HIGH" : "MEDIUM"),
      entityType: "incident", entityId: alert.incidentId,
      createdAt: alert.createdAt || alert.escalatedAt, source: "SLA & Escalation"
    }));
  }

  for (const alert of db.cameraHealthAlerts || []) {
    const status = String(alert.healthStatus || alert.status || alert.alertType || "degraded").toLowerCase();
    notifications.push(record({
      dedupeKey: `camera_${status}:${alert.id || alert.cameraId}`,
      type: `camera_${status}`, title: `Camera ${titleWords(status)}`,
      message: alert.message || `${alert.cameraId} health requires attention`,
      severity: alert.severity || (status.includes("offline") || status.includes("tamper") ? "HIGH" : "MEDIUM"),
      entityType: "camera", entityId: alert.cameraId,
      createdAt: alert.createdAt, source: "Camera Health"
    }));
  }

  for (const camera of db.cameraSources || []) {
    const streamState = String(camera.streamState || "").toUpperCase();
    const aiState = String(camera.aiState || "").toUpperCase();
    if (streamState === "STREAMING" && ["AI_UNAVAILABLE", "AI_TIMEOUT", "AI_ERROR"].includes(aiState)) {
      notifications.push(record({
        dedupeKey: `camera_ai_unavailable:${camera.id}:${aiState}`,
        type: "camera_ai_unavailable", title: "AI Analysis Unavailable",
        message: `${camera.cameraId || camera.id} stream is healthy, but AI processing is unavailable.`,
        severity: "MEDIUM", entityType: "camera", entityId: camera.id,
        createdAt: camera.lastHealthUpdate || camera.updatedAt, source: "Secure Media Gateway"
      }));
    }
    if (["NO_FRAMES", "AUTH_FAILED", "OFFLINE"].includes(streamState)) {
      notifications.push(record({
        dedupeKey: `gateway_${streamState.toLowerCase()}:${camera.id}`,
        type: `camera_${streamState.toLowerCase()}`,
        title: streamState === "NO_FRAMES" ? "Camera Frames Missing" : `Camera ${titleWords(streamState)}`,
        message: camera.lastGatewayError || `${camera.cameraId || camera.id} requires gateway attention.`,
        severity: ["AUTH_FAILED", "OFFLINE"].includes(streamState) ? "HIGH" : "MEDIUM",
        entityType: "camera", entityId: camera.id,
        createdAt: camera.lastHealthUpdate || camera.updatedAt, source: "Secure Media Gateway"
      }));
    }
  }

  for (const observation of db.aiObservations || []) {
    if (observation.status !== "PENDING_REVIEW") continue;
    notifications.push(record({
      dedupeKey: `ai_observation_review:${observation.id}`,
      type: "ai_observation_review", title: "Review Required",
      message: `${observation.cameraName || observation.cameraId} has an AI observation pending human review.`,
      severity: "MEDIUM", entityType: "ai_observation", entityId: observation.id,
      createdAt: observation.createdAt || observation.capturedAt, source: "AI Observation Review"
    }));
  }

  for (const candidate of db.trackingCandidates || []) {
    const status = String(candidate.status || "PENDING_REVIEW").toUpperCase();
    const session = (db.trackingSessions || []).find((item) => item.id === candidate.sessionId);
    const entity = titleWords(candidate.entityType || session?.trackType || "entity");
    notifications.push(record({
      dedupeKey: `tracking_candidate_${status}:${candidate.id}`,
      type: status === "PENDING_REVIEW" ? "tracking_review" : `tracking_${status.toLowerCase()}`,
      title: status === "PENDING_REVIEW" ? `${entity} Sighting Review` : `${entity} Sighting ${titleWords(status)}`,
      message: status === "PENDING_REVIEW" ? `Possible ${entity.toLowerCase()} sighting requires human verification` : `${entity} sighting was ${titleWords(status).toLowerCase()}`,
      severity: status === "PENDING_REVIEW" ? "MEDIUM" : "INFO",
      entityType: "tracking_candidate", entityId: candidate.id,
      createdAt: candidate.createdAt || candidate.detectedAt || candidate.reviewedAt,
      source: candidate.sessionId || "Multi-Camera Tracking"
    }));
  }

  for (const session of db.trackingSessions || []) {
    const entity = titleWords(session.trackType || "entity");
    if (session.verificationStatus === "CONFIRMED" && session.lastSeenAt) {
      notifications.push(record({
        dedupeKey: `tracking_location:${session.id}:${session.lastSeenAt}`,
        type: "tracking_location_confirmed", title: `${entity} Confirmed Sighting`,
        message: `Last confirmed location changed to ${session.lastSeenCameraId}. Human verified.`,
        severity: "INFO", entityType: "tracking_session", entityId: session.id,
        createdAt: session.lastSeenAt, source: "Multi-Entity Tracking"
      }));
    }
    if (session.status === "CLOSED") {
      notifications.push(record({
        dedupeKey: `tracking_closed:${session.id}`, type: "tracking_session_closed",
        title: `${entity} Tracking Session Closed`, message: `${session.id} was closed by an authorized operator.`,
        severity: "INFO", entityType: "tracking_session", entityId: session.id,
        createdAt: session.updatedAt || session.createdAt, source: "Multi-Entity Tracking"
      }));
    }
  }

  for (const audit of db.auditLogs || []) {
    if (audit.action !== "jurisdiction_changed" || !audit.incidentId) continue;
    notifications.push(record({
      dedupeKey: `tracking_jurisdiction:${audit.id}`, type: "tracking_jurisdiction_changed",
      title: "Jurisdiction Transition Detected", message: audit.details || "Confirmed tracking movement crossed jurisdiction.",
      severity: "MEDIUM", entityType: "tracking_session", entityId: audit.incidentId,
      createdAt: audit.timestamp, source: "Multi-Entity Tracking"
    }));
  }

  for (const report of db.reports || []) {
    const status = String(report.status || "submitted_for_review").toLowerCase();
    if (!["submitted_for_review", "under_review", "possible_match", "verified", "rejected", "assigned"].includes(status)) continue;
    notifications.push(record({
      dedupeKey: `report_${status}:${report.id}`, type: `report_${status}`,
      title: status.includes("review") ? "Citizen Report Review" : `Report ${titleWords(status)}`,
      message: `${report.name || report.reportType || "Report"} · ${titleWords(status)}`,
      severity: String(report.urgency || "MEDIUM").toUpperCase(), entityType: "report", entityId: report.id,
      createdAt: report.updatedAt || report.createdAt, source: "Report Center",
      recipientRoles: ["Admin", "Police Officer", "Citizen"]
    }));
  }
  return notifications.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

async function syncNotifications(db) {
  const derived = deriveNotifications(db);
  if (getDatabaseMode() === "postgres") {
    for (const item of derived) {
      await query(
        `INSERT INTO notifications (id, dedupe_key, type, title, message, severity, entity_type, entity_id, source, recipient_roles, created_at, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[],$11,$12::jsonb)
         ON CONFLICT (dedupe_key) DO UPDATE SET title=EXCLUDED.title, message=EXCLUDED.message, severity=EXCLUDED.severity, source=EXCLUDED.source, recipient_roles=EXCLUDED.recipient_roles`,
        [item.id, item.dedupeKey, item.type, item.title, item.message, item.severity, item.entityType, item.entityId, item.source, item.recipientRoles, item.createdAt, JSON.stringify({})]
      );
    }
    return;
  }
  db.notifications ||= [];
  const byKey = new Map(db.notifications.map((item) => [item.dedupeKey, item]));
  let changed = false;
  for (const item of derived) {
    const existing = byKey.get(item.dedupeKey);
    if (!existing) { db.notifications.push(item); byKey.set(item.dedupeKey, item); changed = true; }
    else {
      for (const field of ["title", "message", "severity", "source", "recipientRoles"]) {
        if (JSON.stringify(existing[field]) !== JSON.stringify(item[field])) { existing[field] = item[field]; changed = true; }
      }
    }
  }
  if (changed) writeDb(db);
}

function canSeeNotification(item, user, db) {
  if (!(item.recipientRoles || OPERATOR_ROLES).includes(user.role)) return false;
  if (user.role !== "Citizen") return true;
  if (item.entityType !== "report") return false;
  const report = (db.reports || []).find((entry) => entry.id === item.entityId);
  return Boolean(report && [report.createdBy, report.reporterId, report.userId].includes(user.id));
}

async function storedNotifications(db) {
  if (getDatabaseMode() === "postgres") {
    const result = await query("SELECT id, dedupe_key, type, title, message, severity, entity_type, entity_id, source, recipient_roles, created_at FROM notifications ORDER BY created_at DESC LIMIT 500");
    return result.rows.map((row) => ({ id: row.id, dedupeKey: row.dedupe_key, type: row.type, title: row.title, message: row.message, severity: row.severity, entityType: row.entity_type, entityId: row.entity_id, source: row.source, recipientRoles: row.recipient_roles, createdAt: iso(row.created_at) }));
  }
  return db.notifications || [];
}

async function receiptsFor(userId, db) {
  if (getDatabaseMode() === "postgres") {
    const result = await query("SELECT notification_id, read_at FROM notification_receipts WHERE user_id=$1", [userId]);
    return new Map(result.rows.map((row) => [row.notification_id, iso(row.read_at)]));
  }
  return new Map((db.notificationReceipts || []).filter((entry) => entry.userId === userId).map((entry) => [entry.notificationId, entry.readAt]));
}

async function listNotifications(db, user) {
  await syncNotifications(db);
  const receipts = await receiptsFor(user.id, db);
  const items = (await storedNotifications(db)).filter((item) => canSeeNotification(item, user, db)).map((item) => ({
    ...item, readAt: receipts.get(item.id) || null, read: receipts.has(item.id)
  }));
  return { notifications: items, unreadCount: items.filter((item) => !item.read).length };
}

async function findNotification(db, user, id) {
  await syncNotifications(db);
  const item = (await storedNotifications(db)).find((entry) => entry.id === id);
  if (!item || !canSeeNotification(item, user, db)) throw Object.assign(new Error("Notification not found"), { status: 404 });
  return item;
}

async function setRead(db, user, notificationId, read) {
  await findNotification(db, user, notificationId);
  const readAt = read ? new Date().toISOString() : null;
  if (getDatabaseMode() === "postgres") {
    if (read) await query("INSERT INTO notification_receipts (notification_id,user_id,read_at) VALUES ($1,$2,$3) ON CONFLICT (notification_id,user_id) DO UPDATE SET read_at=EXCLUDED.read_at", [notificationId, user.id, readAt]);
    else await query("DELETE FROM notification_receipts WHERE notification_id=$1 AND user_id=$2", [notificationId, user.id]);
  } else {
    db.notificationReceipts ||= [];
    db.notificationReceipts = db.notificationReceipts.filter((entry) => !(entry.notificationId === notificationId && entry.userId === user.id));
    if (read) db.notificationReceipts.push({ notificationId, userId: user.id, readAt });
    writeDb(db);
  }
  return { read, readAt };
}

async function markAllRead(db, user) {
  const { notifications } = await listNotifications(db, user);
  const readAt = new Date().toISOString();
  if (getDatabaseMode() === "postgres") {
    for (const item of notifications) await query("INSERT INTO notification_receipts (notification_id,user_id,read_at) VALUES ($1,$2,$3) ON CONFLICT (notification_id,user_id) DO UPDATE SET read_at=EXCLUDED.read_at", [item.id, user.id, readAt]);
  } else {
    const ids = new Set(notifications.map((item) => item.id));
    db.notificationReceipts = (db.notificationReceipts || []).filter((entry) => entry.userId !== user.id || !ids.has(entry.notificationId));
    notifications.forEach((item) => db.notificationReceipts.push({ notificationId: item.id, userId: user.id, readAt }));
    writeDb(db);
  }
  return { updated: notifications.length, readAt };
}

function deepSafe(value) {
  if (Array.isArray(value)) return value.map(deepSafe);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEY.test(key)).map(([key, entry]) => [key, deepSafe(entry)]));
}

function incidentDetail(db, id) {
  const incident = (db.incidents || []).find((item) => item.id === id);
  if (!incident) throw Object.assign(new Error("Incident not found"), { status: 404 });
  const unit = (db.responseUnits || []).find((item) => item.id === incident.assignedUnitId);
  return deepSafe({
    kind: "Incident", record: incident,
    response: unit ? { id: unit.id, unitCode: unit.unitCode, name: unit.name, officerName: unit.officerName, status: unit.status, etaMinutes: incident.etaMinutes } : null,
    sla: { assignmentDeadline: incident.assignmentSlaDeadline || incident.assignmentDeadlineAt, responseDeadline: incident.responseSlaDeadline || incident.responseDeadlineAt, assignmentBreachedAt: incident.assignmentBreachedAt, responseBreachedAt: incident.responseBreachedAt, escalationLevel: incident.escalationLevel || incident.escalationStatus },
    evidence: (db.videoEvidence || []).filter((item) => [item.incidentId, item.relatedIncidentId].includes(id)).map(evidenceSummary),
    timeline: [...(db.incidentTimeline || []).filter((item) => item.incidentId === id), ...(db.dispatchEvents || []).filter((item) => item.incidentId === id)].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    audit: (db.auditLogs || []).filter((item) => item.incidentId === id).slice(0, 30)
  });
}

function evidenceSummary(item) {
  return { id: item.id, type: item.type || item.mimeType || item.evidenceType, createdAt: item.createdAt, checksumVerified: item.checksumVerified ?? item.integrityVerified ?? null, accessStatus: item.accessStatus || "authorized", custodyEvents: (item.chainOfCustody || []).length };
}

function reportDetail(db, user, id) {
  const report = (db.reports || []).find((item) => item.id === id);
  if (!report) throw Object.assign(new Error("Report not found"), { status: 404 });
  if (user.role === "Citizen" && ![report.createdBy, report.reporterId, report.userId].includes(user.id)) throw Object.assign(new Error("Report not found"), { status: 404 });
  const linkedIncident = (db.incidents || []).find((item) => item.id === report.incidentId || item.sourceRecordId === id);
  return deepSafe({ kind: "Report", record: report, linkedIncident: linkedIncident ? { id: linkedIncident.id, title: linkedIncident.title, status: linkedIncident.status, assignedUnitId: linkedIncident.assignedUnitId, investigatingOfficerId: linkedIncident.investigatingOfficerId } : null, evidence: (db.videoEvidence || []).filter((item) => [item.reportId, item.relatedReportId].includes(id)).map(evidenceSummary), timeline: (db.auditLogs || []).filter((item) => item.incidentId === id || item.reportId === id).slice(0, 30) });
}

function cameraDetail(db, id) {
  const camera = (db.cameraSources || []).find((item) => item.id === id || item.cameraId === id);
  if (!camera) throw Object.assign(new Error("Camera not found"), { status: 404 });
  const safeCamera = { id: camera.id, cameraId: camera.cameraId, name: camera.name, zone: camera.zone, type: camera.type || camera.sourceType, healthStatus: camera.healthStatus, status: camera.status, connectivity: camera.connectivity, fps: camera.fps, latencyMs: camera.latencyMs, lastFrameAt: camera.lastFrameAt, lastHeartbeatAt: camera.lastHeartbeatAt, lastHealthUpdateAt: camera.lastHealthUpdateAt || camera.updatedAt, aiEnabled: camera.aiEnabled, aiStatus: camera.aiStatus, tamperSuspected: camera.tamperSuspected, obstructionPercent: camera.obstructionPercent, noSignal: camera.noSignal, noVideoFrames: camera.noVideoFrames, maintenance: camera.maintenance || camera.maintenanceStatus };
  return deepSafe({ kind: "Camera", record: safeCamera, alerts: (db.cameraHealthAlerts || []).filter((item) => item.cameraId === camera.id).slice(0, 20), history: (db.cameraHealthEvents || []).filter((item) => item.cameraId === camera.id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 30), detections: (db.detections || []).filter((item) => [item.cameraId, item.sourceId].includes(camera.id)).slice(0, 10) });
}

function trackingDetail(db, entityType, id) {
  const candidate = entityType === "tracking_candidate" ? (db.trackingCandidates || []).find((item) => item.id === id) : null;
  const sessionId = candidate?.sessionId || id;
  const session = (db.trackingSessions || []).find((item) => item.id === sessionId);
  if (!session) throw Object.assign(new Error("Tracking record not found"), { status: 404 });
  const observations = (db.trackingObservations || []).filter((item) => item.sessionId === sessionId);
  const candidates = (db.trackingCandidates || []).filter((item) => item.sessionId === sessionId);
  const verifications = (db.trackingVerifications || []).filter((item) => item.sessionId === sessionId);
  return deepSafe({ kind: candidate ? "Tracking Candidate" : "Tracking Session", session, candidate, observations, candidates, verifications, humanVerificationRequired: candidate ? String(candidate.status || "PENDING_REVIEW") === "PENDING_REVIEW" : false });
}

function evidenceDetail(db, id) {
  const evidence = (db.videoEvidence || []).find((item) => item.id === id);
  if (!evidence) throw Object.assign(new Error("Evidence not found"), { status: 404 });
  return deepSafe({ kind: "Evidence", record: evidenceSummary(evidence), custody: evidence.chainOfCustody || [] });
}

function observationDetail(db, id) {
  const observation = (db.aiObservations || []).find((item) => item.id === id);
  if (!observation) throw Object.assign(new Error("AI observation not found"), { status: 404 });
  return deepSafe({
    kind: "AI Observation",
    record: {
      id: observation.id, cameraId: observation.cameraId, cameraName: observation.cameraName,
      zone: observation.zone, capturedAt: observation.capturedAt, processedAt: observation.processedAt,
      status: observation.status, detections: observation.detections, reason: observation.reason,
      advisory: true, humanVerificationRequired: observation.humanVerificationRequired,
      cameraHealthAtCapture: observation.cameraHealthAtCapture, aiStateAtCapture: observation.aiStateAtCapture,
      alertId: observation.alertId || null,
      previewUrl: observation.frameStorage?.storageKey ? `/api/ai-observations/${encodeURIComponent(observation.id)}/frame` : null
    }
  });
}

async function authoritativeDetail(db, user, notification) {
  if (notification.entityType === "incident") return incidentDetail(db, notification.entityId);
  if (notification.entityType === "report") return reportDetail(db, user, notification.entityId);
  if (notification.entityType === "camera") {
    if (!OPERATOR_ROLES.includes(user.role)) throw Object.assign(new Error("You do not have permission for this record"), { status: 403 });
    return cameraDetail(db, notification.entityId);
  }
  if (["tracking_session", "tracking_candidate"].includes(notification.entityType)) {
    if (!OPERATOR_ROLES.includes(user.role)) throw Object.assign(new Error("You do not have permission for this record"), { status: 403 });
    return trackingDetail(db, notification.entityType, notification.entityId);
  }
  if (notification.entityType === "evidence") {
    if (!OPERATOR_ROLES.includes(user.role)) throw Object.assign(new Error("You do not have permission for this record"), { status: 403 });
    return evidenceDetail(db, notification.entityId);
  }
  if (notification.entityType === "ai_observation") {
    if (!OPERATOR_ROLES.includes(user.role)) throw Object.assign(new Error("You do not have permission for this record"), { status: 403 });
    return observationDetail(db, notification.entityId);
  }
  throw Object.assign(new Error("Linked record type is not supported"), { status: 404 });
}

module.exports = { deriveNotifications, listNotifications, findNotification, setRead, markAllRead, authoritativeDetail, deepSafe };
