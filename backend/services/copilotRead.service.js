const { getAssignmentSlaStatus, getResponseSlaStatus, getEscalationLevel, isInvestigationInactive } = require("./sla.service");
const { listRecords: listCctnsRecords } = require("./cctns.service");
const { isOfficerCollectionQuery, officerIntent, listOfficersByStation, canReadOfficer, operationalAvailability } = require("./copilotOfficers.service");
const { unitTelemetryFreshness, unitTelemetryDispatchQuality } = require("./unitTelemetry.service");
const { activeOfficerDeployments } = require("./incidentOfficerAssignment.service");
const {
  detectLanguage, normalizeQuery, responseLanguage, localizeAnswer,
  MULTILINGUAL_WRITE_PATTERN, SENSITIVE_REQUEST_PATTERN, INJECTION_PATTERN
} = require("./copilotLanguage.service");

// Pure read adapter: no repository, SQL, persistence, or operational command is imported here.
const SECRET_PATTERN = /password|secret|token|credential|api[_-]?key|jwt|rtsp|connection.?string|private.?key/i;
const WRITE_REQUEST_PATTERN = /\b(?:create|add|update|edit|delete|remove|assign|reassign|release|resolve|close|acknowledge|mark|start\s+maintenance|confirm(?:\s+(?:the\s+)?match)?|reject(?:\s+(?:the\s+)?match)?|change|increase|decrease|set|disable|enable)\b/i;
const CLOSED = new Set(["closed", "resolved", "rejected", "cancelled", "completed"]);
const HEALTHY = new Set(["online", "available", "ready"]);
const PAGES = new Set(["dashboard", "cctns", "incident-command", "unit-assignment", "response-units", "cctv", "camera-health", "multi-camera-tracking", "investigations", "gis", "escalations", "reports", "history", "alerts", "video-evidence", "live-vision", "police-management", "settings"]);

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

const CASUAL_PATTERNS = {
  greeting: /\b(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|namaste|vanakkam)\b/i,
  thanks: /\b(?:thanks|thank\s+you|thx|ty|shukriya|dhanyavaad|dhanyavaadam)\b/i,
  acknowledgment: /\b(?:okay|ok|got\s+it|cool|understood|right|sure|fine|alright)\b/i,
  repeat: /\b(?:repeat|say\s+again|what\s+was\s+that|can\s+you\s+repeat)\b/i,
  explain: /\b(?:explain|why|what\s+do\s+you\s+mean|tell\s+me\s+more|in\s+simple\s+terms|simply|break\s+it\s+down)\b/i,
  summary: /\b(?:summarize|summary|short\s+answer|brief|in\s+short)\b/i,
  next: /\b(?:what\s+next|what\s+should\s+i\s+(?:check|do|look\s+at)|anything\s+else|next\s+step)\b/i
};

const FOLLOWUP_PATTERNS = {
  showDetails: /\b(?:show|open|view|details?|expand)\s+(?:those|them|that|it|these|this)\b/i,
  whichOne: /\b(?:which\s+(?:one|incident|camera|unit|officer|track)|(?:the\s+)?(?:first|second|third|last)\s+one|most\s+(?:critical|serious|urgent|important))\b/i,
  whatAbout: /\b(?:what\s+about|how\s+about)\s+(?:cameras?|units?|officers?|incidents?|tracks?|tracking|sla|cctns|cctv|evidence|reports?)\b/i,
  filterCurrent: /\b(?:only\s+(?:critical|high|medium|low|unassigned|open|active|pending)|just\s+(?:the\s+)?(?:critical|high|medium|low|unassigned|open|active|pending))\b/i,
  moreInfo: /\b(?:more\s+(?:info|details|about)|tell\s+me\s+more)\b/i
};

function isCasualQuery(text) {
  return Object.values(CASUAL_PATTERNS).some(pattern => pattern.test(text));
}

function getCasualType(text) {
  for (const [type, pattern] of Object.entries(CASUAL_PATTERNS)) {
    if (pattern.test(text)) return type;
  }
  return null;
}

function isFollowupQuery(text) {
  return Object.values(FOLLOWUP_PATTERNS).some(pattern => pattern.test(text));
}

function getFollowupType(text) {
  for (const [type, pattern] of Object.entries(FOLLOWUP_PATTERNS)) {
    if (pattern.test(text)) return type;
  }
  return null;
}

function resolvePronouns(text, priorEntities = [], page = {}) {
  const pronouns = {
    'those': 'plural',
    'them': 'plural',
    'that': 'singular',
    'it': 'singular',
    'these': 'plural',
    'this': 'singular',
    'there': 'location'
  };

  let resolved = text;
  for (const [pronoun, number] of Object.entries(pronouns)) {
    const regex = new RegExp(`\\b${pronoun}\\b`, 'gi');
    if (regex.test(text)) {
      if (priorEntities.length) {
        const recentType = priorEntities[0]?.type;
        if (recentType) {
          const typeLabel = recentType === 'response_unit' ? 'unit' : recentType === 'investigation' ? 'investigation' : recentType;
          if (number === 'plural') {
            resolved = resolved.replace(regex, `those ${typeLabel}s`);
          } else if (number === 'singular') {
            resolved = resolved.replace(regex, `that ${typeLabel}`);
          } else if (number === 'location') {
            resolved = resolved.replace(regex, `that ${typeLabel}`);
          }
        }
      }
    }
  }

  const ordinalMatch = text.match(/\b(first|second|third|last)\s+(?:one|incident|camera|unit|officer|track)\b/i);
  if (ordinalMatch && priorEntities.length) {
    const index = { first: 0, second: 1, third: 2, last: priorEntities.length - 1 }[lower(ordinalMatch[1])] || 0;
    const entity = priorEntities[index];
    if (entity) {
      resolved = resolved.replace(/\b(first|second|third|last)\s+(?:one|incident|camera|unit|officer|track)\b/i, `${entity.type} ${entity.id}`);
    }
  }

  return resolved;
}

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
    unit: /\b(?:UNIT[-_][A-Z0-9_-]+|(?:[A-Z0-9]+-)?P-\d{1,})\b/gi,
    track: /\b(?:PERSON|VEH(?:ICLE)?|TRACK)[-_][A-Z0-9_-]+\b/gi
  };
  return Object.fromEntries(Object.entries(patterns).map(([type, pattern]) => [type, [...new Set((text.match(pattern) || []).map((item) => item.toUpperCase()))]]));
}

