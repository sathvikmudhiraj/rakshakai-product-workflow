const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const {
  getDatabaseMode,
  query,
  withTransaction,
  withAdvisoryLock
} = require("./postgres.service");
const usersRepository = require("../repositories/users.repository");
const incidentsRepository = require("../repositories/incidents.repository");
const alertsRepository = require("../repositories/alerts.repository");
const responseUnitsRepository = require("../repositories/responseUnits.repository");
const dispatchEventsRepository = require("../repositories/dispatchEvents.repository");
const cameraSourcesRepository = require("../repositories/cameraSources.repository");
const auditLogsRepository = require("../repositories/auditLogs.repository");
const missingPersonsRepository = require("../repositories/missingPersons.repository");

const root = path.join(__dirname, "..");
function loadLocalEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .forEach((line) => {
      const index = line.indexOf("=");
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    });
}

loadLocalEnv();

const host = "127.0.0.1";
const port = Number(process.env.PORT || 5000);
const dbPath = process.env.RAKSHAKAI_DATA_FILE
  ? path.resolve(process.env.RAKSHAKAI_DATA_FILE)
  : path.join(root, "data", "db.json");
const dataDir = path.dirname(dbPath);
const repositories = [
  usersRepository,
  incidentsRepository,
  alertsRepository,
  responseUnitsRepository,
  dispatchEventsRepository,
  cameraSourcesRepository,
  auditLogsRepository,
  missingPersonsRepository
];
const DEMO_PASSWORD_HASH = "$2b$12$6jsUZFcGM/YnWgHEIbP95.v0Zo.8eQtTpSCDuQ3MN8.7/ugAfpPwW";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
}

function now() {
  return new Date().toISOString();
}

function seedDb() {
  const t = now();
  return {
    users: [
      { id: "u_police", name: "Inspector Kavya Rao", email: "police@rakshakai.local", role: "Police Officer", passwordHash: DEMO_PASSWORD_HASH },
      { id: "u_admin", name: "Admin Control Room", email: "admin@rakshakai.local", role: "Admin", passwordHash: DEMO_PASSWORD_HASH },
      { id: "u_citizen", name: "Citizen Reporter", email: "citizen@rakshakai.local", role: "Citizen", passwordHash: DEMO_PASSWORD_HASH }
    ],
    cameras: [
      { id: "cam_c19", cameraId: "C-19", name: "C-19 Red Zone", zone: "Red Zone", health: "online", aiStatus: "Person detection active", density: 68, scene: "cctv-red-zone.svg" },
      { id: "cam_c12", cameraId: "C-12", name: "C-12 Gate A", zone: "Gate A", health: "online", aiStatus: "Crowd 74%", density: 74, scene: "cctv-gate-a.svg" },
      { id: "cam_c27", cameraId: "C-27", name: "C-27 Exit", zone: "Exit Corridor", health: "online", aiStatus: "Normal", density: 42, scene: "cctv-exit.svg" },
      { id: "cam_d03", cameraId: "D-03", name: "D-03 Drone", zone: "Transit Hub", health: "warning", aiStatus: "Motion spike", density: 57, scene: "cctv-drone.svg" },
      { id: "cam_c05", cameraId: "C-05", name: "C-05 Parking", zone: "Parking", health: "offline", aiStatus: "Stream disconnected", density: 0, scene: "cctv-parking.svg" }
    ],
    cameraSources: [
      { id: "cam_c19", type: "cctv", name: "C-19 Red Zone", zone: "Red Zone", status: "online", rtspUrl: "", enabled: true },
      { id: "cam_c12", type: "cctv", name: "C-12 Gate A", zone: "Gate A", status: "online", rtspUrl: "", enabled: true },
      { id: "cam_c27", type: "cctv", name: "C-27 Exit", zone: "Exit Corridor", status: "online", rtspUrl: "", enabled: true },
      { id: "cam_d03", type: "cctv", name: "D-03 Drone", zone: "Transit Hub", status: "online", rtspUrl: "", enabled: true },
      { id: "cam_c05", type: "cctv", name: "C-05 Parking", zone: "Parking", status: "offline", rtspUrl: "", enabled: true },
      { id: "phone_001", type: "phone_camera", name: "Rakshak Live Vision", zone: "Mobile Source", status: "available", enabled: true },
      { id: "upload_001", type: "upload", name: "Upload Video Mode", zone: "Evidence Review", status: "ready", enabled: true }
    ],
    detections: [],
    zones: [
      { id: "z_gate", name: "Gate A", severity: "danger", currentDensity: 88 },
      { id: "z_food", name: "Food Court", severity: "warning", currentDensity: 71 },
      { id: "z_med", name: "Medical Camp", severity: "safe", currentDensity: 36 },
      { id: "z_exit", name: "Exit Corridor", severity: "safe", currentDensity: 42 },
      { id: "z_red", name: "Red Zone", severity: "danger", currentDensity: 82 },
      { id: "z_transit", name: "Transit Hub", severity: "warning", currentDensity: 64 }
    ],
    reports: [],
    incidents: [],
    alerts: [],
    devices: [
      { id: "d1", name: "Camera C-19", type: "CCTV", status: "online", zone: "Red Zone", latencyMs: 210 },
      { id: "d2", name: "Drone D-03", type: "Drone", status: "warning", zone: "Transit Hub", latencyMs: 380 },
      { id: "d3", name: "Camera C-05", type: "CCTV", status: "offline", zone: "Parking", latencyMs: null }
    ],
    auditLogs: []
  };
}

function ensureDb() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify(seedDb(), null, 2));
}

function readDb() {
  ensureDb();
  const raw = fs.readFileSync(dbPath, "utf8").replace(/^\uFEFF/, "");
  const db = ensureProductShape(JSON.parse(raw));
  (db.users || []).forEach((user) => {
    if (!user.passwordHash && user.password) {
      user.passwordHash = bcrypt.hashSync(String(user.password), 12);
      delete user.password;
    }
  });
  const normalized = JSON.stringify(db, null, 2);
  if (normalized !== raw.trim()) fs.writeFileSync(dbPath, normalized);
  return db;
}

function writeDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

async function readDatabase() {
  if (getDatabaseMode() === "json") return readDb();
  const defaults = seedDb();
  const [
    users,
    incidents,
    alerts,
    responseUnits,
    dispatchEvents,
    cameraSources,
    auditLogs,
    reports,
    stateResult
  ] = await Promise.all([
    usersRepository.list(defaults),
    incidentsRepository.list(defaults),
    alertsRepository.list(defaults),
    responseUnitsRepository.list(defaults),
    dispatchEventsRepository.list(defaults),
    cameraSourcesRepository.list(defaults),
    auditLogsRepository.list(defaults),
    missingPersonsRepository.list(defaults),
    query("SELECT data FROM app_state WHERE key = 'operational'")
  ]);
  const state = stateResult.rows[0]?.data || {};
  return ensureProductShape({
    ...defaults,
    ...state,
    users,
    incidents,
    alerts,
    responseUnits,
    dispatchEvents,
    cameraSources,
    auditLogs,
    reports
  });
}

