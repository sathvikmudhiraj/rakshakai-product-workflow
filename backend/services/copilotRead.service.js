const WRITE_PATTERN = /\b(create|add|update|edit|delete|remove|assign|reassign|release|resolve|close|start maintenance|confirm(?:\s+match)?|reject(?:\s+match)?|change|set)\b/i;
const SECRET_PATTERN = /password|secret|token|credential|api[_-]?key|jwt|rtsp|connectionstring/i;

function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SECRET_PATTERN.test(key))
    .map(([key, item]) => [key, clean(item)]));
}

function match(records, reference, keys = ["id"]) {
  const needle = String(reference || "").trim().toLowerCase();
  return (records || []).find((record) => keys.some((key) => String(record?.[key] || "").toLowerCase() === needle));
}

function extractReference(message, prefix) {
  return String(message || "").match(new RegExp(`\\b${prefix}[-_A-Z0-9]+\\b`, "i"))?.[0] || null;
}

function relativeTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unavailable";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function incidentAnswer(db, id) {
  const incident = match(db.incidents, id, ["id", "incidentId"]);
  if (!incident) return { answer: `No incident with ID ${id} was found.`, entities: [] };
  const unit = match(db.responseUnits, incident.assignedUnitId || incident.assignedUnit, ["id", "unitId", "unitCode"]);
  const escalation = (db.escalationAlerts || []).find((item) => item.incidentId === incident.id && item.active);
  const lines = [incident.id, incident.title || incident.type || "Incident", `Severity: ${incident.severity || "Unknown"}`, `Status: ${incident.status || "Unknown"}`, `Assigned unit: ${unit?.unitCode || unit?.unitId || "Unassigned"}`];
  if (escalation) lines.push(`Escalation: ${escalation.escalationLevel || escalation.level || "Active"}`);
  return { answer: lines.join("\n"), entities: [{ type: "incident", id: incident.id }], navigation: { view: "incident-command", entityId: incident.id } };
}

function unitAnswer(db, id) {
  const unit = match(db.responseUnits, id, ["id", "unitId", "unitCode", "name"]);
  if (!unit) return { answer: `No response unit with ID ${id} was found.`, entities: [] };
  const incident = match(db.incidents, unit.assignedIncidentId || unit.currentIncidentId, ["id"]);
  const updatedAt = unit.lastLocationAt || unit.locationUpdatedAt || unit.updatedAt;
  const lines = [unit.unitCode || unit.unitId || unit.id, `Status: ${unit.status || "Unknown"}`, `Station: ${unit.stationName || unit.station || "Not recorded"}`, `Assigned incident: ${incident?.id || "None"}`];
  if (unit.latitude != null && unit.longitude != null) lines.push(`GPS: ${updatedAt ? `updated ${relativeTime(updatedAt)}` : "timestamp unavailable"}`);
  return { answer: lines.join("\n"), entities: [{ type: "response_unit", id: unit.id }], navigation: { view: "unit-assignment", entityId: unit.id } };
}

function cameraAnswer(db, id) {
  const camera = match(db.cameraSources, id, ["id", "cameraId", "name"]);
  if (!camera) return { answer: `No camera with ID ${id} was found.`, entities: [] };
  const health = camera.healthStatus || camera.status || "UNKNOWN";
  const lines = [camera.cameraId || camera.id, `Health: ${health}`, `Location: ${camera.zone || camera.location || "Not recorded"}`];
  if (camera.lastHeartbeatAt) lines.push(`Telemetry: updated ${relativeTime(camera.lastHeartbeatAt)}`);
  if (camera.maintenanceMode) lines.push(`Maintenance: ${camera.maintenanceReason || "Active"}`);
  return { answer: lines.join("\n"), entities: [{ type: "camera", id: camera.id }], navigation: { view: "cctv", entityId: camera.id } };
}

function summaryAnswer(db) {
  const active = (db.incidents || []).filter((item) => !["closed", "resolved", "rejected"].includes(String(item.status).toLowerCase()));
  const unhealthy = (db.cameraSources || []).filter((item) => !["online", "available", "ready"].includes(String(item.healthStatus || item.status || "unknown").toLowerCase()));
  const available = (db.responseUnits || []).filter((item) => item.operational !== false && String(item.status).toLowerCase() === "available");
  const critical = active.filter((item) => String(item.severity).toUpperCase() === "CRITICAL");
  return { answer: ["Current operational summary", `Active incidents: ${active.length}`, `Critical incidents: ${critical.length}`, `Available response units: ${available.length}`, `Unhealthy cameras: ${unhealthy.length}`].join("\n"), entities: [] };
}

function answer(db, message) {
  const text = String(message || "").trim();
  if (WRITE_PATTERN.test(text)) return { answer: "I can show operational information but cannot modify RakshakAI data. Use the relevant operational page to perform that action.", entities: [], blockedWriteRequest: true };
  const incidentId = extractReference(text, "INC"); if (incidentId) return incidentAnswer(db, incidentId);
  const cameraId = extractReference(text, "CAM"); if (cameraId) return cameraAnswer(db, cameraId);
  const unitId = extractReference(text, "(?:P|U|UNIT)"); if (unitId) return unitAnswer(db, unitId);
  if (/offline|unhealthy|need attention|cameras? (?:are )?(?:offline|unhealthy)/i.test(text)) {
    const cameras = (db.cameraSources || []).filter((item) => !["online", "available", "ready"].includes(String(item.healthStatus || item.status || "unknown").toLowerCase())).slice(0, 10);
    return { answer: cameras.length ? `Cameras needing attention:\n${cameras.map((item) => `${item.cameraId || item.id}: ${item.healthStatus || item.status || "UNKNOWN"}`).join("\n")}` : "No unhealthy cameras are currently recorded.", entities: cameras.map((item) => ({ type: "camera", id: item.id })) };
  }
  if (/unassigned|need(?:s)? (?:a )?unit|available units?/i.test(text)) {
    const incidents = (db.incidents || []).filter((item) => !item.assignedUnitId && !["closed", "resolved"].includes(String(item.status).toLowerCase())).slice(0, 10);
    return { answer: incidents.length ? `Incidents awaiting a unit:\n${incidents.map((item) => `${item.id}: ${item.severity || "Unknown"} — ${item.title || item.type || "Incident"}`).join("\n")}` : "No active incidents are awaiting a response unit.", entities: incidents.map((item) => ({ type: "incident", id: item.id })) };
  }
  return summaryAnswer(db);
}

module.exports = { answer, clean, relativeTime, WRITE_PATTERN };