function sanitizePageContext(context = {}) {
  const page = PAGES.has(String(context.page || "")) ? String(context.page) : "dashboard";
  const entityId = /^[A-Za-z0-9_-]{1,100}$/.test(String(context.entityId || "")) ? String(context.entityId) : null;
  return { page, entityId, ...(page === "unit-assignment" && entityId && context.recommendationTimedOut === true ? { recommendationTimedOut: true } : {}) };
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
  return list(db, "responseUnitMembers").filter((member) => member.active !== false && [unit.id, unit.unitId, unit.unitCode].some((id) => same(valueFrom(member, "unitId", "unit_id"), id))).map((member) => {
    const officer = findOfficer(db, valueFrom(member, "officerUserId", "officer_user_id"));
    const user = officer && userForOfficer(db, officer);
    return officer ? { id: idOf(officer, "badgeId", "badge_id"), name: user?.name || officer.name || null, role: member.role || "member" } : null;
  }).filter(Boolean);
}

function getOfficerById(db, id) {
  const officer = findOfficer(db, id);
  if (!officer) return null;
  const user = userForOfficer(db, officer), station = stationFor(db, officer), unit = unitForOfficer(db, officer);
  return clean({ id: idOf(officer, "officerId", "badgeId", "badge_id"), name: user?.name || officer.name || null, stationId: station ? idOf(station, "stationId", "stationCode") : valueFrom(officer, "stationId", "station_id"), stationName: station ? valueFrom(station, "stationName", "name") : null, unitId: unit ? idOf(unit, "unitCode", "unitId") : null, beat: valueFrom(officer, "beat", "beatId", "beat_id"), jurisdiction: officer.jurisdiction || null, dutyStatus: valueFrom(officer, "dutyStatus", "duty_status"), availabilityStatus: operationalAvailability(db, valueFrom(officer, "userId", "user_id", "id"), valueFrom(officer, "availabilityStatus", "availability_status")), assignedIncidentId: valueFrom(officer, "assignedIncidentId", "assigned_incident_id"), active: officer.active !== false, updatedAt: valueFrom(officer, "updatedAt", "lastUpdated") });
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
const READ_ONLY_QUERY_REGISTRY = Object.freeze({ getOfficerById, getIncidentById, getCameraById, getUnitById, getTrackById, listCriticalIncidents, listAvailableUnits, listUnhealthyCameras, listSlaBreaches, listOfficersByStation });

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
  const freshness = unitTelemetryFreshness(findUnit(db, id), now);
  return result([item.id || id, "", `Status: ${display(item.status, "UNKNOWN")}`, `Station: ${display(item.stationName)}`, `Assigned Incident: ${display(item.assignedIncidentId, "None")}`, `Current Location: ${display(item.location, "Unavailable")}`, item.locationUpdatedAt ? `GPS updated: ${relativeTime(item.locationUpdatedAt, now)}` : null, freshness.state === "FRESH" ? "GPS freshness: CURRENT" : `GPS freshness: ${freshness.state}${freshness.state === "STALE" ? "; do not treat this location as current." : ""}`, `Officers: ${item.members.length ? item.members.map((member) => `${display(member.name, member.id)} (${member.id})`).join(", ") : "No unit members recorded"}`].filter(Boolean).join("\n"), [{ type: "response_unit", id: item.id || id }], { navigation: navigation("unit-assignment", item.id || id) });
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

function casualGreeting(db, language) {
  const greetings = {
    en: "Hi. How can I help with the current operation?",
    te: "హలో. ప్రస్తుత ఆపరేషన‌లో నేను ఎలా సహాయపడగలను?",
    hi: "नमस्ते। वर्तमान ऑपरेशन में मैं कैसे मदद कर सकता हूँ?"
  };
  return result(greetings[language] || greetings.en);
}

function casualThanks(db, language) {
  const responses = {
    en: "You're welcome.",
    te: "మీకు సహాయం అయ్యిన విషయంలో సంతోషం.",
    hi: "आपका स्वागत है।"
  };
  return result(responses[language] || responses.en);
}

function casualAcknowledgment(db, language) {
  const responses = {
    en: "Okay. Let me know if you need anything else.",
    te: "సರಿ. ఏదో అంతరిక్తం అవసరమైతే చెప్పండి.",
    hi: "ठीक है। कुछ और चाहिए तो बताएं।"
  };
  return result(responses[language] || responses.en);
}

function casualRepeat(db, priorEntities, language) {
  const responses = {
    en: "Sure. What would you like me to repeat?",
    te: "ఖచ్చితంగా. మీరు ఏమని పునరావృతం చేయాలనుకుంటున్నారు?",
    hi: "ज़रूर। आप क्या दोहराना चाहते हैं?"
  };
  if (priorEntities.length) {
    const last = priorEntities[0];
    return result(`Last result was about ${last.type} ${last.id}. What would you like to know?`, [last]);
  }
  return result(responses[language] || responses.en);
}

function casualExplain(db, priorEntities, language) {
  const responses = {
    en: "I'm showing operational data from authorized Rakshak AI records. What part would you like me to explain?",
    te: "నేను అధీకృత Rakshak AI రికార్డుల నుండి ఆపరేషనల్ డేటాను చూపిస్తున్నాను. ఏ భాగాన్ని వివరించాలి?",
    hi: "मैं अधिकृत Rakshak AI रिकॉर्ड से ऑपरेशनल डेटा दिखा रहा हूँ। आप किस भाग को समझाना चाहते हैं?"
  };
  if (priorEntities.length) {
    const last = priorEntities[0];
    return result(`The previous answer was based on ${last.type} ${last.id} from the current authorized data. What specifically would you like me to explain?`, [last]);
  }
  return result(responses[language] || responses.en);
}

function casualSummary(db, priorEntities, language) {
  if (priorEntities.length) {
    const entities = [...new Map(priorEntities.map(e => [e.id, e])).values()];
    return result(`Summary: ${entities.length} item(s) — ${entities.map(e => `${e.type} ${e.id}`).join(", ")}.`, entities);
  }
  const responses = {
    en: "No previous results to summarize.",
    te: "సారాంశం చేయడానికి మునుపటి ఫలితాలు లేవు.",
    hi: "सारांश के लिए कोई पिछला परिणाम नहीं है।"
  };
  return result(responses[language] || responses.en);
}

function casualNext(db, priorEntities, page, db_, now, language) {
  const critical = listCriticalIncidents(db_).length;
  const slaBreaches = listSlaBreaches(db_, now).length;
  const unhealthy = listUnhealthyCameras(db_).length;
  const available = listAvailableUnits(db_).length;

  const items = [];
  if (critical) items.push(`${critical} critical incident${critical > 1 ? 's' : ''}`);
  if (slaBreaches) items.push(`${slaBreaches} SLA breach${slaBreaches > 1 ? 'es' : ''}`);
  if (unhealthy) items.push(`${unhealthy} unhealthy camera${unhealthy > 1 ? 's' : ''}`);
  if (available) items.push(`${available} available unit${available > 1 ? 's' : ''}`);

  if (items.length) {
    return result(`Check: ${items.join(", ")}.`, []);
  }

  const responses = {
    en: "No urgent items right now. Current operation is stable.",
    te: "ఇప్పుడు అత్యవసర అంశాలు లేవు. ప్రస్తుత ఆపరేషన్లు స్థిరంగా ఉన్నాయి.",
    hi: "अभी कोई जरूरी आइटम नहीं है। वर्तमान ऑपरेशन स्थिर है।"
  };
  return result(responses[language] || responses.en);
}

function listAnswer(title, records, type, formatter, empty, limit = 20) {
  const shown = records.slice(0, limit);
  return result(shown.length ? `${title}\n${shown.map(formatter).join("\n")}${records.length > shown.length ? `\n…and ${records.length - shown.length} more.` : ""}` : empty, shown.map((item) => ({ type, id: idOf(item, type === "camera" ? "cameraId" : type === "response_unit" ? "unitCode" : "id") })));
}

function recommendationAnswer(db, incidentId, eligibility, dispatchDb, timedOut) {
  const incident = incidentId ? findIncident(db, incidentId) : list(db, "incidents").find((item) => !item.assignedUnitId && !CLOSED.has(lower(item.status)));
  if (!incident) return result(incidentId ? `No incident with ID ${incidentId} was found.` : "No active unassigned incident is available for a recommendation.");
  if (timedOut) return result("Unit recommendation is temporarily unavailable because the routing/recommendation request timed out.");
  const rec = incident.dispatchRecommendation?.primary;
  if (rec) return result([`Recommended Unit: ${rec.unit?.unitCode || rec.unitId}`, `Distance: ${display(rec.distanceKm, "Unavailable")}${rec.distanceKm != null ? " km" : ""}`, `ETA: ${display(rec.etaMinutes, "Unavailable")}${rec.etaMinutes != null ? " min" : ""}`, `Status: ${display(rec.unit?.status)}`, `Reason: ${display(rec.selectionReason, "Current authorized dispatch recommendation")}`, "Recommendation only. Assignment must be confirmed from Unit Assignment."].join("\n"), [{ type: "incident", id: incident.id }, { type: "response_unit", id: rec.unit?.unitCode || rec.unitId }], { navigation: navigation("unit-assignment", incident.id) });
  if (incident.dispatchRecommendation?.error && /timeout|timed out/i.test(incident.dispatchRecommendation.error)) return result("Unit recommendation is temporarily unavailable because the routing/recommendation request timed out.");
  if (eligibility && eligibility(dispatchDb || db, incident).eligible.length === 0) return result("No dispatch-eligible response unit is currently available.", [{ type: "incident", id: incident.id }]);
  return result(`No current dispatch recommendation is recorded for ${incident.id}. Open Unit Assignment to calculate one.`, [{ type: "incident", id: incident.id }], { navigation: navigation("unit-assignment", incident.id) });
}

function unitCollectionAnswer(db, text, now, options) {
  if (options.actor && !["Admin", "Police Officer"].includes(options.actor.role)) return result("Response units require an authorized operator.");
  const units = list(db, "responseUnits");
  const eligibility = options.dispatchEligibilitySnapshot;
  const eligible = eligibility ? eligibility(options.dispatchDb || db, {}).eligible : null;
  const eligibleIds = new Set((eligible || []).map((unit) => unit.id));
  const freshness = (unit) => unitTelemetryFreshness(unit, now);
  const status = (unit) => lower(unit.status);
  const committed = (unit) => ["busy", "assigned", "en route", "on scene"].includes(status(unit)) || Boolean(valueFrom(unit, "assignedIncidentId", "currentIncidentId"));
  const available = units.filter((unit) => status(unit) === "available");
  const stale = units.filter((unit) => !freshness(unit).eligible);
  const operational = units.filter((unit) => options.unitForResponse ? options.unitForResponse(unit).operational : unit.operational !== false);
  if (/\b(?:total|how many|count|number of)\b/i.test(text) && !/\b(?:available|free|busy|offline|stale|eligible)\b/i.test(text)) {
    return result([`Total registered response units: ${units.length}`, `Operational: ${operational.length}`, `Registry-available: ${available.length}`, `Busy or committed: ${units.filter(committed).length}`, `Stale or unavailable telemetry: ${stale.length}`, eligible ? `Live dispatch-eligible: ${eligible.length}` : "Live dispatch eligibility: unavailable", "Categories can overlap; eligibility is not a routing recommendation."].join("\n"));
  }
  let records = units, title = "All registered response units";
  if (/\beligible\b/i.test(text)) {
    if (!eligible) return result("Live dispatch eligibility is temporarily unavailable.");
    records = eligible; title = "Live dispatch-eligible units (general requirements; incident and routing checks still apply)";
  } else if (/\b(?:available|free)\b/i.test(text)) { records = available; title = "Available response units (registry status)"; }
  else if (/\bbusy\b/i.test(text)) { records = units.filter(committed); title = "Busy or committed units"; }
  else if (/\boffline\b/i.test(text)) { records = units.filter((unit) => status(unit) === "offline"); title = "Offline units"; }
  else if (/\bstale\b/i.test(text)) { records = stale; title = "Units with stale or unavailable telemetry"; }
  const response = listAnswer(`${title}: ${records.length}`, records, "response_unit", (unit) => {
    const view = options.unitForResponse ? options.unitForResponse(unit) : unit;
    const station = stationFor(db, unit);
    const quality = unitTelemetryDispatchQuality(unit, now);
    return `${idOf(unit, "unitCode", "unitId")} · ${display(valueFrom(view, "unitType", "type"))} · ${display(valueFrom(station, "stationName", "name") || valueFrom(view, "stationName", "station"))} · ${view.operational === false ? "Non-operational" : "Operational"} · ${upper(unit.status) || "UNKNOWN"} · GPS ${freshness(unit).state} · ${committed(unit) ? "Committed" : "No recorded assignment"}${/\b(?:available|free)\b/i.test(text) ? !eligible ? " · Live dispatch eligibility unavailable" : !eligibleIds.has(unit.id) ? ` · Not live dispatch-eligible${!quality.eligible ? ` (${quality.reason})` : " under current responder rules"}` : " · Live dispatch-eligible" : ""}`;
  }, `No ${title.toLowerCase()} are recorded.`, title === "All registered response units" ? records.length : 20);
  return response;
}

function incidentCollectionQuery(text, page = {}, prior = []) {
  if (/\b(?:sla|breach|breached|escalation|investigation|evidence)\b/i.test(text)) return false;
  if (page.page === "cctns" && /\bcases?\b/i.test(text)) return false;
  if (extractReferences(text).incident.length && !/\bincidents\b/i.test(text)) return false;
  if (/\b(?:this|selected|current|that) incident\b/i.test(text) && !/\bincidents\b/i.test(text)) return false;
  const aggregate = /\b(?:total|counts?|how many|list|show all)\b/i.test(text);
  if (/\bincidents?\b/i.test(text)) return aggregate || /\b(?:critical|high|medium|low|unassigned|open|active|pending) incidents\b/i.test(text);
  return (aggregate || /\bpending\s+cases?\b/i.test(text)) && (page.page === "incident-command" || (prior[0]?.type === "incident" && !/\bcases?\b/i.test(text)))
    && !/\b(?:camera|officer|unit|track|evidence|investigation)s?\b/i.test(text);
}

// Match the existing station/ownership incident-access policy, without importing writes.
function scopedIncidents(db, actor) {
  if (!actor) return db; // Internal trusted adapters/tests may supply an already scoped snapshot.
  if (actor.role === "Admin") return db;
  const stations = new Set([actor.stationId, actor.data?.stationId].filter(Boolean));
  for (const officer of list(db, "policeOfficers")) {
    if (same(officer.userId || officer.officerUserId, actor.id)) stations.add(officer.stationId);
  }
  for (const member of list(db, "responseUnitMembers")) {
    if (same(member.officerUserId, actor.id)) stations.add(findUnit(db, member.unitId)?.stationId);
  }
  return { ...db, incidents: actor.role !== "Police Officer" ? [] : list(db, "incidents").filter((item) => {
    const station = valueFrom(item, "stationId", "station_id", "jurisdictionId", "jurisdiction_id");
    return station ? stations.has(station) : same(item.createdBy, actor.id) || same(item.reportedBy, actor.id);
  }) };
}

function incidentCollectionAnswer(db, text, now) {
  let records = list(db, "incidents");
  const activeOnly = /\b(?:open|active|pending|unassigned)\b|needs? (?:a )?unit/i.test(text);
  if (activeOnly) records = records.filter((item) => !CLOSED.has(lower(item.status)));
  if (/unassigned|needs? (?:a )?unit/i.test(text)) records = records.filter((item) => !valueFrom(item, "assignedUnitId", "assigned_unit_id"));
  const severities = ["critical", "high", "medium", "low"].filter((severity) => new RegExp(`\\b${severity}\\b`, "i").test(text));
  if (severities.length) records = records.filter((item) => severities.includes(lower(item.severity)));
  if (/\btoday\b/i.test(text)) records = records.filter((item) => String(valueFrom(item, "createdAt", "updatedAt") || "").slice(0, 10) === new Date(now).toISOString().slice(0, 10));
  const groups = severities.length ? severities : [...new Set(["critical", "high", "medium", "low", ...records.map((item) => lower(item.severity) || "unknown")])];
  const lines = [`${activeOnly ? "Matching active incidents" : "Matching incidents"}: ${records.length}`];
  const entities = [];
  for (const severity of groups) {
    const matches = records.filter((item) => (lower(item.severity) || "unknown") === severity);
    const label = severity[0].toUpperCase() + severity.slice(1);
    lines.push(`${label} incidents: ${matches.length}`);
  }
  for (const severity of groups) {
    const matches = records.filter((item) => (lower(item.severity) || "unknown") === severity);
    if (!matches.length) continue;
    lines.push("", `${severity[0].toUpperCase() + severity.slice(1)} incidents:`);
    matches.slice(0, 20).forEach((item, index) => {
      lines.push(`${index + 1}. ${display(valueFrom(item, "title", "type", "category"), "Incident")} (${item.id}) — ${display(item.status)} — ${display(valueFrom(item, "assignedUnitId", "assigned_unit_id"), "Unassigned")}`);
      entities.push({ type: "incident", id: item.id });
    });
    if (matches.length > 20) lines.push(`Showing 20 of ${matches.length}; open Incident Command for the full queue.`);
  }
  return result(lines.join("\n"), entities, { navigation: navigation("incident-command") });
}

function contextualReferences(message, page, prior = []) {
  const refs = extractReferences(message);
  const referential = /\b(?:this|it|its|there|current|selected|that|the incident|the camera|the unit|the officer|the track|which unit|assigned unit|who is responding|what is pending|how much sla|status|why is (?:it|this))\b/i.test(message);
  if (Object.values(refs).some((items) => items.length) || (!referential && !page.entityId)) return refs;
  const selected = /\bselected\b/i.test(message) && page.entityId;
  const pageType = page.page.includes("incident") ? "incident" : page.page.includes("camera") || page.page === "cctv" ? "camera" : page.page.includes("unit") ? "unit" : page.page.includes("tracking") ? "track" : null;
  const entityId = selected ? page.entityId : prior[0]?.id || page.entityId, type = selected ? pageType : prior[0]?.type || pageType;
  if (entityId && type && refs[type]) refs[type].push(String(entityId).toUpperCase());
  return refs;
}

function classify(text, refs, collection = false, priorEntities = [], page = {}) {
  if (WRITE_REQUEST_PATTERN.test(text) || MULTILINGUAL_WRITE_PATTERN.test(text)) return "blocked_write";
  if (refs.incident.length && /\b(?:responding|supporting)\b/i.test(text)) return /\bsupporting\b/i.test(text) ? "incident_support" : "incident_responders";
  if (/\b(?:unit|units|patrol)\b/i.test(text) && /\brecommend(?:ed|ation)?\b/i.test(text)) return "unit_recommendation";
  // Explicit operational references and collection requests take precedence over
  // conversational words such as "why", "okay", or "which one".
  const explicit = extractReferences(text);
  if (isOfficerCollectionQuery(text)) return officerIntent(text);
  if (/compare/i.test(text)) return "compare";
  if (page.page === "cctns" && /\bcases?\b/i.test(text)) return "cctns_case_search";
  if (collection || incidentCollectionQuery(text)) return "incident_search";
  if (/\bcases?\b/i.test(text)) return "cctns_case_search";
  if (/\bany(?:thing)?\s+(?:issue|issues|problem|problems)\s+there\b/i.test(text) && priorEntities[0]?.type === "camera") return "camera_lookup";
  if (/\b(?:anything|any)\s+pending\b/i.test(text) && ["cctv", "camera-health"].includes(page.page)) return "camera_search";
  if (page.page === "multi-camera-tracking" && /\bpending\s+reviews?\b/i.test(text)) return "tracking_search";
  if (explicit.officer.length) return "officer_lookup";
  if (explicit.track.length) return "tracking_lookup";
  if (explicit.camera.length) return "camera_lookup";
  if (explicit.unit.length && !explicit.incident.length) return "unit_lookup";
  if (explicit.incident.length && /investigat|evidence|investigating officer|overdue/i.test(text)) return "investigation_lookup";
  if (explicit.incident.length && /recommend|nearest|eligible/i.test(text)) return "unit_recommendation";
  if (explicit.incident.length) return "incident_lookup";
  if (/operational\s+(?:summary|overview|status)|today'?s operations/i.test(text)) return "dashboard_summary";
  if (isCasualQuery(text)) return "casual";
  if (isFollowupQuery(text)) return "followup";
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

  // Check for natural language queries about counts/status
  if (/how many|count|total|number of/.test(text)) {
    if (/case|cases|cctns/.test(text) || page.page === "cctns") return "cctns_case_search";
    if (/incident|incidents/.test(text)) return "incident_search";
    if (/camera|cameras/.test(text)) return "camera_search";
    if (/unit|units|patrol/.test(text)) return "unit_search";
    if (/officer|officers|police/.test(text)) return "officer_search";
    if (/track|tracking/.test(text)) return "tracking_search";
    if (/sla|breach/.test(text)) return "sla_search";
    if (/pending/.test(text)) {
      if (page.page === "cctns") return "cctns_case_search";
      if (page.page === "incident-command" || page.page === "dashboard") return "incident_search";
      if (page.page === "cctv" || page.page === "camera-health") return "camera_search";
      return "incident_search";
    }
  }

  if (/anything important|what'?s going on|what is going on|status|overview|summary/.test(text)) {
    return "dashboard_summary";
  }

  if (/any\s+(?:camera|cameras?)\s+(?:offline|down|issue|problem)/.test(text)) return "camera_search";
  if (/any\s+(?:unit|units?)\s+(?:free|available|offline)/.test(text)) return "unit_search";
  if (/any\s+(?:sla|breach|escalation)/.test(text)) return "sla_search";

  return "clarification";
}

function incidentRespondersAnswer(db, reference, actor, supportOnly = false) {
  if (actor && !["Admin", "Police Officer"].includes(actor.role)) return result("Operational response information requires authorized access.", [], { scopeDenied: true });
  const incident = findIncident(db, reference);
  if (!incident) return result(`Incident ${reference} was not found in your authorized scope.`);
  const unit = findUnit(db, valueFrom(incident, "assignedUnitId", "assigned_unit_id"));
  const lines = [];
  const allowedName = (id) => {
    if (!canReadOfficer(db, actor, id)) return null;
    const officer = findOfficer(db, id);
    return officer ? userForOfficer(db, officer)?.name || officer.name || id : null;
  };
  if (!supportOnly && unit) {
    lines.push(`Primary Response: ${idOf(unit, "unitCode", "unitId")}`);
    const named = new Set();
    const explicitlyTracked = new Set((db.incidentOfficerAssignments || [])
      .filter((deployment) => deployment.incidentId === incident.id)
      .map((deployment) => String(deployment.officerId)));
    for (const deployment of activeOfficerDeployments(db, { incidentId: incident.id })) {
      const name = allowedName(deployment.officerId);
      if (name) { lines.push(`- ${name} (${deployment.responseRole})`); named.add(String(deployment.officerId)); }
    }
    // Unit assignment makes the configured, active on-duty crew visible as the
    // primary unit roster. Explicit officer deployments remain listed above and
    // are never replaced by membership-derived entries.
    for (const member of db.responseUnitMembers || []) {
      if ((member.unitId || member.unit_id) !== unit.id || member.active === false) continue;
      const officerId = member.officerUserId || member.officer_user_id;
      if (!officerId || named.has(String(officerId)) || explicitlyTracked.has(String(officerId))) continue;
      const officer = findOfficer(db, officerId);
      if (!officer || officer.active === false || !same(valueFrom(officer, "dutyStatus", "duty_status"), "on_duty")) continue;
      const name = allowedName(officerId);
      if (name) { lines.push(`- ${name} (unit crew)`); named.add(String(officerId)); }
    }
  }
  if (!incident.resourcesReleasedAt) for (const allocation of incident.supportAllocations || []) {
    const names = (allocation.officerIds || []).filter((id) => {
      const officer = findOfficer(db, id);
      return officer && same(valueFrom(officer, "assignedIncidentId", "assigned_incident_id"), incident.id);
    }).map(allowedName).filter(Boolean);
    const incidentStation = valueFrom(incident, "stationId", "station_id", "jurisdictionId", "jurisdiction_id");
    const sameStation = incidentStation && [allocation.stationId, allocation.stationCode].some((id) => same(id, incidentStation));
    if (names.length) lines.push(`${sameStation ? "Additional Station Support" : "Emergency Support"}: ${allocation.stationName || allocation.stationCode || allocation.stationId || "Station not recorded"}`, ...names.map((name) => `- ${name}`));
  }
  if (!supportOnly && incident.investigatingOfficerId) {
    const name = allowedName(incident.investigatingOfficerId);
    if (name) lines.push(`Investigation: ${name}`);
  }
  return result(lines.length ? lines.join("\n") : "No authorized active response details are recorded.", [{ type: "incident", id: incident.id }]);
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

function cctnsCaseCount(db, actor) {
  if (!actor || !["Admin", "Police Officer"].includes(actor.role)) {
    return result("CCTNS case counts require an authorized operator.", []);
  }
  const statuses = ["ACTIVE", "UNDER INVESTIGATION", "OPEN", "PENDING"];
  const results = statuses.map((status) => listCctnsRecords(db, actor, { type: "case", status, limit: 1 }));
  if (results.some((item) => item.state === "ADAPTER_UNAVAILABLE")) {
    return result("The CCTNS simulator is unavailable; case counts cannot be determined.", [], { navigation: navigation("cctns") });
  }
  const counts = results.map((item) => item.total);
  const health = results[0].adapter.status === "DEGRADED" ? " Adapter status: DEGRADED." : "";
  return result(`CCTNS simulator (not live government data): ${counts.reduce((a, b) => a + b, 0)} cases in the statuses ACTIVE, UNDER INVESTIGATION, OPEN or PENDING. ${statuses.map((status, i) => `${status}: ${counts[i]}`).join("; ")}.${health} Other statuses are excluded.`, [], { navigation: navigation("cctns") });
}

function pendingTrackingReviews(db, actor) {
  if (actor && !["Admin", "Police Officer"].includes(actor.role)) return result("Tracking reviews require an authorized operator.", []);
  const candidates = list(db, "trackingCandidates").filter((item) => upper(item.status) === "PENDING_REVIEW");
  const sessions = new Map(list(db, "trackingSessions").map((session) => [session.id, session]));
  const lines = [`Tracking candidates pending human review: ${candidates.length}`];
  const entities = [];
  for (const candidate of candidates.slice(0, 20)) {
    const session = sessions.get(candidate.sessionId);
    const trackId = session && idOf(session, "trackId", "subjectId", "entityId");
    lines.push(`${display(candidate.id, "Candidate ID unavailable")} · ${trackId || "Tracking session unavailable"}`);
    if (trackId && !entities.some((entity) => entity.id === trackId)) entities.push({ type: "track", id: trackId });
  }
  if (candidates.length > 20) lines.push(`Showing 20 of ${candidates.length}; open Tracking for the full queue.`);
  return result(lines.join("\n"), entities, { navigation: navigation("multi-camera-tracking") });
}

function answer(db, message, options = {}) {
  options = { ...options, dispatchDb: db };
  db = scopedIncidents(db, options.actor);
  if (options.actor && !["Admin", "Police Officer"].includes(options.actor.role)) db = { ...db, responseUnits: [] };
  const originalText = String(message || "").trim();
  const detected = detectLanguage(originalText, options.priorLanguage);
  const language = responseLanguage(options.selectedLanguage, detected.language, options.priorLanguage);
  const text = normalizeQuery(originalText);
  const now = Number(options.currentTime) || Date.now(), page = sanitizePageContext(options.pageContext);
  const collection = incidentCollectionQuery(text, page, options.priorEntities || []);
  const officerCollection = isOfficerCollectionQuery(text);
  const unitCollection = /\b(?:units|patrols)\b/i.test(text) && !/\brecommend(?:ed|ation)?\b/i.test(text);
  const priorEntities = options.priorEntities || [];
  const refs = collection || officerCollection || unitCollection ? extractReferences(text) : contextualReferences(text, page, priorEntities);
  const safetyIntent = SENSITIVE_REQUEST_PATTERN.test(originalText) ? "blocked_sensitive" : INJECTION_PATTERN.test(originalText) ? "blocked_safety" : null;
  const intent = safetyIntent || classify(text, refs, collection, priorEntities, page);
  let response;
  if (intent === "blocked_sensitive") response = result("I can't provide passwords, tokens, credentials, private URLs, or other protected configuration.", [], { blockedSensitiveRequest: true });
  else if (intent === "blocked_safety") response = result("I can only use approved read-only RakshakAI information tools. I cannot bypass safety rules, execute SQL, or write to operational data.", [], { blockedSafetyRequest: true });
  else if (intent === "blocked_write") response = result("I can show operational information but cannot modify RakshakAI data. Use the relevant authorized operational page to perform that action.", [], { blockedWriteRequest: true, navigation: page.page === "dashboard" ? undefined : navigation(page.page, page.entityId) });
  else if (intent === "casual") {
    const casualType = getCasualType(text);
    if (casualType === "greeting") response = casualGreeting(db, language);
    else if (casualType === "thanks") response = casualThanks(db, language);
    else if (casualType === "acknowledgment") response = casualAcknowledgment(db, language);
    else if (casualType === "repeat") response = casualRepeat(db, priorEntities, language);
    else if (casualType === "explain") response = casualExplain(db, priorEntities, language);
    else if (casualType === "summary") response = casualSummary(db, priorEntities, language);
    else if (casualType === "next") response = casualNext(db, priorEntities, page, db, now, language);
    else response = casualGreeting(db, language);
  }
  else if (intent === "followup") {
    const followupType = getFollowupType(text);
    const resolvedText = resolvePronouns(text, priorEntities, page);
    if (followupType === "showDetails" && priorEntities.length) {
      const entity = priorEntities[0];
      if (/\b(?:those|them|these)\b/i.test(text) && entity.type === "incident" && priorEntities.length > 1) {
        const records = priorEntities.filter(e => e.type === "incident").map(e => findIncident(db, e.id)).filter(Boolean);
        response = listAnswer("Previously listed incidents:", records, "incident", item => `${item.id}: ${display(item.title)} · ${display(item.status)}`, "No incidents in your authorized scope.");
      } else if (entity.type === "incident") response = incidentAnswer(db, entity.id, now, resolvedText);
      else if (entity.type === "camera") response = cameraAnswer(db, entity.id, now);
      else if (entity.type === "response_unit") response = unitAnswer(db, entity.id, now);
      else if (entity.type === "track") response = trackAnswer(db, entity.id, resolvedText);
      else if (entity.type === "investigation") response = investigationAnswer(db, entity.id, now);
      else response = result(`I can show details for ${entity.type} ${entity.id}. What would you like to know?`, [entity]);
    }
    else if (followupType === "whichOne" && priorEntities.length) {
      const critical = priorEntities.filter(e => {
        if (e.type === "incident") {
          const inc = findIncident(db, e.id);
          return inc && upper(inc.severity) === "CRITICAL";
        }
        if (e.type === "camera") {
          const cam = findCamera(db, e.id);
          return cam && upper(valueFrom(cam, "healthStatus", "status")) === "OFFLINE";
        }
        return false;
      });
      if (critical.length) {
        const entity = critical[0];
        if (entity.type === "incident") response = incidentAnswer(db, entity.id, now, resolvedText);
        else if (entity.type === "camera") response = cameraAnswer(db, entity.id, now);
        else response = result(`Most critical: ${entity.type} ${entity.id}.`, [entity]);
      } else if (/\bcritical\b/i.test(text)) {
        response = result("No critical item was found in the current results.", []);
      } else {
        const entity = priorEntities[0];
        if (entity.type === "incident") response = incidentAnswer(db, entity.id, now, resolvedText);
        else if (entity.type === "camera") response = cameraAnswer(db, entity.id, now);
        else if (entity.type === "response_unit") response = unitAnswer(db, entity.id, now);
        else if (entity.type === "track") response = trackAnswer(db, entity.id, resolvedText);
        else response = result(`First item: ${entity.type} ${entity.id}.`, [entity]);
      }
    }
    else if (followupType === "whatAbout") {
      if (/camera|cctv/.test(text)) {
        const records = listUnhealthyCameras(db);
        response = listAnswer("Cameras needing attention:", records, "camera", (item) => `${idOf(item, "cameraId")}: ${upper(valueFrom(item, "healthStatus", "status") || "UNKNOWN")} · ${display(valueFrom(item, "zone", "location"))}`, "All cameras are healthy.");
      } else if (/unit|patrol/.test(text)) {
        response = unitCollectionAnswer(db, "all units", now, options);
      } else if (/incident/.test(text)) {
        const records = list(db, "incidents").filter((item) => !CLOSED.has(lower(item.status)));
        response = listAnswer("Active incidents:", records, "incident", (item) => `${item.id}: ${upper(item.severity || "UNKNOWN")} · ${display(item.status)} · ${display(valueFrom(item, "assignedUnitId", "assigned_unit_id"), "Unassigned")}`, "No active incidents.");
      } else if (/tracking|track/.test(text)) {
        response = pendingTrackingReviews(db, options.actor);
      } else if (/cctns|cases?/.test(text)) {
        response = result("CCTNS case queries are handled on the CCTNS page. Ask about FIR, crime, person, or vehicle searches there.", [], { navigation: navigation("cctns") });
      } else if (/officer|police/.test(text)) {
        response = listOfficersByStation(db, text, options.actor, officerIntent(text));
      } else if (/sla|escalation/.test(text)) {
        const records = listSlaBreaches(db, now);
        response = listAnswer("Incidents at or beyond SLA breach:", records, "incident", (item) => `${item.id}: ${upper(item.severity)} · ${getEscalationLevel(item, list(db, "slaConfig"), now)}`, "No current SLA breaches are recorded.");
      } else if (/evidence/.test(text)) {
        const records = list(db, "videoEvidence").filter((item) => !options.actor || options.actor.role === "Admin" || list(db, "incidents").some((incident) => same(incident.id, valueFrom(item, "incidentId", "incident_id"))));
        response = listAnswer("Video evidence:", records, "evidence", (item) => `${item.id}: ${item.incidentId || "No incident"}: ${item.title || item.status || "Uploaded"}`, "No video evidence recorded.");
      } else {
        response = result("What specific area would you like me to check?", []);
      }
    }
    else if (followupType === "filterCurrent" && priorEntities.length) {
      const entityType = priorEntities[0]?.type;
      if (entityType === "incident") {
        const records = priorEntities.filter(e => e.type === "incident").map(e => findIncident(db, e.id)).filter(Boolean);
        const critical = records.filter(r => upper(r.severity) === "CRITICAL");
        const high = records.filter(r => upper(r.severity) === "HIGH");
        if (/critical/.test(text)) response = listAnswer("Critical incidents:", critical, "incident", (item) => `${item.id}: ${display(item.title)} · ${display(item.status)}`, "No critical incidents in current results.");
        else if (/high/.test(text)) response = listAnswer("High incidents:", high, "incident", (item) => `${item.id}: ${display(item.title)} · ${display(item.status)}`, "No high incidents in current results.");
        else if (/unassigned/.test(text)) {
          const unassigned = records.filter(r => !valueFrom(r, "assignedUnitId", "assigned_unit_id"));
          response = listAnswer("Unassigned incidents:", unassigned, "incident", (item) => `${item.id}: ${display(item.title)} · ${display(item.status)}`, "No unassigned incidents in current results.");
        }
        else response = listAnswer("Filtered incidents:", records, "incident", (item) => `${item.id}: ${upper(item.severity || "UNKNOWN")} · ${display(item.status)}`, "No incidents in current results.");
      } else {
        response = result("Filter applied to current results.", priorEntities);
      }
    }
    else if (followupType === "moreInfo" && priorEntities.length) {
      const entity = priorEntities[0];
      if (entity.type === "incident") response = incidentAnswer(db, entity.id, now, resolvedText);
      else if (entity.type === "camera") response = cameraAnswer(db, entity.id, now);
      else if (entity.type === "response_unit") response = unitAnswer(db, entity.id, now);
      else if (entity.type === "track") response = trackAnswer(db, entity.id, resolvedText);
      else if (entity.type === "investigation") response = investigationAnswer(db, entity.id, now);
      else response = result(`More info about ${entity.type} ${entity.id}.`, [entity]);
    }
    else {
      response = result("I can show details, filter, or check other areas. What would you like?", []);
    }
  }
  else if (intent === "cctns_case_search") {
    response = /\b(?:pending|open)\b/i.test(text) ? cctnsCaseCount(db, options.actor) : result("CCTNS case searches are handled on the CCTNS page. You can search FIRs, crime records, persons, and vehicles there.", [], { navigation: navigation("cctns") });
  }
  else if (intent === "compare") response = compareAnswer(db, refs, now);
  else if (officerCollection) response = listOfficersByStation(db, text, options.actor, intent);
  else if (intent === "officer_lookup") response = canReadOfficer(db, options.actor, refs.officer[0]) ? officerAnswer(db, refs.officer[0]) : result(`No officer with ID ${refs.officer[0]} was found in your authorized scope.`);
  else if (intent === "tracking_lookup") response = trackAnswer(db, refs.track[0], text);
  else if (intent === "camera_lookup") response = cameraAnswer(db, refs.camera[0], now);
  else if (intent === "unit_lookup") response = unitAnswer(db, refs.unit[0], now);
  else if (intent === "incident_responders" || intent === "incident_support") response = incidentRespondersAnswer(db, refs.incident[0], options.actor, intent === "incident_support");
  else if (intent === "investigation_lookup") response = investigationAnswer(db, refs.incident[0], now);
  else if (intent === "unit_recommendation") response = recommendationAnswer(db, refs.incident[0] || (page.page === "unit-assignment" ? page.entityId : null), options.dispatchEligibilitySnapshot, options.dispatchDb, page.recommendationTimedOut && (!refs.incident[0] || same(refs.incident[0], page.entityId)));
  else if (intent === "incident_lookup") response = incidentAnswer(db, refs.incident[0], now, text);
  else if (intent === "sla_search") { const records = listSlaBreaches(db, now); response = listAnswer("Incidents at or beyond SLA breach:", records, "incident", (item) => `${item.id}: ${upper(item.severity)} · ${getEscalationLevel(item, list(db, "slaConfig"), now)}`, "No current SLA breaches are recorded."); }
  else if (intent === "incident_search") {
    response = incidentCollectionAnswer(db, text, now);
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
    response = /\bunits?\s+needing\s+assignment\b/i.test(text) ? incidentCollectionAnswer(db, "unassigned incidents", now) : unitCollectionAnswer(db, text, now, options);
  } else if (intent === "tracking_search") {
    response = pendingTrackingReviews(db, options.actor);
  } else if (intent === "dashboard_summary") response = dashboardAnswer(db, now);
  else {
    const clarification = {
      en: "I couldn't confidently identify the operational request. Try asking about an incident, camera, unit, SLA, or tracking session.",
      te: "ఆపరేషనల్ అడగదాన్ని నేను స్పష్టంగా గుర్తించలేకపోయాను. ఘటన, కెమెరా, యూనిట్, SLA లేదా ట్రాకింగ్ సెషన్ గురించి అడగండి.",
      hi: "मैं ऑपरेशनल अनुरोध को स्पष्ट रूप से पहचान नहीं पाया। घटना, कैमरा, यूनिट, SLA या ट्रैकिंग सेशन के बारे में पूछें।"
    };
    response = result(clarification[language] || clarification.en, [], { clarificationRequired: true });
  }
  const sources = sourceMetadata(db, response.entities);
  return { ...response, answer: localizeAnswer(response.answer, language), sources, intent, detectedLanguage: detected.language, responseLanguage: language, languageConfidence: detected.confidence };
}

module.exports = { answer, clean, relativeTime, extractReferences, sanitizePageContext, classify, sourceMetadata, READ_ONLY_QUERY_REGISTRY, WRITE_PATTERN: WRITE_REQUEST_PATTERN, WRITE_REQUEST_PATTERN, isCasualQuery, getCasualType, isFollowupQuery, getFollowupType, resolvePronouns };