async function writeDatabase(db) {
  if (getDatabaseMode() === "json") {
    writeDb(db);
    return;
  }
  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [724211]);
    const incidentIds = new Set((db.incidents || []).map((incident) => incident.id));
    const safeAlerts = (db.alerts || []).map((alert) =>
      alert.incidentId && !incidentIds.has(alert.incidentId)
        ? { ...alert, incidentId: null }
        : alert
    );
    const safeDispatchEvents = (db.dispatchEvents || []).filter((event) => incidentIds.has(event.incidentId));
    const recordsByRepository = [
      [usersRepository, db.users || []],
      [incidentsRepository, db.incidents || []],
      [alertsRepository, safeAlerts],
      [responseUnitsRepository, db.responseUnits || []],
      [dispatchEventsRepository, safeDispatchEvents],
      [cameraSourcesRepository, db.cameraSources || []],
      [auditLogsRepository, db.auditLogs || []],
      [missingPersonsRepository, db.reports || []]
    ];
    for (const [repository, records] of recordsByRepository) {
      for (const record of records) await repository.upsert(record, client);
    }
    const recordsByDeleteOrder = [
      [dispatchEventsRepository, safeDispatchEvents],
      [alertsRepository, safeAlerts],
      [incidentsRepository, db.incidents || []],
      [responseUnitsRepository, db.responseUnits || []],
      [cameraSourcesRepository, db.cameraSources || []],
      [auditLogsRepository, db.auditLogs || []],
      [missingPersonsRepository, db.reports || []],
      [usersRepository, db.users || []]
    ];
    for (const [repository, records] of recordsByDeleteOrder) {
      const ids = records.map((record) => record.id);
      if (ids.length) {
        await client.query(`DELETE FROM ${repository.table} WHERE NOT (id = ANY($1::text[]))`, [ids]);
      } else {
        await client.query(`DELETE FROM ${repository.table}`);
      }
    }
    await client.query(
      `INSERT INTO app_state (key, data) VALUES ('operational', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [JSON.stringify({
        cameras: db.cameras || [],
        zones: db.zones || [],
        devices: db.devices || [],
        detections: db.detections || []
      })]
    );
  });
}

async function writeSelectedRecords(db, recordsByRepository) {
  if (getDatabaseMode() === "json") {
    writeDb(db);
    return;
  }
  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [724211]);
    for (const [repository, records] of recordsByRepository) {
      for (const record of records) await repository.upsert(record, client);
    }
  });
}

const INCIDENT_STATUSES = ["New", "Verification Required", "Verified", "Assigned", "En Route", "On Scene", "Resolved", "Closed", "Rejected / False Alarm"];
const INCIDENT_TRANSITIONS = {
  New: new Set(["Verification Required", "Verified", "Rejected / False Alarm"]),
  "Verification Required": new Set(["Verified", "Rejected / False Alarm"]),
  Verified: new Set(["Assigned", "Rejected / False Alarm"]),
  Assigned: new Set(["En Route", "Rejected / False Alarm"]),
  "En Route": new Set(["On Scene", "Rejected / False Alarm"]),
  "On Scene": new Set(["Resolved", "Rejected / False Alarm"]),
  Resolved: new Set(["Closed"]),
  Closed: new Set(),
  "Rejected / False Alarm": new Set()
};
const UNIT_STATUSES = ["available", "assigned", "busy", "offline"];
const ZONE_COORDINATES = {
  "Red Zone": { lat: 28.6139, lng: 77.2295 },
  "Main Entry": { lat: 28.6164, lng: 77.2257 },
  "Gate A": { lat: 28.6164, lng: 77.2257 },
  "Food Court": { lat: 28.6108, lng: 77.2266 },
  "Medical Camp": { lat: 28.6087, lng: 77.2323 },
  "Exit Corridor": { lat: 28.6079, lng: 77.2215 },
  "Transit Hub": { lat: 28.6079, lng: 77.2215 },
  "Parking": { lat: 28.6205, lng: 77.2325 },
  "Parking Zone B": { lat: 28.6205, lng: 77.2325 },
  "Mobile Source": { lat: 28.6139, lng: 77.2295 },
  "Evidence Review": { lat: 28.6139, lng: 77.2295 }
};

function canonicalIncidentStatus(value) {
  const match = INCIDENT_STATUSES.find((status) => normalizedIncidentValue(status) === normalizedIncidentValue(value));
  if (match) return match;
  if (normalizedIncidentValue(value) === "open") return "New";
  if (normalizedIncidentValue(value) === "assigned") return "Assigned";
  return "New";
}

function canTransitionIncident(currentStatus, nextStatus) {
  const current = canonicalIncidentStatus(currentStatus);
  const next = canonicalIncidentStatus(nextStatus);
  return current === next || Boolean(INCIDENT_TRANSITIONS[current]?.has(next));
}

function pointFor(record, fallbackZone = "") {
  const rawLat = record?.lat ?? record?.location?.lat;
  const rawLng = record?.lng ?? record?.lon ?? record?.location?.lng ?? record?.location?.lon;
  const lat = rawLat === null || rawLat === "" || rawLat === undefined ? NaN : Number(rawLat);
  const lng = rawLng === null || rawLng === "" || rawLng === undefined ? NaN : Number(rawLng);
  if (isValidCoordinatePair(lat, lng)) return { lat, lng };
  return ZONE_COORDINATES[record?.zone || fallbackZone] || ZONE_COORDINATES["Mobile Source"];
}

function isValidCoordinatePair(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return !(lat === 0 && lng === 0);
}

function strictPoint(record) {
  const rawLat = record?.lat ?? record?.location?.lat;
  const rawLng = record?.lng ?? record?.lon ?? record?.location?.lng ?? record?.location?.lon;
  if (rawLat === null || rawLat === undefined || rawLat === "" || typeof rawLat === "boolean") return null;
  if (rawLng === null || rawLng === undefined || rawLng === "" || typeof rawLng === "boolean") return null;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!isValidCoordinatePair(lat, lng)) return null;
  return { lat, lng };
}

function normalizedLocationStatus(value, hasPoint) {
  if (!hasPoint) return "Needs Confirmation";
  return ["Verified", "Approximate", "Needs Confirmation"].includes(value) ? value : "Approximate";
}

function unitCodeFor(db, unitId) {
  return db.responseUnits.find((unit) => unit.id === unitId)?.unitCode || null;
}

function addDispatchEvent(db, incidentId, type, message, createdBy, createdAt = now()) {
  const event = { id: uid("evt"), incidentId, type, message, createdAt, createdBy };
  db.dispatchEvents.unshift(event);
  return event;
}

function addAuditLog(db, action, actor, incidentId = null, details = "", timestamp = now()) {
  const log = {
    id: uid("aud"),
    actorName: actor?.name || actor || "RakshakAI System",
    actorId: actor?.id || null,
    action,
    incidentId,
    details,
    timestamp
  };
  db.auditLogs.unshift(log);
  return log;
}

function ensureProductShape(db) {
  db.cameraSources = Array.isArray(db.cameraSources) ? db.cameraSources : [];
  db.detections = Array.isArray(db.detections) ? db.detections : [];
  db.dispatchEvents = Array.isArray(db.dispatchEvents) ? db.dispatchEvents : [];
  db.responseUnits = Array.isArray(db.responseUnits) && db.responseUnits.length
    ? db.responseUnits
    : [
        { id: "unit_p04", unitCode: "P-04", name: "Central Patrol 04", officerName: "Inspector Kavya Rao", vehicleType: "Patrol SUV", status: "available", lat: 28.6281, lng: 77.2186, zone: "Central Sector", assignedIncidentId: null, lastUpdated: now() },
        { id: "unit_p02", unitCode: "P-02", name: "Entry Response 02", officerName: "Sub-Inspector Arjun Mehta", vehicleType: "Patrol Car", status: "available", lat: 28.6196, lng: 77.2189, zone: "Main Entry", assignedIncidentId: null, lastUpdated: now() },
        { id: "unit_m02", unitCode: "M-02", name: "Medical Response 02", officerName: "Dr. Neha Iyer", vehicleType: "Ambulance", status: "available", lat: 28.6087, lng: 77.2323, zone: "Medical Camp", assignedIncidentId: null, lastUpdated: now() }
      ];
  db.incidents = consolidateActiveAiIncidents(Array.isArray(db.incidents) ? db.incidents : []);
  db.alerts = consolidateActiveAiAlerts(Array.isArray(db.alerts) ? db.alerts : []);
  const sourceById = new Map(db.cameraSources.map((source) => [source.id, source]));
  (db.cameras || []).forEach((camera) => {
    if (!sourceById.has(camera.id)) {
      db.cameraSources.push({
        id: camera.id,
        type: "cctv",
        name: camera.name,
        zone: camera.zone,
        status: camera.health === "offline" ? "offline" : "online",
        lat: pointFor(camera).lat,
        lng: pointFor(camera).lng,
        rtspUrl: "",
        enabled: true
      });
    }
  });
  if (!sourceById.has("phone_001")) {
    db.cameraSources.push({ id: "phone_001", type: "phone_camera", name: "Rakshak Live Vision", zone: "Mobile Source", status: "available", enabled: true });
  }
  if (!sourceById.has("upload_001")) {
    db.cameraSources.push({ id: "upload_001", type: "upload", name: "Upload Video Mode", zone: "Evidence Review", status: "ready", enabled: true });
  }
  db.responseUnits.forEach((unit) => {
    unit.status = UNIT_STATUSES.includes(unit.status) ? unit.status : "available";
    unit.assignedIncidentId = unit.assignedIncidentId || null;
    unit.lastUpdated = unit.lastUpdated || now();
    unit.lastLocationUpdatedAt = unit.lastLocationUpdatedAt || unit.lastUpdated || null;
  });
  db.incidents.forEach((incident) => {
    const point = strictPoint(incident);
    incident.title = incident.title || String(incident.type || "Incident").replace(/[_-]+/g, " ");
    incident.type = incident.type || incident.threatType || "incident";
    incident.category = incident.category || incident.type;
    incident.sourceType = incident.sourceType || "manual";
    incident.sourceName = incident.sourceName || incident.source || "Command Center";
    incident.source = incident.source || (incident.sourceType === "citizen_report" ? "Citizen" : incident.sourceType?.includes("ai") ? "AI" : "Manual");
    incident.address = incident.address || incident.zone || "Location not specified";
    incident.reportedBy = incident.reportedBy || incident.createdBy || "system";
    incident.lat = point?.lat ?? null;
    incident.lng = point?.lng ?? null;
    incident.locationStatus = normalizedLocationStatus(incident.locationStatus, Boolean(point));
    incident.status = canonicalIncidentStatus(incident.status);
    incident.assignedUnitId = incident.assignedUnitId || db.responseUnits.find((unit) => unit.unitCode === incident.assignedUnit)?.id || null;
    incident.recommendedUnitId = incident.recommendedUnitId || db.responseUnits.find((unit) => unit.unitCode === incident.recommendedUnit)?.id || null;
    incident.etaMinutes = Number.isFinite(Number(incident.etaMinutes)) ? Number(incident.etaMinutes) : null;
    incident.distanceKm = Number.isFinite(Number(incident.distanceKm)) ? Number(incident.distanceKm) : null;
    if (incident.distanceKm === null) {
      incident.etaMinutes = null;
      if (!incident.assignedUnitId) incident.recommendedUnitId = null;
    }
    incident.occurrenceCount = Math.max(1, Number(incident.occurrenceCount) || 1);
    incident.confidence = Number(incident.confidence) || 0;
    incident.createdAt = incident.createdAt || incident.openedAt || incident.timestamp || now();
    incident.updatedAt = incident.updatedAt || incident.lastDetectedAt || incident.createdAt;
    incident.lastDetectedAt = incident.lastDetectedAt || incident.timestamp || incident.createdAt;
    incident.createdBy = incident.createdBy || "system";
    delete incident.assignedUnit;
    delete incident.recommendedUnit;
    delete incident.priority;
    delete incident.source;
    delete incident.threatType;
    delete incident.recommendedAction;
    delete incident.unitLocation;
    delete incident.location;
    delete incident.timeline;
    delete incident.openedAt;
    delete incident.timestamp;
  });
  db.responseUnits.forEach((unit) => {
    const assignedIncident = db.incidents.find((incident) => incident.assignedUnitId === unit.id && isActiveIncident(incident));
    if (assignedIncident) Object.assign(unit, { status: "busy", assignedIncidentId: assignedIncident.id });
    else if (["assigned", "busy"].includes(unit.status)) Object.assign(unit, { status: "available", assignedIncidentId: null });
  });
  db.alerts.forEach((alert) => {
    const point = pointFor(alert);
    alert.incidentId = alert.incidentId || null;
    alert.title = alert.title || alert.message || String(alert.threatType || alert.type || "Alert").replace(/[_-]+/g, " ");
    alert.threatType = alert.threatType || alert.type || "alert";
    alert.sourceType = alert.sourceType || "manual";
    alert.sourceName = alert.sourceName || alert.source || "Command Center";
    alert.lat = point.lat;
    alert.lng = point.lng;
    alert.confidence = Number(alert.confidence) || 0;
    alert.occurrenceCount = Math.max(1, Number(alert.occurrenceCount) || 1);
    const alertStatus = normalizedIncidentValue(alert.status);
    alert.status = ["pending review", "observation", "false alarm", "closed"].includes(alertStatus)
      ? alert.status
      : alert.acknowledged ? "Acknowledged" : "New";
    alert.acknowledged = Boolean(alert.acknowledged || alert.acknowledgedBy?.length);
    alert.createdAt = alert.createdAt || alert.timestamp || now();
    alert.lastDetectedAt = alert.lastDetectedAt || alert.timestamp || alert.createdAt;
    delete alert.location;
    delete alert.timestamp;
    delete alert.assignedUnit;
    delete alert.type;
    delete alert.message;
    delete alert.sourceId;
    delete alert.acknowledgedBy;
  });
  db.alerts
    .filter((alert) => !alert.incidentId && isActiveIncident(alert) && alert.status !== "Pending Review")
    .forEach((alert) => {
      const alertTime = new Date(alert.createdAt).getTime();
      const related = db.incidents.find((incident) =>
        incident.zone === alert.zone
        && Number.isFinite(alertTime)
        && Math.abs(new Date(incident.createdAt).getTime() - alertTime) < 5000
      );
      if (related) {
        alert.incidentId = related.id;
        return;
      }
      const incident = {
        id: uid("inc"),
        title: alert.title,
        type: alert.threatType,
        severity: alert.severity,
        sourceType: alert.sourceType,
        sourceName: alert.sourceName,
        zone: alert.zone,
        lat: alert.lat,
        lng: alert.lng,
        status: "New",
        assignedUnitId: null,
        recommendedUnitId: null,
        etaMinutes: null,
        distanceKm: null,
        occurrenceCount: alert.occurrenceCount,
        confidence: alert.confidence,
        createdAt: alert.createdAt,
        lastDetectedAt: alert.lastDetectedAt,
        createdBy: "migration"
      };
      db.incidents.unshift(incident);
      alert.incidentId = incident.id;
      addDispatchEvent(db, incident.id, "alert_created", alert.title, "migration", alert.createdAt);
      addDispatchEvent(db, incident.id, "incident_created", incident.title, "migration", incident.createdAt);
      addAuditLog(db, "incident_created", "migration", incident.id, incident.title, incident.createdAt);
    });
  db.cameraSources.forEach((source) => {
    const point = pointFor(source);
    source.lat = point.lat;
    source.lng = point.lng;
    if (source.status === "demo") source.status = "online";
    source.latestDetection = db.detections.find((item) => item.sourceId === source.id || item.sourceName === source.name) || source.latestDetection || null;
    source.incidentCount = db.incidents.filter((incident) => incident.sourceName === source.name || incident.sourceId === source.id).length;
    source.enabled = source.enabled !== false;
  });
  if (!db.dispatchEvents.length) {
    db.incidents.forEach((incident) => {
      addDispatchEvent(db, incident.id, "incident_created", `${incident.title} created from ${incident.sourceName}`, incident.createdBy, incident.createdAt);
      if (incident.recommendedUnitId) addDispatchEvent(db, incident.id, "unit_recommended", `${unitCodeFor(db, incident.recommendedUnitId)} recommended`, "system", incident.createdAt);
      if (incident.assignedUnitId) addDispatchEvent(db, incident.id, "unit_assigned", `${unitCodeFor(db, incident.assignedUnitId)} assigned`, "system", incident.createdAt);
    });
  }
  return db;
}

function normalizedIncidentValue(value) {
  return String(value || "").trim().toLowerCase();
}

function isActiveIncident(incident) {
  return !["closed", "resolved", "rejected / false alarm"].includes(normalizedIncidentValue(incident?.status));
}

const ACTIVE_MISSING_REPORT_STATUSES = new Set(["under_review", "active", "verified", "assigned", "en_route", "on_scene", "submitted_for_review", "possible_match"]);
const EXCLUDED_MISSING_REPORT_STATUSES = new Set(["resolved", "closed", "rejected", "false_alarm", "duplicate", "rejected / false report", "rejected / false alarm"]);

function isDemoOrTestRecord(record) {
  const haystack = [
    record?.id,
    record?.name,
    record?.category,
    record?.description,
    record?.lastSeenLocation,
    record?.address
  ].map((value) => String(value || "").toLowerCase());
  return Boolean(record?.demo || record?.isDemo || record?.test || record?.isTest || haystack.some((value) => /\b(demo|test)\b/.test(value)));
}

function isActiveOperationalReport(report) {
  const status = normalizedIncidentValue(report?.status).replace(/\s+/g, "_");
  if (isDemoOrTestRecord(report) || EXCLUDED_MISSING_REPORT_STATUSES.has(status)) return false;
  return ACTIVE_MISSING_REPORT_STATUSES.has(status);
}

function aiIncidentKey(incident) {
  const sourceType = normalizedIncidentValue(incident?.sourceType);
  const sourceName = normalizedIncidentValue(incident?.sourceName || incident?.source);
  const threatType = normalizedIncidentValue(incident?.threatType || incident?.type);
  const zone = normalizedIncidentValue(incident?.zone);
  if (!sourceType || !sourceName || !threatType || !zone || !isActiveIncident(incident)) return "";
  return [sourceType, sourceName, threatType, zone].join("|");
}

function consolidateActiveAiIncidents(incidents) {
  const unique = [];
  const activeByKey = new Map();
  incidents.forEach((incident) => {
    const key = aiIncidentKey(incident);
    if (!key) {
      unique.push(incident);
      return;
    }
    const existing = activeByKey.get(key);
    if (!existing) {
      incident.occurrenceCount = Math.max(1, Number(incident.occurrenceCount) || 1);
      incident.lastDetectedAt = incident.lastDetectedAt || incident.timestamp || incident.openedAt;
      activeByKey.set(key, incident);
      unique.push(incident);
      return;
    }
    existing.occurrenceCount += Math.max(1, Number(incident.occurrenceCount) || 1);
    existing.lastDetectedAt = [existing.lastDetectedAt, incident.lastDetectedAt, incident.timestamp, incident.openedAt]
      .filter(Boolean)
      .sort()
      .at(-1);
    existing.confidence = Math.max(Number(existing.confidence) || 0, Number(incident.confidence) || 0);
    existing.severity = severityForThreat(existing.threatType || existing.type, existing.confidence);
    existing.timeline = Array.from(new Set([...(existing.timeline || []), ...(incident.timeline || [])]));
  });
  return unique;
}

function consolidateActiveAiAlerts(alerts) {
  const unique = [];
  const activeByKey = new Map();
  alerts.forEach((alert) => {
    const sourceType = normalizedIncidentValue(alert.sourceType);
    const sourceName = normalizedIncidentValue(alert.sourceName);
    const threatType = normalizedIncidentValue(alert.threatType || alert.type);
    const zone = normalizedIncidentValue(alert.zone);
    const key = sourceType && sourceName && threatType && zone && isActiveIncident(alert)
      ? [sourceType, sourceName, threatType, zone].join("|")
      : "";
    const existing = key ? activeByKey.get(key) : null;
    if (!existing) {
      alert.occurrenceCount = Math.max(1, Number(alert.occurrenceCount) || 1);
      if (key) activeByKey.set(key, alert);
      unique.push(alert);
      return;
    }
    existing.occurrenceCount += Math.max(1, Number(alert.occurrenceCount) || 1);
    if (String(alert.timestamp || "") > String(existing.timestamp || "")) existing.timestamp = alert.timestamp;
    existing.severity = severityForThreat(alert.threatType || existing.threatType, Math.max(Number(alert.confidence) || 0, Number(existing.confidence) || 0));
  });
  return unique;
}

function sendJson(res, code, payload, headers = {}) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(payload));
}

function getBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function cookies(req) {
  const parsed = {};
  String(req.headers.cookie || "")
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => {
      const index = value.indexOf("=");
      if (index < 1) return;
      const key = value.slice(0, index);
      if (!(key in parsed)) parsed[key] = decodeURIComponent(value.slice(index + 1));
    });
  return parsed;
}

function userFromReq(req, db) {
  const bearer = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer || cookies(req).rakshakai_session;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, jwtSecret());
    return db.users.find((user) =>
      user.id === payload.sub
      && user.role === payload.role
      && (user.sessionVersion || null) === (payload.sessionVersion || null)
    ) || null;
  } catch (error) {
    return null;
  }
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function jwtSecret() {
  const secret = envValue("JWT_SECRET");
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is required in production");
  }
  return "rakshakai-local-development-secret";
}

function signSessionToken(user) {
  return jwt.sign(
    {
      role: user.role,
      email: user.email,
      name: user.name,
      sessionVersion: user.sessionVersion || null
    },
    jwtSecret(),
    { subject: user.id, expiresIn: process.env.JWT_EXPIRES_IN || "12h" }
  );
}

async function verifyPassword(user, password) {
  const stored = String(user.passwordHash || user.password || "");
  if (/^\$2[aby]\$/.test(stored)) return bcrypt.compare(String(password || ""), stored);
  const supplied = Buffer.from(String(password || ""));
  const legacy = Buffer.from(stored);
  const matches = legacy.length > 0
    && legacy.length === supplied.length
    && crypto.timingSafeEqual(legacy, supplied);
  if (matches) {
    user.passwordHash = await bcrypt.hash(String(password), 12);
    delete user.password;
  }
  return Boolean(matches);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeRole(role) {
  const value = String(role || "").trim().toLowerCase();
  if (value === "police" || value === "police officer") return "Police Officer";
  if (value === "admin") return "Admin";
  return "Citizen";
}

function hasRole(user, roles) {
  return Boolean(user && roles.includes(user.role));
}

function forbidden(res) {
  return sendJson(res, 403, { error: "Access denied", message: "Access denied" });
}

function citizenReportForResponse(report) {
  const status = normalizedIncidentValue(report.status);
  const publicStatus = ["closed", "resolved", "found"].includes(status)
    ? status === "closed" ? "Closed" : "Resolved"
    : ["possible_match", "verification_required"].includes(status)
      ? "Verification pending"
      : status === "under_review"
        ? "Under review"
        : "Submitted";
  return {
    id: report.id,
    reportType: report.reportType || "missing_person",
    category: report.category || report.reportType || "report",
    name: report.name,
    age: report.age,
    description: report.description || "",
    lastSeenLocation: report.lastSeenLocation,
    address: report.address || report.lastSeenLocation,
    urgency: report.urgency || "medium",
    status: publicStatus,
    imageName: report.imageName || null,
    createdAt: report.createdAt
  };
}

function envValue(key) {
  return String(process.env[key] || "").trim();
}

function maskSecret(value) {
  if (!value) return "";
  if (value.length <= 10) return "configured";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function parseEnvList(key) {
  const raw = envValue(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch (error) {
    // Plain comma/semicolon/newline lists are easier for local .env files.
  }
  return raw
    .split(/[;\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function configuredRtspCameras() {
  return parseEnvList("RTSP_CAMERA_URLS").map((streamUrl, index) => ({
    id: `rtsp_${index + 1}`,
    cameraId: `RTSP-${String(index + 1).padStart(2, "0")}`,
    name: `RTSP Camera ${index + 1}`,
    zone: "Configured Stream",
    health: "online",
    aiStatus: "Real RTSP stream configured",
    density: 0,
    scene: "cctv-red-zone.svg",
    rtspConfigured: true,
    rtspUrlMasked: maskSecret(streamUrl)
  }));
}

function sourceStatusLabel(source) {
  if (source.status === "online") return "Online";
  if (source.status === "offline") return "Offline";
  if (source.status === "available") return "Available";
  if (source.status === "ready") return "Ready";
  return "Configured";
}

function cameraSourcesForResponse(db) {
  const sources = [...db.cameraSources];
  configuredRtspCameras().forEach((camera) => {
    sources.unshift({
      id: camera.id,
      type: "cctv",
      name: camera.name,
      zone: camera.zone,
      status: "online",
      rtspUrlMasked: camera.rtspUrlMasked,
      enabled: true,
      externalConfig: true
    });
  });
  return sources.map((source) => {
    const detections = db.detections.filter((item) =>
      item.configured === true
      && (item.sourceId === source.id || item.sourceName === source.name)
    );
    const latestDetection = detections[0] || null;
    const relatedAlerts = db.alerts.filter((alert) => alert.sourceId === source.id || alert.sourceName === source.name || String(alert.title || "").includes(source.name));
    const incidentCount = db.incidents.filter((incident) => incident.sourceId === source.id || incident.sourceName === source.name).length;
    return {
      ...source,
      statusLabel: sourceStatusLabel(source),
      latestDetection,
      latestAlertTime: relatedAlerts[0]?.lastDetectedAt || relatedAlerts[0]?.createdAt || null,
      incidentCount
    };
  });
}

function camerasForResponse(db) {
  const rtspCameras = configuredRtspCameras();
  const sourcesById = new Map((db.cameraSources || []).map((source) => [source.id, source]));
  const cameras = (db.cameras || []).map((camera) => {
    const source = sourcesById.get(camera.id);
    const rtspUrl = source?.rtspUrl || "";
    return {
      ...camera,
      sourceStatus: source?.status || (camera.health === "offline" ? "offline" : "online"),
      sourceStatusLabel: sourceStatusLabel(source || { status: camera.health === "offline" ? "offline" : "online" }),
      rtspUrl,
      rtspConfigured: Boolean(rtspUrl),
      rtspUrlMasked: rtspUrl ? maskSecret(rtspUrl) : camera.rtspUrlMasked
    };
  });
  return rtspCameras.length ? [...rtspCameras, ...cameras] : cameras;
}

function integrationStatus() {
  const rtsp = configuredRtspCameras();
  const aiServiceUrl = envValue("AI_SERVICE_URL");
  const databaseMode = getDatabaseMode();
  const firebaseKey = envValue("FIREBASE_SERVER_KEY") || envValue("FIREBASE_SERVICE_ACCOUNT");
  const jwtSecret = envValue("JWT_SECRET") || envValue("SESSION_SECRET");
  const osrmBaseUrl = envValue("OSRM_BASE_URL") || "https://router.project-osrm.org";
  return [
    { id: "rtsp", name: "Real CCTV RTSP Streams", configured: rtsp.length > 0, detail: rtsp.length ? `${rtsp.length} stream(s) configured` : "Set RTSP_CAMERA_URLS in .env" },
    { id: "ai", name: "AI Detection Service", configured: Boolean(aiServiceUrl), detail: aiServiceUrl ? (envValue("AI_SERVICE_API_KEY") ? "AI service URL and API key configured" : "AI service URL set; add AI_SERVICE_API_KEY for auth") : "Set AI_SERVICE_URL to enable real detection" },
    {
      id: "database",
      name: "PostgreSQL Database",
      configured: databaseMode === "postgres",
      detail: databaseMode === "postgres"
        ? "Connected through DATABASE_URL"
        : "Local db.json fallback is active; set DATABASE_URL for PostgreSQL"
    },
    { id: "firebase", name: "Firebase Push Notifications", configured: Boolean(firebaseKey), detail: firebaseKey ? "Firebase credentials configured" : "Set FIREBASE_SERVER_KEY or FIREBASE_SERVICE_ACCOUNT" },
    { id: "deployment", name: "Vercel / Render Deployment", configured: Boolean(envValue("VERCEL_URL") || envValue("RENDER_EXTERNAL_URL")), detail: envValue("VERCEL_URL") || envValue("RENDER_EXTERNAL_URL") || "Ready to deploy with provided env vars" },
    { id: "auth", name: "Production Authentication", configured: Boolean(jwtSecret), detail: jwtSecret ? "Session/JWT secret configured" : "Local session login active; set JWT_SECRET for deployment" },
    { id: "routing", name: "Police Route Assignment", configured: true, detail: `Route engine: ${osrmBaseUrl}` }
  ];
}

async function callJson(url, options = {}, timeoutMs = 4500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function severityForThreat(threatType, confidence) {
  if (["weapon_detected", "fire_smoke", "violence_detected"].includes(threatType) && confidence >= 0.9) return "critical";
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.55) return "medium";
  return "low";
}

async function sendFirebaseNotification(alert) {
  const key = envValue("FIREBASE_SERVER_KEY");
  if (!key) return { sent: false, mode: "not-configured" };
  try {
    await callJson("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `key=${key}` },
      body: JSON.stringify({
        to: envValue("FIREBASE_TOPIC") || "/topics/rakshakai-alerts",
        notification: { title: `RakshakAI ${alert.severity} alert`, body: alert.message },
        data: alert
      })
    });
    return { sent: true, mode: "firebase" };
  } catch (error) {
    return { sent: false, mode: "firebase", error: error.message };
  }
}

function numberParam(url, key) {
  const value = Number(url.searchParams.get(key));
  return Number.isFinite(value) ? value : null;
}

function fallbackRoute(fromLat, fromLng, toLat, toLng) {
  const distanceKm = Math.hypot((toLat - fromLat) * 111, (toLng - fromLng) * 100);
  return {
    provider: "local-fallback",
    approximate: true,
    message: "Approximate distance only, not driving route.",
    distanceMeters: Math.round(distanceKm * 1000),
    durationSeconds: null,
    coordinates: [
      [fromLng, fromLat],
      [toLng, toLat]
    ],
    calculatedAt: now()
  };
}

async function routeBetween(url) {
  const fromLat = numberParam(url, "fromLat");
  const fromLng = numberParam(url, "fromLng");
  const toLat = numberParam(url, "toLat");
  const toLng = numberParam(url, "toLng");
  const start = strictPoint({ lat: fromLat, lng: fromLng });
  const destination = strictPoint({ lat: toLat, lng: toLng });
  if (!start || !destination) throw new Error("Valid route coordinates are required");
  const base = envValue("OSRM_BASE_URL") || "https://router.project-osrm.org";
  const pathUrl = `${base.replace(/\/$/, "")}/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
  try {
    const data = await callJson(pathUrl, {}, 4500);
    const route = data.routes?.[0];
    if (!route) throw new Error("No route found");
    if (!Number.isFinite(Number(route.distance)) || Number(route.distance) <= 0) throw new Error("Route distance is invalid");
    if (!Number.isFinite(Number(route.duration)) || Number(route.duration) <= 0) throw new Error("Route duration is invalid");
    if (!Array.isArray(route.geometry?.coordinates) || route.geometry.coordinates.length < 2) throw new Error("Route geometry is invalid");
    const endpoint = route.geometry.coordinates.at(-1);
    const endpointPoint = strictPoint({ lat: endpoint?.[1], lng: endpoint?.[0] });
    if (!endpointPoint || Math.hypot((endpointPoint.lat - destination.lat) * 111, (endpointPoint.lng - destination.lng) * 100) > 0.5) {
      throw new Error("Route does not reach the incident location");
    }
    return {
      provider: "osrm",
      approximate: false,
      distanceMeters: Math.round(route.distance),
      durationSeconds: Math.round(route.duration),
      coordinates: route.geometry.coordinates,
      calculatedAt: now()
    };
  } catch (error) {
    return { ...fallbackRoute(fromLat, fromLng, toLat, toLng), error: error.message };
  }
}

