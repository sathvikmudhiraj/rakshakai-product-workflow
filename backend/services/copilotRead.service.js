const { getAssignmentSlaStatus, getResponseSlaStatus, getEscalationLevel, isInvestigationInactive } = require("./sla.service");
const {
  detectLanguage, normalizeQuery, responseLanguage, localizeAnswer,
  MULTILINGUAL_WRITE_PATTERN, SENSITIVE_REQUEST_PATTERN, INJECTION_PATTERN
} = require("./copilotLanguage.service");

// Pure read adapter: no repository, SQL, persistence, or operational command is imported here.
const SECRET_PATTERN = /password|secret|token|credential|api[_-]?key|jwt|rtsp|connection.?string|private.?key/i;
const WRITE_REQUEST_PATTERN = /\b(?:create|add|update|edit|delete|remove|assign|reassign|release|resolve|close|acknowledge|mark|start\s+maintenance|confirm(?:\s+(?:the\s+)?match)?|reject(?:\s+(?:the\s+)?match)?|change|increase|decrease|set|disable|enable)\b/i;
const CLOSED = new Set(["closed", "resolved", "rejected", "cancelled", "completed"]);
const HEALTHY = new Set(["online", "available", "ready"]);
const PAGES = new Set(["dashboard", "incident-command", "unit-assignment", "response-units", "cctv", "camera-health", "multi-camera-tracking", "investigations", "gis", "escalations", "reports", "history", "alerts", "video-evidence", "live-vision", "police-management", "settings"]);

const list = (db, key) => Array.isArray(db?.[key]) ? db[key] : [];
const lower = (value) => String(value || "").trim().toLowerCase();
const upper = (value) => String(value || "").trim().toUpperCase();
const valueFrom = (record, ...keys) => { for (const key of keys) if (record?.[key] !== null && record?.[key] !== undefined && record?.[key] !== "") return record[key]; return null; };
const display = (value, fallback = "Not recorded") => value === null || value === undefined || value === "" ? fallback : String(value);
const same = (value, reference) => value !== null && value !== undefined && value !== "" && reference !== null && reference !== undefined && reference !== "" && lower(value) === lower(reference);
const matches = (record, reference, keys) => keys.some((key) => same(record?.[key], reference));
const idOf = (record, ...keys) => valueFrom(record, ...keys, "id");
const result = (answer, entities = [], extra = {}) => ({ answer, entities, ...extra });
const navigation = (view, entityId) => entityId ? { view, entityId } : { view };

function clean(value, seen = new WeakSet()) {
  if (Array.isArray(value)) return value.map((item) => clean(item, seen));
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_PATTERN.test(key)).map(([key, item]) => [key, clean(item, seen)]));
}