function routeUrl(from, to) {
  return new URL(`/api/route?fromLat=${from.lat}&fromLng=${from.lng}&toLat=${to.lat}&toLng=${to.lng}`, "http://localhost");
}

function unitLocationFreshness(unit, at = Date.now()) {
  const timestamp = unit.lastLocationUpdatedAt || unit.lastUpdated;
  const updatedAt = new Date(timestamp || "").getTime();
  if (!Number.isFinite(updatedAt)) return { label: "Unknown", ageMinutes: null, eligible: false };
  const ageMinutes = Math.max(0, (at - updatedAt) / 60000);
  if (ageMinutes <= 2) return { label: "Live", ageMinutes: Number(ageMinutes.toFixed(1)), eligible: true };
  if (ageMinutes <= 10) return { label: "Recent", ageMinutes: Number(ageMinutes.toFixed(1)), eligible: true };
  return { label: "Stale", ageMinutes: Number(ageMinutes.toFixed(1)), eligible: false };
}

function unitForResponse(unit) {
  const locationFreshness = unitLocationFreshness(unit);
  return { ...unit, locationFreshness: locationFreshness.label, locationAgeMinutes: locationFreshness.ageMinutes };
}

function availableUnitsByDistance(db, lat, lng) {
  const destination = strictPoint({ lat, lng });
  if (!destination) return [];
  return db.responseUnits
    .filter((unit) => {
      const freshness = unitLocationFreshness(unit);
      return unit.status === "available" && freshness.eligible && Boolean(strictPoint(unit));
    })
    .map((unit) => ({
      ...unitForResponse(unit),
      straightLineKm: Number(Math.hypot((Number(unit.lat) - lat) * 111, (Number(unit.lng) - lng) * 100).toFixed(2))
    }))
    .sort((a, b) => a.straightLineKm - b.straightLineKm);
}

async function bestRoutedUnit(db, incident) {
  const destination = strictPoint(incident);
  if (!destination) return null;
  const candidates = availableUnitsByDistance(db, destination.lat, destination.lng);
  const routed = await Promise.all(candidates.map(async (unit) => ({
    unit,
    route: await routeBetween(routeUrl(strictPoint(unit), destination))
  })));
  return routed
    .filter((item) => item.route.provider === "osrm" && !item.route.approximate)
    .sort((a, b) => a.route.durationSeconds - b.route.durationSeconds || a.route.distanceMeters - b.route.distanceMeters)[0] || null;
}

function incidentForResponse(db, incident) {
  if (!incident) return null;
  const recommendedUnit = db.responseUnits.find((unit) => unit.id === incident.recommendedUnitId) || null;
  const assignedUnit = db.responseUnits.find((unit) => unit.id === incident.assignedUnitId) || null;
  const location = strictPoint(incident);
  const dispatchable = Boolean(location && incident.locationStatus === "Verified" && ["Verified", "Assigned", "En Route", "On Scene"].includes(canonicalIncidentStatus(incident.status)));
  const locationSafetyLabel = !location
    ? "Location missing — verify before dispatch"
    : incident.locationStatus === "Verified"
      ? "Ready for dispatch"
      : incident.locationStatus === "Approximate"
        ? "Location approximate"
        : "Location missing";
  return {
    ...incident,
    displayTitle: incidentDisplayTitle(incident),
    displaySource: incidentDisplaySource(incident),
    dispatchable,
    locationSafetyLabel,
    dispatchSafetyLabel: dispatchable ? "Ready for dispatch" : "Not dispatchable",
    location,
    unitLocation: assignedUnit
      ? strictPoint(assignedUnit)
      : recommendedUnit
        ? strictPoint(recommendedUnit)
        : null,
    recommendedUnit: recommendedUnit ? unitForResponse(recommendedUnit) : null,
    assignedUnit: assignedUnit ? unitForResponse(assignedUnit) : null,
    timeline: db.dispatchEvents
      .filter((event) => event.incidentId === incident.id)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map((event) => event.message)
  };
}