function relativeTime(value, currentTime = Date.now()) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unavailable";
  const seconds = Math.max(0, Math.floor((currentTime - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function duration(ms) {
  if (!Number.isFinite(ms)) return "Unavailable";
  const seconds = Math.max(0, Math.floor(Math.abs(ms) / 1000));
  const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60);
  return [hours ? `${hours}h` : null, minutes ? `${minutes}m` : null, `${seconds % 60}s`].filter(Boolean).join(" ");
}

function formatTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : "Unavailable";
}

function extractReferences(message) {
  const text = String(message || "");
  const patterns = {
    officer: /\b(?:PO|OFFICER)[-_][A-Z0-9]+\b/gi,
    incident: /\bINC[-_][A-Z0-9_-]+\b/gi,
    camera: /\b(?:CAM[-_][A-Z0-9_-]+|[CD]-\d{2,})\b/gi,
    unit: /\b(?:UNIT[-_][A-Z0-9_-]+|P-\d{1,})\b/gi,
    track: /\b(?:PERSON|VEH(?:ICLE)?|TRACK)[-_][A-Z0-9_-]+\b/gi
  };
  return Object.fromEntries(Object.entries(patterns).map(([type, pattern]) => [type, [...new Set((text.match(pattern) || []).map((item) => item.toUpperCase()))]]));
}

function sanitizePageContext(context = {}) {
  const page = PAGES.has(String(context.page || "")) ? String(context.page) : "dashboard";
  const entityId = /^[A-Za-z0-9_-]{1,100}$/.test(String(context.entityId || "")) ? String(context.entityId) : null;
  return { page, entityId };
}

function findOfficer(db, ref) {
  let officer = list(db, "policeOfficers").find((item) => matches(item, ref, ["id", "userId", "user_id", "badgeId", "badge_id", "officerId"]));
  if (!officer) {
    const user = list(db, "users").find((item) => item.role === "Police Officer" && matches(item, ref, ["id", "badgeId", "officerId"]));
    if (user) officer = list(db, "policeOfficers").find((item) => same(valueFrom(item, "userId", "user_id", "id"), user.id)) || { id: user.id, userId: user.id };
  }
  return officer || null;
}
const findStation = (db, ref) => list(db, "policeStations").find((item) => matches(item, ref, ["id", "stationId", "stationCode", "stationName", "name"])) || null;
const findUnit = (db, ref) => list(db, "responseUnits").find((item) => matches(item, ref, ["id", "unitId", "unitCode", "unitName", "name"])) || null;
const findIncident = (db, ref) => list(db, "incidents").find((item) => matches(item, ref, ["id", "incidentId"])) || null;
const findCamera = (db, ref) => list(db, "cameraSources").find((item) => matches(item, ref, ["id", "cameraId", "name"])) || null;
const findTrack = (db, ref) => list(db, "trackingSessions").find((item) => matches(item, ref, ["id", "trackId", "subjectId", "entityId", "referenceDetectionId"])) || null;
const userForOfficer = (db, officer) => list(db, "users").find((user) => same(user.id, valueFrom(officer, "userId", "user_id", "id"))) || null;
const stationFor = (db, record) => findStation(db, valueFrom(record, "stationId", "station_id", "linkedStationId", "station", "stationName"));

function unitForOfficer(db, officer) {
  const officerId = valueFrom(officer, "userId", "user_id", "id");
  const member = list(db, "responseUnitMembers").find((item) => same(valueFrom(item, "officerUserId", "officer_user_id"), officerId));
  return member ? findUnit(db, valueFrom(member, "unitId", "unit_id")) : null;
}

function membersForUnit(db, unit) {
  return list(db, "responseUnitMembers").filter((member) => [unit.id, unit.unitId, unit.unitCode].some((id) => same(valueFrom(member, "unitId", "unit_id"), id))).map((member) => {
    const officer = findOfficer(db, valueFrom(member, "officerUserId", "officer_user_id"));
    const user = officer && userForOfficer(db, officer);
    return officer ? { id: idOf(officer, "badgeId", "badge_id"), name: user?.name || officer.name || null, role: member.role || "member" } : null;
  }).filter(Boolean);
}

function getOfficerById(db, id) {
  const officer = findOfficer(db, id);
  if (!officer) return null;
  const user = userForOfficer(db, officer), station = stationFor(db, officer), unit = unitForOfficer(db, officer);
  return clean({ id: idOf(officer, "officerId", "badgeId", "badge_id"), name: user?.name || officer.name || null, stationId: station ? idOf(station, "stationId", "stationCode") : valueFrom(officer, "stationId", "station_id"), stationName: station ? valueFrom(station, "stationName", "name") : null, unitId: unit ? idOf(unit, "unitCode", "unitId") : null, beat: valueFrom(officer, "beat", "beatId", "beat_id"), jurisdiction: officer.jurisdiction || null, dutyStatus: valueFrom(officer, "dutyStatus", "duty_status"), availabilityStatus: valueFrom(officer, "availabilityStatus", "availability_status"), assignedIncidentId: valueFrom(officer, "assignedIncidentId", "assigned_incident_id"), active: officer.active !== false, updatedAt: valueFrom(officer, "updatedAt", "lastUpdated") });
}

function getUnitById(db, id) {
  const unit = findUnit(db, id);
  if (!unit) return null;
  const station = stationFor(db, unit), incident = findIncident(db, valueFrom(unit, "assignedIncidentId", "currentIncidentId"));
  return clean({ id: idOf(unit, "unitCode", "unitId"), internalId: unit.id, name: valueFrom(unit, "unitName", "name"), type: valueFrom(unit, "unitType", "type", "unitSubtype"), status: unit.status || null, operational: unit.operational !== false, stationId: station ? idOf(station, "stationId", "stationCode") : valueFrom(unit, "stationId", "linkedStationId"), stationName: station ? valueFrom(station, "stationName", "name") : valueFrom(unit, "stationName", "station"), assignedIncidentId: incident?.id || valueFrom(unit, "assignedIncidentId", "currentIncidentId"), location: valueFrom(unit, "currentAddress", "address", "zone", "beat", "sector"), latitude: valueFrom(unit, "latitude", "lat"), longitude: valueFrom(unit, "longitude", "lng"), locationUpdatedAt: valueFrom(unit, "locationCapturedAt", "lastLocationUpdatedAt", "lastSeen", "lastUpdated"), members: membersForUnit(db, unit) });
}

function slaSnapshot(db, incident, now = Date.now()) {
  return { assignment: getAssignmentSlaStatus(incident, list(db, "slaConfig"), now), response: getResponseSlaStatus(incident, list(db, "slaConfig"), now), escalationLevel: getEscalationLevel(incident, list(db, "slaConfig"), now), assignmentDeadline: incident.assignmentDeadline || null, responseDeadline: incident.responseDeadline || null };
}

function getIncidentById(db, id, now = Date.now()) {
  const incident = findIncident(db, id);
  if (!incident) return null;
  const unit = findUnit(db, valueFrom(incident, "assignedUnitId", "assigned_unit_id")), camera = findCamera(db, valueFrom(incident, "cameraId", "sourceCameraId", "cameraSourceId")), officer = findOfficer(db, incident.investigatingOfficerId), officerUser = officer && userForOfficer(db, officer);
  return clean({ id: incident.id, title: valueFrom(incident, "title", "type", "category"), severity: incident.severity || null, status: incident.status || null, zone: valueFrom(incident, "zone", "address"), assignedUnitId: unit ? idOf(unit, "unitCode", "unitId") : valueFrom(incident, "assignedUnitId", "assigned_unit_id"), cameraId: camera ? idOf(camera, "cameraId") : valueFrom(incident, "cameraId", "sourceCameraId", "cameraSourceId"), sla: slaSnapshot(db, incident, now), investigationRequired: Boolean(incident.investigationRequired), investigationStatus: incident.investigationStatus || null, investigatingOfficerId: officer ? idOf(officer, "badgeId", "badge_id") : incident.investigatingOfficerId || null, investigatingOfficerName: officerUser?.name || null, investigationStartedAt: incident.investigationStartedAt || null, lastInvestigationUpdateAt: incident.lastInvestigationUpdateAt || null, investigationOverdue: isInvestigationInactive(incident, list(db, "slaConfig"), now), evidenceCount: list(db, "videoEvidence").filter((item) => same(item.incidentId, incident.id)).length, dispatchRecommendation: incident.dispatchRecommendation || null, createdAt: incident.createdAt || null, updatedAt: valueFrom(incident, "updatedAt", "lastDetectedAt", "createdAt") });
}

function cameraExplanation(status) {
  return ({ ONLINE: "The device, stream, and usable frames are currently healthy.", DEGRADED: "The camera is reachable, but one or more telemetry measures are below normal.", LOW_FPS: "Usable frames are arriving below the configured frame-rate threshold.", HIGH_LATENCY: "Measured stream latency is above the configured threshold.", NO_SIGNAL: "The camera signal is not reaching RakshakAI.", NO_VIDEO_FRAMES: "The device or stream may be reachable, but usable video frames are not arriving.", OBSTRUCTED: "Recent frame analysis indicates that the view may be obstructed.", TAMPER_SUSPECTED: "Telemetry indicates a possible abrupt obstruction or scene change. Human verification is still required.", TAMPER_CONFIRMED: "A tamper condition is confirmed in the camera-health record.", BLURRY: "Frame-quality telemetry indicates excessive blur.", TOO_DARK: "Frame brightness is below the configured usable threshold.", STORAGE_ERROR: "Video storage telemetry reports an error.", OFFLINE: "The camera is not currently reachable.", MAINTENANCE: "The camera is intentionally in maintenance mode.", UNKNOWN: "RakshakAI lacks enough current telemetry to determine camera health." })[status] || "RakshakAI lacks an explanation for this recorded state.";
}

function getCameraById(db, id) {
  const camera = findCamera(db, id);
  if (!camera) return null;
  const status = upper(valueFrom(camera, "healthStatus", "status") || "UNKNOWN"), events = list(db, "cameraHealthEvents").filter((item) => same(item.cameraId, camera.id) || same(item.cameraId, camera.cameraId)).sort((a, b) => Date.parse(b.createdAt || b.detectedAt || 0) - Date.parse(a.createdAt || a.detectedAt || 0));
  return clean({ id: idOf(camera, "cameraId"), internalId: camera.id, name: camera.name || null, location: valueFrom(camera, "location", "zone", "address"), health: status, severity: camera.healthSeverity || null, reason: valueFrom(camera, "healthReason", "lastFrameStatus"), explanation: cameraExplanation(status), fps: valueFrom(camera, "currentFps", "fps", "observedFps"), expectedFps: camera.expectedFps ?? null, latencyMs: valueFrom(camera, "latencyMs", "streamLatencyMs"), deviceReachable: valueFrom(camera, "deviceReachable", "heartbeatAvailable"), streamConnected: valueFrom(camera, "streamConnected", "streamAvailable"), lastHeartbeatAt: camera.lastHeartbeatAt || null, lastFrameReceivedAt: camera.lastFrameReceivedAt || null, lastHealthCheckAt: camera.lastHealthCheckAt || null, maintenanceMode: Boolean(camera.maintenanceMode), tamperEvidence: status === "TAMPER_SUSPECTED" || status === "TAMPER_CONFIRMED", latestEvent: events[0] || null });
}

function getTrackById(db, id) {
  const session = findTrack(db, id);
  if (!session) return null;
  const observations = list(db, "trackingObservations").filter((item) => same(item.sessionId, session.id)).sort((a, b) => Date.parse(a.detectedAt || 0) - Date.parse(b.detectedAt || 0));
  const candidates = list(db, "trackingCandidates").filter((item) => same(item.sessionId, session.id)).sort((a, b) => Number(b.overallConfidence || 0) - Number(a.overallConfidence || 0));
  const confirmedIds = new Set(list(db, "trackingVerifications").filter((item) => same(item.sessionId, session.id) && upper(item.decision) === "CONFIRM_MATCH").map((item) => item.candidateId));
  const confirmedObservationIds = new Set(candidates.filter((item) => confirmedIds.has(item.id) || upper(item.status).includes("CONFIRM")).map((item) => item.observationId));
  const chosen = observations.filter((item) => confirmedObservationIds.has(item.id));
  const sequence = (chosen.length ? chosen : observations).map((obs) => ({ cameraId: idOf(findCamera(db, obs.cameraId), "cameraId") || obs.cameraId, detectedAt: obs.detectedAt }));
  const last = observations.at(-1), lastSequence = sequence.at(-1);
  return clean({ id: idOf(session, "trackId", "subjectId", "entityId"), internalId: session.id, type: session.trackType || null, status: session.status || null, verificationStatus: session.verificationStatus || null, confidence: session.confidence ?? null, lastSeenCameraId: session.lastSeenCameraId || lastSequence?.cameraId || null, lastSeenAt: session.lastSeenAt || lastSequence?.detectedAt || null, sequence, highestCandidate: candidates[0] || null, observation: last ? { plate: last.plateText || null, color: last.vehicleColor || null, vehicleType: last.vehicleType || null, brand: last.vehicleBrand || null, model: last.vehicleModel || null, brandModelConfidence: last.brandModelConfidence ?? null } : null });
}

const listCriticalIncidents = (db) => list(db, "incidents").filter((item) => upper(item.severity) === "CRITICAL" && !CLOSED.has(lower(item.status)));
const listAvailableUnits = (db) => list(db, "responseUnits").filter((item) => item.operational !== false && lower(item.status) === "available");
const listUnhealthyCameras = (db) => list(db, "cameraSources").filter((item) => !HEALTHY.has(lower(valueFrom(item, "healthStatus", "status") || "unknown")));
const listSlaBreaches = (db, now = Date.now()) => list(db, "incidents").filter((item) => { const sla = slaSnapshot(db, item, now); return sla.assignment.overdue || sla.response.overdue || ["L2", "L3", "L4"].includes(sla.escalationLevel); });

// This is the complete tool surface. There are deliberately no generic repository or mutation tools.
const READ_ONLY_QUERY_REGISTRY = Object.freeze({ getOfficerById, getIncidentById, getCameraById, getUnitById, getTrackById, listCriticalIncidents, listAvailableUnits, listUnhealthyCameras, listSlaBreaches });

function officerAnswer(db, id) {
  const item = getOfficerById(db, id);
  if (!item) return result(`No officer with ID ${id} was found.`);
  return result(["Officer Details", "", `Officer ID: ${display(item.id, id)}`, `Name: ${display(item.name)}`, `Police Station: ${display(item.stationName, "No station assignment recorded")}`, `Unit: ${display(item.unitId, "No response unit assignment recorded")}`, `Beat/Zone: ${display(item.beat)}`, `Duty Status: ${display(item.dutyStatus)}`, `Availability: ${display(item.availabilityStatus)}`, item.updatedAt ? `Record updated: ${relativeTime(item.updatedAt)}` : null].filter(Boolean).join("\n"), [{ type: "officer", id: item.id }], { navigation: navigation("police-management", item.id) });
}

function slaLine(label, status, deadline) {
  return [`${label}: ${display(status.status, "UNKNOWN")}`, status.remainingMs > 0 ? `${duration(status.remainingMs)} remaining` : null, status.overdueMs > 0 ? `${duration(status.overdueMs)} overdue` : null, deadline ? `deadline ${formatTimestamp(deadline)}` : null].filter(Boolean).join(" · ");
}

function incidentAnswer(db, id, now, message) {
  const item = getIncidentById(db, id, now);
  if (!item) return result(`No incident with ID ${id} was found.`);
  if (/timeline|history/i.test(message)) {
    const incident = findIncident(db, id), events = [...list(db, "incidentTimeline"), ...list(db, "dispatchEvents")].filter((entry) => same(entry.incidentId, incident.id)).sort((a, b) => Date.parse(a.createdAt || a.timestamp || 0) - Date.parse(b.createdAt || b.timestamp || 0));
    return result(events.length ? [`${item.id} timeline`, ...events.map((entry) => `${formatTimestamp(entry.createdAt || entry.timestamp)} — ${display(valueFrom(entry, "message", "type", "action"))}`)].join("\n") : `No timeline entries are recorded for ${item.id}.`, [{ type: "incident", id: item.id }], { navigation: navigation("incident-command", item.id) });
  }
  return result([item.id, display(item.title, "Incident"), "", `Severity: ${display(item.severity, "UNKNOWN")}`, `Status: ${display(item.status, "UNKNOWN")}`, `Assigned unit: ${display(item.assignedUnitId, "Unassigned")}`, slaLine("Assignment SLA", item.sla.assignment, item.sla.assignmentDeadline), slaLine("Response SLA", item.sla.response, item.sla.responseDeadline), `Escalation: ${item.sla.escalationLevel}`, item.cameraId ? `Source Camera: ${item.cameraId}` : null, item.updatedAt ? `Incident updated: ${relativeTime(item.updatedAt, now)}` : null].filter(Boolean).join("\n"), [{ type: "incident", id: item.id }], { navigation: navigation("incident-command", item.id) });
}

function unitAnswer(db, id, now) {
  const item = getUnitById(db, id);
  if (!item) return result(`No response unit with ID ${id} was found.`);
  const age = item.locationUpdatedAt ? now - Date.parse(item.locationUpdatedAt) : NaN, staleMs = Math.max(1, Number(process.env.UNIT_GPS_STALE_SECONDS || 120)) * 1000;
  return result([item.id || id, "", `Status: ${display(item.status, "UNKNOWN")}`, `Station: ${display(item.stationName)}`, `Assigned Incident: ${display(item.assignedIncidentId, "None")}`, `Current Location: ${display(item.location, "Unavailable")}`, item.locationUpdatedAt ? `GPS updated: ${relativeTime(item.locationUpdatedAt, now)}` : "GPS freshness: UNAVAILABLE", Number.isFinite(age) ? age > staleMs ? "GPS data is stale; do not treat this location as current." : "GPS freshness: CURRENT" : null, `Officers: ${item.members.length ? item.members.map((member) => `${display(member.name, member.id)} (${member.id})`).join(", ") : "No unit members recorded"}`].filter(Boolean).join("\n"), [{ type: "response_unit", id: item.id || id }], { navigation: navigation("unit-assignment", item.id || id) });
}

function cameraAnswer(db, id, now) {
  const item = getCameraById(db, id);
  if (!item) return result(`No camera with ID ${id} was found.`);
  return result([item.id || id, "", `Health: ${item.health}`, `Location: ${display(item.location)}`, item.explanation, item.reason ? `Recorded reason: ${item.reason}` : null, item.deviceReachable !== null ? `Device reachable: ${item.deviceReachable ? "Yes" : "No"}` : null, item.streamConnected !== null ? `Stream connected: ${item.streamConnected ? "Yes" : "No"}` : null, item.fps !== null ? `FPS: ${item.fps}${item.expectedFps !== null ? ` (expected ${item.expectedFps})` : ""}` : null, item.latencyMs !== null ? `Latency: ${item.latencyMs} ms` : null, item.lastFrameReceivedAt ? `Last usable frame: ${relativeTime(item.lastFrameReceivedAt, now)}` : null, item.lastHealthCheckAt || item.lastHeartbeatAt ? `Telemetry updated: ${relativeTime(item.lastHealthCheckAt || item.lastHeartbeatAt, now)}` : null, item.tamperEvidence ? "Tamper evidence is recorded; human verification is still required." : "No current tamper evidence is recorded."].filter(Boolean).join("\n"), [{ type: "camera", id: item.id || id }], { navigation: navigation("camera-health", item.id || id) });
}

function compareAnswer(db, refs, now) {
  const group = Object.entries(refs).find(([, ids]) => ids.length >= 2);
  if (!group) return result("Please provide two camera, response-unit, or incident IDs to compare.");
  const [type, ids] = group;
  const rows = ids.slice(0, 4).map((id) => {
    if (type === "camera") { const x = getCameraById(db, id); return x ? `${x.id}\nHealth: ${x.health}\nFPS: ${display(x.fps, "Unavailable")}\nLatency: ${x.latencyMs === null ? "Unavailable" : `${x.latencyMs} ms`}` : `${id}\nNOT FOUND`; }
    if (type === "unit") { const x = getUnitById(db, id); return x ? `${x.id}\nStatus: ${display(x.status)}\nStation: ${display(x.stationName)}\nIncident: ${display(x.assignedIncidentId, "None")}\nGPS: ${x.locationUpdatedAt ? relativeTime(x.locationUpdatedAt, now) : "Unavailable"}` : `${id}\nNOT FOUND`; }
    if (type === "incident") { const x = getIncidentById(db, id, now); return x ? `${x.id}\nSeverity: ${display(x.severity)}\nStatus: ${display(x.status)}\nUnit: ${display(x.assignedUnitId, "Unassigned")}\nEscalation: ${x.sla.escalationLevel}` : `${id}\nNOT FOUND`; }
    return null;
  }).filter(Boolean);
  return rows.length ? result(rows.join("\n\n"), ids.map((id) => ({ type, id }))) : result("That comparison is not supported by the current Rakshak records.");
}

function investigationAnswer(db, id, now) {
  const item = getIncidentById(db, id, now);
  if (!item) return result(`No investigation or incident with ID ${id} was found.`);
  if (!item.investigationRequired && !item.investigationStatus) return result(`No investigation is recorded for ${item.id}.`, [{ type: "incident", id: item.id }]);
  return result([`Investigation: ${item.id}`, "", `Status: ${display(item.investigationStatus, "UNKNOWN")}`, `Assigned Officer: ${display(item.investigatingOfficerId, "Unassigned")}${item.investigatingOfficerName ? ` — ${item.investigatingOfficerName}` : ""}`, `Last Update: ${item.lastInvestigationUpdateAt ? formatTimestamp(item.lastInvestigationUpdateAt) : "No update recorded"}`, `Evidence Items: ${item.evidenceCount}`, `Overdue/Inactivity threshold reached: ${item.investigationOverdue ? "Yes" : "No"}`].join("\n"), [{ type: "investigation", id: item.id }], { navigation: navigation("investigations", item.id) });
}

function trackAnswer(db, id, message) {
  const item = getTrackById(db, id);
  if (!item) return result(`No tracking record with ID ${id} was found.`);
  if (/why|confidence|same (?:person|vehicle|subject)|possible match/i.test(message)) {
    const c = item.highestCandidate;
    if (!c) return result(`No candidate confidence data is available for ${item.id}.`, [{ type: "track", id: item.id }]);
    const metrics = [["Appearance similarity", c.appearanceSimilarity], ["Plate similarity", c.plateSimilarity], ["Color similarity", c.colorSimilarity], ["Vehicle type similarity", c.vehicleTypeSimilarity], ["Location/time consistency", c.timingConsistency], ["Spatial consistency", c.spatialConsistency], ["Direction consistency", c.directionConsistency], ["Activity continuity", c.activityConsistency]].filter(([, value]) => Number.isFinite(Number(value)));
    return result([`${item.id} candidate explanation`, ...metrics.map(([label, value]) => `${label}: ${Math.round(Number(value) * 100)}%`), `Overall candidate confidence: ${Math.round(Number(c.overallConfidence || 0) * 100)}%`, "This is a candidate association, not an automatic identity claim. Human verification is still required."].join("\n"), [{ type: "track", id: item.id }], { navigation: navigation("multi-camera-tracking", item.id) });
  }
  const detail = item.observation || {};
  return result([item.id, "", `Type: ${display(item.type)}`, `Status: ${display(item.status)}`, `Last seen camera: ${display(item.lastSeenCameraId, "Unavailable")}`, `Time: ${item.lastSeenAt ? formatTimestamp(item.lastSeenAt) : "Unavailable"}`, `Confirmed/observed sequence: ${item.sequence.length ? item.sequence.map((entry) => entry.cameraId).join(" → ") : "Unavailable"}`, upper(item.type) === "VEHICLE" || detail.plate || /vehicle/i.test(id) ? `Plate: ${display(detail.plate, "Unavailable")}\nColor: ${display(detail.color, "Unavailable")}\nVehicle type: ${display(detail.vehicleType, "Unavailable")}\nBrand/Model: ${detail.brand || detail.model ? `${display(detail.brand, "Unknown brand")} ${display(detail.model, "")}`.trim() : "Unavailable"}` : null].filter(Boolean).join("\n"), [{ type: "track", id: item.id }], { navigation: navigation("multi-camera-tracking", item.id) });
}

function dashboardAnswer(db, now) {
  const active = list(db, "incidents").filter((item) => !CLOSED.has(lower(item.status)));
  return result(["Current Operational Summary", "", `Active incidents: ${active.length}`, `Critical incidents: ${listCriticalIncidents(db).length}`, `Response units: ${list(db, "responseUnits").length} total`, `Available response units: ${listAvailableUnits(db).length}`, `CCTV sources: ${list(db, "cameraSources").length} total`, `Unhealthy cameras: ${listUnhealthyCameras(db).length}`, `Active SLA breaches: ${listSlaBreaches(db, now).length}`].join("\n"));
}

function listAnswer(title, records, type, formatter, empty) {
  const shown = records.slice(0, 20);
  return result(shown.length ? `${title}\n${shown.map(formatter).join("\n")}${records.length > shown.length ? `\n…and ${records.length - shown.length} more.` : ""}` : empty, shown.map((item) => ({ type, id: idOf(item, type === "camera" ? "cameraId" : type === "response_unit" ? "unitCode" : "id") })));
}

function recommendationAnswer(db, incidentId) {
  const incident = incidentId ? findIncident(db, incidentId) : list(db, "incidents").find((item) => !item.assignedUnitId && !CLOSED.has(lower(item.status)));
  if (!incident) return result(incidentId ? `No incident with ID ${incidentId} was found.` : "No active unassigned incident is available for a recommendation.");
  const rec = incident.dispatchRecommendation?.primary;
  if (rec) return result([`Recommended Unit: ${rec.unit?.unitCode || rec.unitId}`, `Distance: ${display(rec.distanceKm, "Unavailable")}${rec.distanceKm != null ? " km" : ""}`, `ETA: ${display(rec.etaMinutes, "Unavailable")}${rec.etaMinutes != null ? " min" : ""}`, `Status: ${display(rec.unit?.status)}`, `Reason: ${display(rec.selectionReason, "Current authorized dispatch recommendation")}`, "Recommendation only. Assignment must be confirmed from Unit Assignment."].join("\n"), [{ type: "incident", id: incident.id }, { type: "response_unit", id: rec.unit?.unitCode || rec.unitId }], { navigation: navigation("unit-assignment", incident.id) });
  const available = listAvailableUnits(db);
  return result(available.length ? `No current dispatch recommendation is recorded for ${incident.id}. ${available.length} unit(s) are marked available. Open Unit Assignment to calculate an authoritative route-based recommendation.` : `No available unit is currently recorded for ${incident.id}.`, [{ type: "incident", id: incident.id }], { navigation: navigation("unit-assignment", incident.id) });
}

function contextualReferences(message, page, prior = []) {
  const refs = extractReferences(message);
  const referential = /\b(?:this|it|its|current|selected|that|the incident|the camera|the unit|the officer|the track|which unit|assigned unit|who is responding|what is pending|how much sla|status|why is (?:it|this))\b/i.test(message);
  if (Object.values(refs).some((items) => items.length) || (!referential && !page.entityId)) return refs;
  const entityId = prior[0]?.id || page.entityId, type = prior[0]?.type || (page.page.includes("incident") ? "incident" : page.page.includes("camera") || page.page === "cctv" ? "camera" : page.page.includes("unit") ? "unit" : page.page.includes("tracking") ? "track" : null);
  if (entityId && type && refs[type]) refs[type].push(String(entityId).toUpperCase());
  return refs;
}

function classify(text, refs) {
  if (WRITE_REQUEST_PATTERN.test(text) || MULTILINGUAL_WRITE_PATTERN.test(text)) return "blocked_write";
  if (/compare/i.test(text)) return "compare";
  if (/investigations?.+assigned/i.test(text)) return "investigation_search";
  if (refs.officer.length) return "officer_lookup";
  if (refs.track.length) return "tracking_lookup";
  if (refs.camera.length) return "camera_lookup";
  if (refs.unit.length && !refs.incident.length) return "unit_lookup";
  if (refs.incident.length && /investigat|evidence|investigating officer|overdue/i.test(text)) return "investigation_lookup";
  if (refs.incident.length && /recommend|nearest|eligible/i.test(text)) return "unit_recommendation";
  if (refs.incident.length) return "incident_lookup";
  if (/sla|breach|escalat|\bL[234]\b/i.test(text)) return "sla_search";
  if (/incidents?.+(?:unassigned|need(?:s)? (?:a )?unit|critical|today)|(?:unassigned|critical).+incidents?/i.test(text)) return "incident_search";
  if (/officers?.+(?:station|responding)|show officers/i.test(text)) return "officer_search";
  if (/camera|tamper|video frame/i.test(text)) return "camera_search";
  if (/tracking|pending.+track|track.+review/i.test(text)) return "tracking_search";
  if (/unit|patrol/i.test(text)) return "unit_search";
  if (/summary|overview|what needs attention|operational status|today'?s operations/i.test(text)) return "dashboard_summary";
  return "clarification";
}

function sourceMetadata(db, entities) {
  return (entities || []).slice(0, 8).map(({ type, id }) => {
    let record;
    if (type === "incident" || type === "investigation") record = getIncidentById(db, id);
    else if (type === "camera") record = getCameraById(db, id);
    else if (type === "response_unit" || type === "unit") record = getUnitById(db, id);
    else if (type === "officer") record = getOfficerById(db, id);
    else if (type === "track") record = getTrackById(db, id);
    return { type, id, updatedAt: record ? valueFrom(record, "updatedAt", "lastHealthCheckAt", "lastHeartbeatAt", "locationUpdatedAt", "lastSeenAt") : null };
  }).filter((source) => source.id);
}

function answer(db, message, options = {}) {
  const originalText = String(message || "").trim();
  const detected = detectLanguage(originalText, options.priorLanguage);
  const language = responseLanguage(options.selectedLanguage, detected.language);
  const text = normalizeQuery(originalText);
  const now = Number(options.currentTime) || Date.now(), page = sanitizePageContext(options.pageContext), refs = contextualReferences(text, page, options.priorEntities || []);
  const safetyIntent = SENSITIVE_REQUEST_PATTERN.test(originalText) ? "blocked_sensitive" : INJECTION_PATTERN.test(originalText) ? "blocked_safety" : null;
  const intent = safetyIntent || classify(text, refs);
  let response;
  if (intent === "blocked_sensitive") response = result("I can't provide passwords, tokens, credentials, private URLs, or other protected configuration.", [], { blockedSensitiveRequest: true });
  else if (intent === "blocked_safety") response = result("I can only use approved read-only RakshakAI information tools. I cannot bypass safety rules, execute SQL, or write to operational data.", [], { blockedSafetyRequest: true });
  else if (intent === "blocked_write") response = result("I can show operational information but cannot modify RakshakAI data. Use the relevant authorized operational page to perform that action.", [], { blockedWriteRequest: true, navigation: page.page === "dashboard" ? undefined : navigation(page.page, page.entityId) });
  else if (intent === "compare") response = compareAnswer(db, refs, now);
  else if (intent === "officer_lookup") response = officerAnswer(db, refs.officer[0]);
  else if (intent === "tracking_lookup") response = trackAnswer(db, refs.track[0], text);
  else if (intent === "camera_lookup") response = cameraAnswer(db, refs.camera[0], now);
  else if (intent === "unit_lookup") response = unitAnswer(db, refs.unit[0], now);
  else if (intent === "investigation_lookup") response = investigationAnswer(db, refs.incident[0], now);
  else if (intent === "unit_recommendation") response = recommendationAnswer(db, refs.incident[0]);
  else if (intent === "incident_lookup") response = incidentAnswer(db, refs.incident[0], now, text);
  else if (intent === "sla_search") { const records = listSlaBreaches(db, now); response = listAnswer("Incidents at or beyond SLA breach:", records, "incident", (item) => `${item.id}: ${upper(item.severity)} · ${getEscalationLevel(item, list(db, "slaConfig"), now)}`, "No current SLA breaches are recorded."); }
  else if (intent === "incident_search") {
    let records = list(db, "incidents").filter((item) => !CLOSED.has(lower(item.status)));
    if (/unassigned|need(?:s)? (?:a )?unit/i.test(text)) records = records.filter((item) => !valueFrom(item, "assignedUnitId", "assigned_unit_id"));
    if (/critical/i.test(text)) records = records.filter((item) => upper(item.severity) === "CRITICAL");
    if (/today/i.test(text)) { const day = new Date(now).toISOString().slice(0, 10); records = records.filter((item) => String(valueFrom(item, "createdAt", "updatedAt") || "").slice(0, 10) === day); }
    response = listAnswer("Matching active incidents:", records, "incident", (item) => `${item.id}: ${upper(item.severity || "UNKNOWN")} · ${display(item.status)} · ${display(valueFrom(item, "assignedUnitId", "assigned_unit_id"), "Unassigned")}`, "No matching active incidents were found.");
  }
  else if (intent === "investigation_search") {
    const officerRef = refs.officer[0];
    const officer = officerRef ? findOfficer(db, officerRef) : null, officerId = officer && valueFrom(officer, "userId", "user_id", "id");
    const records = list(db, "incidents").filter((item) => item.investigationRequired && (!officerRef || same(item.investigatingOfficerId, officerId) || same(item.investigatingOfficerId, officerRef)));
    response = listAnswer("Matching investigations:", records, "investigation", (item) => `${item.id}: ${display(item.investigationStatus, "UNKNOWN")} · Officer ${display(item.investigatingOfficerId, "Unassigned")}`, "No matching investigations were found.");
  }
  else if (intent === "officer_search") {
    const phrase = text.match(/(?:from|in|at)\s+(.+?)(?:\s+police station)?[?.]?$/i)?.[1], responding = /responding|assigned/i.test(text);
    const records = list(db, "policeOfficers").filter((officer) => (!responding || valueFrom(officer, "assignedIncidentId", "assigned_incident_id")) && (!phrase || lower(valueFrom(stationFor(db, officer), "stationName", "name", "stationId")).includes(lower(phrase))));
    response = listAnswer("Authorized officers:", records, "officer", (item) => { const x = getOfficerById(db, idOf(item, "badgeId", "badge_id")); return `${display(x?.id)}: ${display(x?.name)} · ${display(x?.stationName)} · ${display(x?.dutyStatus)}`; }, "No matching officers were found.");
  } else if (intent === "camera_search") {
    let records = /offline/i.test(text) ? list(db, "cameraSources").filter((item) => upper(valueFrom(item, "healthStatus", "status")) === "OFFLINE") : listUnhealthyCameras(db);
    if (/tamper/i.test(text)) records = list(db, "cameraSources").filter((item) => upper(valueFrom(item, "healthStatus", "status")).includes("TAMPER"));
    const location = text.match(/(?:in|at)\s+(.+?)[?.]?$/i)?.[1];
    if (location) records = records.filter((item) => lower(valueFrom(item, "zone", "location", "stationName", "address")).includes(lower(location)));
    response = listAnswer("Cameras needing attention:", records, "camera", (item) => `${idOf(item, "cameraId")}: ${upper(valueFrom(item, "healthStatus", "status") || "UNKNOWN")} · ${display(valueFrom(item, "zone", "location"))}`, "No matching unhealthy cameras are currently recorded.");
  } else if (intent === "unit_search") {
    const records = /offline/i.test(text) ? list(db, "responseUnits").filter((item) => lower(item.status) === "offline") : listAvailableUnits(db);
    response = listAnswer(/offline/i.test(text) ? "Offline response units:" : "Available response units:", records, "response_unit", (item) => `${idOf(item, "unitCode", "unitId")}: ${upper(item.status)} · ${display(valueFrom(item, "stationName", "station", "zone"))}`, /offline/i.test(text) ? "No response units are currently recorded as offline." : "No response units are currently recorded as available.");
  } else if (intent === "tracking_search") {
    const records = list(db, "trackingSessions").filter((item) => !CLOSED.has(lower(item.status)) && !/confirmed|rejected/i.test(String(item.verificationStatus || "")));
    response = listAnswer("Tracking sessions pending review:", records, "track", (item) => `${idOf(item, "trackId", "subjectId", "entityId")}: ${upper(item.status || "PENDING REVIEW")}`, "No tracking sessions are currently pending review.");
  } else if (intent === "dashboard_summary") response = dashboardAnswer(db, now);
  else response = result("I couldn't confidently identify the operational request. Try asking about an incident ID, camera, unit, SLA, or tracking session.", [], { clarificationRequired: true });
  const sources = sourceMetadata(db, response.entities);
  return { ...response, answer: localizeAnswer(response.answer, language), sources, intent, detectedLanguage: detected.language, responseLanguage: language, languageConfidence: detected.confidence };
}

module.exports = { answer, clean, relativeTime, extractReferences, sanitizePageContext, classify, sourceMetadata, READ_ONLY_QUERY_REGISTRY, WRITE_PATTERN: WRITE_REQUEST_PATTERN, WRITE_REQUEST_PATTERN };