function displayWords(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function incidentDisplayTitle(incident) {
  const type = normalizedIncidentValue(incident?.type || incident?.category).replace(/\s+/g, "_");
  const title = String(incident?.title || "").trim().replace(/^undefined[\s:]*/i, "");
  if (type === "missing_object") return `Missing Object Report: ${displayWords(title.replace(/^missing[_\s-]*object\s*:\s*/i, ""))}`;
  if (type === "missing_person") return `Missing Person Report: ${displayWords(title.replace(/^missing[_\s-]*person\s*:\s*/i, ""))}`;
  if (type === "person_detected") return "AI Vision Detection";
  if (incident?.source === "AI" || String(incident?.sourceType || "").includes("camera")) return title ? displayWords(title) : "AI Vision Detection";
  return title ? displayWords(title) : displayWords(incident?.type || "Incident");
}

function incidentDisplaySource(incident) {
  const sourceType = normalizedIncidentValue(incident?.sourceType).replace(/\s+/g, "_");
  if (sourceType === "live_camera" || sourceType === "phone_camera") return "Live Camera";
  if (sourceType === "cctv") return "CCTV";
  if (sourceType === "citizen_report") return "Citizen Report";
  if (incident?.source === "AI") return "AI Vision";
  return displayWords(incident?.source || incident?.sourceType || "Command Center");
}

function createIncidentRecord(db, input, user, timestamp = now()) {
  const explicitPoint = strictPoint(input);
  const zonePoint = !explicitPoint && input.zone ? ZONE_COORDINATES[input.zone] : null;
  const point = explicitPoint || zonePoint;
  const locationStatus = normalizedLocationStatus(
    input.locationStatus || (explicitPoint ? "Approximate" : zonePoint ? "Approximate" : "Needs Confirmation"),
    Boolean(point)
  );
  const requestedStatus = input.status === "New" ? "New" : "Verified";
  const status = requestedStatus === "Verified" && !point ? "Verification Required" : requestedStatus;
  const incident = {
    id: uid("inc"),
    title: String(input.title || input.category || "Operational incident").trim().slice(0, 160),
    type: String(input.category || input.type || "operational_incident").trim().slice(0, 80),
    category: String(input.category || input.type || "Operational incident").trim().slice(0, 80),
    severity: ["critical", "high", "medium", "low"].includes(input.severity) ? input.severity : "medium",
    status,
    source: input.source || "Manual",
    sourceType: input.sourceType || "manual",
    sourceName: input.sourceName || user?.name || "Command Center",
    sourceRecordId: input.sourceRecordId || null,
    zone: input.zone || input.address || "Unassigned",
    address: input.address || input.zone || "Location not specified",
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    locationStatus,
    reportedBy: input.reportedBy || user?.id || "system",
    assignedUnitId: null,
    recommendedUnitId: null,
    etaMinutes: null,
    distanceKm: null,
    occurrenceCount: 1,
    confidence: Number(input.confidence) || 0,
    detectionMetadata: input.detectionMetadata || null,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastDetectedAt: timestamp,
    createdBy: user?.id || "system"
  };
  db.incidents.unshift(incident);
  addDispatchEvent(db, incident.id, "incident_created", `${incident.title} created from ${incident.source}`, user?.name || "system", timestamp);
  addAuditLog(db, "incident_created", user, incident.id, `${incident.source}: ${incident.title}`, timestamp);
  if (incident.status === "Verified") {
    addDispatchEvent(db, incident.id, "incident_verified", `${incident.title} verified`, user?.name || "system", timestamp);
    addAuditLog(db, "incident_verified", user, incident.id, incident.title, timestamp);
  } else if (incident.status === "Verification Required") {
    addDispatchEvent(db, incident.id, "location_verification_required", `${incident.title} requires a valid location before dispatch`, user?.name || "system", timestamp);
    addAuditLog(db, "incident_location_verification_required", user, incident.id, incident.title, timestamp);
  }
  return incident;
}

function summary(db) {
  const sources = cameraSourcesForResponse(db);
  const activeIncidents = db.incidents.filter(isActiveIncident);
  const openAlerts = db.alerts.filter(isActiveIncident);
  const etaIncidents = activeIncidents.filter((incident) => incident.etaMinutes !== null && incident.etaMinutes !== undefined && Number(incident.etaMinutes) > 0);
  const activeReports = db.reports.filter(isActiveOperationalReport);
  const missingPersons = activeReports.filter((report) => report.reportType === "missing_person").length;
  const missingObjects = activeReports.filter((report) => report.reportType === "missing_object").length;
  return {
    criticalAlerts: openAlerts.filter((alert) => alert.severity === "critical").length,
    activeIncidents: activeIncidents.length,
    missingPersons,
    missingObjects,
    pendingCitizenReports: activeReports.length,
    camerasOnline: sources.filter((source) => source.enabled && ["online", "available", "ready"].includes(source.status)).length,
    unitsAvailable: db.responseUnits.filter((unit) => unit.status === "available").length,
    pendingReview: db.alerts.filter((alert) => alert.status === "Pending Review").length
      + db.reports.filter((report) => ["submitted_for_review", "possible_match"].includes(normalizedIncidentValue(report.status))).length,
    averageEtaMinutes: etaIncidents.length
      ? Math.round(etaIncidents.reduce((sum, incident) => sum + Number(incident.etaMinutes), 0) / etaIncidents.length)
      : null
  };
}

async function apiInternal(req, res, url) {
  const db = await readDatabase();
  const user = userFromReq(req, db);
  const body = req.method === "GET" ? {} : await getBody(req);

  if (req.method === "GET" && url.pathname === "/api/health") return sendJson(res, 200, { ok: true, service: "RakshakAI Local API", timestamp: now() });
  if (req.method === "GET" && url.pathname === "/api/me") return sendJson(res, 200, { user: publicUser(user) });

  if (req.method === "POST" && url.pathname === "/api/login") {
    const email = normalizeEmail(body.email);
    const found = db.users.find((candidate) => normalizeEmail(candidate.email) === email);
    if (!found || !await verifyPassword(found, body.password)) {
      return sendJson(res, 401, { error: "Invalid email or password" });
    }
    const token = signSessionToken(found);
    return sendJson(res, 200, { user: publicUser(found) }, {
      "Set-Cookie": [
        `rakshakai_session=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=43200${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
        `rakshakai_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
      ]
    });
  }

  if (req.method === "POST" && url.pathname === "/api/register") {
    const name = String(body.name || "").trim();
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const role = "Citizen";
    if (name.length < 2) return sendJson(res, 400, { error: "Enter a valid name" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { error: "Enter a valid email" });
    if (password.length < 6) return sendJson(res, 400, { error: "Password must be at least 6 characters" });
    if (db.users.some((u) => normalizeEmail(u.email) === email)) return sendJson(res, 409, { error: "Email already registered. Please login." });
    const created = { id: uid("u"), name, email, role, passwordHash: await bcrypt.hash(password, 12), createdAt: now() };
    db.users.push(created);
    const registrationAudit = { id: uid("aud"), actorName: name, actorId: created.id, action: `registered_${role.toLowerCase().replace(/\s+/g, "_")}`, timestamp: now() };
    db.auditLogs.unshift(registrationAudit);
    await writeSelectedRecords(db, [
      [usersRepository, [created]],
      [auditLogsRepository, [registrationAudit]]
    ]);
    const token = signSessionToken(created);
    return sendJson(res, 201, { user: publicUser(created) }, {
      "Set-Cookie": [
        `rakshakai_session=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=43200${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
        `rakshakai_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
      ]
    });
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    return sendJson(res, 200, { ok: true }, {
      "Set-Cookie": [
        `rakshakai_session=; Path=/api; HttpOnly; Max-Age=0; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
        `rakshakai_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
      ]
    });
  }

  if (req.method === "POST" && url.pathname === "/api/change-password") {
    if (!user) return sendJson(res, 401, { error: "Authentication required" });
    if (!hasRole(user, ["Admin"])) return forbidden(res);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (!await verifyPassword(user, currentPassword)) {
      return sendJson(res, 401, { error: "Current password is incorrect" });
    }
    if (newPassword.length < 10
      || !/[a-z]/.test(newPassword)
      || !/[A-Z]/.test(newPassword)
      || !/\d/.test(newPassword)) {
      return sendJson(res, 400, { error: "New password must be at least 10 characters and include uppercase, lowercase, and a number" });
    }
    if (await verifyPassword(user, newPassword)) {
      return sendJson(res, 400, { error: "New password must be different from the current password" });
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.sessionVersion = crypto.randomUUID();
    delete user.password;
    const passwordAudit = {
      id: uid("aud"),
      actorName: user.name,
      actorId: user.id,
      action: "admin_password_changed",
      timestamp: now()
    };
    db.auditLogs.unshift(passwordAudit);
    await writeSelectedRecords(db, [
      [usersRepository, [user]],
      [auditLogsRepository, [passwordAudit]]
    ]);
    return sendJson(res, 200, { ok: true, message: "Password changed successfully. Please sign in again." }, {
      "Set-Cookie": [
        `rakshakai_session=; Path=/api; HttpOnly; Max-Age=0; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
        `rakshakai_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
      ]
    });
  }

  if (req.method === "GET" && ["/api/dashboard", "/api/dashboard/summary"].includes(url.pathname)) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    return sendJson(res, 200, { summary: summary(db) });
  }
  if (req.method === "GET" && url.pathname === "/api/camera-feeds") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    return sendJson(res, 200, { cameras: camerasForResponse(db) });
  }
  if (req.method === "GET" && url.pathname === "/api/camera-sources") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    return sendJson(res, 200, { sources: cameraSourcesForResponse(db) });
  }
  if (req.method === "GET" && url.pathname === "/api/zones") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    return sendJson(res, 200, {
      zones: db.zones.map((zone) => ({ ...zone, ...pointFor({ zone: zone.name }) }))
    });
  }
  if (req.method === "GET" && url.pathname === "/api/reports") {
    if (!user) return sendJson(res, 401, { error: "Authentication required" });
    return sendJson(res, 200, {
      reports: user.role === "Citizen"
        ? db.reports.filter((report) => report.createdBy === user.id).map(citizenReportForResponse)
        : db.reports
    });
  }
  if (req.method === "GET" && url.pathname === "/api/alerts") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    return sendJson(res, 200, { alerts: db.alerts.filter((alert) => !["closed", "resolved", "false alarm"].includes(normalizedIncidentValue(alert.status))) });
  }
  if (req.method === "GET" && ["/api/incidents", "/api/incidents/live"].includes(url.pathname)) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    return sendJson(res, 200, { incidents: db.incidents.filter(isActiveIncident).map((incident) => incidentForResponse(db, incident)) });
  }
  const getIncidentMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)$/);
  if (req.method === "GET" && getIncidentMatch && getIncidentMatch[1] !== "history") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const incident = db.incidents.find((item) => item.id === getIncidentMatch[1]);
    return incident ? sendJson(res, 200, { incident: incidentForResponse(db, incident) }) : sendJson(res, 404, { error: "Incident not found" });
  }
  const timelineMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/timeline$/);
  if (req.method === "GET" && timelineMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const events = db.dispatchEvents
      .filter((event) => event.incidentId === timelineMatch[1])
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return sendJson(res, 200, { events });
  }
  if (req.method === "GET" && url.pathname === "/api/response-units") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    return sendJson(res, 200, { units: db.responseUnits.map(unitForResponse) });
  }
  if (req.method === "GET" && url.pathname === "/api/response-units/nearest") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const lat = numberParam(url, "lat");
    const lng = numberParam(url, "lng");
    if (lat === null || lng === null) return sendJson(res, 400, { error: "lat and lng are required" });
    return sendJson(res, 200, { units: availableUnitsByDistance(db, lat, lng) });
  }
  if (req.method === "GET" && url.pathname === "/api/devices/health") {
    if (!hasRole(user, ["Admin"])) return forbidden(res);
    return sendJson(res, 200, { devices: db.devices });
  }
  if (req.method === "GET" && url.pathname === "/api/audit-logs") {
    if (!hasRole(user, ["Admin"])) return forbidden(res);
    return sendJson(res, 200, { auditLogs: db.auditLogs });
  }
  if (req.method === "GET" && url.pathname === "/api/integrations/status") {
    if (!hasRole(user, ["Admin"])) return forbidden(res);
    return sendJson(res, 200, { integrations: integrationStatus() });
  }
  if (req.method === "GET" && url.pathname === "/api/route") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    try {
      return sendJson(res, 200, { route: await routeBetween(url) });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (!user) return sendJson(res, 401, { error: "Authentication required" });

  if (req.method === "GET" && url.pathname === "/api/admin/users") {
    if (!hasRole(user, ["Admin"])) return forbidden(res);
    return sendJson(res, 200, { users: db.users.map(publicUser) });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/users") {
    if (!hasRole(user, ["Admin"])) return forbidden(res);
    const name = String(body.name || "").trim();
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const role = normalizeRole(body.role);
    if (!["Police Officer", "Admin"].includes(role)) return sendJson(res, 400, { error: "Staff role must be Police Officer or Admin" });
    if (name.length < 2) return sendJson(res, 400, { error: "Enter the staff member's full name" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { error: "Enter a valid email" });
    if (password.length < 8) return sendJson(res, 400, { error: "Temporary password must be at least 8 characters" });
    if (db.users.some((item) => normalizeEmail(item.email) === email)) return sendJson(res, 409, { error: "Email is already registered" });
    const created = {
      id: uid("u"),
      name,
      email,
      role,
      passwordHash: await bcrypt.hash(password, 12),
      createdAt: now(),
      createdBy: user.id
    };
    db.users.push(created);
    addAuditLog(db, "staff_account_created", user, null, `${role}: ${email}`);
    await writeDatabase(db);
    return sendJson(res, 201, { user: publicUser(created) });
  }

  const reviewAlertMatch = url.pathname.match(/^\/api\/alerts\/([^/]+)\/review$/);
  if (req.method === "POST" && reviewAlertMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const alert = db.alerts.find((item) => item.id === reviewAlertMatch[1]);
    if (!alert) return sendJson(res, 404, { error: "AI alert not found" });
    const action = String(body.action || "").toLowerCase();
    if (!["create_incident", "observation", "dismiss"].includes(action)) {
      return sendJson(res, 400, { error: "Review action must be create_incident, observation, or dismiss" });
    }
    const reviewedAt = now();
    alert.reviewedAt = reviewedAt;
    alert.reviewedBy = { id: user.id, name: user.name, role: user.role };
    addAuditLog(db, "ai_alert_reviewed", user, alert.incidentId, `${alert.id}: ${action}`, reviewedAt);
    let incident = null;
    if (action === "create_incident") {
      incident = createIncidentRecord(db, {
        title: alert.title,
        category: alert.threatType,
        severity: alert.severity,
        source: "AI",
        sourceType: "ai_detection",
        sourceName: alert.sourceName,
        sourceRecordId: alert.id,
        zone: alert.zone,
        address: alert.address || alert.zone,
        lat: alert.lat,
        lng: alert.lng,
        reportedBy: "RakshakAI",
        confidence: alert.confidence,
        detectionMetadata: {
          detectedObjects: alert.detections || [],
          vehicleAnalysis: alert.vehicleAnalysis || [],
          personAnalysis: alert.personAnalysis || [],
          objectAnalysis: alert.objectAnalysis || [],
          personIdentity: { identified: false, status: "unsupported" },
          confidence: alert.confidence,
          frameTimestamp: alert.frameTimestamp || alert.createdAt,
          threatLevel: alert.threatLevel || alert.severity,
          message: alert.message || alert.title
        }
      }, user, reviewedAt);
      alert.incidentId = incident.id;
      alert.status = "Reviewed";
      alert.reviewStatus = "incident_created";
    } else if (action === "observation") {
      alert.status = "Observation";
      alert.reviewStatus = "observation";
      addAuditLog(db, "ai_alert_marked_observation", user, null, alert.id, reviewedAt);
    } else {
      alert.status = "False Alarm";
      alert.reviewStatus = "false_alarm";
      addAuditLog(db, "false_alarm_rejected", user, null, alert.id, reviewedAt);
    }
    await writeDatabase(db);
    return sendJson(res, 200, { alert, incident: incident ? incidentForResponse(db, incident) : null });
  }

  const reportIncidentMatch = url.pathname.match(/^\/api\/reports\/([^/]+)\/create-incident$/);
  if (req.method === "POST" && reportIncidentMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const report = db.reports.find((item) => item.id === reportIncidentMatch[1]);
    if (!report) return sendJson(res, 404, { error: "Citizen report not found" });
    if (report.incidentId) return sendJson(res, 409, { error: "Report already has an incident" });
    const createdAt = now();
    const incident = createIncidentRecord(db, {
      title: body.title || `${report.category || report.reportType}: ${report.name}`,
      category: report.category || report.reportType,
      severity: body.severity || report.urgency,
      source: "Citizen",
      sourceType: "citizen_report",
      sourceName: "Citizen Report Portal",
      sourceRecordId: report.id,
      zone: report.lastSeenLocation || report.address,
      address: report.address || report.lastSeenLocation,
      lat: report.lat,
      lng: report.lng,
      reportedBy: report.createdBy
    }, user, createdAt);
    report.status = "under_review";
    report.incidentId = incident.id;
    report.reviewedBy = user.id;
    report.updatedAt = createdAt;
    addAuditLog(db, "citizen_report_converted", user, incident.id, report.id, createdAt);
    await writeDatabase(db);
    return sendJson(res, 201, { report, incident: incidentForResponse(db, incident) });
  }

  if (req.method === "POST" && url.pathname === "/api/incidents/sample") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const createdAt = now();
    const scenarios = [
      {
        title: "Crowd surge detected at Gate A",
        type: "crowd_surge",
        severity: "high",
        sourceName: "C-12 Gate A",
        zone: "Gate A",
        confidence: 0.88
      },
      {
        title: "Restricted-zone movement detected",
        type: "restricted_zone_intrusion",
        severity: "critical",
        sourceName: "C-19 Red Zone",
        zone: "Red Zone",
        confidence: 0.93
      },
      {
        title: "Unattended object requires inspection",
        type: "unattended_object",
        severity: "medium",
        sourceName: "C-27 Exit",
        zone: "Exit Corridor",
        confidence: 0.81
      }
    ];
    const scenario = scenarios[db.incidents.length % scenarios.length];
    const point = pointFor({ zone: scenario.zone });
    const incident = {
      id: uid("inc"),
      ...scenario,
      sourceType: "command_center_demo",
      lat: point.lat,
      lng: point.lng,
      status: "New",
      assignedUnitId: null,
      recommendedUnitId: null,
      etaMinutes: null,
      distanceKm: null,
      occurrenceCount: 1,
      createdAt,
      lastDetectedAt: createdAt,
      createdBy: user.id
    };
    const alert = {
      id: uid("alt"),
      incidentId: incident.id,
      title: incident.title,
      threatType: incident.type,
      severity: incident.severity,
      sourceType: incident.sourceType,
      sourceName: incident.sourceName,
      zone: incident.zone,
      lat: incident.lat,
      lng: incident.lng,
      confidence: incident.confidence,
      occurrenceCount: 1,
      status: "New",
      acknowledged: false,
      createdAt,
      lastDetectedAt: createdAt
    };
    db.incidents.unshift(incident);
    db.alerts.unshift(alert);
    addDispatchEvent(db, incident.id, "alert_created", alert.title, user.name, createdAt);
    addDispatchEvent(db, incident.id, "incident_created", `${incident.title} opened from command center`, user.name, createdAt);
    addAuditLog(db, "incident_created", user, incident.id, incident.title, createdAt);
    await writeDatabase(db);
    return sendJson(res, 201, { incident: incidentForResponse(db, incident), alert });
  }

  if (req.method === "POST" && url.pathname === "/api/incidents") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const createdAt = now();
    const incident = createIncidentRecord(db, { ...body, source: "Manual", status: body.status || "Verified" }, user, createdAt);
    await writeDatabase(db);
    return sendJson(res, 201, { incident: incidentForResponse(db, incident) });
  }

  const locationMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/location$/);
  if (req.method === "PATCH" && locationMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const incident = db.incidents.find((item) => item.id === locationMatch[1]);
    if (!incident) return sendJson(res, 404, { error: "Incident not found" });
    const point = strictPoint(body);
    if (!point) return sendJson(res, 400, { error: "Valid latitude and longitude are required" });
    const changedAt = now();
    incident.lat = point.lat;
    incident.lng = point.lng;
    incident.address = String(body.address || incident.address || `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`).trim().slice(0, 300);
    incident.locationStatus = body.confirmed === true ? "Verified" : normalizedLocationStatus(body.locationStatus, true);
    incident.updatedAt = changedAt;
    incident.recommendedUnitId = null;
    incident.distanceKm = null;
    incident.etaMinutes = null;
    addDispatchEvent(db, incident.id, "incident_location_updated", `Incident location updated to ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`, user.name, changedAt);
    addAuditLog(db, "incident_location_updated", user, incident.id, `${incident.locationStatus}: ${incident.address}`, changedAt);
    await writeDatabase(db);
    return sendJson(res, 200, { incident: incidentForResponse(db, incident) });
  }

  const confirmLocationMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/confirm-location$/);
  if (req.method === "POST" && confirmLocationMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const incident = db.incidents.find((item) => item.id === confirmLocationMatch[1]);
    if (!incident) return sendJson(res, 404, { error: "Incident not found" });
    if (!strictPoint(incident)) return sendJson(res, 409, { error: "Add valid incident coordinates before confirming location" });
    const changedAt = now();
    incident.locationStatus = "Verified";
    incident.updatedAt = changedAt;
    addDispatchEvent(db, incident.id, "incident_location_verified", `Incident location confirmed: ${incident.address}`, user.name, changedAt);
    addAuditLog(db, "incident_location_verified", user, incident.id, incident.address, changedAt);
    await writeDatabase(db);
    return sendJson(res, 200, { incident: incidentForResponse(db, incident) });
  }

  const recommendMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/recommend-unit$/);
  if (req.method === "POST" && recommendMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const incident = db.incidents.find((item) => item.id === recommendMatch[1]);
    if (!incident) return sendJson(res, 404, { error: "Incident not found" });
    if (!strictPoint(incident)) return sendJson(res, 409, { error: "Location missing — verify before dispatch" });
    if (incident.locationStatus !== "Verified") return sendJson(res, 409, { error: "Confirm the incident location before calculating dispatch recommendations" });
    const routed = await bestRoutedUnit(db, incident);
    if (!routed) return sendJson(res, 503, { error: "No fresh available unit has a verified driving route", degraded: true });
    const { unit: nearest, route } = routed;
    incident.recommendedUnitId = nearest.id;
    incident.distanceKm = Number((route.distanceMeters / 1000).toFixed(2));
    incident.etaMinutes = Math.max(1, Math.round(route.durationSeconds / 60));
    addDispatchEvent(db, incident.id, "unit_recommended", `${nearest.unitCode} recommended with ${incident.etaMinutes} minute ETA`, user.name);
    addDispatchEvent(db, incident.id, "route_calculated", `${incident.distanceKm} km route calculated via ${route.provider}`, user.name);
    addAuditLog(db, "route_calculated", user, incident.id, `${incident.distanceKm} km, ${incident.etaMinutes} min`);
    addAuditLog(db, "unit_recommended", user, incident.id, nearest.unitCode);
    await writeDatabase(db);
    return sendJson(res, 200, { incident: incidentForResponse(db, incident), unit: nearest, route });
  }

  const productAssignMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/assign-unit$/);
  const assignNearestMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/assign-nearest$/);
  if (req.method === "POST" && assignNearestMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const incident = db.incidents.find((item) => item.id === assignNearestMatch[1]);
    if (!incident) return sendJson(res, 404, { error: "Incident not found" });
    if (!["Verified", "Assigned"].includes(canonicalIncidentStatus(incident.status))) {
      return sendJson(res, 409, { error: "Verify the incident before assigning a response unit" });
    }
    if (!strictPoint(incident)) {
      return sendJson(res, 409, { error: "Location missing — verify before dispatch" });
    }
    if (incident.locationStatus !== "Verified") {
      return sendJson(res, 409, { error: "Confirm the incident location before automatic dispatch" });
    }
    const routed = await bestRoutedUnit(db, incident);
    if (!routed) return sendJson(res, 503, { error: "No fresh available unit has a verified driving route", degraded: true });
    const { unit: nearest, route } = routed;
    incident.recommendedUnitId = nearest.id;
    incident.assignedUnitId = nearest.id;
    incident.status = "Assigned";
    incident.distanceKm = Number((route.distanceMeters / 1000).toFixed(2));
    incident.etaMinutes = Math.max(1, Math.round(route.durationSeconds / 60));
    incident.updatedAt = now();
    Object.assign(nearest, { status: "busy", assignedIncidentId: incident.id, lastUpdated: incident.updatedAt });
    addDispatchEvent(db, incident.id, "unit_assigned", `${nearest.unitCode} assigned with ${incident.etaMinutes} minute ETA`, user.name, incident.updatedAt);
    addAuditLog(db, "unit_assigned", user, incident.id, `${nearest.unitCode}; ${incident.distanceKm} km; ${incident.etaMinutes} min`, incident.updatedAt);
    await writeDatabase(db);
    return sendJson(res, 200, { incident: incidentForResponse(db, incident), unit: nearest, route });
  }

  if (req.method === "POST" && productAssignMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const incident = db.incidents.find((item) => item.id === productAssignMatch[1]);
    if (!incident) return sendJson(res, 404, { error: "Incident not found" });
    if (!["Verified", "Assigned"].includes(canonicalIncidentStatus(incident.status))) {
      return sendJson(res, 409, { error: "Verify the incident before assigning a response unit" });
    }
    if (!strictPoint(incident)) return sendJson(res, 409, { error: "Location missing — verify before dispatch" });
    const unitId = body.unitId || incident.recommendedUnitId;
    const unit = db.responseUnits.find((item) => item.id === unitId);
    if (!unit) return sendJson(res, 400, { error: "Recommend or select a valid response unit first" });
    if (unit.status !== "available" && unit.assignedIncidentId !== incident.id) return sendJson(res, 409, { error: `${unit.unitCode} is not available` });
    if (incident.locationStatus !== "Verified") return sendJson(res, 409, { error: "Confirm the incident location before dispatch" });
    const freshness = unitLocationFreshness(unit);
    if (!freshness.eligible && body.overrideStale !== true) {
      return sendJson(res, 409, { error: `${unit.unitCode} location is ${freshness.label.toLowerCase()}. Manual override confirmation is required.`, requiresOverride: true });
    }
    if (incident.assignedUnitId && incident.assignedUnitId !== unit.id) {
      const previous = db.responseUnits.find((item) => item.id === incident.assignedUnitId);
      if (previous) Object.assign(previous, { status: "available", assignedIncidentId: null, lastUpdated: now() });
    }
    incident.assignedUnitId = unit.id;
    incident.recommendedUnitId = incident.recommendedUnitId || unit.id;
    incident.status = "Assigned";
    incident.updatedAt = now();
    Object.assign(unit, { status: "busy", assignedIncidentId: incident.id, lastUpdated: incident.updatedAt });
    addDispatchEvent(db, incident.id, "status_updated", "Incident status changed to Assigned", user.name);
    addDispatchEvent(db, incident.id, "unit_assigned", `${unit.unitCode} assigned to ${incident.title}`, user.name);
    addAuditLog(db, "unit_assigned", user, incident.id, unit.unitCode);
    await writeDatabase(db);
    return sendJson(res, 200, { incident: incidentForResponse(db, incident), unit });
  }

  const closeMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/close$/);
  if (req.method === "POST" && closeMatch) {
    if (!hasRole(user, ["Admin"])) return forbidden(res);
    const incident = db.incidents.find((item) => item.id === closeMatch[1]);
    if (!incident) return sendJson(res, 404, { error: "Incident not found" });
    if (!canTransitionIncident(incident.status, "Closed")) {
      return sendJson(res, 409, { error: `Incident cannot transition from ${canonicalIncidentStatus(incident.status)} to Closed` });
    }
    const closedAt = now();
    incident.status = "Closed";
    incident.closedAt = closedAt;
    const unit = db.responseUnits.find((item) => item.id === incident.assignedUnitId);
    if (unit) Object.assign(unit, { status: "available", assignedIncidentId: null, lastUpdated: closedAt });
    db.alerts.filter((alert) => alert.incidentId === incident.id).forEach((alert) => { alert.status = "Closed"; });
    addDispatchEvent(db, incident.id, "incident_closed", `${incident.title} closed${unit ? `; ${unit.unitCode} released` : ""}`, user.name, closedAt);
    addAuditLog(db, "incident_closed", user, incident.id, unit ? `${unit.unitCode} released` : "", closedAt);
    await writeDatabase(db);
    return sendJson(res, 200, { incident: incidentForResponse(db, incident), releasedUnit: unit || null });
  }

  const cameraConfigMatch = url.pathname.match(/^\/api\/camera-sources\/([^/]+)\/config$/);
  if (req.method === "PATCH" && cameraConfigMatch) {
    if (!hasRole(user, ["Admin"])) return forbidden(res);
    const source = db.cameraSources.find((item) => item.id === cameraConfigMatch[1]);
    if (!source) return sendJson(res, 404, { error: "Camera source not found" });
    if (source.type !== "cctv") return sendJson(res, 400, { error: "RTSP config is available for CCTV sources only" });
    const rtspUrl = String(body.rtspUrl || "").trim().slice(0, 400);
    source.rtspUrl = rtspUrl;
    source.status = rtspUrl ? "online" : "offline";
    db.auditLogs.unshift({ id: uid("aud"), actorName: user.name, action: "updated_camera_source_config", timestamp: now() });
    await writeDatabase(db);
    return sendJson(res, 200, { source: cameraSourcesForResponse(db).find((item) => item.id === source.id) });
  }

  const cameraTestMatch = url.pathname.match(/^\/api\/camera-sources\/([^/]+)\/test$/);
  if (req.method === "POST" && cameraTestMatch) {
    if (!hasRole(user, ["Admin"])) return forbidden(res);
    const source = db.cameraSources.find((item) => item.id === cameraTestMatch[1]);
    if (!source) return sendJson(res, 404, { error: "Camera source not found" });
    if (source.type !== "cctv") return sendJson(res, 400, { error: "Connection test is available for CCTV sources only" });
    const ok = Boolean(String(source.rtspUrl || "").trim());
    source.lastTestedAt = now();
    source.lastTestStatus = ok ? "configured" : "not_configured";
    db.auditLogs.unshift({ id: uid("aud"), actorName: user.name, action: "tested_camera_source_connection", timestamp: now() });
    await writeDatabase(db);
    return sendJson(res, 200, { ok, mode: ok ? "configured" : "not-configured", message: ok ? "RTSP URL is configured. Enable the streaming gateway to validate frames." : "No RTSP URL is configured for this source." });
  }

  if (req.method === "GET" && url.pathname === "/api/incidents/history") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const incidents = db.incidents
      .filter((incident) => ["closed", "resolved", "rejected / false alarm"].includes(normalizedIncidentValue(incident.status)))
      .sort((a, b) => String(b.closedAt || b.resolvedAt || b.createdAt || "").localeCompare(String(a.closedAt || a.resolvedAt || a.createdAt || "")))
      .map((incident) => incidentForResponse(db, incident));
    return sendJson(res, 200, { incidents });
  }

  if (req.method === "DELETE" && url.pathname === "/api/incidents/history") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const clearedIds = new Set(
      db.incidents
        .filter((incident) => ["closed", "resolved", "rejected / false alarm"].includes(normalizedIncidentValue(incident.status)))
        .map((incident) => incident.id)
    );
    const before = db.incidents.length;
    db.incidents = db.incidents.filter((incident) => !clearedIds.has(incident.id));
    db.dispatchEvents = db.dispatchEvents.filter((event) => !clearedIds.has(event.incidentId));
    db.alerts = db.alerts.filter((alert) => !clearedIds.has(alert.incidentId));
    const cleared = before - db.incidents.length;
    db.auditLogs.unshift({ id: uid("aud"), actorName: user.name, action: `cleared_${cleared}_incident_history`, timestamp: now() });
    await writeDatabase(db);
    return sendJson(res, 200, { cleared });
  }

  if (req.method === "POST" && url.pathname === "/api/report-missing") {
    if (!hasRole(user, ["Citizen", "Police Officer", "Admin"])) return forbidden(res);
    const evidence = typeof body.image === "string"
      && (body.image.startsWith("data:image/") || body.image.startsWith("data:video/"))
      && body.image.length < 900000
      ? body.image
      : null;
    const image = evidence?.startsWith("data:image/") ? evidence : null;
    const evidenceType = evidence?.startsWith("data:video/") ? "video" : image ? "image" : null;
    const imageName = evidence && body.imageName ? String(body.imageName).slice(0, 120) : null;
    const reportType = ["missing_object", "emergency_report"].includes(body.reportType)
      ? body.reportType
      : "missing_person";
    const report = {
      id: uid(reportType === "missing_object" ? "mo" : reportType === "emergency_report" ? "er" : "mp"),
      reportType,
      name: body.name,
      age: reportType === "missing_person" ? Number(body.age || 0) : null,
      category: String(body.category || reportType).slice(0, 80),
      description: String(body.description || "").slice(0, 500),
      lastSeenLocation: body.lastSeenLocation,
      address: String(body.address || body.lastSeenLocation || "Location not specified").slice(0, 240),
      lat: Number.isFinite(Number(body.lat)) ? Number(body.lat) : null,
      lng: Number.isFinite(Number(body.lng)) ? Number(body.lng) : null,
      urgency: ["low", "medium", "high", "critical"].includes(body.urgency) ? body.urgency : "medium",
      status: "submitted_for_review",
      matchConfidence: 0,
      matchedCameraId: null,
      image,
      evidence: evidenceType === "video" ? evidence : null,
      evidenceType,
      imageName,
      createdAt: now(),
      updatedAt: now(),
      createdBy: user.id
    };
    db.reports.unshift(report);
    const auditLog = addAuditLog(db, "citizen_report_submitted", user, null, `${reportType}: ${report.name}`, report.createdAt);
    await writeSelectedRecords(db, [
      [missingPersonsRepository, [report]],
      [auditLogsRepository, [auditLog]]
    ]);
    return sendJson(res, 201, user.role === "Citizen"
      ? { report: citizenReportForResponse(report), message: "Submitted for review" }
      : { report, message: "Submitted for review" });
  }

  if (req.method === "POST" && url.pathname === "/api/send-alert") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const location = pointFor({ ...body, location: body.location });
    const createdAt = now();
    const alert = {
      id: uid("alt"),
      incidentId: body.incidentId || null,
      title: body.message || body.title || "Command center alert",
      threatType: body.type || "manual_alert",
      severity: body.severity || "critical",
      sourceType: "manual",
      sourceName: user.name,
      zone: body.zone || "All Zones",
      lat: location.lat,
      lng: location.lng,
      confidence: 0,
      occurrenceCount: 1,
      status: "New",
      acknowledged: false,
      createdAt,
      lastDetectedAt: createdAt
    };
    db.alerts.unshift(alert);
    if (alert.incidentId) addDispatchEvent(db, alert.incidentId, "alert_created", alert.title, user.name, createdAt);
    addAuditLog(db, "alert_created", user, alert.incidentId, alert.title, createdAt);
    await writeDatabase(db);
    return sendJson(res, 201, { alert, delivery: await sendFirebaseNotification(alert) });
  }

  if (req.method === "PATCH" && url.pathname === "/api/alerts/clear") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const clearedAt = now();
    let cleared = 0;
    db.alerts.forEach((alert) => {
      if (alert.status !== "closed") {
        alert.status = "closed";
        alert.closedAt = clearedAt;
        cleared += 1;
      }
    });
    db.auditLogs.unshift({ id: uid("aud"), actorName: user.name, action: `cleared_${cleared}_alerts`, timestamp: clearedAt });
    await writeDatabase(db);
    return sendJson(res, 200, { cleared });
  }

  const ackAlertMatch = url.pathname.match(/^\/api\/alerts\/([^/]+)\/(?:ack|acknowledge)$/);
  if (["PATCH", "POST"].includes(req.method) && ackAlertMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const alert = db.alerts.find((item) => item.id === ackAlertMatch[1]);
    if (!alert) return sendJson(res, 404, { error: "Alert not found" });
    if (!alert.acknowledged) {
      alert.acknowledged = true;
      alert.status = "Acknowledged";
      alert.acknowledgedAt = now();
      alert.acknowledgedBy = { userId: user.id, name: user.name, role: user.role };
      if (alert.incidentId) addDispatchEvent(db, alert.incidentId, "alert_acknowledged", `${alert.title} acknowledged by ${user.name}`, user.name);
      addAuditLog(db, "alert_acknowledged", user, alert.incidentId, alert.id);
    }
    await writeDatabase(db);
    return sendJson(res, 200, { alert });
  }

  const assignMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/assign-unit$/);
  if (req.method === "PATCH" && assignMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const incident = db.incidents.find((i) => i.id === assignMatch[1]);
    if (!incident) return sendJson(res, 404, { error: "Not found" });
    if (!["Verified", "Assigned"].includes(canonicalIncidentStatus(incident.status))) {
      return sendJson(res, 409, { error: "Verify the incident before assigning a response unit" });
    }
    if (!strictPoint(incident)) return sendJson(res, 409, { error: "Location missing — verify before dispatch" });
    const unit = db.responseUnits.find((item) => item.id === body.unitId || item.unitCode === body.assignedUnit)
      || db.responseUnits.find((item) => item.id === incident.recommendedUnitId);
    if (!unit) return sendJson(res, 400, { error: "Recommend or select a valid response unit first" });
    if (unit.status !== "available" && unit.assignedIncidentId !== incident.id) return sendJson(res, 409, { error: `${unit.unitCode} is not available` });
    if (incident.locationStatus !== "Verified") return sendJson(res, 409, { error: "Confirm the incident location before dispatch" });
    const freshness = unitLocationFreshness(unit);
    if (!freshness.eligible && body.overrideStale !== true) {
      return sendJson(res, 409, { error: `${unit.unitCode} location is ${freshness.label.toLowerCase()}. Manual override confirmation is required.`, requiresOverride: true });
    }
    incident.status = "Assigned";
    incident.assignedUnitId = unit.id;
    incident.updatedAt = now();
    Object.assign(unit, { status: "busy", assignedIncidentId: incident.id, lastUpdated: incident.updatedAt });
    addDispatchEvent(db, incident.id, "unit_assigned", `${unit.unitCode} assigned to ${incident.title}`, user.name);
    addAuditLog(db, "unit_assigned", user, incident.id, unit.unitCode);
    await writeDatabase(db);
    return sendJson(res, 200, { incident: incidentForResponse(db, incident), unit });
  }

  const statusMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/status$/);
  if (req.method === "PATCH" && statusMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const incident = db.incidents.find((i) => i.id === statusMatch[1]);
    if (!incident) return sendJson(res, 404, { error: "Not found" });
    const nextStatus = canonicalIncidentStatus(body.status || incident.status);
    if (!INCIDENT_STATUSES.includes(nextStatus)) return sendJson(res, 400, { error: "Invalid incident status" });
    const currentStatus = canonicalIncidentStatus(incident.status);
    if (!canTransitionIncident(currentStatus, nextStatus)) {
      return sendJson(res, 409, { error: `Incident cannot transition from ${currentStatus} to ${nextStatus}` });
    }
    if (currentStatus === nextStatus) {
      return sendJson(res, 200, { incident: incidentForResponse(db, incident) });
    }
    if (nextStatus === "Verified" && !strictPoint(incident)) {
      incident.status = "Verification Required";
      incident.locationStatus = "Needs Confirmation";
      incident.updatedAt = now();
      await writeDatabase(db);
      return sendJson(res, 409, { error: "Location missing — verify before dispatch", incident: incidentForResponse(db, incident) });
    }
    if (["Assigned", "En Route", "On Scene"].includes(nextStatus) && !incident.assignedUnitId) {
      return sendJson(res, 409, { error: "Assign a response unit before this status" });
    }
    const changedAt = now();
    incident.status = nextStatus;
    incident.updatedAt = changedAt;
    const assignedUnit = db.responseUnits.find((item) => item.id === incident.assignedUnitId);
    if (["Assigned", "En Route", "On Scene"].includes(nextStatus) && assignedUnit) {
      assignedUnit.status = "busy";
      assignedUnit.lastUpdated = changedAt;
    }
    if (nextStatus === "Resolved") {
      incident.resolvedAt = changedAt;
      addAuditLog(db, "incident_resolved", user, incident.id, incident.title, changedAt);
    }
    if (nextStatus === "Rejected / False Alarm") {
      incident.rejectedAt = changedAt;
      addAuditLog(db, "false_alarm_rejected", user, incident.id, incident.title, changedAt);
    }
    if (["Closed", "Rejected / False Alarm"].includes(nextStatus)) {
      const closedAt = changedAt;
      incident.closedAt = closedAt;
      const unit = assignedUnit;
      if (unit) Object.assign(unit, { status: "available", assignedIncidentId: null, lastUpdated: closedAt });
      db.alerts
        .filter((alert) => alert.incidentId === incident.id)
        .forEach((alert) => {
          alert.status = "Closed";
          alert.closedAt = closedAt;
        });
    }
    addDispatchEvent(db, incident.id, "status_updated", `Incident status changed to ${nextStatus}`, user.name);
    addAuditLog(db, "incident_status_changed", user, incident.id, nextStatus);
    if (nextStatus === "Verified") addAuditLog(db, "incident_verified", user, incident.id, incident.title, changedAt);
    if (nextStatus === "Closed") addAuditLog(db, "incident_closed", user, incident.id, incident.title, changedAt);
    await writeDatabase(db);
    return sendJson(res, 200, { incident: incidentForResponse(db, incident) });
  }

  return sendJson(res, 404, { error: "Not found" });
}

function api(req, res, url) {
  const mutatesData = ["POST", "PATCH", "PUT", "DELETE"].includes(req.method);
  if (getDatabaseMode() !== "postgres" || !mutatesData) {
    return apiInternal(req, res, url);
  }
  return withAdvisoryLock(() => apiInternal(req, res, url));
}

if (getDatabaseMode() === "json") ensureDb();

module.exports = {
  api,
  ensureDb,
  readDb,
  writeDb,
  readDatabase,
  writeDatabase,
  seedDb,
  ensureProductShape,
  sendJson,
  now,
  publicUser,
  userFromReq,
  hasRole,
  forbidden,
  summary,
  camerasForResponse,
  cameraSourcesForResponse,
  integrationStatus,
  consolidateActiveAiIncidents
};
