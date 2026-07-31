// @ts-nocheck
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
const {
  resolveOsrmBaseUrl,
  routeTimeoutMs,
  routeUnavailableWarning
} = require("./routingConfig.service");
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
      { id: "cam_c19", cameraId: "C-19", name: "C-19 Red Zone", zone: "Red Zone", health: "online", aiStatus: "Demo AI sample: possible person", density: 68, scene: "cctv-red-zone.svg", sourceType: "demo_seed", isDemo: true, aiEnabled: false },
      { id: "cam_c12", cameraId: "C-12", name: "C-12 Gate A", zone: "Gate A", health: "online", aiStatus: "Demo AI sample: possible crowd", density: 74, scene: "cctv-gate-a.svg", sourceType: "demo_seed", isDemo: true, aiEnabled: false },
      { id: "cam_c27", cameraId: "C-27", name: "C-27 Exit", zone: "Exit Corridor", health: "online", aiStatus: "Demo feed normal", density: 42, scene: "cctv-exit.svg", sourceType: "demo_seed", isDemo: true, aiEnabled: false },
      { id: "cam_d03", cameraId: "D-03", name: "D-03 Drone", zone: "Transit Hub", health: "warning", aiStatus: "Demo AI sample: possible motion", density: 57, scene: "cctv-drone.svg", sourceType: "demo_seed", isDemo: true, aiEnabled: false },
      { id: "cam_c05", cameraId: "C-05", name: "C-05 Parking", zone: "Parking", health: "offline", aiStatus: "Demo feed unavailable", density: 0, scene: "cctv-parking.svg", sourceType: "demo_seed", isDemo: true, aiEnabled: false }
    ],
    cameraSources: [
      { id: "cam_c19", cameraId: "C-19", type: "demo", sourceType: "demo_seed", name: "C-19 Red Zone", zone: "Red Zone", status: "online", enabled: true, aiEnabled: false, isDemo: true, lastFrameStatus: "simulated demo frame", healthReason: "Simulated feed for product demonstration only" },
      { id: "cam_c12", cameraId: "C-12", type: "demo", sourceType: "demo_seed", name: "C-12 Gate A", zone: "Gate A", status: "online", enabled: true, aiEnabled: false, isDemo: true, lastFrameStatus: "simulated demo frame", healthReason: "Simulated feed for product demonstration only" },
      { id: "cam_c27", cameraId: "C-27", type: "demo", sourceType: "demo_seed", name: "C-27 Exit", zone: "Exit Corridor", status: "online", enabled: true, aiEnabled: false, isDemo: true, lastFrameStatus: "simulated demo frame", healthReason: "Simulated feed for product demonstration only" },
      { id: "cam_d03", cameraId: "D-03", type: "demo", sourceType: "demo_seed", name: "D-03 Drone", zone: "Transit Hub", status: "unknown", enabled: true, aiEnabled: false, isDemo: true, lastFrameStatus: "simulated demo frame", healthReason: "Demo motion sample, not a production camera" },
      { id: "cam_c05", cameraId: "C-05", type: "demo", sourceType: "demo_seed", name: "C-05 Parking", zone: "Parking", status: "offline", enabled: true, aiEnabled: false, isDemo: true, lastFrameStatus: "simulated feed offline", healthReason: "Demo disconnected state" },
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
    videoEvidence: [],
    policeStations: defaultPoliceStations(t),
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
        detections: db.detections || [],
        videoEvidence: db.videoEvidence || [],
        policeStations: db.policeStations || []
      })]
    );
  });
}

async function repairLegacyPersistedData() {
  const db = await readDatabase();
  const actions = [...legacyRepairActions(db)];
  if (actions.length) await writeDatabase(db);
  return actions;
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

async function writeIncidentWorkflowRecords(db, incident, {
  units = [],
  alerts = [],
  reports = [],
  events = [],
  audits = []
} = {}) {
  const relatedAlerts = db.alerts.filter((alert) => alert.incidentId === incident.id);
  const linkedReport = db.reports.find((report) => report.incidentId === incident.id || report.id === incident.sourceRecordId);
  const relatedEvents = db.dispatchEvents.filter((event) => event.incidentId === incident.id);
  const relatedAudits = db.auditLogs.filter((log) => log.incidentId === incident.id);
  const uniqueById = (records) => [...new Map(records.filter(Boolean).map((record) => [record.id, record])).values()];
  await writeSelectedRecords(db, [
    [incidentsRepository, [incident]],
    [responseUnitsRepository, uniqueById(units)],
    [alertsRepository, uniqueById([...relatedAlerts, ...alerts])],
    [missingPersonsRepository, uniqueById([linkedReport, ...reports])],
    [dispatchEventsRepository, uniqueById([...relatedEvents, ...events])],
    [auditLogsRepository, uniqueById([...relatedAudits, ...audits])]
  ]);
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
const UNIT_STATUSES = ["available", "assigned", "busy", "offline", "stale"];
const UNIT_TYPES = ["police_patrol", "police_station", "traffic", "medical", "fire", "backup"];
const UNIT_SOURCES = ["live_gps", "admin_registry", "station_registry", "demo_seed"];
const DISPATCH_UNIT_SOURCE_PRIORITY = {
  live_gps: 0,
  admin_registry: 1,
  station_registry: 2,
  demo_seed: 3
};
const DEFAULT_OPERATIONAL_CENTER = { lat: 17.5109, lng: 78.3276 };
const LOCAL_DEMO_POINTS = {
  patancheru: { lat: 17.5285, lng: 78.2636 },
  bhel: { lat: 17.4933, lng: 78.3915 },
  ramachandrapuram: { lat: 17.4933, lng: 78.3915 },
  hyderabadCentral: { lat: 17.385, lng: 78.4867 }
};
const ZONE_COORDINATES = {
  "Red Zone": { lat: 17.5312, lng: 78.2662 },
  "Main Entry": { lat: 17.5285, lng: 78.2636 },
  "Gate A": { lat: 17.5285, lng: 78.2636 },
  "Food Court": { lat: 17.5218, lng: 78.2815 },
  "Medical Camp": { lat: 17.4933, lng: 78.3915 },
  "Exit Corridor": { lat: 17.4972, lng: 78.3841 },
  "Transit Hub": { lat: 17.5004, lng: 78.3798 },
  "Parking": { lat: 17.4889, lng: 78.3973 },
  "Parking Zone B": { lat: 17.4889, lng: 78.3973 },
  "Industrial Area": { lat: 17.5285, lng: 78.2636 },
  "BHEL Township": { lat: 17.4933, lng: 78.3915 },
  "Mobile Source": DEFAULT_OPERATIONAL_CENTER,
  "Evidence Review": DEFAULT_OPERATIONAL_CENTER,
  "All Zones": DEFAULT_OPERATIONAL_CENTER
};
const LEGACY_DELHI_TEXT_PATTERN = /\b(?:delhi|new delhi|ncr|noida|ghaziabad)\b/i;
const LOCAL_DEMO_LOCATION_SOURCE = "demo_seed_normalized";
const LEGACY_LOCATION_WARNING = "Legacy fallback location requires confirmation";

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

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isLegacyDelhiPoint(record) {
  const point = strictPoint(record);
  if (!point) return false;
  return point.lat >= 28.4 && point.lat <= 28.8 && point.lng >= 77.0 && point.lng <= 77.4;
}

function isExactLegacyDelhiDefault(record) {
  const point = strictPoint(record);
  if (!point) return false;
  return Math.abs(point.lat - 28.6139) < 0.0001 && Math.abs(point.lng - 77.2295) < 0.0001;
}

function legacyLocationText(record = {}) {
  return [
    record.id,
    record.title,
    record.name,
    record.zone,
    record.address,
    record.currentAddress,
    record.sourceName,
    record.description,
    record.lastSeenLocation
  ].map((value) => String(value || "")).join(" ");
}

function hasLegacyDelhiText(record) {
  return LEGACY_DELHI_TEXT_PATTERN.test(legacyLocationText(record));
}

function isDemoMode() {
  return process.env.RAKSHAKAI_DEMO_MODE === "true" || process.env.NODE_ENV === "test" || process.env.NODE_ENV !== "production";
}

function normalizeUnitType(value = "") {
  const text = String(value || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (UNIT_TYPES.includes(text)) return text;
  if (/station/.test(text)) return "police_station";
  if (/traffic/.test(text)) return "traffic";
  if (/medical|ambulance/.test(text)) return "medical";
  if (/fire/.test(text)) return "fire";
  if (/backup|reserve/.test(text)) return "backup";
  return "police_patrol";
}

function normalizeUnitSource(value = "", { isDemo = false } = {}) {
  const source = String(value || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (UNIT_SOURCES.includes(source)) return source;
  if (isDemo) return "demo_seed";
  if (/gps|live/.test(source)) return "live_gps";
  if (/station|base/.test(source)) return "station_registry";
  return "admin_registry";
}

function defaultPoliceStations(timestamp = now()) {
  return [
    {
      id: "station_patancheru",
      stationId: "PS-PATANCHERU",
      stationName: "Patancheru Police Station",
      address: "Patancheru, Sangareddy District, Telangana",
      lat: LOCAL_DEMO_POINTS.patancheru.lat,
      lng: LOCAL_DEMO_POINTS.patancheru.lng,
      jurisdiction: "Patancheru",
      beat: "Industrial Area",
      sectorCoverage: ["Industrial Area", "Gate A", "Red Zone"],
      source: "demo_seed",
      isDemo: true,
      operational: isDemoMode(),
      lastUpdated: timestamp
    },
    {
      id: "station_bhel_ramachandrapuram",
      stationId: "PS-BHEL-RCP",
      stationName: "BHEL / Ramachandrapuram Demo Station",
      address: "BHEL Township, Ramachandrapuram, Telangana",
      lat: LOCAL_DEMO_POINTS.bhel.lat,
      lng: LOCAL_DEMO_POINTS.bhel.lng,
      jurisdiction: "Ramachandrapuram",
      beat: "BHEL Township",
      sectorCoverage: ["BHEL Township", "Transit Hub", "Parking Zone B"],
      source: "demo_seed",
      isDemo: true,
      operational: isDemoMode(),
      lastUpdated: timestamp
    },
    {
      id: "station_hyderabad_control",
      stationId: "PS-HYD-CTRL",
      stationName: "Hyderabad Central Control Demo Station",
      address: "Hyderabad Central Control Room, Telangana",
      lat: LOCAL_DEMO_POINTS.hyderabadCentral.lat,
      lng: LOCAL_DEMO_POINTS.hyderabadCentral.lng,
      jurisdiction: "Hyderabad",
      beat: "Central Control",
      sectorCoverage: ["Hyderabad", "Regional Backup"],
      source: "demo_seed",
      isDemo: true,
      operational: isDemoMode(),
      lastUpdated: timestamp
    }
  ];
}

function normalizePoliceStationRecord(station = {}) {
  const point = strictPoint(station);
  const isDemo = station.isDemo === true || normalizeUnitSource(station.source, { isDemo: false }) === "demo_seed";
  const source = normalizeUnitSource(station.source || (isDemo ? "demo_seed" : "admin_registry"), { isDemo });
  const operational = source === "demo_seed"
    ? (station.operational !== undefined ? Boolean(station.operational) && isDemoMode() : isDemoMode())
    : station.operational !== undefined
      ? Boolean(station.operational)
      : true;
  return {
    ...station,
    id: station.id || station.stationId || uid("station"),
    stationId: station.stationId || station.id || "",
    stationName: station.stationName || station.name || "Police Station",
    name: station.name || station.stationName || "Police Station",
    address: station.address || station.currentAddress || "Station address unavailable",
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    latitude: point?.lat ?? null,
    longitude: point?.lng ?? null,
    jurisdiction: station.jurisdiction || station.zone || "",
    beat: station.beat || station.sector || "",
    sectorCoverage: Array.isArray(station.sectorCoverage)
      ? station.sectorCoverage
      : String(station.sectorCoverage || station.beat || station.sector || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    source,
    sourceLabel: {
      live_gps: "Live GPS",
      admin_registry: "Admin registry",
      station_registry: "Station fallback",
      demo_seed: "Demo seed"
    }[source],
    isDemo,
    operational,
    badge: isDemo ? "DEMO STATION" : "REAL STATION",
    sourceNotes: isDemo ? "Simulated station for local Hyderabad/Patancheru demo" : "",
    lastUpdated: station.lastUpdated || station.updatedAt || now()
  };
}

function stationForResponse(station) {
  const normalized = normalizePoliceStationRecord(station);
  return {
    ...normalized,
    location: strictPoint(normalized),
    status: normalized.operational ? "available" : "offline"
  };
}

function findLinkedStation(unit = {}, stations = []) {
  const stationId = String(unit.linkedStationId || unit.stationId || "").trim().toLowerCase();
  const stationName = String(unit.stationName || unit.station || "").trim().toLowerCase();
  if (!stationId && !stationName) return null;
  return stations
    .map(normalizePoliceStationRecord)
    .find((station) =>
      (stationId && [station.id, station.stationId].map((item) => String(item || "").toLowerCase()).includes(stationId))
      || (stationName && String(station.stationName || station.name || "").toLowerCase() === stationName)
    ) || null;
}

function applyStationFallback(unit = {}, stations = []) {
  const station = findLinkedStation(unit, stations);
  if (!station) return unit;
  const unitPoint = strictPoint(unit);
  const stationPoint = strictPoint(station);
  const next = {
    ...unit,
    linkedStationId: unit.linkedStationId || station.stationId || station.id,
    stationId: unit.stationId || station.stationId || station.id,
    stationName: unit.stationName || station.stationName,
    station: unit.station || station.stationName
  };
  if (!unitPoint && stationPoint) {
    Object.assign(next, {
      lat: stationPoint.lat,
      lng: stationPoint.lng,
      address: unit.address || station.address,
      currentAddress: unit.currentAddress || station.address,
      stationFallback: true,
      locationSource: "station_registry",
      locationSourceLabel: "Live GPS unavailable - using station/base location",
      lastLocationUpdatedAt: unit.lastLocationUpdatedAt || station.lastUpdated || now()
    });
  }
  return next;
}

function localDemoUnitTemplate(unit = {}) {
  const key = String(unit.id || unit.unitCode || unit.unitId || "").toLowerCase();
  if (key.includes("unit_p04") || key.includes("p-04") || key.includes("p-01")) {
    return {
      unitCode: "P-01",
      unitId: "P-01",
      unitName: "Patancheru Patrol 01",
      name: "Patancheru Patrol 01",
      officerName: unit.officerName || "Inspector Kavya Rao",
      vehicleType: "Patrol SUV",
      unitType: "police_patrol",
      lat: LOCAL_DEMO_POINTS.patancheru.lat,
      lng: LOCAL_DEMO_POINTS.patancheru.lng,
      zone: "Industrial Area",
      beat: "Industrial Area",
      sector: "Industrial Area",
      jurisdiction: "Patancheru",
      linkedStationId: "PS-PATANCHERU",
      stationId: "PS-PATANCHERU",
      stationName: "Patancheru Police Station",
      station: "Patancheru Police Station",
      address: "Patancheru Industrial Area demo patrol point"
    };
  }
  if (key.includes("unit_p02") || key.includes("p-02")) {
    return {
      unitCode: "P-02",
      unitId: "P-02",
      unitName: "BHEL Patrol 02",
      name: "BHEL Patrol 02",
      officerName: unit.officerName || "Sub-Inspector Arjun Mehta",
      vehicleType: "Patrol Car",
      unitType: "police_patrol",
      lat: LOCAL_DEMO_POINTS.bhel.lat,
      lng: LOCAL_DEMO_POINTS.bhel.lng,
      zone: "BHEL Township",
      beat: "BHEL Township",
      sector: "BHEL Township",
      jurisdiction: "Ramachandrapuram",
      linkedStationId: "PS-BHEL-RCP",
      stationId: "PS-BHEL-RCP",
      stationName: "BHEL / Ramachandrapuram Demo Station",
      station: "BHEL / Ramachandrapuram Demo Station",
      address: "BHEL Township demo patrol point"
    };
  }
  if (key.includes("unit_m02") || key.includes("m-02")) {
    return {
      unitCode: "M-02",
      unitId: "M-02",
      unitName: "BHEL Medical Response 02",
      name: "BHEL Medical Response 02",
      officerName: unit.officerName || "Dr. Neha Iyer",
      vehicleType: "Ambulance",
      unitType: "medical",
      lat: 17.5004,
      lng: 78.3798,
      zone: "Transit Hub",
      beat: "Transit Hub",
      sector: "Transit Hub",
      jurisdiction: "Ramachandrapuram",
      linkedStationId: "PS-BHEL-RCP",
      stationId: "PS-BHEL-RCP",
      stationName: "BHEL / Ramachandrapuram Demo Station",
      station: "BHEL / Ramachandrapuram Demo Station",
      address: "BHEL Transit Hub demo medical point"
    };
  }
  return null;
}

function migrateLegacyDemoUnit(unit = {}) {
  if (!isSeedDemoUnit(unit) && unit.isDemo !== true && unit.source !== "demo_seed") return unit;
  const template = localDemoUnitTemplate(unit);
  if (!template) return unit;
  return {
    ...unit,
    ...template,
    source: "demo_seed",
    isDemo: true,
    operational: unit.operational !== undefined ? Boolean(unit.operational) && isDemoMode() : isDemoMode()
  };
}

function isSeedDemoUnit(unit) {
  return ["unit_p04", "unit_p02", "unit_m02"].includes(unit?.id) || /^unit_[pm]\d+/i.test(String(unit?.id || ""));
}

function normalizeUnitStatus(value = "") {
  const status = String(value || "").toLowerCase().replace(/\s+/g, "_");
  if (UNIT_STATUSES.includes(status)) return status;
  if (["active", "ready", "online"].includes(status)) return "available";
  if (["inactive", "disabled", "deactivated"].includes(status)) return "offline";
  return "available";
}

function normalizeResponseUnitRecord(unit = {}) {
  const point = strictPoint(unit);
  const isDemo = unit.isDemo === true || normalizeUnitSource(unit.source, { isDemo: isSeedDemoUnit(unit) }) === "demo_seed" || isSeedDemoUnit(unit);
  const source = normalizeUnitSource(unit.source, { isDemo });
  const locationSource = unit.locationSource || (unit.stationFallback ? "station_registry" : source);
  const unitType = normalizeUnitType(unit.unitType || unit.type || unit.vehicleType);
  const operational = source === "demo_seed"
    ? (unit.operational !== undefined ? Boolean(unit.operational) && isDemoMode() : isDemoMode())
    : unit.operational !== undefined
      ? Boolean(unit.operational)
      : normalizeUnitStatus(unit.status) !== "offline";
  const lastUpdated = unit.lastUpdated || unit.lastSeen || now();
  const lastLocationUpdatedAt = unit.lastLocationUpdatedAt || unit.lastSeen || lastUpdated;
  return {
    ...unit,
    id: unit.id || uid("unit"),
    unitId: unit.unitId || unit.unitCode || unit.id || "",
    unitCode: unit.unitCode || unit.unitId || unit.id || "",
    unitName: unit.unitName || unit.name || unit.unitCode || "Response Unit",
    name: unit.name || unit.unitName || unit.unitCode || "Response Unit",
    unitType,
    type: unit.type || unitType,
    officerName: unit.officerName || unit.teamName || "",
    teamName: unit.teamName || unit.officerName || "",
    stationName: unit.stationName || unit.station || "",
    station: unit.station || unit.stationName || "",
    linkedStationId: unit.linkedStationId || unit.stationId || null,
    stationId: unit.stationId || unit.linkedStationId || null,
    beat: unit.beat || unit.zone || "",
    sector: unit.sector || unit.beat || unit.zone || "",
    jurisdiction: unit.jurisdiction || unit.zone || unit.beat || "",
    vehicleType: unit.vehicleType || displayWords(unitType),
    status: normalizeUnitStatus(unit.status),
    currentIncidentId: unit.currentIncidentId || unit.assignedIncidentId || null,
    assignedIncidentId: unit.assignedIncidentId || unit.currentIncidentId || null,
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    latitude: point?.lat ?? null,
    longitude: point?.lng ?? null,
    address: unit.address || unit.currentAddress || unit.zone || "Location address unavailable",
    currentAddress: unit.currentAddress || unit.address || unit.zone || "Location address unavailable",
    source,
    sourceLabel: {
      live_gps: "Live GPS",
      admin_registry: "Admin registry",
      station_registry: "Station fallback",
      demo_seed: "Demo seed"
    }[source],
    locationSource,
    locationSourceLabel: unit.locationSourceLabel || (locationSource === "station_registry"
      ? "Live GPS unavailable - using station/base location"
      : source === "demo_seed"
        ? "Simulated unit for demo"
        : source === "live_gps"
          ? "Live GPS"
          : "Admin registry"),
    isDemo,
    stationFallback: Boolean(unit.stationFallback || locationSource === "station_registry"),
    operational,
    lastSeen: unit.lastSeen || lastLocationUpdatedAt,
    lastUpdated,
    lastLocationUpdatedAt,
    sourceNotes: source === "demo_seed"
      ? "Simulated unit for demo"
      : locationSource === "station_registry"
        ? "Live GPS unavailable - using station/base location"
        : ""
  };
}

const TRUSTED_LOCATION_SOURCES = new Set(["browser_gps", "manual_search", "map_click", "manual_latlng"]);
const DEMO_LOCATION_SOURCES = new Set(["demo_seed", "seed", LOCAL_DEMO_LOCATION_SOURCE]);

function normalizeLocationSource(value, { hasPoint = false, isDemo = false } = {}) {
  const source = normalizedIncidentValue(value).replace(/[\s-]+/g, "_");
  if (value !== undefined && value !== null && source === "unknown") return "unknown";
  if (source === "gps" || source === "browsergps") return "browser_gps";
  if (source === "manual" || source === "manual_coordinates" || source === "manual_lat_lng") return "manual_latlng";
  if (source === "map" || source === "map_select") return "map_click";
  if (source === "geocoded" || source === "address_search") return "manual_search";
  if (source === LOCAL_DEMO_LOCATION_SOURCE) return LOCAL_DEMO_LOCATION_SOURCE;
  if (source === "seed" || source === "demo") return "demo_seed";
  if (TRUSTED_LOCATION_SOURCES.has(source) || DEMO_LOCATION_SOURCES.has(source)) return source === "seed" ? "demo_seed" : source;
  if (value !== undefined && value !== null && source) return "unknown";
  if (isDemo) return "demo_seed";
  return hasPoint ? "manual_latlng" : "unknown";
}

function hasDispatchableLocation(incident) {
  const point = strictPoint(incident);
  if (!point || incident.locationStatus !== "Verified") return false;
  const source = normalizeLocationSource(incident.locationSource, { hasPoint: true, isDemo: incident.isDemo || incident.sourceType === "command_center_demo" });
  if (TRUSTED_LOCATION_SOURCES.has(source)) return true;
  return DEMO_LOCATION_SOURCES.has(source) && (incident.isDemo === true || incident.sourceType === "command_center_demo" || process.env.NODE_ENV === "test");
}

function dispatchLocationError(incident) {
  if (!strictPoint(incident)) return "Incident location missing";
  if (incident.locationStatus !== "Verified") return "Confirm incident location before dispatch";
  if (!hasDispatchableLocation(incident)) return "Confirm incident location with GPS, search, map click, or manual coordinates before dispatch";
  return null;
}

function normalizedLocationStatus(value, hasPoint) {
  if (!hasPoint) return "Needs Confirmation";
  return ["Verified", "Approximate", "Needs Confirmation"].includes(value) ? value : "Approximate";
}

function hasExplicitTrustedLocationSource(record) {
  if (record?.locationSource === undefined || record.locationSource === null || record.locationSource === "") return false;
  const source = normalizeLocationSource(record.locationSource, {
    hasPoint: Boolean(strictPoint(record)),
    isDemo: record?.isDemo === true || record?.sourceType === "command_center_demo"
  });
  return TRUSTED_LOCATION_SOURCES.has(source) || DEMO_LOCATION_SOURCES.has(source);
}

function localPointForKnownZone(record) {
  const text = legacyLocationText(record).toLowerCase();
  if (/gate\s*a|sector\s*7|main\s*entry/.test(text)) return ZONE_COORDINATES["Gate A"];
  if (/red\s*zone|camera\s*c-?19/.test(text)) return ZONE_COORDINATES["Red Zone"];
  if (/food\s*court/.test(text)) return ZONE_COORDINATES["Food Court"];
  if (/medical\s*camp|first\s*aid/.test(text)) return ZONE_COORDINATES["Medical Camp"];
  if (/exit\s*corridor/.test(text)) return ZONE_COORDINATES["Exit Corridor"];
  if (/transit\s*hub/.test(text)) return ZONE_COORDINATES["Transit Hub"];
  if (/parking/.test(text)) return ZONE_COORDINATES["Parking"];
  if (/mobile\s*source|live\s*vision/.test(text)) return ZONE_COORDINATES["Mobile Source"];
  if (/evidence\s*review|upload\s*video/.test(text)) return ZONE_COORDINATES["Evidence Review"];
  if (/central\s*sector|zone-1/.test(text)) return DEFAULT_OPERATIONAL_CENTER;
  const zone = String(record?.zone || "").trim();
  if (!zone || normalizedIncidentValue(zone) === "all zones") return null;
  return ZONE_COORDINATES[zone] || null;
}

function clearUnconfirmedLegacyLocation(record) {
  record.lat = null;
  record.lng = null;
  record.locationSource = "unknown";
  record.locationStatus = "Needs Confirmation";
  if (!String(record.address || "").trim() || record.address === "All Zones" || hasLegacyDelhiText(record)) {
    record.address = "Location not confirmed";
  }
}

function isRealRegistryRecord(record = {}) {
  const hasRegistryIdentity = Boolean(
    record.unitCode
    || record.unitId
    || record.unitType
    || record.stationId
    || record.stationName
  );
  if (!hasRegistryIdentity) return false;
  const source = normalizeUnitSource(record.source || record.locationSource || "", { isDemo: record.isDemo === true });
  return !record.isDemo && ["admin_registry", "live_gps"].includes(source);
}

function isLegacyDelhiOperationalRecord(record = {}) {
  if (isRealRegistryRecord(record)) return false;
  if (!isLegacyDelhiPoint(record) && !hasLegacyDelhiText(record)) return false;
  const isDemoOrSeed = record.isDemo === true || record.source === "demo_seed" || record.sourceType === "command_center_demo";
  if (isDemoOrSeed) return true;
  if (!isDemoMode()) return false;
  return !hasExplicitTrustedLocationSource(record);
}

function legacyRepairActions(db) {
  if (!Object.prototype.hasOwnProperty.call(db, "__legacyRepairActions")) {
    Object.defineProperty(db, "__legacyRepairActions", {
      value: [],
      enumerable: false,
      configurable: true
    });
  }
  return db.__legacyRepairActions;
}

function recordLegacyRepair(db, action, recordId) {
  legacyRepairActions(db).push({ action, recordId });
}

function scrubLegacyDelhiRepairText(record = {}) {
  for (const field of ["locationWarning", "details", "message"]) {
    if (typeof record[field] === "string") {
      record[field] = record[field].replace(/Legacy Delhi fallback/g, "Legacy fallback");
    }
  }
  return record;
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
    actorRole: actor?.role || (actor ? "System" : "System"),
    action,
    incidentId,
    details,
    timestamp
  };
  db.auditLogs.unshift(log);
  return log;
}

function addLegacyRepairAudit(db, action, incidentId = null, details = "") {
  const exists = (db.auditLogs || []).some((log) =>
    log.action === action
    && (log.incidentId || null) === (incidentId || null)
    && String(log.details || "") === String(details || "")
  );
  if (exists) return null;
  const audit = addAuditLog(db, action, { name: "RakshakAI System", id: null, role: "System" }, incidentId, details);
  recordLegacyRepair(db, action, incidentId || details);
  return audit;
}

function clearDispatchRouteFields(record) {
  record.assignedUnitId = null;
  record.recommendedUnitId = null;
  record.assignedUnit = null;
  record.recommendedUnit = null;
  record.distanceKm = null;
  record.etaMinutes = null;
  record.routeLabel = null;
  record.routeProvider = null;
  record.routeApproximate = false;
  record.routeCalculatedAt = null;
  record.routeSelectionReason = null;
}

function applyLegacyIncidentRepair(db, incident) {
  if (!isLegacyDelhiOperationalRecord(incident)) return null;
  const originalAssignedUnitId = incident.assignedUnitId || null;
  const originalRecommendedUnitId = incident.recommendedUnitId || null;
  const localPoint = localPointForKnownZone(incident);
  const hadDispatchState = Boolean(originalAssignedUnitId || originalRecommendedUnitId || incident.distanceKm || incident.etaMinutes);

  if (localPoint) {
    incident.lat = localPoint.lat;
    incident.lng = localPoint.lng;
    incident.latitude = localPoint.lat;
    incident.longitude = localPoint.lng;
    incident.isDemo = true;
    incident.source = "demo_seed";
    if (!["citizen_report", "phone_camera"].includes(String(incident.sourceType || ""))) {
      incident.sourceType = "command_center_demo";
    }
    incident.locationSource = LOCAL_DEMO_LOCATION_SOURCE;
    incident.locationStatus = "Verified";
    incident.locationConfirmed = true;
    incident.locationWarning = "Legacy fallback normalized to local demo coordinates";
    if (["Assigned", "En Route", "On Scene"].includes(canonicalIncidentStatus(incident.status)) || hadDispatchState) {
      incident.status = "Verified";
      clearDispatchRouteFields(incident);
    }
    addLegacyRepairAudit(db, "legacy_location_normalized", incident.id, `${incident.id}: ${incident.zone || incident.address || "local demo coordinate"}`);
    return {
      normalized: true,
      releaseIncidentId: incident.id,
      releasedUnitIds: [originalAssignedUnitId, originalRecommendedUnitId].filter(Boolean)
    };
  }

  clearUnconfirmedLegacyLocation(incident);
  incident.locationConfirmed = false;
  incident.dispatchable = false;
  incident.locationWarning = LEGACY_LOCATION_WARNING;
  if (["Verified", "Assigned", "En Route", "On Scene"].includes(canonicalIncidentStatus(incident.status)) || hadDispatchState) {
    incident.status = "Verification Required";
  }
  clearDispatchRouteFields(incident);
  addLegacyRepairAudit(db, "legacy_location_unconfirmed", incident.id, `${incident.id}: ${LEGACY_LOCATION_WARNING}`);
  return {
    normalized: false,
    releaseIncidentId: incident.id,
    releasedUnitIds: [originalAssignedUnitId, originalRecommendedUnitId].filter(Boolean)
  };
}

function applyLegacyAlertRepair(db, alert) {
  if (!isLegacyDelhiOperationalRecord(alert)) return null;
  const localPoint = localPointForKnownZone(alert);
  if (localPoint) {
    alert.lat = localPoint.lat;
    alert.lng = localPoint.lng;
    alert.latitude = localPoint.lat;
    alert.longitude = localPoint.lng;
    alert.isDemo = true;
    alert.source = "demo_seed";
    alert.sourceType = "command_center_demo";
    alert.locationSource = LOCAL_DEMO_LOCATION_SOURCE;
    alert.locationStatus = "Verified";
    alert.locationWarning = "Legacy fallback normalized to local demo coordinates";
    alert.verificationStatus = alert.verificationStatus || "pending_review";
    alert.reviewStatus = alert.reviewStatus || "pending_review";
  } else {
    clearUnconfirmedLegacyLocation(alert);
    alert.locationWarning = LEGACY_LOCATION_WARNING;
    alert.verificationStatus = "location_needs_confirmation";
    alert.reviewStatus = "location_needs_confirmation";
  }
  alert.actionable = false;
  alert.operationalAlert = false;
  addLegacyRepairAudit(db, localPoint ? "legacy_location_normalized" : "legacy_location_unconfirmed", alert.incidentId || null, `${alert.id}: ${alert.locationWarning}`);
  return { normalized: Boolean(localPoint) };
}

function releaseUnitsForLegacyIncidents(db, releasedIncidentIds, releasedUnitIds = new Set()) {
  if (!releasedIncidentIds.size && !releasedUnitIds.size) return;
  db.responseUnits.forEach((unit) => {
    const linkedIncidentId = unit.assignedIncidentId || unit.currentIncidentId;
    const unitId = unit.id || unit.unitId || unit.unitCode;
    if (!releasedIncidentIds.has(linkedIncidentId) && !releasedUnitIds.has(unitId)) return;
    const releasedFrom = linkedIncidentId || "legacy Delhi incident";
    unit.status = "available";
    unit.assignedIncidentId = null;
    unit.currentIncidentId = null;
    unit.lastUpdated = now();
    addLegacyRepairAudit(db, "unit_released_legacy_location", null, `${unit.unitCode || unit.id}: ${releasedFrom}`);
  });
}

const ALERT_SOURCE_LABELS = {
  demo_seed: "DEMO SEED",
  citizen_report: "REAL CITIZEN REPORT",
  ai_observation: "AI OBSERVATION",
  browser_camera: "BROWSER CAMERA",
  cctv_scan: "CCTV",
  video_upload: "VIDEO",
  manual_alert: "MANUAL ALERT",
  system: "SYSTEM"
};

function normalizeAlertSource(alert) {
  const source = normalizedIncidentValue(alert.source).replace(/\s+/g, "_");
  if (Object.prototype.hasOwnProperty.call(ALERT_SOURCE_LABELS, source)) return source;
  const sourceType = normalizedIncidentValue(alert.sourceType).replace(/\s+/g, "_");
  const threatType = normalizedIncidentValue(alert.threatType || alert.type).replace(/\s+/g, "_");
  if (sourceType === "command_center_demo" || sourceType.includes("demo")) return "demo_seed";
  if (sourceType.includes("citizen") || sourceType.includes("report")) return "citizen_report";
  if (sourceType.includes("video")) return "video_upload";
  if (sourceType.includes("browser") || sourceType.includes("live_camera") || sourceType.includes("phone_camera")) return "browser_camera";
  if (sourceType.includes("cctv") || sourceType.includes("camera")) return "cctv_scan";
  if (sourceType.includes("ai") || sourceType.includes("scan") || threatType.includes("detected") || threatType.includes("possible_match")) return "ai_observation";
  if (sourceType === "manual" || threatType === "manual_alert") return "manual_alert";
  if (sourceType === "system") return "system";
  return "system";
}

function normalizeAcknowledgements(alert) {
  const existing = Array.isArray(alert.acknowledgedBy)
    ? alert.acknowledgedBy
    : alert.acknowledgedBy
      ? [alert.acknowledgedBy]
      : [];
  return existing
    .filter(Boolean)
    .map((item) => ({
      userId: item.userId || item.id || null,
      name: item.name || item.actorName || "Unknown",
      role: item.role || "Unknown",
      acknowledgedAt: item.acknowledgedAt || alert.acknowledgedAt || null
    }));
}

function normalizeAlertMetadata(alert) {
  const source = normalizeAlertSource(alert);
  const acknowledgedBy = normalizeAcknowledgements(alert);
  const createdAt = alert.createdAt || alert.timestamp || now();
  const location = strictPoint(alert);
  const isDemo = alert.isDemo === true || source === "demo_seed";
  const verificationStatus = alert.verificationStatus
    || alert.reviewStatus
    || (normalizedIncidentValue(alert.status) === "pending review" ? "pending_review" : "unreviewed");
  return {
    ...alert,
    source,
    sourceLabel: ALERT_SOURCE_LABELS[source],
    isDemo,
    actionable: alert.actionable !== undefined ? Boolean(alert.actionable) : !isDemo && alert.operationalAlert !== false,
    createdBy: alert.createdBy || (source === "manual_alert" ? alert.createdByUserId : null) || "system",
    createdByRole: alert.createdByRole || (source === "manual_alert" ? alert.createdByRoleName : null) || "System",
    linkedReportId: alert.linkedReportId || alert.reportId || (source === "citizen_report" ? alert.sourceRecordId || null : null),
    linkedIncidentId: alert.linkedIncidentId || alert.incidentId || null,
    locationSource: normalizeLocationSource(alert.locationSource, { hasPoint: Boolean(location), isDemo }),
    verificationStatus,
    acknowledgedBy,
    acknowledged: Boolean(alert.acknowledged || acknowledgedBy.length),
    createdAt,
    lastDetectedAt: alert.lastDetectedAt || alert.timestamp || createdAt
  };
}

function alertForResponse(db, alert) {
  const normalized = normalizeAlertMetadata(alert);
  const linkedIncident = normalized.linkedIncidentId
    ? db.incidents.find((incident) => incident.id === normalized.linkedIncidentId)
    : null;
  const linkedReport = normalized.linkedReportId
    ? db.reports.find((report) => report.id === normalized.linkedReportId)
    : null;
  return {
    ...normalized,
    linkedIncident: linkedIncident ? { id: linkedIncident.id, title: linkedIncident.title, status: linkedIncident.status } : null,
    linkedReport: linkedReport ? { id: linkedReport.id, type: linkedReport.reportType, status: linkedReport.status } : null
  };
}

function ensureProductShape(db) {
  db.cameraSources = Array.isArray(db.cameraSources) ? db.cameraSources : [];
  db.detections = Array.isArray(db.detections) ? db.detections : [];
  db.videoEvidence = Array.isArray(db.videoEvidence) ? db.videoEvidence : [];
  db.dispatchEvents = Array.isArray(db.dispatchEvents) ? db.dispatchEvents : [];
  const stationDefaults = defaultPoliceStations();
  const stationById = new Map(stationDefaults.map((station) => [station.id, normalizePoliceStationRecord(station)]));
  (Array.isArray(db.policeStations) ? db.policeStations : []).forEach((station) => {
    const normalized = normalizePoliceStationRecord(station);
    stationById.set(normalized.id, normalized);
  });
  db.policeStations = [...stationById.values()];
  db.responseUnits = Array.isArray(db.responseUnits) && db.responseUnits.length
    ? db.responseUnits
    : [
        { id: "unit_p04", unitCode: "P-01", name: "Patancheru Patrol 01", officerName: "Inspector Kavya Rao", vehicleType: "Patrol SUV", unitType: "police_patrol", status: "available", lat: LOCAL_DEMO_POINTS.patancheru.lat, lng: LOCAL_DEMO_POINTS.patancheru.lng, zone: "Industrial Area", beat: "Industrial Area", jurisdiction: "Patancheru", linkedStationId: "PS-PATANCHERU", stationName: "Patancheru Police Station", assignedIncidentId: null, source: "demo_seed", isDemo: true, operational: isDemoMode(), lastUpdated: now() },
        { id: "unit_p02", unitCode: "P-02", name: "BHEL Patrol 02", officerName: "Sub-Inspector Arjun Mehta", vehicleType: "Patrol Car", unitType: "police_patrol", status: "available", lat: LOCAL_DEMO_POINTS.bhel.lat, lng: LOCAL_DEMO_POINTS.bhel.lng, zone: "BHEL Township", beat: "BHEL Township", jurisdiction: "Ramachandrapuram", linkedStationId: "PS-BHEL-RCP", stationName: "BHEL / Ramachandrapuram Demo Station", assignedIncidentId: null, source: "demo_seed", isDemo: true, operational: isDemoMode(), lastUpdated: now() },
        { id: "unit_m02", unitCode: "M-02", name: "BHEL Medical Response 02", officerName: "Dr. Neha Iyer", vehicleType: "Ambulance", unitType: "medical", status: "available", lat: 17.5004, lng: 78.3798, zone: "Transit Hub", beat: "Transit Hub", jurisdiction: "Ramachandrapuram", linkedStationId: "PS-BHEL-RCP", stationName: "BHEL / Ramachandrapuram Demo Station", assignedIncidentId: null, source: "demo_seed", isDemo: true, operational: isDemoMode(), lastUpdated: now() }
      ];
  db.incidents = consolidateActiveAiIncidents(Array.isArray(db.incidents) ? db.incidents : []);
  db.alerts = consolidateActiveAiAlerts(Array.isArray(db.alerts) ? db.alerts : []);
  const sourceById = new Map(db.cameraSources.map((source) => [source.id, source]));
  (db.cameras || []).forEach((camera) => {
    if (!sourceById.has(camera.id)) {
      db.cameraSources.push({
        id: camera.id,
        cameraId: camera.cameraId || camera.id,
        type: "demo",
        sourceType: "demo_seed",
        name: camera.name,
        zone: camera.zone,
        status: camera.health === "offline" ? "offline" : "online",
        lat: pointFor(camera).lat,
        lng: pointFor(camera).lng,
        enabled: true,
        aiEnabled: false,
        isDemo: true,
        lastFrameStatus: "simulated demo frame",
        healthReason: "Simulated feed for product demonstration only"
      });
    }
  });
  if (!sourceById.has("phone_001")) {
    db.cameraSources.push({ id: "phone_001", type: "phone_camera", name: "Rakshak Live Vision", zone: "Mobile Source", status: "available", enabled: true });
  }
  if (!sourceById.has("upload_001")) {
    db.cameraSources.push({ id: "upload_001", type: "upload", name: "Upload Video Mode", zone: "Evidence Review", status: "ready", enabled: true });
  }
  db.responseUnits = db.responseUnits.map((unit) => normalizeResponseUnitRecord(applyStationFallback(migrateLegacyDemoUnit(unit), db.policeStations)));
  const legacyReleasedIncidentIds = new Set();
  const legacyReleasedUnitIds = new Set();
  db.incidents.forEach((incident) => {
    let point = strictPoint(incident);
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
    incident.status = canonicalIncidentStatus(incident.status);
    incident.assignedUnitId = incident.assignedUnitId || db.responseUnits.find((unit) => unit.unitCode === incident.assignedUnit)?.id || null;
    incident.recommendedUnitId = incident.recommendedUnitId || db.responseUnits.find((unit) => unit.unitCode === incident.recommendedUnit)?.id || null;
    const legacyRepair = applyLegacyIncidentRepair(db, incident);
    if (legacyRepair) {
      if (legacyRepair.releaseIncidentId) legacyReleasedIncidentIds.add(legacyRepair.releaseIncidentId);
      (legacyRepair.releasedUnitIds || []).forEach((unitId) => legacyReleasedUnitIds.add(unitId));
    }
    point = strictPoint(incident);
    incident.locationSource = normalizeLocationSource(incident.locationSource, {
      hasPoint: Boolean(point),
      isDemo: incident.isDemo === true || incident.sourceType === "command_center_demo"
    });
    incident.locationStatus = normalizedLocationStatus(incident.locationStatus, Boolean(point));
    incident.status = canonicalIncidentStatus(incident.status);
    incident.assignedUnitId = incident.assignedUnitId || db.responseUnits.find((unit) => unit.unitCode === incident.assignedUnit)?.id || null;
    incident.recommendedUnitId = incident.recommendedUnitId || db.responseUnits.find((unit) => unit.unitCode === incident.recommendedUnit)?.id || null;
    incident.etaMinutes = finiteNumberOrNull(incident.etaMinutes);
    incident.distanceKm = finiteNumberOrNull(incident.distanceKm);
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
    scrubLegacyDelhiRepairText(incident);
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
  releaseUnitsForLegacyIncidents(db, legacyReleasedIncidentIds, legacyReleasedUnitIds);
  db.responseUnits.forEach((unit) => {
    const assignedIncident = db.incidents.find((incident) => incident.assignedUnitId === unit.id && isActiveIncident(incident));
    if (assignedIncident) Object.assign(unit, { status: "busy", assignedIncidentId: assignedIncident.id, currentIncidentId: assignedIncident.id });
    else if (["assigned", "busy"].includes(unit.status)) Object.assign(unit, { status: "available", assignedIncidentId: null, currentIncidentId: null });
  });
  db.alerts.forEach((alert) => {
    const hadExplicitLocationSource = alert.locationSource !== undefined && alert.locationSource !== null && alert.locationSource !== "";
    Object.assign(alert, normalizeAlertMetadata(alert));
    let point = strictPoint(alert);
    alert.incidentId = alert.incidentId || null;
    alert.title = alert.title || alert.message || String(alert.threatType || alert.type || "Alert").replace(/[_-]+/g, " ");
    alert.threatType = alert.threatType || alert.type || "alert";
    alert.sourceType = alert.sourceType || alert.source;
    alert.sourceName = alert.sourceName || alert.source || "Command Center";
    alert.lat = point?.lat ?? null;
    alert.lng = point?.lng ?? null;
    if (!hadExplicitLocationSource && isLegacyDelhiPoint(alert)) alert.locationSource = "unknown";
    const legacyRepair = applyLegacyAlertRepair(db, alert);
    if (!legacyRepair && alert.isDemo === true && isLegacyDelhiPoint(alert)) {
      const localPoint = pointFor({ zone: alert.zone || "All Zones" });
      alert.lat = localPoint.lat;
      alert.lng = localPoint.lng;
    }
    point = strictPoint(alert);
    alert.locationSource = normalizeLocationSource(alert.locationSource, { hasPoint: Boolean(point), isDemo: alert.isDemo === true });
    alert.confidence = Number(alert.confidence) || 0;
    alert.occurrenceCount = Math.max(1, Number(alert.occurrenceCount) || 1);
    const alertStatus = normalizedIncidentValue(alert.status);
    alert.status = ["pending review", "observation", "false alarm", "closed"].includes(alertStatus)
      ? alert.status
      : alert.acknowledged ? "Acknowledged" : "New";
    alert.createdAt = alert.createdAt || alert.timestamp || now();
    alert.lastDetectedAt = alert.lastDetectedAt || alert.timestamp || alert.createdAt;
    scrubLegacyDelhiRepairText(alert);
    delete alert.location;
    delete alert.timestamp;
    delete alert.assignedUnit;
    delete alert.type;
    delete alert.message;
    delete alert.sourceId;
  });
  db.cameraSources.forEach((source) => {
    const point = pointFor(source);
    source.lat = point.lat;
    source.lng = point.lng;
    const sourceText = legacyLocationText(source).toLowerCase();
    if (source.id === "phone_001" || /live\s*vision|phone\s*camera|browser\s*camera/.test(sourceText)) {
      source.type = "phone_camera";
      source.sourceType = "phone_camera";
      source.zone = source.zone || "Mobile Source";
      if (!["available", "online", "offline"].includes(String(source.status || "").toLowerCase())) source.status = "available";
    }
    if (source.id === "upload_001" || /upload\s*video|video\s*upload|evidence\s*review/.test(sourceText)) {
      source.type = "upload";
      source.sourceType = "upload";
      source.zone = source.zone || "Evidence Review";
      if (!["ready", "online", "offline"].includes(String(source.status || "").toLowerCase())) source.status = "ready";
    }
    if (["phone_camera", "upload"].includes(source.type) && isLegacyDelhiPoint(source)) {
      const localPoint = localPointForKnownZone(source);
      if (localPoint) {
        source.lat = localPoint.lat;
        source.lng = localPoint.lng;
        source.locationSource = LOCAL_DEMO_LOCATION_SOURCE;
        source.locationWarning = "Legacy fallback normalized to local source workflow coordinates";
      }
    }
    if (source.status === "demo") source.status = "online";
    const hasStreamConfig = cameraHasStreamConfig(source);
    source.isDemo = isDemoCameraSource(source) || (source.type === "cctv" && !hasStreamConfig && String(source.id || "").startsWith("cam_"));
    if (source.isDemo && isLegacyDelhiPoint(source)) {
      const localPoint = pointFor({ zone: source.zone || "All Zones" });
      source.lat = localPoint.lat;
      source.lng = localPoint.lng;
    }
    if (["phone_camera", "upload"].includes(source.type)) {
      source.sourceType = source.type;
      const allowedWorkflowStatuses = source.type === "upload" ? ["ready", "online", "offline"] : ["available", "online", "offline"];
      source.status = allowedWorkflowStatuses.includes(String(source.status || "").toLowerCase())
        ? String(source.status).toLowerCase()
        : source.type === "upload" ? "ready" : "available";
    } else {
      source.type = normalizeCameraSourceType(source.sourceType || source.type, { isDemo: source.isDemo, hasStreamConfig });
      source.sourceType = source.isDemo ? "demo_seed" : source.type;
      source.status = CAMERA_STATUSES.has(String(source.status || "").toLowerCase()) ? String(source.status).toLowerCase() : (source.isDemo ? "online" : "unknown");
    }
    source.aiEnabled = source.isDemo ? false : Boolean(source.aiEnabled);
    if (source.isDemo) {
      delete source.rtspUrl;
      delete source.streamUrl;
      delete source.username;
      delete source.password;
      delete source.token;
      source.lastFrameStatus = source.lastFrameStatus || "simulated demo frame";
      source.healthReason = source.healthReason || "Simulated feed for product demonstration only";
    }
    source.latestDetection = db.detections.find((item) => item.sourceId === source.id || item.sourceName === source.name) || source.latestDetection || null;
    source.incidentCount = db.incidents.filter((incident) => incident.sourceName === source.name || incident.sourceId === source.id).length;
    source.enabled = source.enabled !== false;
    scrubLegacyDelhiRepairText(source);
  });
  db.auditLogs.forEach(scrubLegacyDelhiRepairText);
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

async function userFromReqForSession(req) {
  const users = getDatabaseMode() === "json"
    ? readDb().users
    : await usersRepository.list({ users: seedDb().users });
  return userFromReq(req, { users });
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function policeUserForResponse(user) {
  if (!user || user.role !== "Police Officer") return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    badgeId: user.badgeId || "",
    unitId: user.unitId || "",
    station: user.station || "",
    beat: user.beat || "",
    jurisdiction: user.jurisdiction || "",
    status: user.status || "active",
    active: user.status !== "inactive",
    createdBy: user.createdBy || null,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null
  };
}

function policeUsersForResponse(db) {
  return db.users
    .filter((item) => item.role === "Police Officer")
    .map(policeUserForResponse)
    .filter(Boolean);
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

function rejectUnauthenticatedOrForbidden(res, user) {
  if (!user) return sendJson(res, 401, { error: "Authentication required" });
  return forbidden(res);
}

function authorizeRole(res, user, roles) {
  if (hasRole(user, roles)) return true;
  rejectUnauthenticatedOrForbidden(res, user);
  return false;
}

function reportStatusForCitizen(db, report) {
  const status = normalizedIncidentValue(report.status);
  const incident = report.incidentId
    ? db?.incidents?.find((item) => item.id === report.incidentId)
    : null;
  const incidentStatus = normalizedIncidentValue(incident?.status);
  if (["closed", "resolved", "found"].includes(status) || ["closed", "resolved"].includes(incidentStatus)) {
    return status === "closed" || incidentStatus === "closed" ? "Closed" : "Resolved";
  }
  if (["en route", "on scene"].includes(incidentStatus) || ["in_progress", "in progress"].includes(status)) return "In Progress";
  if (incidentStatus === "assigned" || status === "assigned") return "Assigned";
  if (status === "verified") return "Verified";
  if (["possible_match", "verification_required"].includes(status)) return "Verification pending";
  if (["under_review", "submitted_for_review"].includes(status)) return "Under review";
  if (["rejected", "false_alarm"].includes(status)) return "Rejected";
  return "Submitted";
}

function citizenReportForResponse(db, report) {
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
    status: reportStatusForCitizen(db, report),
    imageName: report.imageName || null,
    createdAt: report.createdAt
  };
}

function syncLinkedCitizenReportStatus(db, incident) {
  if (incident?.sourceType !== "citizen_report" || !incident.sourceRecordId) return null;
  const report = db.reports.find((item) => item.id === incident.sourceRecordId || item.incidentId === incident.id);
  if (!report) return null;
  const status = canonicalIncidentStatus(incident.status);
  if (status === "Assigned") report.status = "assigned";
  else if (["En Route", "On Scene"].includes(status)) report.status = "in_progress";
  else if (status === "Resolved") report.status = "resolved";
  else if (status === "Closed") report.status = "closed";
  else if (status === "Rejected / False Alarm") report.status = "false_alarm";
  report.updatedAt = incident.updatedAt || now();
  return report;
}

function envValue(key) {
  return String(process.env[key] || "").trim();
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

const REAL_CAMERA_SOURCE_TYPES = new Set(["rtsp", "hls", "onvif", "nvr", "dvr", "webcam"]);
const CAMERA_STATUSES = new Set(["online", "offline", "unknown"]);
const SECRET_CAMERA_FIELDS = new Set([
  "streamUrl",
  "rtspUrl",
  "hlsUrl",
  "onvifUrl",
  "username",
  "password",
  "token",
  "credentials",
  "apiKey",
  "secret"
]);

function normalizeCameraSourceType(value, { isDemo = false, hasStreamConfig = false } = {}) {
  if (isDemo) return "demo";
  const raw = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (raw === "demo" || raw === "demo_seed" || raw === "simulated") return "demo";
  if (raw === "cctv") return hasStreamConfig ? "rtsp" : "demo";
  if (REAL_CAMERA_SOURCE_TYPES.has(raw)) return raw;
  return hasStreamConfig ? "rtsp" : "unknown";
}

function cameraSourceTypeLabel(type) {
  const normalized = normalizeCameraSourceType(type);
  if (normalized === "demo") return "Demo";
  if (normalized === "unknown") return "Unknown";
  return normalized.toUpperCase();
}

function cameraHasStreamConfig(source) {
  return Boolean(String(source?.streamUrl || source?.rtspUrl || source?.hlsUrl || source?.onvifUrl || "").trim());
}

function isDemoCameraSource(source) {
  return source?.isDemo === true
    || source?.sourceType === "demo_seed"
    || normalizeCameraSourceType(source?.type) === "demo";
}

function sanitizeDetectionForCamera(detection) {
  if (!detection) return null;
  return {
    id: detection.id,
    sourceId: detection.sourceId,
    sourceName: detection.sourceName,
    timestamp: detection.timestamp,
    message: detection.message || "Possible detection",
    threatType: detection.threatType || "observation",
    alertClassification: detection.alertClassification || "observation",
    configured: Boolean(detection.configured)
  };
}

function configuredRtspCameras() {
  return parseEnvList("RTSP_CAMERA_URLS").map((streamUrl, index) => ({
    id: `rtsp_${index + 1}`,
    cameraId: `RTSP-${String(index + 1).padStart(2, "0")}`,
    name: `RTSP Camera ${index + 1}`,
    zone: "Configured Stream",
    location: "Configured Stream",
    type: "rtsp",
    sourceType: "rtsp",
    status: "unknown",
    streamUrl,
    enabled: true,
    aiEnabled: false,
    isDemo: false,
    externalConfig: true,
    healthReason: "Configured through RTSP_CAMERA_URLS. Stream proxy/transcoding is required before browser playback.",
    lastFrameStatus: "snapshot unavailable",
    streamProxyConfigured: false
  }));
}

function sourceStatusLabel(source) {
  if (source.status === "online") return "Online";
  if (source.status === "offline") return "Offline";
  if (source.status === "available") return "Available";
  if (source.status === "ready") return "Ready";
  if (source.status === "unknown") return "Unknown";
  return "Configured";
}

function cameraSourceForResponse(db, source) {
  if (["phone_camera", "upload"].includes(source.type)) {
    const detections = db.detections.filter((item) =>
      item.configured === true
      && (item.sourceId === source.id || item.sourceName === source.name)
    );
    const latestDetection = sanitizeDetectionForCamera(detections[0] || null);
    const relatedAlerts = db.alerts.filter((alert) =>
      alert.sourceId === source.id
      || alert.sourceName === source.name
      || String(alert.title || "").includes(source.name)
    );
    return {
      id: source.id,
      type: source.type,
      sourceType: source.type,
      name: source.name || "Unnamed source",
      location: source.location || source.zone || "Unassigned",
      zone: source.zone || source.location || "Unassigned",
      status: source.status || "ready",
      statusLabel: sourceStatusLabel(source),
      enabled: source.enabled !== false,
      latestDetection,
      latestAlertTime: relatedAlerts[0]?.lastDetectedAt || relatedAlerts[0]?.createdAt || null,
      incidentCount: db.incidents.filter((incident) => incident.sourceId === source.id || incident.sourceName === source.name).length
    };
  }
  const hasStreamConfig = cameraHasStreamConfig(source);
  const isDemo = isDemoCameraSource(source);
  const sourceType = isDemo ? "demo" : normalizeCameraSourceType(source.sourceType || source.type, { hasStreamConfig });
  const detections = db.detections.filter((item) =>
    item.configured === true
    && (item.sourceId === source.id || item.sourceName === source.name)
  );
  const latestDetection = sanitizeDetectionForCamera(detections[0] || null);
  const relatedAlerts = db.alerts.filter((alert) =>
    alert.sourceId === source.id
    || alert.sourceName === source.name
    || String(alert.title || "").includes(source.name)
  );
  const incidentCount = db.incidents.filter((incident) => incident.sourceId === source.id || incident.sourceName === source.name).length;
  return {
    id: source.id,
    cameraId: source.cameraId || source.id,
    type: sourceType,
    sourceType: isDemo ? "demo_seed" : sourceType,
    sourceTypeLabel: isDemo ? "Demo" : cameraSourceTypeLabel(sourceType),
    name: source.name || "Unnamed camera",
    location: source.location || source.zone || "Unassigned",
    zone: source.zone || source.location || "Unassigned",
    status: CAMERA_STATUSES.has(String(source.status || "").toLowerCase()) ? String(source.status).toLowerCase() : "unknown",
    statusLabel: sourceStatusLabel(source),
    enabled: source.enabled !== false,
    aiEnabled: Boolean(source.aiEnabled),
    isDemo,
    badge: isDemo ? "DEMO CAMERA / SIMULATED FEED" : "REAL CCTV",
    hasStreamConfig: !isDemo && hasStreamConfig,
    streamProxyConfigured: Boolean(source.streamProxyConfigured),
    streamProxyStatus: source.streamProxyConfigured ? "Stream proxy configured" : "Stream proxy not configured",
    lastCheckedAt: source.lastCheckedAt || source.lastTestedAt || source.lastSeenAt || null,
    lastFrameStatus: source.lastFrameStatus || source.lastSnapshotStatus || (isDemo ? "simulated demo frame" : "snapshot unavailable"),
    healthReason: source.healthReason || (isDemo ? "Simulated feed for demonstration only" : hasStreamConfig ? "Connection test pending" : "No backend stream configuration"),
    latestDetection,
    latestAlertTime: relatedAlerts[0]?.lastDetectedAt || relatedAlerts[0]?.createdAt || null,
    incidentCount,
    externalConfig: Boolean(source.externalConfig)
  };
}

function cameraSourcesForResponse(db) {
  const sources = [...db.cameraSources];
  configuredRtspCameras().forEach((camera) => sources.unshift(camera));
  return sources.map((source) => cameraSourceForResponse(db, source));
}

function camerasForResponse(db) {
  const sourcesById = new Map((db.cameraSources || []).map((source) => [source.id, source]));
  configuredRtspCameras().forEach((source) => sourcesById.set(source.id, source));
  const cameraById = new Map((db.cameras || []).map((camera) => [camera.id, camera]));
  return [...sourcesById.values()]
    .filter((source) => {
      const type = normalizeCameraSourceType(source.sourceType || source.type, { isDemo: isDemoCameraSource(source), hasStreamConfig: cameraHasStreamConfig(source) });
      return type === "demo" || REAL_CAMERA_SOURCE_TYPES.has(type);
    })
    .map((source) => {
      const demo = cameraById.get(source.id) || {};
      return {
        ...cameraSourceForResponse(db, source),
        health: source.status || demo.health || "unknown",
        aiStatus: isDemoCameraSource(source)
          ? (demo.aiStatus || "Demo AI sample")
          : "Possible detection only after authorized snapshot analysis",
        density: isDemoCameraSource(source) ? Number(demo.density) || 0 : null,
        scene: isDemoCameraSource(source) ? demo.scene : null
      };
    });
}

function safeCameraConfigBody(body, existing = {}) {
  const hasExistingSecret = cameraHasStreamConfig(existing);
  const requestedType = normalizeCameraSourceType(body.sourceType || body.type || existing.sourceType || existing.type, {
    hasStreamConfig: hasExistingSecret || Boolean(body.streamUrl || body.rtspUrl)
  });
  if (!REAL_CAMERA_SOURCE_TYPES.has(requestedType)) {
    throw Object.assign(new Error("Select a real camera source type: RTSP, HLS, ONVIF, NVR, DVR, or Webcam"), { status: 400 });
  }
  const name = String(body.name || existing.name || "").trim().slice(0, 120);
  if (!name) throw Object.assign(new Error("Camera name is required"), { status: 400 });
  const location = String(body.location || body.zone || existing.location || existing.zone || "").trim().slice(0, 180);
  const next = {
    ...existing,
    id: existing.id || uid("cam"),
    cameraId: String(body.cameraId || existing.cameraId || existing.id || "").trim().slice(0, 60) || undefined,
    type: requestedType,
    sourceType: requestedType,
    name,
    location: location || "Unassigned",
    zone: location || "Unassigned",
    status: CAMERA_STATUSES.has(String(body.status || "").toLowerCase()) ? String(body.status).toLowerCase() : (existing.status || "unknown"),
    aiEnabled: body.aiEnabled === undefined ? Boolean(existing.aiEnabled) : Boolean(body.aiEnabled),
    enabled: body.enabled === undefined ? existing.enabled !== false : Boolean(body.enabled),
    isDemo: false,
    lastFrameStatus: existing.lastFrameStatus || "snapshot unavailable",
    healthReason: existing.healthReason || "Connection test pending",
    updatedAt: now()
  };
  if (Object.prototype.hasOwnProperty.call(body, "streamUrl") || Object.prototype.hasOwnProperty.call(body, "rtspUrl")) {
    const streamUrl = String(body.streamUrl || body.rtspUrl || "").trim().slice(0, 500);
    if (streamUrl) next.streamUrl = streamUrl;
    else if (!existing.id) delete next.streamUrl;
    delete next.rtspUrl;
  }
  if (Object.prototype.hasOwnProperty.call(body, "username")) {
    const username = String(body.username || "").trim().slice(0, 180);
    if (username) next.username = username;
    else if (!existing.id) delete next.username;
  }
  if (Object.prototype.hasOwnProperty.call(body, "password")) {
    const password = String(body.password || "").slice(0, 300);
    if (password) next.password = password;
    else if (!existing.id) delete next.password;
  }
  next.hasCredentials = Boolean(next.username || next.password);
  if (!cameraHasStreamConfig(next)) {
    next.status = next.status === "online" ? "unknown" : next.status;
    next.healthReason = "No stream URL configured";
  }
  return next;
}

const MAX_VIDEO_EVIDENCE_BYTES = 1_100_000;
const MAX_VIDEO_DURATION_SECONDS = 10 * 60;
const VIDEO_EVIDENCE_MIME_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/mpeg"
]);
const EVIDENCE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function safeFileName(value) {
  return String(value || "evidence-video")
    .replace(/[^\w.\- ()]+/g, "_")
    .trim()
    .slice(0, 140) || "evidence-video";
}

function parseEvidenceDataUrl(value, { allowImages = false } = {}) {
  const dataUrl = String(value || "").trim();
  const match = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const allowed = VIDEO_EVIDENCE_MIME_TYPES.has(mimeType) || (allowImages && EVIDENCE_IMAGE_MIME_TYPES.has(mimeType));
  if (!allowed) return null;
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!buffer.length) return null;
  return { dataUrl, mimeType, buffer };
}

function hashEvidence(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function evidenceLinkedReport(db, evidence) {
  return evidence.linkedReportId ? db.reports.find((report) => report.id === evidence.linkedReportId) || null : null;
}

function evidenceLinkedIncident(db, evidence) {
  return evidence.linkedIncidentId ? db.incidents.find((incident) => incident.id === evidence.linkedIncidentId) || null : null;
}

function canAccessVideoEvidence(db, user, evidence) {
  if (!user || !evidence) return false;
  if (hasRole(user, ["Police Officer", "Admin"])) return true;
  const report = evidenceLinkedReport(db, evidence);
  return user.role === "Citizen" && (evidence.uploadedBy === user.id || report?.createdBy === user.id);
}

function evidenceObservations(db, evidenceId) {
  return (db.alerts || [])
    .filter((alert) => alert.linkedEvidenceId === evidenceId || alert.evidenceId === evidenceId)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function videoObservationForResponse(db, alert) {
  const response = alertForResponse(db, alert);
  const detectionType = alert.detectionType || alert.threatType || alert.type || "video_observation";
  return {
    ...response,
    observationId: alert.id,
    linkedEvidenceId: alert.linkedEvidenceId || alert.evidenceId || null,
    linkedReportId: alert.linkedReportId || null,
    source: "video_upload",
    detectionType,
    detectionLabel: alert.detectionLabel || detectionType.replace(/_/g, " "),
    frameTimestamp: alert.frameTimestamp || null,
    frameTimestampSeconds: Number.isFinite(Number(alert.frameTimestampSeconds)) ? Number(alert.frameTimestampSeconds) : null,
    previewFrameUrl: alert.previewFrameUrl || null,
    possibleColor: alert.possibleColor || null,
    possiblePlateText: alert.possiblePlateText || null,
    plateDetected: Boolean(alert.plateDetected),
    plateConfidence: alert.plateConfidence === null || alert.plateConfidence === undefined || alert.plateConfidence === ""
      ? null
      : (Number.isFinite(Number(alert.plateConfidence)) ? Number(alert.plateConfidence) : null),
    vehicleType: alert.vehicleType || null,
    objectType: alert.objectType || null,
    possibleSize: alert.possibleSize || null,
    activityType: alert.activityType || null,
    identityStatus: alert.identityStatus || "possible_detection_requires_human_verification",
    message: alert.message || "Possible detection - requires human verification",
    actionable: Boolean(alert.actionable),
    operationalAlert: false
  };
}

function videoEvidenceForResponse(db, evidence) {
  const observations = evidenceObservations(db, evidence.id);
  const linkedReport = evidenceLinkedReport(db, evidence);
  const linkedIncident = evidenceLinkedIncident(db, evidence);
  return {
    id: evidence.id,
    evidenceId: evidence.evidenceId || evidence.id,
    source: evidence.source || "video_upload",
    status: evidence.status || "uploaded",
    processingStatus: evidence.processingStatus || "ready_for_analysis",
    uploadedBy: evidence.uploadedBy,
    uploadedByName: evidence.uploadedByName || "Unknown",
    uploadedByRole: evidence.uploadedByRole || "Unknown",
    linkedReportId: evidence.linkedReportId || null,
    linkedIncidentId: evidence.linkedIncidentId || null,
    linkedReport: linkedReport ? { id: linkedReport.id, type: linkedReport.reportType, status: linkedReport.status, name: linkedReport.name } : null,
    linkedIncident: linkedIncident ? { id: linkedIncident.id, title: linkedIncident.title, status: linkedIncident.status } : null,
    uploadedAt: evidence.uploadedAt,
    fileName: evidence.fileName,
    fileSize: evidence.fileSize,
    mimeType: evidence.mimeType,
    durationSeconds: evidence.durationSeconds ?? null,
    checksum: evidence.checksum,
    isDemo: Boolean(evidence.isDemo),
    previewUrl: `/api/video-evidence/${evidence.id}/preview`,
    observationCount: observations.length,
    pendingObservationCount: observations.filter((alert) => ["pending_review", "human_verification_required"].includes(String(alert.reviewStatus || alert.verificationStatus || "").toLowerCase())).length,
    chainOfCustody: (evidence.chainOfCustody || []).map((item) => ({
      action: item.action,
      actorName: item.actorName,
      actorRole: item.actorRole,
      timestamp: item.timestamp,
      notes: item.notes || ""
    })),
    analysisSummary: evidence.analysisSummary || null
  };
}

function assertSafeEvidencePayload(payload) {
  const serialized = JSON.stringify(payload);
  for (const forbidden of ["fileData", "storagePath", "absolutePath", "C:\\\\", "/uploads/", "confirmed criminal", "confirmed crime", "confirmed missing person", "confirmed identity"]) {
    if (serialized.includes(forbidden)) throw new Error(`Unsafe evidence response includes ${forbidden}`);
  }
}

function recordEvidenceAudit(db, evidence, action, user, notes = "", timestamp = now()) {
  const custody = {
    action,
    actorId: user?.id || null,
    actorName: user?.name || "RakshakAI System",
    actorRole: user?.role || "System",
    timestamp,
    notes: String(notes || "").slice(0, 500)
  };
  evidence.chainOfCustody = [custody, ...(evidence.chainOfCustody || [])].slice(0, 50);
  return addAuditLog(db, action, user || "RakshakAI System", evidence.linkedIncidentId || null, `${evidence.id}${notes ? `: ${String(notes).slice(0, 180)}` : ""}`, timestamp);
}

function validateEvidenceLinks(db, body, user) {
  const linkedReportId = String(body.linkedReportId || body.reportId || "").trim() || null;
  const linkedIncidentId = String(body.linkedIncidentId || body.incidentId || "").trim() || null;
  const linkedReport = linkedReportId ? db.reports.find((report) => report.id === linkedReportId) : null;
  const linkedIncident = linkedIncidentId ? db.incidents.find((incident) => incident.id === linkedIncidentId) : null;
  if (linkedReportId && !linkedReport) throw Object.assign(new Error("Linked report not found"), { status: 404 });
  if (linkedIncidentId && !linkedIncident) throw Object.assign(new Error("Linked incident not found"), { status: 404 });
  if (user?.role === "Police Officer" && !linkedReport && !linkedIncident) {
    throw Object.assign(new Error("Police video uploads must be linked to a report or incident"), { status: 400 });
  }
  return { linkedReportId, linkedIncidentId, linkedReport, linkedIncident };
}

function createVideoEvidenceRecord(db, body, user, { source = "video_upload", linkedReport = null, linkedIncident = null, allowImages = false } = {}) {
  const parsed = parseEvidenceDataUrl(body.videoData || body.fileData || body.dataUrl || body.evidence || body.image, { allowImages });
  if (!parsed) throw Object.assign(new Error(allowImages ? "Upload a supported image or video evidence file" : "Upload a supported video evidence file"), { status: 400 });
  if (parsed.buffer.length > MAX_VIDEO_EVIDENCE_BYTES) {
    throw Object.assign(new Error("Video evidence file is too large for this local evidence workflow"), { status: 413 });
  }
  const duration = Number(body.durationSeconds);
  if (Number.isFinite(duration) && duration > MAX_VIDEO_DURATION_SECONDS) {
    throw Object.assign(new Error("Video duration exceeds the allowed evidence review limit"), { status: 400 });
  }
  const timestamp = now();
  const evidence = {
    id: uid("evd"),
    evidenceId: null,
    source,
    status: "uploaded",
    processingStatus: "ready_for_analysis",
    uploadedBy: user.id,
    uploadedByName: user.name,
    uploadedByRole: user.role,
    linkedReportId: linkedReport?.id || null,
    linkedIncidentId: linkedIncident?.id || null,
    uploadedAt: timestamp,
    fileName: safeFileName(body.fileName || body.name),
    fileSize: Number(body.fileSize) > 0 ? Math.min(Number(body.fileSize), parsed.buffer.length) : parsed.buffer.length,
    mimeType: parsed.mimeType,
    durationSeconds: Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : null,
    checksum: hashEvidence(parsed.buffer),
    fileData: parsed.dataUrl,
    sourceLabel: source === "citizen_evidence" ? "Citizen Evidence" : "Video Evidence Upload",
    isDemo: Boolean(body.isDemo),
    notes: String(body.notes || "").slice(0, 500),
    chainOfCustody: []
  };
  evidence.evidenceId = evidence.id;
  recordEvidenceAudit(db, evidence, "evidence_uploaded", user, evidence.notes, timestamp);
  return evidence;
}

function textPossibleColor(...values) {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  for (const color of ["black", "white", "blue", "red", "green", "yellow", "silver", "grey", "gray", "brown"]) {
    if (text.includes(color)) return color === "grey" ? "gray" : color;
  }
  return null;
}

function textObjectType(...values) {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  if (text.includes("backpack")) return "backpack";
  if (text.includes("bag")) return "bag";
  if (text.includes("phone")) return "phone";
  if (text.includes("wallet")) return "wallet";
  if (text.includes("vehicle") || text.includes("car") || text.includes("bike")) return "vehicle";
  return "reported object";
}

function videoObservationSpecsForEvidence(db, evidence) {
  const duration = Number(evidence.durationSeconds);
  const frameLimit = Number.isFinite(duration) && duration > 0 ? Math.min(duration, 30) : 12;
  const frameAt = (seconds) => Math.max(0, Math.min(frameLimit, seconds));
  const linkedReport = evidenceLinkedReport(db, evidence);
  const specs = [
    {
      detectionType: "person_detected",
      detectionLabel: "Person",
      confidence: 0.72,
      frameTimestamp: frameAt(0),
      message: "Possible person detected in uploaded video - requires human verification."
    },
    {
      detectionType: "face_detected",
      detectionLabel: "Face",
      confidence: 0.58,
      frameTimestamp: frameAt(2),
      message: "Possible face detected - identity is not confirmed and requires authorized human verification."
    },
    {
      detectionType: "vehicle_detected",
      detectionLabel: "Vehicle",
      confidence: 0.67,
      frameTimestamp: frameAt(5),
      vehicleType: "possible vehicle",
      possibleColor: "dark",
      plateDetected: true,
      possiblePlateText: "possible plate region",
      plateConfidence: 0.38,
      message: "Possible vehicle detected. Color and plate text are unverified and require human review."
    },
    {
      detectionType: "object_detected",
      detectionLabel: "Object",
      confidence: 0.63,
      frameTimestamp: frameAt(8),
      objectType: "bag/package",
      possibleSize: "medium",
      message: "Possible object detected in uploaded video - requires human verification."
    },
    {
      detectionType: "suspicious_activity",
      detectionLabel: "Crowd or activity pattern",
      confidence: 0.55,
      frameTimestamp: frameAt(10),
      activityType: "crowd_activity_review",
      message: "Possible crowd or activity pattern detected - requires human review before action."
    }
  ];

  if (String(linkedReport?.reportType || linkedReport?.category || "").toLowerCase().includes("missing_object")) {
    specs.push({
      detectionType: "missing_object_possible_match",
      detectionLabel: "Possible missing object match",
      confidence: 0.49,
      frameTimestamp: frameAt(6),
      objectType: textObjectType(linkedReport?.name, linkedReport?.description),
      possibleColor: textPossibleColor(linkedReport?.name, linkedReport?.description),
      message: "Possible missing object match - requires human verification."
    });
  }

  return specs;
}

function createVideoObservation(db, evidence, user, {
  detectionType = "person_detected",
  detectionLabel = "",
  confidence = 0.72,
  frameTimestamp = 0,
  message = "",
  previewFrameUrl = null,
  possibleColor = null,
  possiblePlateText = null,
  plateDetected = false,
  plateConfidence = null,
  vehicleType = null,
  objectType = null,
  possibleSize = null,
  activityType = null,
  identityStatus = "possible_detection_requires_human_verification"
} = {}) {
  const createdAt = now();
  const normalizedConfidence = Math.max(0, Math.min(0.99, Number(confidence) || 0));
  const frameSeconds = Math.max(0, Math.round(Number(frameTimestamp) || 0));
  const label = String(detectionLabel || detectionType.replace(/_/g, " ")).replace(/\s+/g, " ").trim();
  const normalizedPlateConfidence = plateConfidence === null || plateConfidence === undefined || plateConfidence === ""
    ? null
    : Number(plateConfidence);
  const detection = {
    label,
    detectionType,
    confidence: normalizedConfidence,
    source: "video_upload",
    frameTimestamp: frameSeconds
  };
  for (const [key, value] of Object.entries({ possibleColor, possiblePlateText, vehicleType, objectType, possibleSize, activityType })) {
    if (value) detection[key] = value;
  }
  if (plateDetected) detection.plateDetected = true;
  if (Number.isFinite(normalizedPlateConfidence)) detection.plateConfidence = normalizedPlateConfidence;
  const alert = {
    id: uid("obs"),
    observationId: null,
    incidentId: null,
    linkedIncidentId: null,
    linkedEvidenceId: evidence.id,
    evidenceId: evidence.id,
    linkedReportId: evidence.linkedReportId || null,
    title: `Possible ${label} in uploaded video`,
    message: message || `Possible ${label.toLowerCase()} in uploaded video - requires human verification.`,
    type: detectionType,
    threatType: detectionType,
    detectionType,
    detectionLabel: label,
    severity: "low",
    zone: evidenceLinkedIncident(db, evidence)?.zone || evidenceLinkedReport(db, evidence)?.lastSeenLocation || "Evidence Review",
    sourceId: evidence.id,
    source: "video_upload",
    sourceType: "uploaded_video",
    sourceName: evidence.fileName,
    confidence: normalizedConfidence,
    maxConfidence: normalizedConfidence,
    frameTimestamp: `${frameSeconds}s`,
    frameTimestampSeconds: frameSeconds,
    previewFrameUrl,
    possibleColor,
    possiblePlateText,
    plateDetected: Boolean(plateDetected),
    plateConfidence: Number.isFinite(normalizedPlateConfidence) ? normalizedPlateConfidence : null,
    vehicleType,
    objectType,
    possibleSize,
    activityType,
    identityStatus,
    detections: [detection],
    alertClassification: "observation",
    actionable: false,
    operationalAlert: false,
    status: "Pending Review",
    reviewStatus: "pending_review",
    verificationStatus: "human_verification_required",
    acknowledged: false,
    createdBy: "system",
    createdByRole: "System/AI",
    createdAt,
    lastDetectedAt: createdAt,
    isDemo: false
  };
  alert.observationId = alert.id;
  db.alerts.unshift(alert);
  db.detections = [{
    id: uid("det"),
    sourceId: evidence.id,
    sourceType: "uploaded_video",
    sourceName: evidence.fileName,
    timestamp: createdAt,
    configured: true,
    threatDetected: false,
    threatType: detectionType,
    detectionType,
    detectionLabel: label,
    confidence: normalizedConfidence,
    frameTimestamp: frameSeconds,
    possibleColor,
    possiblePlateText,
    vehicleType,
    objectType,
    actionable: false,
    alertClassification: "observation",
    message: alert.message,
    linkedEvidenceId: evidence.id
  }, ...(db.detections || [])].slice(0, 100);
  return alert;
}

function integrationStatus() {
  const rtsp = configuredRtspCameras();
  const aiServiceUrl = envValue("AI_SERVICE_URL");
  const databaseMode = getDatabaseMode();
  const firebaseKey = envValue("FIREBASE_SERVER_KEY") || envValue("FIREBASE_SERVICE_ACCOUNT");
  const jwtSecret = envValue("JWT_SECRET") || envValue("SESSION_SECRET");
  let routingConfig = null;
  let routingError = null;
  try {
    routingConfig = resolveOsrmBaseUrl();
  } catch (error) {
    routingError = error.message;
  }
  const checkedAt = now();
  return [
    {
      id: "rtsp",
      name: "Real CCTV RTSP Streams",
      configured: rtsp.length > 0,
      status: rtsp.length > 0 ? "ready" : "setup_required",
      detail: rtsp.length ? `${rtsp.length} stream(s) configured` : "Connect real camera streams for production monitoring.",
      requiredKey: rtsp.length ? null : "RTSP_CAMERA_URLS",
      checkedAt
    },
    {
      id: "ai",
      name: "AI Detection Service",
      configured: Boolean(aiServiceUrl),
      status: aiServiceUrl ? "ready" : "setup_required",
      detail: aiServiceUrl ? (envValue("AI_SERVICE_API_KEY") ? "AI service URL and API key configured." : "AI service URL set; API key authentication is optional but recommended.") : "Enable real detection by configuring the AI service endpoint.",
      requiredKey: aiServiceUrl ? (envValue("AI_SERVICE_API_KEY") ? null : "AI_SERVICE_API_KEY") : "AI_SERVICE_URL",
      healthUrl: aiServiceUrl ? `${aiServiceUrl.replace(/\/+$/, "")}/health` : "http://localhost:8000/health",
      checkedAt
    },
    {
      id: "database",
      name: "PostgreSQL Database",
      configured: databaseMode === "postgres",
      status: databaseMode === "postgres" ? "ready" : "setup_required",
      detail: databaseMode === "postgres"
        ? "Connected through DATABASE_URL."
        : "Local db.json fallback is active. Use PostgreSQL for production persistence.",
      requiredKey: databaseMode === "postgres" ? null : "DATABASE_URL",
      checkedAt
    },
    {
      id: "firebase",
      name: "Firebase Push Notifications",
      configured: Boolean(firebaseKey),
      status: firebaseKey ? "ready" : "setup_required",
      detail: firebaseKey ? "Firebase credentials configured." : "Configure Firebase credentials to send push notifications.",
      requiredKey: firebaseKey ? null : "FIREBASE_SERVER_KEY or FIREBASE_SERVICE_ACCOUNT",
      checkedAt
    },
    {
      id: "routing",
      name: "Map/Route Service",
      configured: Boolean(routingConfig?.baseUrl),
      status: routingConfig?.baseUrl ? "ready" : "setup_required",
      detail: routingConfig?.baseUrl
        ? `Route assignment uses ${routingConfig.provider} OSRM.`
        : `Route assignment will use approximate fallback. ${routingError || "Configure OSRM_BASE_URL."}`,
      requiredKey: routingConfig?.baseUrl ? null : "OSRM_BASE_URL",
      healthUrl: routingConfig?.baseUrl || "http://osrm:5000",
      checkedAt
    }
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

function fallbackRoute(fromLat, fromLng, toLat, toLng, warning = routeUnavailableWarning()) {
  const distanceKm = Math.hypot((toLat - fromLat) * 111, (toLng - fromLng) * 100);
  const durationSeconds = approximateRouteDurationSeconds(Math.round(distanceKm * 1000));
  const route = {
    id: "approximate",
    label: "Approximate fallback route",
    routeType: "approximate_fallback",
    provider: "local-fallback",
    approximate: true,
    isApproximate: true,
    degraded: true,
    warning,
    message: "Approximate fallback route",
    distanceMeters: Math.round(distanceKm * 1000),
    distanceKm: Number(distanceKm.toFixed(2)),
    durationSeconds,
    durationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
    coordinates: [
      [fromLng, fromLat],
      [toLng, toLat]
    ],
    geometry: [
      [fromLat, fromLng],
      [toLat, toLng]
    ],
    steps: ["Approximate fallback route. Confirm road access before dispatch."],
    calculatedAt: now()
  };
  return {
    ...route,
    routeLabel: route.label,
    routeOptions: [route],
    alternateRoutes: [],
    alternativesSupported: false,
    alternativeMessage: "Alternative routes unavailable because the routing service is degraded."
  };
}

function approximateRouteDurationSeconds(distanceMeters) {
  const meters = Math.max(0, Number(distanceMeters) || 0);
  return Math.max(60, Math.round(meters / 8));
}

function routeSteps(route) {
  return (route.legs || [])
    .flatMap((leg) => leg.steps || [])
    .map((step) => {
      const name = step.name ? ` on ${step.name}` : "";
      return `${step.maneuver?.type || "Continue"}${name}`;
    })
    .filter(Boolean)
    .slice(0, 8);
}

function routeOptionFromOsrm(route, index, shortestIndex) {
  const coordinates = route.geometry.coordinates;
  const label = index === 0
    ? "Fastest route"
    : index === shortestIndex
      ? "Shortest route"
      : "Backup route";
  const durationSeconds = Math.round(route.duration);
  const distanceMeters = Math.round(route.distance);
  return {
    id: `route_${index + 1}`,
    label,
    routeType: "osrm",
    provider: "osrm",
    approximate: false,
    isApproximate: false,
    distanceMeters,
    distanceKm: Number((distanceMeters / 1000).toFixed(2)),
    durationSeconds,
    durationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
    coordinates,
    geometry: coordinates.map(([lng, lat]) => [lat, lng]),
    steps: routeSteps(route).length ? routeSteps(route) : ["Follow route", "Arrive at destination"],
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
  try {
    const routingConfig = resolveOsrmBaseUrl();
    const pathUrl = `${routingConfig.baseUrl.replace(/\/$/, "")}/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson&steps=true&alternatives=true`;
    const data = await callJson(pathUrl, {}, routeTimeoutMs());
    const validRoutes = (data.routes || []).filter((route) => {
      if (!Number.isFinite(Number(route.distance)) || Number(route.distance) <= 0) return false;
      if (!Number.isFinite(Number(route.duration)) || Number(route.duration) <= 0) return false;
      if (!Array.isArray(route.geometry?.coordinates) || route.geometry.coordinates.length < 2) return false;
      const endpoint = route.geometry.coordinates.at(-1);
      const endpointPoint = strictPoint({ lat: endpoint?.[1], lng: endpoint?.[0] });
      return endpointPoint && Math.hypot((endpointPoint.lat - destination.lat) * 111, (endpointPoint.lng - destination.lng) * 100) <= 0.5;
    });
    if (!validRoutes.length) throw new Error("No valid route found");
    const shortestIndex = validRoutes.reduce((best, route, index, routes) => Number(route.distance) < Number(routes[best].distance) ? index : best, 0);
    const routeOptions = validRoutes
      .map((route, index) => routeOptionFromOsrm(route, index, shortestIndex))
      .sort((a, b) => a.durationSeconds - b.durationSeconds || a.distanceMeters - b.distanceMeters)
      .slice(0, 3)
      .map((route, index, routes) => ({
        ...route,
        label: index === 0 ? "Fastest route" : route.distanceMeters === Math.min(...routes.map((item) => item.distanceMeters)) ? "Shortest route" : "Backup route"
      }));
    const primary = routeOptions[0];
    return {
      ...primary,
      routeLabel: primary.label,
      routeOptions,
      alternateRoutes: routeOptions.slice(1),
      alternativesSupported: routeOptions.length > 1,
      alternativeMessage: routeOptions.length > 1
        ? `${routeOptions.length} route options returned by current routing service.`
        : "Alternative routes unavailable from current routing service."
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
  const normalized = normalizeResponseUnitRecord(unit);
  const locationFreshness = unitLocationFreshness(unit);
  const normalizedStatus = String(normalized.status || "unknown").toLowerCase();
  const dispatchStatus = normalizedStatus === "available" && normalized.operational && !dispatchEligibleFreshness(normalized).eligible
    ? "stale"
    : normalizedStatus;
  return {
    ...normalized,
    status: normalizedStatus,
    dispatchStatus,
    unitType: normalized.unitType,
    unitTypeLabel: displayWords(normalized.unitType),
    currentAddress: normalized.currentAddress || normalized.address || normalized.zone || "Location address unavailable",
    locationFreshness: locationFreshness.label,
    locationAgeMinutes: locationFreshness.ageMinutes,
    lastLocationUpdatedAt: normalized.lastLocationUpdatedAt || normalized.lastUpdated || null,
    sourceBadge: normalized.isDemo ? "DEMO UNIT" : normalized.stationFallback ? "STATION FALLBACK" : displayWords(normalized.source),
    badge: normalized.isDemo ? "DEMO UNIT" : "REAL UNIT"
  };
}

function isPoliceResponseUnit(unit) {
  const normalized = normalizeResponseUnitRecord(unit);
  const text = `${normalized.unitCode || ""} ${normalized.vehicleType || ""} ${normalized.name || ""} ${normalized.unitType || ""}`.toLowerCase();
  if (/(ambulance|medical|fire|drone)/.test(text)) return false;
  return /^p[-_ ]?\d+/.test(String(unit?.unitCode || "").toLowerCase())
    || ["police_patrol", "police_station", "traffic", "backup"].includes(normalized.unitType)
    || /police|patrol|response/.test(text);
}

function isDispatchAssignablePoliceUnit(unit) {
  const normalized = normalizeResponseUnitRecord(unit);
  return isPoliceResponseUnit(normalized) && normalized.unitType !== "police_station";
}

function isDemoPatrolUnit(unit) {
  return isDemoMode() && normalizeResponseUnitRecord(unit).isDemo;
}

function dispatchEligibleFreshness(unit) {
  const freshness = unitLocationFreshness(unit);
  return {
    ...freshness,
    eligible: freshness.eligible || (isDemoPatrolUnit(unit) && Boolean(strictPoint(unit))),
    demoGrace: !freshness.eligible && isDemoPatrolUnit(unit)
  };
}

function unitBeatMatch(unit, incident) {
  const unitArea = `${unit.zone || ""} ${unit.beat || ""} ${unit.jurisdiction || ""}`.toLowerCase();
  const incidentArea = `${incident.zone || ""} ${incident.address || ""}`.toLowerCase();
  return Boolean(unitArea && incidentArea && (incidentArea.includes(unitArea.trim()) || unitArea.includes(String(incident.zone || "").toLowerCase())));
}

function unitLoadScore(unit) {
  if (Number.isFinite(Number(unit.activeAssignments))) return Number(unit.activeAssignments);
  if (Number.isFinite(Number(unit.load))) return Number(unit.load);
  return unit.assignedIncidentId ? 1 : 0;
}

function unitSourcePriority(unit) {
  const normalized = normalizeResponseUnitRecord(unit);
  return DISPATCH_UNIT_SOURCE_PRIORITY[normalized.locationSource || normalized.source] ?? 9;
}

function responseUnitSummary(units) {
  const safeUnits = units.map(unitForResponse);
  return {
    total: safeUnits.length,
    available: safeUnits.filter((unit) => unit.dispatchStatus === "available").length,
    assigned: safeUnits.filter((unit) => unit.dispatchStatus === "assigned").length,
    busy: safeUnits.filter((unit) => unit.dispatchStatus === "busy").length,
    offline: safeUnits.filter((unit) => unit.dispatchStatus === "offline").length,
    stale: safeUnits.filter((unit) => unit.dispatchStatus === "stale").length
  };
}

function unitExclusionReason(unit) {
  const normalized = normalizeResponseUnitRecord(unit);
  const status = String(normalized.status || "unknown").toLowerCase();
  if (status !== "available") return `${displayWords(status)} unit`;
  if (!normalized.operational) return normalized.isDemo ? "Demo unit is not operational in this mode" : "Unit is not operational";
  if (normalized.unitType === "police_station") return "Station/base record, not assignable response unit";
  if (!strictPoint(normalized)) return "Missing GPS location";
  const freshness = dispatchEligibleFreshness(normalized);
  if (!freshness.eligible) return "Stale GPS location";
  if (!isPoliceResponseUnit(normalized)) return "Not a police response unit";
  return "";
}

function rankedCandidateForResponse(candidate, rank = null) {
  return {
    rank,
    id: candidate.unit.id,
    unitCode: candidate.unit.unitCode,
    name: candidate.unit.name,
    officerName: candidate.unit.officerName || null,
    vehicleType: candidate.unit.vehicleType || "Police response unit",
    status: "available",
    dispatchStatus: "available",
    source: candidate.unitResponse.source,
    sourceLabel: candidate.unitResponse.sourceLabel,
    locationSource: candidate.unitResponse.locationSource,
    locationSourceLabel: candidate.unitResponse.locationSourceLabel,
    sourceBadge: candidate.unitResponse.sourceBadge,
    stationFallback: Boolean(candidate.unitResponse.stationFallback),
    isDemo: Boolean(candidate.unitResponse.isDemo),
    operational: Boolean(candidate.unitResponse.operational),
    locationFreshness: candidate.unitResponse.locationFreshness,
    locationAgeMinutes: candidate.unitResponse.locationAgeMinutes,
    currentAddress: candidate.unitResponse.currentAddress,
    distanceKm: Number((candidate.route.distanceMeters / 1000).toFixed(2)),
    etaMinutes: Math.max(1, Math.round(candidate.etaSeconds / 60)),
    routeLabel: candidate.route.routeLabel || candidate.route.label,
    routeProvider: candidate.route.provider,
    approximate: Boolean(candidate.route.approximate),
    beatMatch: Boolean(candidate.beatMatch),
    loadScore: candidate.loadScore,
    selectionReason: candidate.selectionReason || ""
  };
}

function safeResponseUnitBody(body = {}, existing = null, stations = []) {
  const source = normalizeUnitSource(body.source || existing?.source || "admin_registry", { isDemo: body.isDemo === true || existing?.isDemo === true });
  const hasCoordinateInput = [body.latitude, body.lat, body.longitude, body.lng]
    .some((value) => value !== undefined && value !== null && String(value).trim() !== "");
  const point = strictPoint({
    lat: body.latitude ?? body.lat ?? existing?.lat,
    lng: body.longitude ?? body.lng ?? existing?.lng
  });
  const unitCode = String(body.unitId || body.unitCode || existing?.unitCode || "").trim().slice(0, 40);
  const name = String(body.unitName || body.name || existing?.name || "").trim().slice(0, 120);
  if (!existing && (!unitCode || !name)) {
    throw Object.assign(new Error("Unit ID and unit name are required"), { status: 400 });
  }
  if (hasCoordinateInput && !point) {
    throw Object.assign(new Error("Valid unit latitude and longitude are required"), { status: 400 });
  }
  const current = existing ? normalizeResponseUnitRecord(existing) : {};
  const station = findLinkedStation({
    linkedStationId: body.linkedStationId || body.stationId || current.linkedStationId,
    stationName: body.stationName || body.station || current.stationName
  }, stations);
  const rawUnit = {
    ...current,
    id: existing?.id || uid("unit"),
    unitId: unitCode || current.unitId,
    unitCode: unitCode || current.unitCode,
    unitName: name || current.unitName,
    name: name || current.name,
    unitType: normalizeUnitType(body.unitType || current.unitType || body.vehicleType),
    officerName: String(body.officerName || current.officerName || "").trim().slice(0, 120),
    teamName: String(body.teamName || body.officerName || current.teamName || "").trim().slice(0, 120),
    stationName: String(body.stationName || body.station || current.stationName || station?.stationName || "").trim().slice(0, 120),
    linkedStationId: String(body.linkedStationId || body.stationId || current.linkedStationId || station?.stationId || station?.id || "").trim() || null,
    stationId: String(body.stationId || body.linkedStationId || current.stationId || station?.stationId || station?.id || "").trim() || null,
    beat: String(body.beat || body.sector || current.beat || "").trim().slice(0, 120),
    sector: String(body.sector || body.beat || current.sector || "").trim().slice(0, 120),
    jurisdiction: String(body.jurisdiction || current.jurisdiction || "").trim().slice(0, 160),
    vehicleType: String(body.vehicleType || current.vehicleType || displayWords(body.unitType || current.unitType || "police_patrol")).trim().slice(0, 80),
    status: normalizeUnitStatus(body.status || current.status || "available"),
    lat: point?.lat ?? current.lat ?? null,
    lng: point?.lng ?? current.lng ?? null,
    address: String(body.address || body.currentAddress || current.address || station?.address || "").trim().slice(0, 240) || "Location address unavailable",
    currentAddress: String(body.currentAddress || body.address || current.currentAddress || station?.address || "").trim().slice(0, 240) || "Location address unavailable",
    source,
    isDemo: body.isDemo === true || (source === "demo_seed" ? true : current.isDemo === true),
    operational: body.operational !== undefined ? Boolean(body.operational) : current.operational !== undefined ? Boolean(current.operational) : source !== "demo_seed",
    lastSeen: body.lastSeen || current.lastSeen || now(),
    lastUpdated: now(),
    lastLocationUpdatedAt: point ? now() : current.lastLocationUpdatedAt || now(),
    assignedIncidentId: current.assignedIncidentId || null,
    currentIncidentId: current.currentIncidentId || current.assignedIncidentId || null
  };
  return normalizeResponseUnitRecord(applyStationFallback(rawUnit, stations));
}

function safePoliceStationBody(body = {}, existing = null) {
  const current = existing ? normalizePoliceStationRecord(existing) : {};
  const hasCoordinateInput = [body.latitude, body.lat, body.longitude, body.lng]
    .some((value) => value !== undefined && value !== null && String(value).trim() !== "");
  const point = strictPoint({
    lat: body.latitude ?? body.lat ?? current.lat,
    lng: body.longitude ?? body.lng ?? current.lng
  });
  const stationId = String(body.stationId || current.stationId || "").trim().slice(0, 48);
  const stationName = String(body.stationName || body.name || current.stationName || "").trim().slice(0, 140);
  if (!existing && (!stationId || !stationName)) throw Object.assign(new Error("Station ID and station name are required"), { status: 400 });
  if (hasCoordinateInput && !point) throw Object.assign(new Error("Valid station latitude and longitude are required"), { status: 400 });
  const source = normalizeUnitSource(body.source || current.source || "admin_registry", { isDemo: body.isDemo === true || current.isDemo === true });
  return normalizePoliceStationRecord({
    ...current,
    id: existing?.id || uid("station"),
    stationId: stationId || current.stationId,
    stationName: stationName || current.stationName,
    address: String(body.address || current.address || "").trim().slice(0, 240) || "Station address unavailable",
    lat: point?.lat ?? current.lat ?? null,
    lng: point?.lng ?? current.lng ?? null,
    jurisdiction: String(body.jurisdiction || current.jurisdiction || "").trim().slice(0, 160),
    beat: String(body.beat || body.sector || current.beat || "").trim().slice(0, 120),
    sectorCoverage: Array.isArray(body.sectorCoverage)
      ? body.sectorCoverage
      : String(body.sectorCoverage || current.sectorCoverage?.join?.(", ") || "").split(",").map((item) => item.trim()).filter(Boolean),
    source,
    isDemo: body.isDemo === true || (source === "demo_seed" ? true : current.isDemo === true),
    operational: body.operational !== undefined ? Boolean(body.operational) : current.operational !== undefined ? Boolean(current.operational) : source !== "demo_seed",
    lastUpdated: now()
  });
}

function availableUnitsByDistance(db, lat, lng) {
  const destination = strictPoint({ lat, lng });
  if (!destination) return [];
  const operationalUnits = db.responseUnits.map(normalizeResponseUnitRecord).filter((unit) => unit.operational && isDispatchAssignablePoliceUnit(unit));
  const hasRealUnits = operationalUnits.some((unit) => !unit.isDemo);
  return operationalUnits
    .filter((unit) => {
      const freshness = dispatchEligibleFreshness(unit);
      return unit.status === "available" && freshness.eligible && Boolean(strictPoint(unit)) && (!hasRealUnits || !unit.isDemo);
    })
    .map((unit) => ({
      ...unitForResponse(unit),
      straightLineKm: Number(Math.hypot((Number(unit.lat) - lat) * 111, (Number(unit.lng) - lng) * 100).toFixed(2))
    }))
    .sort((a, b) => a.straightLineKm - b.straightLineKm);
}

async function bestRoutedUnit(db, incident, { allowApproximate = true } = {}) {
  const destination = strictPoint(incident);
  const locationError = dispatchLocationError(incident);
  if (locationError) return { error: locationError, status: 409 };

  const policeUnits = db.responseUnits.map(normalizeResponseUnitRecord).filter(isPoliceResponseUnit);
  const operationalPoliceUnits = policeUnits.filter((unit) => unit.operational);
  const assignablePoliceUnits = operationalPoliceUnits.filter(isDispatchAssignablePoliceUnit);
  const realOperationalAvailable = assignablePoliceUnits.some((unit) => unit.status === "available" && !unit.isDemo);
  const available = assignablePoliceUnits.filter((unit) => unit.status === "available" && (!realOperationalAvailable || !unit.isDemo));
  const excludedUnits = policeUnits
    .map((unit) => ({ ...unitForResponse(unit), exclusionReason: unitExclusionReason(unit) }))
    .map((unit) => (!unit.exclusionReason && realOperationalAvailable && unit.isDemo ? { ...unit, exclusionReason: "Demo unit excluded while real registry units are available" } : unit))
    .filter((unit) => unit.exclusionReason);
  const staleUnits = excludedUnits.filter((unit) => /stale/i.test(unit.exclusionReason));
  const warnings = staleUnits.length ? [`${staleUnits.length} available police unit(s) excluded because GPS is stale.`] : [];
  const stationFallbackUnits = available.filter((unit) => normalizeResponseUnitRecord(unit).stationFallback);
  if (stationFallbackUnits.length) warnings.push(`Live GPS unavailable - using station/base location for ${stationFallbackUnits.length} unit(s).`);
  if (available.length && available.every((unit) => normalizeResponseUnitRecord(unit).isDemo)) warnings.push("Demo dispatch mode: using simulated response units.");
  if (!available.length) return { error: "No available police response units", status: 409, candidates: [], excludedUnits, warnings };

  const withLocation = available.filter((unit) => Boolean(strictPoint(unit)));
  if (!withLocation.length) return { error: "Available police units have missing or stale GPS", status: 409, candidates: [], excludedUnits, warnings };

  const candidates = withLocation
    .map((unit) => ({ unit, freshness: dispatchEligibleFreshness(unit) }))
    .filter((item) => item.freshness.eligible)
    .map((item) => ({
      unit: item.unit,
      unitResponse: {
        ...unitForResponse(item.unit),
        locationFreshness: item.freshness.demoGrace ? "Demo" : item.freshness.label,
        locationAgeMinutes: item.freshness.ageMinutes
      },
      locationFreshness: item.freshness.demoGrace ? "Demo" : item.freshness.label,
      locationAgeMinutes: item.freshness.ageMinutes,
      beatMatch: unitBeatMatch(item.unit, incident),
      loadScore: unitLoadScore(item.unit),
      sourcePriority: unitSourcePriority(item.unit),
      straightLineKm: Number(Math.hypot((Number(item.unit.lat) - destination.lat) * 111, (Number(item.unit.lng) - destination.lng) * 100).toFixed(2))
    }))
    .sort((a, b) => a.straightLineKm - b.straightLineKm);
  if (!candidates.length) return { error: "Available police units have stale GPS", status: 409, candidates: [], excludedUnits, warnings };

  const routed = await Promise.all(candidates.map(async (candidate) => ({
    ...candidate,
    route: await routeBetween(routeUrl(strictPoint(candidate.unit), destination))
  })));
  const usable = routed
    .filter((item) => allowApproximate || (item.route.provider === "osrm" && !item.route.approximate))
    .map((item) => ({
      ...item,
      etaSeconds: item.route.durationSeconds || approximateRouteDurationSeconds(item.route.distanceMeters)
    }))
    .sort((a, b) => a.etaSeconds - b.etaSeconds
      || a.route.distanceMeters - b.route.distanceMeters
      || Number(b.beatMatch) - Number(a.beatMatch)
      || a.sourcePriority - b.sourcePriority
      || a.loadScore - b.loadScore
      || String(a.unit.unitCode || "").localeCompare(String(b.unit.unitCode || "")));
  if (!usable.length) return { error: "Route service unavailable", status: 503, degraded: true, candidates: [], excludedUnits, warnings };
  const ranked = usable.map((candidate, index) => {
    const etaMinutes = Math.max(1, Math.round(candidate.etaSeconds / 60));
    const distanceKm = Number((candidate.route.distanceMeters / 1000).toFixed(2));
    const sourceLabel = candidate.unitResponse.stationFallback ? "Station fallback" : candidate.unitResponse.sourceLabel;
    const selectionReason = index === 0
      ? `Selected because it is available, closest by ETA (${etaMinutes} min), ${distanceKm} km away${candidate.beatMatch ? ", and inside jurisdiction" : ""}. Source: ${sourceLabel}.`
      : `Ranked by ETA ${etaMinutes} min and distance ${distanceKm} km.`;
    return { ...candidate, rank: index + 1, selectionReason };
  });
  const selected = ranked[0];
  return {
    unit: selected.unit,
    unitResponse: selected.unitResponse,
    route: selected.route,
    etaSeconds: selected.etaSeconds,
    candidates: ranked.map((candidate) => rankedCandidateForResponse(candidate, candidate.rank)),
    excludedUnits,
    warnings,
    selectionReason: selected.selectionReason
  };
}

function incidentForResponse(db, incident) {
  if (!incident) return null;
  const recommendedUnit = db.responseUnits.find((unit) => unit.id === incident.recommendedUnitId) || null;
  const assignedUnit = db.responseUnits.find((unit) => unit.id === incident.assignedUnitId) || null;
  const location = strictPoint(incident);
  const dispatchable = Boolean(hasDispatchableLocation(incident) && ["Verified", "Assigned", "En Route", "On Scene"].includes(canonicalIncidentStatus(incident.status)));
  const locationSafetyLabel = !location
    ? "Location missing - verify before dispatch"
    : incident.locationStatus === "Verified" && hasDispatchableLocation(incident)
      ? "Ready for dispatch"
      : incident.locationStatus === "Verified"
        ? "Location source unconfirmed"
        : incident.locationStatus === "Approximate"
          ? "Location approximate"
          : "Location missing";
  return {
    ...incident,
    displayTitle: incidentDisplayTitle(incident),
    displaySource: incidentDisplaySource(incident),
    dispatchable,
    navigationReady: Boolean(dispatchable && assignedUnit && incident.distanceKm && incident.etaMinutes),
    routeLabel: incident.routeLabel || (incident.routeApproximate ? "Approximate fallback route" : incident.distanceKm ? "Fastest route" : null),
    routeProvider: incident.routeProvider || null,
    routeApproximate: Boolean(incident.routeApproximate),
    routeCalculatedAt: incident.routeCalculatedAt || null,
    routeSelectionReason: incident.routeSelectionReason || null,
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
  const point = explicitPoint;
  const locationSource = normalizeLocationSource(input.locationSource, {
    hasPoint: Boolean(point),
    isDemo: input.isDemo === true || input.sourceType === "command_center_demo" || input.source === "demo_seed"
  });
  const locationStatus = normalizedLocationStatus(
    input.locationStatus || (explicitPoint ? "Approximate" : "Needs Confirmation"),
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
    locationSource,
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
    pendingVideoObservations: db.alerts.filter((alert) => alert.source === "video_upload" && ["pending_review", "human_verification_required"].includes(String(alert.reviewStatus || alert.verificationStatus || "").toLowerCase())).length,
    averageEtaMinutes: etaIncidents.length
      ? Math.round(etaIncidents.reduce((sum, incident) => sum + Number(incident.etaMinutes), 0) / etaIncidents.length)
      : null
  };
}

async function apiInternal(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") return sendJson(res, 200, { ok: true, service: "RakshakAI Local API", timestamp: now() });
  if (req.method === "GET" && url.pathname === "/api/me") {
    const user = await userFromReqForSession(req);
    return sendJson(res, 200, { user: publicUser(user) });
  }

  const db = await readDatabase();
  const user = userFromReq(req, db);
  const body = req.method === "GET" ? {} : await getBody(req);

  if (req.method === "POST" && url.pathname === "/api/login") {
    const email = normalizeEmail(body.email);
    const found = db.users.find((candidate) => normalizeEmail(candidate.email) === email);
    if (!found || !await verifyPassword(found, body.password)) {
      return sendJson(res, 401, { error: "Invalid email or password" });
    }
    if (found.role === "Police Officer" && found.status === "inactive") {
      return sendJson(res, 403, { error: "Police account is inactive. Contact an administrator." });
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
    if (!authorizeRole(res, user, ["Police Officer", "Admin"])) return;
    return sendJson(res, 200, { cameras: camerasForResponse(db) });
  }
  if (req.method === "GET" && url.pathname === "/api/camera-sources") {
    if (!authorizeRole(res, user, ["Police Officer", "Admin"])) return;
    return sendJson(res, 200, { sources: cameraSourcesForResponse(db) });
  }
  if (req.method === "POST" && url.pathname === "/api/camera-sources") {
    if (!authorizeRole(res, user, ["Admin"])) return;
    const source = safeCameraConfigBody(body);
    source.createdAt = now();
    source.createdBy = user.id;
    db.cameraSources.unshift(source);
    db.auditLogs.unshift({ id: uid("aud"), actorName: user.name, actorRole: user.role, action: "created_camera_source_config", timestamp: now() });
    await writeDatabase(db);
    return sendJson(res, 201, { source: cameraSourceForResponse(db, source) });
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
        ? db.reports.filter((report) => report.createdBy === user.id).map((report) => citizenReportForResponse(db, report))
        : db.reports
    });
  }

  if (req.method === "GET" && url.pathname === "/api/video-evidence") {
    if (!authorizeRole(res, user, ["Police Officer", "Admin"])) return;
    const evidence = db.videoEvidence
      .slice()
      .sort((a, b) => String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || "")))
      .map((item) => videoEvidenceForResponse(db, item));
    const observations = db.alerts
      .filter((alert) => alert.source === "video_upload" || alert.linkedEvidenceId)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .map((alert) => videoObservationForResponse(db, alert));
    const payload = { evidence, observations };
    assertSafeEvidencePayload(payload);
    return sendJson(res, 200, payload);
  }

  if (req.method === "POST" && url.pathname === "/api/video-evidence") {
    if (!authorizeRole(res, user, ["Police Officer", "Admin"])) return;
    let links;
    try {
      links = validateEvidenceLinks(db, body, user);
    } catch (error) {
      return sendJson(res, error.status || 400, { error: error.message });
    }
    try {
      const evidence = createVideoEvidenceRecord(db, body, user, {
        source: "video_upload",
        linkedReport: links.linkedReport,
        linkedIncident: links.linkedIncident
      });
      db.videoEvidence.unshift(evidence);
      await writeDatabase(db);
      const payload = { evidence: videoEvidenceForResponse(db, evidence), message: "Video evidence uploaded for AI-assisted review." };
      assertSafeEvidencePayload(payload);
      return sendJson(res, 201, payload);
    } catch (error) {
      return sendJson(res, error.status || 400, { error: error.message });
    }
  }

  const videoPreviewMatch = url.pathname.match(/^\/api\/video-evidence\/([^/]+)\/preview$/);
  if (req.method === "GET" && videoPreviewMatch) {
    const evidence = db.videoEvidence.find((item) => item.id === videoPreviewMatch[1]);
    if (!evidence) return sendJson(res, 404, { error: "Evidence not found" });
    if (!user || !canAccessVideoEvidence(db, user, evidence)) return rejectUnauthenticatedOrForbidden(res, user);
    const parsed = parseEvidenceDataUrl(evidence.fileData, { allowImages: true });
    if (!parsed) return sendJson(res, 404, { error: "Evidence preview is not available" });
    res.writeHead(200, {
      "Content-Type": parsed.mimeType,
      "Cache-Control": "private, max-age=60",
      "Content-Length": parsed.buffer.length
    });
    return res.end(parsed.buffer);
  }

  const analyzeEvidenceMatch = url.pathname.match(/^\/api\/video-evidence\/([^/]+)\/analyze$/);
  if (req.method === "POST" && analyzeEvidenceMatch) {
    if (!authorizeRole(res, user, ["Police Officer", "Admin"])) return;
    const evidence = db.videoEvidence.find((item) => item.id === analyzeEvidenceMatch[1]);
    if (!evidence) return sendJson(res, 404, { error: "Evidence not found" });
    if (!canAccessVideoEvidence(db, user, evidence)) return forbidden(res);
    const existingPending = evidenceObservations(db, evidence.id).filter((alert) => ["pending_review", "human_verification_required"].includes(String(alert.reviewStatus || alert.verificationStatus || "").toLowerCase()));
    const startedAt = now();
    evidence.processingStatus = "analysis_started";
    evidence.analysisStartedAt = startedAt;
    const analysisAudit = recordEvidenceAudit(db, evidence, "video_ai_analysis_started", user, "AI-assisted video evidence review started", startedAt);
    const observations = existingPending.length
      ? existingPending
      : videoObservationSpecsForEvidence(db, evidence).map((spec) => createVideoObservation(db, evidence, user, spec));
    const observationAudits = observations
      .filter((alert) => !existingPending.includes(alert))
      .map((alert) => addAuditLog(db, "ai_observation_created", user, null, `${alert.id}: ${evidence.id}`, startedAt));
    evidence.processingStatus = "analysis_complete";
    evidence.analyzedAt = now();
    evidence.analysisSummary = {
      message: "Possible detections created for human verification. No crime or identity is confirmed automatically.",
      observationCount: evidenceObservations(db, evidence.id).length
    };
    await writeDatabase(db);
    const payload = {
      evidence: videoEvidenceForResponse(db, evidence),
      observations: evidenceObservations(db, evidence.id).map((alert) => videoObservationForResponse(db, alert)),
      audit: [analysisAudit, ...observationAudits].map((log) => ({ id: log.id, action: log.action, timestamp: log.timestamp }))
    };
    assertSafeEvidencePayload(payload);
    return sendJson(res, 200, payload);
  }

  const reviewVideoObservationMatch = url.pathname.match(/^\/api\/video-observations\/([^/]+)\/review$/);
  if (req.method === "POST" && reviewVideoObservationMatch) {
    if (!authorizeRole(res, user, ["Police Officer", "Admin"])) return;
    const alert = db.alerts.find((item) => item.id === reviewVideoObservationMatch[1] && (item.source === "video_upload" || item.linkedEvidenceId));
    if (!alert) return sendJson(res, 404, { error: "Video AI observation not found" });
    const evidence = db.videoEvidence.find((item) => item.id === alert.linkedEvidenceId || item.id === alert.evidenceId);
    if (!evidence) return sendJson(res, 404, { error: "Linked evidence not found" });
    if (!canAccessVideoEvidence(db, user, evidence)) return forbidden(res);
    const action = String(body.action || "").toLowerCase();
    if (!["verify", "reject"].includes(action)) return sendJson(res, 400, { error: "Review action must be verify or reject" });
    const reviewedAt = now();
    const notes = String(body.notes || "").slice(0, 500);
    alert.reviewedAt = reviewedAt;
    alert.reviewedBy = { id: user.id, name: user.name, role: user.role };
    alert.reviewNotes = notes;
    alert.acknowledged = true;
    if (action === "verify") {
      alert.status = "Verified";
      alert.reviewStatus = "verified";
      alert.verificationStatus = "verified";
      alert.actionable = true;
    } else {
      alert.status = "False Alarm";
      alert.reviewStatus = "false_alarm";
      alert.verificationStatus = "rejected_false_alarm";
      alert.actionable = false;
    }
    alert.operationalAlert = false;
    const audit = recordEvidenceAudit(db, evidence, action === "verify" ? "observation_verified" : "observation_rejected", user, `${alert.id}${notes ? `: ${notes}` : ""}`, reviewedAt);
    await writeDatabase(db);
    return sendJson(res, 200, {
      observation: videoObservationForResponse(db, alert),
      evidence: videoEvidenceForResponse(db, evidence),
      audit: { id: audit.id, action: audit.action, timestamp: audit.timestamp }
    });
  }

  const convertVideoObservationMatch = url.pathname.match(/^\/api\/video-observations\/([^/]+)\/convert-incident$/);
  if (req.method === "POST" && convertVideoObservationMatch) {
    if (!authorizeRole(res, user, ["Police Officer", "Admin"])) return;
    const alert = db.alerts.find((item) => item.id === convertVideoObservationMatch[1] && (item.source === "video_upload" || item.linkedEvidenceId));
    if (!alert) return sendJson(res, 404, { error: "Video AI observation not found" });
    const evidence = db.videoEvidence.find((item) => item.id === alert.linkedEvidenceId || item.id === alert.evidenceId);
    if (!evidence) return sendJson(res, 404, { error: "Linked evidence not found" });
    if (!canAccessVideoEvidence(db, user, evidence)) return forbidden(res);
    if (alert.linkedIncidentId || alert.incidentId) return sendJson(res, 409, { error: "Observation is already linked to an incident" });
    if (String(alert.reviewStatus || "").toLowerCase() !== "verified" || String(alert.verificationStatus || "").toLowerCase() !== "verified") {
      return sendJson(res, 409, { error: "Verify the observation before converting it to an incident" });
    }
    const createdAt = now();
    const incident = createIncidentRecord(db, {
      title: "Verified video evidence observation",
      category: alert.threatType || "video_evidence_observation",
      severity: "medium",
      source: "Video Evidence",
      sourceType: "video_upload",
      sourceName: evidence.fileName,
      sourceRecordId: alert.id,
      zone: alert.zone || evidenceLinkedReport(db, evidence)?.lastSeenLocation || "Evidence Review",
      address: evidenceLinkedReport(db, evidence)?.address || evidenceLinkedIncident(db, evidence)?.address || "Location not specified",
      reportedBy: user.id,
      confidence: alert.confidence,
      detectionMetadata: {
        linkedEvidenceId: evidence.id,
        observationId: alert.id,
        message: alert.message,
        detections: alert.detections || [],
        confidence: alert.confidence,
        detectionType: alert.detectionType || alert.threatType,
        detectionLabel: alert.detectionLabel || null,
        possibleColor: alert.possibleColor || null,
        possiblePlateText: alert.possiblePlateText || null,
        vehicleType: alert.vehicleType || null,
        objectType: alert.objectType || null,
        identityStatus: "possible_detection_requires_human_verification"
      }
    }, user, createdAt);
    alert.incidentId = incident.id;
    alert.linkedIncidentId = incident.id;
    alert.status = "Reviewed";
    alert.reviewStatus = "incident_created";
    alert.verificationStatus = "verified_incident_created";
    const audit = recordEvidenceAudit(db, evidence, "observation_converted_to_incident", user, `${alert.id} -> ${incident.id}`, createdAt);
    const incidentAudit = addAuditLog(db, "incident_created_from_video_observation", user, incident.id, `${alert.id}: ${evidence.id}`, createdAt);
    await writeIncidentWorkflowRecords(db, incident, { alerts: [alert], audits: [audit, incidentAudit] });
    return sendJson(res, 200, {
      observation: videoObservationForResponse(db, alert),
      evidence: videoEvidenceForResponse(db, evidence),
      incident: incidentForResponse(db, incident)
    });
  }

  const reviewBrowserObservationMatch = url.pathname.match(/^\/api\/browser-observations\/([^/]+)\/review$/);
  if (req.method === "POST" && reviewBrowserObservationMatch) {
    if (!authorizeRole(res, user, ["Police Officer", "Admin"])) return;
    const alert = db.alerts.find((item) => item.id === reviewBrowserObservationMatch[1]);
    if (!alert) return sendJson(res, 404, { error: "Browser AI observation not found" });
    const alertSource = normalizeAlertSource(alert);
    const sourceText = `${alert.source || ""} ${alert.sourceType || ""} ${alert.sourceName || ""}`.toLowerCase();
    if (alertSource !== "browser_camera" && !/browser_camera|live vision|phone camera/.test(sourceText)) {
      return sendJson(res, 404, { error: "Browser AI observation not found" });
    }
    const action = String(body.action || "").toLowerCase();
    if (!["verify", "reject"].includes(action)) return sendJson(res, 400, { error: "Review action must be verify or reject" });
    const reviewedAt = now();
    const notes = String(body.notes || "").slice(0, 500);
    alert.reviewedAt = reviewedAt;
    alert.reviewedBy = { id: user.id, name: user.name, role: user.role };
    alert.reviewNotes = notes;
    alert.acknowledged = true;
    alert.operationalAlert = false;
    alert.personIdentity = { identified: false, status: "unsupported" };
    if (action === "verify") {
      alert.status = "Verified";
      alert.reviewStatus = "verified";
      alert.verificationStatus = "verified";
      alert.actionable = false;
    } else {
      alert.status = "False Alarm";
      alert.reviewStatus = "false_alarm";
      alert.verificationStatus = "rejected_false_alarm";
      alert.actionable = false;
    }
    const report = alert.linkedReportId
      ? db.reports.find((item) => item.id === alert.linkedReportId)
      : null;
    if (report && action === "verify") {
      report.status = "possible_match";
      report.updatedAt = reviewedAt;
      report.reviewNotes = notes || report.reviewNotes;
    }
    const audit = addAuditLog(
      db,
      action === "verify" ? "browser_ai_observation_verified" : "browser_ai_observation_rejected",
      user,
      null,
      `${alert.id}${report ? `: report ${report.id}` : ""}${notes ? `: ${notes}` : ""}`,
      reviewedAt
    );
    await writeSelectedRecords(db, [
      [alertsRepository, [alert]],
      [missingPersonsRepository, report ? [report] : []],
      [auditLogsRepository, [audit]]
    ]);
    return sendJson(res, 200, {
      observation: alertForResponse(db, alert),
      report: report ? citizenReportForResponse(db, report) : null,
      audit: { id: audit.id, action: audit.action, timestamp: audit.timestamp }
    });
  }

  const reportEvidenceMatch = url.pathname.match(/^\/api\/reports\/([^/]+)\/evidence$/);
  if (req.method === "POST" && reportEvidenceMatch) {
    if (!user) return sendJson(res, 401, { error: "Authentication required" });
    const report = db.reports.find((item) => item.id === reportEvidenceMatch[1]);
    if (!report) return sendJson(res, 404, { error: "Report not found" });
    if (user.role === "Citizen" && report.createdBy !== user.id) return forbidden(res);
    if (!hasRole(user, ["Citizen", "Police Officer", "Admin"])) return forbidden(res);
    try {
      const evidence = createVideoEvidenceRecord(db, body, user, {
        source: "citizen_evidence",
        linkedReport: report,
        allowImages: true
      });
      db.videoEvidence.unshift(evidence);
      report.evidenceId = evidence.id;
      report.evidenceType = evidence.mimeType.startsWith("video/") ? "video" : "image";
      report.imageName = evidence.fileName;
      report.updatedAt = now();
      await writeDatabase(db);
      const payload = user.role === "Citizen"
        ? {
            report: citizenReportForResponse(db, report),
            evidence: {
              evidenceId: evidence.id,
              fileName: evidence.fileName,
              uploadedAt: evidence.uploadedAt,
              status: "submitted_for_review"
            },
            message: "Evidence submitted for staff review."
          }
        : { report, evidence: videoEvidenceForResponse(db, evidence), message: "Evidence attached for review." };
      assertSafeEvidencePayload(payload);
      return sendJson(res, 201, payload);
    } catch (error) {
      return sendJson(res, error.status || 400, { error: error.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/alerts") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const alerts = db.alerts
      .filter((alert) => !["closed", "resolved", "false alarm"].includes(normalizedIncidentValue(alert.status)))
      .map((alert) => alertForResponse(db, alert));
    return sendJson(res, 200, { alerts });
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
    return sendJson(res, 200, { units: db.responseUnits.map(unitForResponse), summary: responseUnitSummary(db.responseUnits) });
  }
  if (req.method === "GET" && url.pathname === "/api/police-stations") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    return sendJson(res, 200, { stations: db.policeStations.map(stationForResponse), defaultCenter: DEFAULT_OPERATIONAL_CENTER });
  }
  if (req.method === "POST" && url.pathname === "/api/police-stations") {
    if (!hasRole(user, ["Admin"])) return forbidden(res);
    try {
      const station = safePoliceStationBody(body);
      if (db.policeStations.some((item) => item.id === station.id || item.stationId === station.stationId)) {
        return sendJson(res, 409, { error: "Police station ID already exists" });
      }
      db.policeStations.unshift(station);
      const audit = addAuditLog(db, "station_created", user, null, `${station.stationId}: ${station.stationName}`);
      await writeDatabase(db);
      return sendJson(res, 201, { station: stationForResponse(station), audit: { id: audit.id, action: audit.action, timestamp: audit.timestamp } });
    } catch (error) {
      return sendJson(res, error.status || 400, { error: error.message });
    }
  }
  const policeStationMatch = url.pathname.match(/^\/api\/police-stations\/([^/]+)$/);
  if (policeStationMatch && ["PATCH", "DELETE"].includes(req.method)) {
    if (!hasRole(user, ["Admin"])) return forbidden(res);
    const station = db.policeStations.find((item) => item.id === policeStationMatch[1] || item.stationId === policeStationMatch[1]);
    if (!station) return sendJson(res, 404, { error: "Police station not found" });
    const before = normalizePoliceStationRecord(station);
    try {
      const next = req.method === "DELETE"
        ? normalizePoliceStationRecord({ ...station, operational: false, lastUpdated: now() })
        : safePoliceStationBody(body, station);
      Object.assign(station, next);
      const audit = addAuditLog(db, req.method === "DELETE" || before.operational !== station.operational ? "station_status_changed" : "station_updated", user, null, `${station.stationId}: ${station.stationName}`);
      await writeDatabase(db);
      return sendJson(res, 200, { station: stationForResponse(station), audit: { id: audit.id, action: audit.action, timestamp: audit.timestamp } });
    } catch (error) {
      return sendJson(res, error.status || 400, { error: error.message });
    }
  }
  if (req.method === "POST" && url.pathname === "/api/response-units") {
    if (!hasRole(user, ["Admin"])) return forbidden(res);
    try {
      const unit = safeResponseUnitBody(body, null, db.policeStations);
      if (db.responseUnits.some((item) => item.id === unit.id || item.unitCode === unit.unitCode || item.unitId === unit.unitId)) {
        return sendJson(res, 409, { error: "Response unit ID already exists" });
      }
      db.responseUnits.unshift(unit);
      const audit = addAuditLog(db, "unit_created", user, null, `${unit.unitCode}: ${unit.name}`);
      await writeSelectedRecords(db, [
        [responseUnitsRepository, [unit]],
        [auditLogsRepository, [audit]]
      ]);
      return sendJson(res, 201, { unit: unitForResponse(unit), audit: { id: audit.id, action: audit.action, timestamp: audit.timestamp } });
    } catch (error) {
      return sendJson(res, error.status || 400, { error: error.message });
    }
  }
  const responseUnitMatch = url.pathname.match(/^\/api\/response-units\/([^/]+)$/);
  if (responseUnitMatch && ["PATCH", "DELETE"].includes(req.method)) {
    if (!hasRole(user, ["Admin"])) return forbidden(res);
    const unit = db.responseUnits.find((item) => item.id === responseUnitMatch[1] || item.unitCode === responseUnitMatch[1] || item.unitId === responseUnitMatch[1]);
    if (!unit) return sendJson(res, 404, { error: "Response unit not found" });
    const before = normalizeResponseUnitRecord(unit);
    try {
      const next = req.method === "DELETE"
        ? normalizeResponseUnitRecord({ ...unit, operational: false, status: "offline", lastUpdated: now() })
        : safeResponseUnitBody(body, unit, db.policeStations);
      Object.assign(unit, next);
      const audits = [addAuditLog(db, req.method === "DELETE" ? "unit_status_changed" : "unit_updated", user, null, `${unit.unitCode}: ${unit.status}`)];
      if (before.status !== unit.status || before.operational !== unit.operational) {
        audits.push(addAuditLog(db, "unit_status_changed", user, null, `${unit.unitCode}: ${before.status} -> ${unit.status}; operational=${unit.operational}`));
      }
      if (before.lat !== unit.lat || before.lng !== unit.lng || before.source !== unit.source) {
        audits.push(addAuditLog(db, "unit_location_updated", user, null, `${unit.unitCode}: ${unit.sourceLabel}`));
      }
      await writeSelectedRecords(db, [
        [responseUnitsRepository, [unit]],
        [auditLogsRepository, audits]
      ]);
      return sendJson(res, 200, { unit: unitForResponse(unit), audits: audits.map((audit) => ({ id: audit.id, action: audit.action, timestamp: audit.timestamp })) });
    } catch (error) {
      return sendJson(res, error.status || 400, { error: error.message });
    }
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

  if (req.method === "GET" && url.pathname === "/api/admin/police-users") {
    if (!hasRole(user, ["Admin"])) return forbidden(res);
    return sendJson(res, 200, { users: policeUsersForResponse(db) });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/police-users") {
    if (!hasRole(user, ["Admin"])) return forbidden(res);
    const name = String(body.name || "").trim();
    const email = normalizeEmail(body.email);
    const password = String(body.temporaryPassword || body.password || "");
    if (name.length < 2) return sendJson(res, 400, { error: "Enter the police officer's full name" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { error: "Enter a valid email" });
    if (password.length < 8) return sendJson(res, 400, { error: "Temporary password must be at least 8 characters" });
    if (db.users.some((item) => normalizeEmail(item.email) === email)) return sendJson(res, 409, { error: "Email is already registered" });
    const createdAt = now();
    const created = {
      id: uid("u"),
      name,
      email,
      role: "Police Officer",
      passwordHash: await bcrypt.hash(password, 12),
      badgeId: String(body.badgeId || "").trim(),
      unitId: String(body.unitId || "").trim(),
      station: String(body.station || "").trim(),
      beat: String(body.beat || "").trim(),
      jurisdiction: String(body.jurisdiction || "").trim(),
      status: body.status === "inactive" ? "inactive" : "active",
      createdBy: user.id,
      createdAt
    };
    db.users.push(created);
    const audit = addAuditLog(db, "police_account_created", user, null, `${created.name}: ${created.email}`, createdAt);
    await writeSelectedRecords(db, [[usersRepository, [created]], [auditLogsRepository, [audit]]]);
    return sendJson(res, 201, { user: policeUserForResponse(created) });
  }

  const policeUserMatch = url.pathname.match(/^\/api\/admin\/police-users\/([^/]+)$/);
  if (req.method === "PATCH" && policeUserMatch) {
    if (!hasRole(user, ["Admin"])) return forbidden(res);
    const policeUser = db.users.find((item) => item.id === policeUserMatch[1] && item.role === "Police Officer");
    if (!policeUser) return sendJson(res, 404, { error: "Police account not found" });
    const name = String(body.name ?? policeUser.name).trim();
    const email = normalizeEmail(body.email ?? policeUser.email);
    if (name.length < 2) return sendJson(res, 400, { error: "Enter the police officer's full name" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { error: "Enter a valid email" });
    if (db.users.some((item) => item.id !== policeUser.id && normalizeEmail(item.email) === email)) {
      return sendJson(res, 409, { error: "Email is already registered" });
    }
    policeUser.name = name;
    policeUser.email = email;
    policeUser.badgeId = String(body.badgeId ?? policeUser.badgeId ?? "").trim();
    policeUser.unitId = String(body.unitId ?? policeUser.unitId ?? "").trim();
    policeUser.station = String(body.station ?? policeUser.station ?? "").trim();
    policeUser.beat = String(body.beat ?? policeUser.beat ?? "").trim();
    policeUser.jurisdiction = String(body.jurisdiction ?? policeUser.jurisdiction ?? "").trim();
    policeUser.updatedAt = now();
    const audit = addAuditLog(db, "police_account_updated", user, null, `${policeUser.name}: ${policeUser.email}`, policeUser.updatedAt);
    await writeSelectedRecords(db, [[usersRepository, [policeUser]], [auditLogsRepository, [audit]]]);
    return sendJson(res, 200, { user: policeUserForResponse(policeUser) });
  }

  const policeStatusMatch = url.pathname.match(/^\/api\/admin\/police-users\/([^/]+)\/(activate|deactivate)$/);
  if (req.method === "PATCH" && policeStatusMatch) {
    if (!hasRole(user, ["Admin"])) return forbidden(res);
    const policeUser = db.users.find((item) => item.id === policeStatusMatch[1] && item.role === "Police Officer");
    if (!policeUser) return sendJson(res, 404, { error: "Police account not found" });
    const active = policeStatusMatch[2] === "activate";
    policeUser.status = active ? "active" : "inactive";
    policeUser.updatedAt = now();
    if (!active) policeUser.sessionVersion = crypto.randomUUID();
    const audit = addAuditLog(db, active ? "police_account_activated" : "police_account_deactivated", user, null, policeUser.email, policeUser.updatedAt);
    await writeSelectedRecords(db, [[usersRepository, [policeUser]], [auditLogsRepository, [audit]]]);
    return sendJson(res, 200, { user: policeUserForResponse(policeUser) });
  }

  const policeResetMatch = url.pathname.match(/^\/api\/admin\/police-users\/([^/]+)\/reset-password$/);
  if (req.method === "POST" && policeResetMatch) {
    if (!hasRole(user, ["Admin"])) return forbidden(res);
    const policeUser = db.users.find((item) => item.id === policeResetMatch[1] && item.role === "Police Officer");
    if (!policeUser) return sendJson(res, 404, { error: "Police account not found" });
    const temporaryPassword = String(body.temporaryPassword || body.password || "");
    if (temporaryPassword.length < 8) return sendJson(res, 400, { error: "Temporary password must be at least 8 characters" });
    policeUser.passwordHash = await bcrypt.hash(temporaryPassword, 12);
    policeUser.sessionVersion = crypto.randomUUID();
    policeUser.updatedAt = now();
    delete policeUser.password;
    const audit = addAuditLog(db, "police_password_reset", user, null, policeUser.email, policeUser.updatedAt);
    await writeSelectedRecords(db, [[usersRepository, [policeUser]], [auditLogsRepository, [audit]]]);
    return sendJson(res, 200, { user: policeUserForResponse(policeUser), message: "Temporary password has been reset." });
  }

  const reviewAlertMatch = url.pathname.match(/^\/api\/alerts\/([^/]+)\/review$/);
  if (req.method === "POST" && reviewAlertMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const alert = db.alerts.find((item) => item.id === reviewAlertMatch[1]);
    if (!alert) return sendJson(res, 404, { error: "AI alert not found" });
    const action = String(body.action || "").toLowerCase();
    if (!["verify", "reject", "convert_incident", "create_incident", "observation", "dismiss"].includes(action)) {
      return sendJson(res, 400, { error: "Review action must be verify, reject, convert_incident, create_incident, observation, or dismiss" });
    }
    const reviewedAt = now();
    const currentAlert = alertForResponse(db, alert);
    const wantsIncident = ["convert_incident", "create_incident"].includes(action);
    if (!currentAlert.acknowledged) {
      return sendJson(res, 409, { error: "Acknowledge the alert before review" });
    }
    if (wantsIncident && currentAlert.linkedIncidentId) {
      return sendJson(res, 409, { error: "Alert is already linked to an incident" });
    }
    if (wantsIncident && currentAlert.isDemo) {
      return sendJson(res, 409, { error: "Demo seed alerts cannot create real incidents" });
    }
    if (wantsIncident) {
      const status = normalizedIncidentValue(currentAlert.verificationStatus).replace(/\s+/g, "_");
      if (status !== "verified") return sendJson(res, 409, { error: "Verify the alert before converting it to an incident" });
      if (!currentAlert.actionable) return sendJson(res, 409, { error: "Only actionable alerts can be converted to incidents" });
    }
    alert.reviewedAt = reviewedAt;
    alert.reviewedBy = { id: user.id, name: user.name, role: user.role };
    alert.verificationStatus = wantsIncident
      ? "verified_incident_created"
      : action === "verify"
        ? "verified"
        : action === "observation"
          ? "marked_observation"
          : "rejected_false_alarm";
    const auditAction = wantsIncident
      ? "alert_converted_to_incident"
      : action === "verify"
        ? "alert_verified"
        : action === "observation"
          ? "ai_alert_marked_observation"
          : "alert_rejected";
    const legacyReviewAudit = addAuditLog(db, "ai_alert_reviewed", user, alert.incidentId, `${alert.id}: ${action}`, reviewedAt);
    const reviewAudit = addAuditLog(db, auditAction, user, alert.incidentId, `${alert.id}: ${action}`, reviewedAt);
    let incident = null;
    const extraAudits = [legacyReviewAudit, reviewAudit];
    if (wantsIncident) {
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
        locationSource: alert.locationSource,
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
      alert.linkedIncidentId = incident.id;
      alert.status = "Reviewed";
      alert.reviewStatus = "incident_created";
      alert.actionable = true;
    } else if (action === "verify") {
      alert.status = "Verified";
      alert.reviewStatus = "verified";
      alert.actionable = currentAlert.isDemo ? false : currentAlert.actionable;
    } else if (action === "observation") {
      alert.status = "Observation";
      alert.reviewStatus = "observation";
    } else {
      alert.status = "False Alarm";
      alert.reviewStatus = "false_alarm";
      alert.actionable = false;
    }
    if (incident) await writeIncidentWorkflowRecords(db, incident, { alerts: [alert], audits: extraAudits });
    else await writeSelectedRecords(db, [[alertsRepository, [alert]], [auditLogsRepository, extraAudits]]);
    return sendJson(res, 200, { alert: alertForResponse(db, alert), incident: incident ? incidentForResponse(db, incident) : null });
  }

  const reportIncidentMatch = url.pathname.match(/^\/api\/reports\/([^/]+)\/create-incident$/);
  if (req.method === "POST" && reportIncidentMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const report = db.reports.find((item) => item.id === reportIncidentMatch[1]);
    if (!report) return sendJson(res, 404, { error: "Citizen report not found" });
    if (report.incidentId) return sendJson(res, 409, { error: "Report already has an incident" });
    if (["rejected", "false_alarm", "closed", "resolved"].includes(normalizedIncidentValue(report.status))) {
      return sendJson(res, 409, { error: "Report is no longer pending review" });
    }
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
      reportedBy: report.createdBy,
      locationSource: report.locationSource
    }, user, createdAt);
    report.status = "verified";
    report.incidentId = incident.id;
    report.reviewedBy = user.id;
    report.reviewedAt = createdAt;
    report.updatedAt = createdAt;
    const verifiedAudit = addAuditLog(db, "citizen_report_verified", user, incident.id, report.id, createdAt);
    const convertedAudit = addAuditLog(db, "citizen_report_converted", user, incident.id, report.id, createdAt);
    await writeIncidentWorkflowRecords(db, incident, { reports: [report], audits: [verifiedAudit, convertedAudit] });
    const locationMessage = incident.locationStatus === "Verified"
      ? "Incident is ready for dispatch"
      : "Incident created. Confirm the incident location before dispatch.";
    return sendJson(res, 201, { report, incident: incidentForResponse(db, incident), message: `Report verified. ${locationMessage}` });
  }

  const reportRejectMatch = url.pathname.match(/^\/api\/reports\/([^/]+)\/reject$/);
  if (req.method === "POST" && reportRejectMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const report = db.reports.find((item) => item.id === reportRejectMatch[1]);
    if (!report) return sendJson(res, 404, { error: "Citizen report not found" });
    if (report.incidentId) return sendJson(res, 409, { error: "Report already has an incident" });
    if (["rejected", "false_alarm", "closed", "resolved"].includes(normalizedIncidentValue(report.status))) {
      return sendJson(res, 409, { error: "Report is already closed" });
    }
    const rejectedAt = now();
    report.status = "rejected";
    report.reviewedBy = user.id;
    report.reviewedAt = rejectedAt;
    report.rejectionReason = String(body.reason || "Rejected during human review").trim().slice(0, 300);
    report.updatedAt = rejectedAt;
    const audit = addAuditLog(db, "citizen_report_rejected", user, null, `${report.id}: ${report.rejectionReason}`, rejectedAt);
    await writeSelectedRecords(db, [[missingPersonsRepository, [report]], [auditLogsRepository, [audit]]]);
    return sendJson(res, 200, { report, message: "Report rejected" });
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
      linkedIncidentId: incident.id,
      title: incident.title,
      threatType: incident.type,
      severity: incident.severity,
      source: "demo_seed",
      isDemo: true,
      actionable: false,
      sourceType: incident.sourceType,
      sourceName: incident.sourceName,
      zone: incident.zone,
      lat: incident.lat,
      lng: incident.lng,
      locationSource: "demo_seed",
      confidence: incident.confidence,
      occurrenceCount: 1,
      status: "New",
      acknowledged: false,
      verificationStatus: "demo_seed",
      createdBy: user.id,
      createdByRole: user.role,
      createdAt,
      lastDetectedAt: createdAt
    };
    db.incidents.unshift(incident);
    db.alerts.unshift(alert);
    const alertEvent = addDispatchEvent(db, incident.id, "alert_created", alert.title, user.name, createdAt);
    const incidentEvent = addDispatchEvent(db, incident.id, "incident_created", `${incident.title} opened from command center`, user.name, createdAt);
    const audit = addAuditLog(db, "incident_created", user, incident.id, incident.title, createdAt);
    await writeIncidentWorkflowRecords(db, incident, { alerts: [alert], events: [alertEvent, incidentEvent], audits: [audit] });
    return sendJson(res, 201, { incident: incidentForResponse(db, incident), alert: alertForResponse(db, alert) });
  }

  if (req.method === "POST" && url.pathname === "/api/incidents") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const createdAt = now();
    const incident = createIncidentRecord(db, { ...body, source: "Manual", status: body.status || "Verified" }, user, createdAt);
    await writeIncidentWorkflowRecords(db, incident);
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
    incident.locationSource = normalizeLocationSource(body.locationSource, { hasPoint: true });
    incident.locationStatus = body.confirmed === true ? "Verified" : normalizedLocationStatus(body.locationStatus, true);
    incident.updatedAt = changedAt;
    incident.recommendedUnitId = null;
    incident.distanceKm = null;
    incident.etaMinutes = null;
    const event = addDispatchEvent(db, incident.id, "incident_location_updated", `Incident location updated to ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`, user.name, changedAt);
    const audit = addAuditLog(db, "incident_location_updated", user, incident.id, `${incident.locationStatus}: ${incident.address}`, changedAt);
    await writeIncidentWorkflowRecords(db, incident, { events: [event], audits: [audit] });
    return sendJson(res, 200, { incident: incidentForResponse(db, incident) });
  }

  const confirmLocationMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/confirm-location$/);
  if (req.method === "POST" && confirmLocationMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const incident = db.incidents.find((item) => item.id === confirmLocationMatch[1]);
    if (!incident) return sendJson(res, 404, { error: "Incident not found" });
    const submittedPoint = strictPoint(body);
    if (submittedPoint) {
      incident.lat = submittedPoint.lat;
      incident.lng = submittedPoint.lng;
      incident.address = String(body.address || incident.address || `${submittedPoint.lat.toFixed(5)}, ${submittedPoint.lng.toFixed(5)}`).trim().slice(0, 300);
      incident.locationSource = normalizeLocationSource(body.locationSource, { hasPoint: true });
    }
    if (!strictPoint(incident)) return sendJson(res, 409, { error: "Add valid incident coordinates before confirming location" });
    if (!hasDispatchableLocation({ ...incident, locationStatus: "Verified" })) {
      return sendJson(res, 409, { error: "Confirm incident location with GPS, search, map click, or manual coordinates before dispatch" });
    }
    const changedAt = now();
    incident.locationStatus = "Verified";
    incident.updatedAt = changedAt;
    const event = addDispatchEvent(db, incident.id, "incident_location_verified", `Incident location confirmed: ${incident.address}`, user.name, changedAt);
    const audit = addAuditLog(db, "incident_location_verified", user, incident.id, incident.address, changedAt);
    await writeIncidentWorkflowRecords(db, incident, { events: [event], audits: [audit] });
    return sendJson(res, 200, { incident: incidentForResponse(db, incident) });
  }

  const recommendMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/recommend-unit$/);
  if (req.method === "POST" && recommendMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const incident = db.incidents.find((item) => item.id === recommendMatch[1]);
    if (!incident) return sendJson(res, 404, { error: "Incident not found" });
    const locationError = dispatchLocationError(incident);
    if (locationError) {
      addAuditLog(db, "dispatch_failed", user, incident.id, locationError);
      await writeDatabase(db);
      return sendJson(res, 409, { error: locationError });
    }
    const routed = await bestRoutedUnit(db, incident);
    if (routed.error) {
      addAuditLog(db, "dispatch_failed", user, incident.id, routed.error);
      await writeDatabase(db);
      return sendJson(res, routed.status || 503, { error: routed.error, degraded: routed.degraded || false, candidates: routed.candidates || [], excludedUnits: routed.excludedUnits || [], warnings: routed.warnings || [] });
    }
    if (!routed) {
      addAuditLog(db, "dispatch_failed", user, incident.id, "Route service unavailable");
      await writeDatabase(db);
      return sendJson(res, 503, { error: "Route service unavailable", degraded: true });
    }
    const { unit: nearest, route } = routed;
    incident.recommendedUnitId = nearest.id;
    incident.distanceKm = Number((route.distanceMeters / 1000).toFixed(2));
    incident.etaMinutes = Math.max(1, Math.round(routed.etaSeconds / 60));
    incident.routeLabel = route.routeLabel || route.label;
    incident.routeProvider = route.provider;
    incident.routeApproximate = Boolean(route.approximate);
    incident.routeCalculatedAt = route.calculatedAt;
    incident.routeSelectionReason = routed.selectionReason;
    const recommendEvent = addDispatchEvent(db, incident.id, "unit_recommended", `${nearest.unitCode} recommended with ${incident.etaMinutes} minute ETA`, user.name);
    const routeEvent = addDispatchEvent(db, incident.id, "route_calculated", `${incident.distanceKm} km route calculated via ${route.provider}`, user.name);
    const routeAudit = addAuditLog(db, "route_calculated", user, incident.id, `${incident.distanceKm} km, ${incident.etaMinutes} min${route.approximate ? "; approximate" : ""}`);
    const recommendAudit = addAuditLog(db, "unit_recommended", user, incident.id, nearest.unitCode);
    const suggestedAudit = addAuditLog(db, "unit_suggested", user, incident.id, routed.selectionReason || nearest.unitCode);
    await writeIncidentWorkflowRecords(db, incident, { units: [nearest], events: [recommendEvent, routeEvent], audits: [routeAudit, recommendAudit, suggestedAudit] });
    return sendJson(res, 200, {
      incident: incidentForResponse(db, incident),
      unit: unitForResponse(nearest),
      route,
      candidates: routed.candidates,
      excludedUnits: routed.excludedUnits,
      warnings: routed.warnings,
      selectionReason: routed.selectionReason
    });
  }

  const productAssignMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/assign-unit$/);
  const assignNearestMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/assign-nearest$/);
  if (req.method === "POST" && assignNearestMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const incident = db.incidents.find((item) => item.id === assignNearestMatch[1]);
    if (!incident) return sendJson(res, 404, { error: "Incident not found" });
    const locationError = dispatchLocationError(incident);
    if (locationError) {
      addAuditLog(db, "dispatch_failed", user, incident.id, locationError);
      await writeDatabase(db);
      return sendJson(res, 409, { error: locationError });
    }
    if (!["Verified", "Assigned"].includes(canonicalIncidentStatus(incident.status))) {
      return sendJson(res, 409, { error: "Verify the incident before assigning a response unit" });
    }
    const routed = await bestRoutedUnit(db, incident);
    if (routed.error) {
      addAuditLog(db, "dispatch_failed", user, incident.id, routed.error);
      await writeDatabase(db);
      return sendJson(res, routed.status || 503, { error: routed.error, degraded: routed.degraded || false, candidates: routed.candidates || [], excludedUnits: routed.excludedUnits || [], warnings: routed.warnings || [] });
    }
    if (!routed) {
      addAuditLog(db, "dispatch_failed", user, incident.id, "Route service unavailable");
      await writeDatabase(db);
      return sendJson(res, 503, { error: "Route service unavailable", degraded: true });
    }
    const { unit: nearest, route } = routed;
    incident.recommendedUnitId = nearest.id;
    incident.assignedUnitId = nearest.id;
    incident.status = "Assigned";
    incident.distanceKm = Number((route.distanceMeters / 1000).toFixed(2));
    incident.etaMinutes = Math.max(1, Math.round(routed.etaSeconds / 60));
    incident.routeLabel = route.routeLabel || route.label;
    incident.routeProvider = route.provider;
    incident.routeApproximate = Boolean(route.approximate);
    incident.routeCalculatedAt = route.calculatedAt;
    incident.routeSelectionReason = routed.selectionReason;
    incident.updatedAt = now();
    Object.assign(nearest, { status: "busy", assignedIncidentId: incident.id, currentIncidentId: incident.id, lastUpdated: incident.updatedAt });
    const linkedReport = syncLinkedCitizenReportStatus(db, incident);
    const event = addDispatchEvent(db, incident.id, "unit_assigned", `${nearest.unitCode} assigned with ${incident.etaMinutes} minute ${route.approximate ? "approximate " : ""}ETA`, user.name, incident.updatedAt);
    const suggestAudit = addAuditLog(db, "unit_suggested", user, incident.id, routed.selectionReason || nearest.unitCode, incident.updatedAt);
    const audit = addAuditLog(db, "unit_assigned", user, incident.id, `${nearest.unitCode}; ${incident.distanceKm} km; ${incident.etaMinutes} min${route.approximate ? "; approximate route" : ""}`, incident.updatedAt);
    await writeIncidentWorkflowRecords(db, incident, { units: [nearest], reports: [linkedReport], events: [event], audits: [suggestAudit, audit] });
    return sendJson(res, 200, {
      incident: incidentForResponse(db, incident),
      unit: unitForResponse(nearest),
      route,
      candidates: routed.candidates,
      excludedUnits: routed.excludedUnits,
      warnings: routed.warnings,
      selectionReason: routed.selectionReason
    });
  }

  if (req.method === "POST" && productAssignMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const incident = db.incidents.find((item) => item.id === productAssignMatch[1]);
    if (!incident) return sendJson(res, 404, { error: "Incident not found" });
    const locationError = dispatchLocationError(incident);
    if (locationError) {
      addAuditLog(db, "dispatch_failed", user, incident.id, locationError);
      await writeDatabase(db);
      return sendJson(res, 409, { error: locationError });
    }
    if (!["Verified", "Assigned"].includes(canonicalIncidentStatus(incident.status))) {
      return sendJson(res, 409, { error: "Verify the incident before assigning a response unit" });
    }
    const unitId = body.unitId || incident.recommendedUnitId;
    const unit = db.responseUnits.find((item) => item.id === unitId);
    if (!unit) return sendJson(res, 400, { error: "Recommend or select a valid response unit first" });
    if (!normalizeResponseUnitRecord(unit).operational) return sendJson(res, 409, { error: `${unit.unitCode} is not operational` });
    if (!isPoliceResponseUnit(unit)) return sendJson(res, 400, { error: "Select an available police unit" });
    if (unit.status !== "available" && unit.assignedIncidentId !== incident.id) return sendJson(res, 409, { error: `${unit.unitCode} is not available` });
    const freshness = unitLocationFreshness(unit);
    if (!freshness.eligible && !isDemoPatrolUnit(unit) && body.overrideStale !== true) {
      return sendJson(res, 409, { error: `${unit.unitCode} location is ${freshness.label.toLowerCase()}. Manual override confirmation is required.`, requiresOverride: true });
    }
    const route = strictPoint(unit)
      ? await routeBetween(routeUrl(strictPoint(unit), strictPoint(incident)))
      : null;
    if (incident.assignedUnitId && incident.assignedUnitId !== unit.id) {
      const previous = db.responseUnits.find((item) => item.id === incident.assignedUnitId);
      if (previous) Object.assign(previous, { status: "available", assignedIncidentId: null, currentIncidentId: null, lastUpdated: now() });
    }
    incident.assignedUnitId = unit.id;
    incident.recommendedUnitId = incident.recommendedUnitId || unit.id;
    incident.status = "Assigned";
    if (route) {
      incident.distanceKm = Number((route.distanceMeters / 1000).toFixed(2));
      incident.etaMinutes = Math.max(1, Math.round((route.durationSeconds || approximateRouteDurationSeconds(route.distanceMeters)) / 60));
      incident.routeLabel = route.routeLabel || route.label;
      incident.routeProvider = route.provider;
      incident.routeApproximate = Boolean(route.approximate);
      incident.routeCalculatedAt = route.calculatedAt;
      incident.routeSelectionReason = `Selected manually; route calculated for ${unit.unitCode}.`;
    }
    incident.updatedAt = now();
    Object.assign(unit, { status: "busy", assignedIncidentId: incident.id, currentIncidentId: incident.id, lastUpdated: incident.updatedAt });
    const linkedReport = syncLinkedCitizenReportStatus(db, incident);
    const statusEvent = addDispatchEvent(db, incident.id, "status_updated", "Incident status changed to Assigned", user.name);
    const assignEvent = addDispatchEvent(db, incident.id, "unit_assigned", `${unit.unitCode} assigned to ${incident.title}`, user.name);
    const audit = addAuditLog(db, "unit_assigned", user, incident.id, unit.unitCode);
    const overrideAudit = body.unitId ? addAuditLog(db, "manual_unit_override", user, incident.id, `${unit.unitCode}: ${incident.title}`) : null;
    await writeIncidentWorkflowRecords(db, incident, { units: [unit], reports: [linkedReport], events: [statusEvent, assignEvent], audits: [audit, overrideAudit] });
    return sendJson(res, 200, { incident: incidentForResponse(db, incident), unit: unitForResponse(unit), route });
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
    incident.updatedAt = closedAt;
    const unit = db.responseUnits.find((item) => item.id === incident.assignedUnitId);
    if (unit) Object.assign(unit, { status: "available", assignedIncidentId: null, currentIncidentId: null, lastUpdated: closedAt });
    db.alerts.filter((alert) => alert.incidentId === incident.id).forEach((alert) => { alert.status = "Closed"; });
    syncLinkedCitizenReportStatus(db, incident);
    addDispatchEvent(db, incident.id, "incident_closed", `${incident.title} closed${unit ? `; ${unit.unitCode} released` : ""}`, user.name, closedAt);
    addAuditLog(db, "incident_closed", user, incident.id, unit ? `${unit.unitCode} released` : "", closedAt);
    await writeDatabase(db);
    return sendJson(res, 200, { incident: incidentForResponse(db, incident), releasedUnit: unit || null });
  }

  const cameraConfigMatch = url.pathname.match(/^\/api\/camera-sources\/([^/]+)\/config$/);
  if (req.method === "PATCH" && cameraConfigMatch) {
    if (!authorizeRole(res, user, ["Admin"])) return;
    const source = db.cameraSources.find((item) => item.id === cameraConfigMatch[1]);
    if (!source) return sendJson(res, 404, { error: "Camera source not found" });
    if (isDemoCameraSource(source)) return sendJson(res, 400, { error: "Demo camera feeds cannot be converted into real CCTV configuration" });
    Object.assign(source, safeCameraConfigBody(body, source));
    db.auditLogs.unshift({ id: uid("aud"), actorName: user.name, actorRole: user.role, action: "updated_camera_source_config", timestamp: now() });
    await writeDatabase(db);
    return sendJson(res, 200, { source: cameraSourceForResponse(db, source) });
  }

  const cameraTestMatch = url.pathname.match(/^\/api\/camera-sources\/([^/]+)\/test$/);
  if (req.method === "POST" && cameraTestMatch) {
    if (!authorizeRole(res, user, ["Police Officer", "Admin"])) return;
    const source = db.cameraSources.find((item) => item.id === cameraTestMatch[1]);
    if (!source) return sendJson(res, 404, { error: "Camera source not found" });
    const isDemo = isDemoCameraSource(source);
    const ok = isDemo || cameraHasStreamConfig(source);
    const testedAt = now();
    source.lastTestedAt = testedAt;
    source.lastCheckedAt = testedAt;
    source.lastTestStatus = isDemo ? "demo_simulated" : ok ? "configured" : "not_configured";
    source.lastFrameStatus = isDemo ? "simulated demo frame available" : ok ? "snapshot unavailable; stream proxy required" : "no stream configuration";
    source.healthReason = isDemo
      ? "Demo camera is simulated and not connected to a production CCTV system"
      : ok
        ? "Stream URL is stored backend-side. Configure an HLS/WebRTC/MJPEG proxy before browser playback."
        : "No backend stream URL configured";
    db.auditLogs.unshift({ id: uid("aud"), actorName: user.name, actorRole: user.role, action: "tested_camera_source_connection", timestamp: now() });
    await writeDatabase(db);
    return sendJson(res, 200, {
      ok,
      mode: isDemo ? "demo-simulated" : ok ? "configured" : "not-configured",
      message: isDemo
        ? "Demo camera is simulated. No production CCTV connection was tested."
        : ok
          ? "Camera configuration exists backend-side. Stream proxy/transcoding is required for browser viewing."
          : "No stream URL is configured for this source.",
      source: cameraSourceForResponse(db, source)
    });
  }

  const cameraAnalyzeMatch = url.pathname.match(/^\/api\/camera-sources\/([^/]+)\/analyze$/);
  if (req.method === "POST" && cameraAnalyzeMatch) {
    if (!authorizeRole(res, user, ["Police Officer", "Admin"])) return;
    const source = db.cameraSources.find((item) => item.id === cameraAnalyzeMatch[1]);
    if (!source) return sendJson(res, 404, { error: "Camera source not found" });
    if (!isDemoCameraSource(source) && !source.aiEnabled) {
      return sendJson(res, 409, { error: "AI analysis is disabled for this camera" });
    }
    if (!isDemoCameraSource(source) && !source.latestSnapshotBase64) {
      return sendJson(res, 409, { error: "No safe snapshot is available. Configure a backend stream proxy/transcoder before analysis." });
    }
    const createdAt = now();
    const alert = {
      id: uid("alt"),
      incidentId: null,
      linkedIncidentId: null,
      title: isDemoCameraSource(source) ? "Demo AI observation sample" : "Possible camera detection requires review",
      message: isDemoCameraSource(source)
        ? "Demo camera sample only. Human review can inspect workflow behavior."
        : "Possible detection from authorized camera snapshot. Human verification required.",
      threatType: "ai_observation",
      severity: "low",
      source: isDemoCameraSource(source) ? "demo_seed" : "ai_observation",
      sourceType: isDemoCameraSource(source) ? "demo_seed" : source.type,
      sourceId: source.id,
      sourceName: source.name,
      zone: source.zone || source.location || "Unassigned",
      confidence: null,
      occurrenceCount: 1,
      status: "Pending Review",
      reviewStatus: "pending_review",
      verificationStatus: "human_verification_required",
      acknowledged: false,
      actionable: false,
      operationalAlert: false,
      alertClassification: "observation",
      isDemo: isDemoCameraSource(source),
      createdBy: "system",
      createdByRole: "System/AI",
      createdAt,
      lastDetectedAt: createdAt
    };
    db.alerts.unshift(alert);
    db.detections = [{
      id: uid("det"),
      sourceId: source.id,
      sourceType: alert.sourceType,
      sourceName: source.name,
      zone: alert.zone,
      timestamp: createdAt,
      configured: !isDemoCameraSource(source),
      threatDetected: false,
      threatType: "ai_observation",
      actionable: false,
      alertClassification: "observation",
      message: alert.message,
      duplicateSuppressed: false
    }, ...(db.detections || [])].slice(0, 100);
    db.auditLogs.unshift({ id: uid("aud"), actorName: user.name, actorRole: user.role, action: "camera_snapshot_analyzed", details: source.id, timestamp: createdAt });
    await writeDatabase(db);
    return sendJson(res, 200, { alert: alertForResponse(db, alert), incident: null, source: cameraSourceForResponse(db, source) });
  }

  const cameraDeleteMatch = url.pathname.match(/^\/api\/camera-sources\/([^/]+)$/);
  if (req.method === "DELETE" && cameraDeleteMatch) {
    if (!authorizeRole(res, user, ["Admin"])) return;
    const source = db.cameraSources.find((item) => item.id === cameraDeleteMatch[1]);
    if (!source) return sendJson(res, 404, { error: "Camera source not found" });
    if (isDemoCameraSource(source)) return sendJson(res, 400, { error: "Demo seed cameras cannot be deleted from the registry" });
    db.cameraSources = db.cameraSources.filter((item) => item.id !== source.id);
    db.auditLogs.unshift({ id: uid("aud"), actorName: user.name, actorRole: user.role, action: "deleted_camera_source_config", details: source.id, timestamp: now() });
    await writeDatabase(db);
    return sendJson(res, 200, { ok: true });
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
    db.auditLogs.unshift({ id: uid("aud"), actorName: user.name, actorRole: user.role, action: `cleared_${cleared}_incident_history`, timestamp: now() });
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
      locationSource: normalizeLocationSource(body.locationSource, { hasPoint: Boolean(strictPoint(body)) }),
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
    let evidenceRecord = null;
    if (evidence) {
      try {
        evidenceRecord = createVideoEvidenceRecord(db, {
          image: evidence,
          fileName: imageName || `${report.id}-evidence`,
          fileSize: Buffer.byteLength(evidence)
        }, user, {
          source: "citizen_evidence",
          linkedReport: report,
          allowImages: true
        });
        report.evidenceId = evidenceRecord.id;
      } catch {
        evidenceRecord = null;
      }
    }
    db.reports.unshift(report);
    if (evidenceRecord) db.videoEvidence.unshift(evidenceRecord);
    addAuditLog(db, "citizen_report_submitted", user, null, `${reportType}: ${report.name}`, report.createdAt);
    await writeDatabase(db);
    return sendJson(res, 201, user.role === "Citizen"
      ? { report: citizenReportForResponse(db, report), message: "Submitted for review" }
      : { report, message: "Submitted for review" });
  }

  if (req.method === "POST" && url.pathname === "/api/send-alert") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const location = strictPoint(body.location || body);
    const locationSource = normalizeLocationSource(body.locationSource || body.location?.locationSource, { hasPoint: Boolean(location) });
    const createdAt = now();
    const alert = {
      id: uid("alt"),
      incidentId: body.incidentId || null,
      linkedIncidentId: body.incidentId || null,
      title: body.message || body.title || "Command center alert",
      threatType: body.type || "manual_alert",
      severity: body.severity || "critical",
      source: "manual_alert",
      isDemo: false,
      actionable: true,
      sourceType: "manual",
      sourceName: user.name,
      zone: body.zone || "All Zones",
      lat: location?.lat ?? null,
      lng: location?.lng ?? null,
      locationSource,
      confidence: 0,
      occurrenceCount: 1,
      status: "New",
      acknowledged: false,
      verificationStatus: "unreviewed",
      createdBy: user.id,
      createdByRole: user.role,
      createdAt,
      lastDetectedAt: createdAt
    };
    db.alerts.unshift(alert);
    if (alert.incidentId) addDispatchEvent(db, alert.incidentId, "alert_created", alert.title, user.name, createdAt);
    addAuditLog(db, "alert_created", user, alert.incidentId, alert.title, createdAt);
    await writeDatabase(db);
    return sendJson(res, 201, { alert: alertForResponse(db, alert), delivery: await sendFirebaseNotification(alert) });
  }

  if (req.method === "PATCH" && url.pathname === "/api/alerts/clear") {
    if (!hasRole(user, ["Admin"])) return forbidden(res);
    const clearedAt = now();
    let cleared = 0;
    db.alerts.forEach((alert) => {
      if (alert.status !== "closed") {
        alert.status = "closed";
        alert.closedAt = clearedAt;
        cleared += 1;
      }
    });
    db.auditLogs.unshift({ id: uid("aud"), actorName: user.name, actorRole: user.role, action: `cleared_${cleared}_alerts`, timestamp: clearedAt });
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
      alert.acknowledgedBy = normalizeAcknowledgements(alert);
      alert.acknowledgedBy.push({ userId: user.id, name: user.name, role: user.role, acknowledgedAt: alert.acknowledgedAt });
      if (alert.incidentId) addDispatchEvent(db, alert.incidentId, "alert_acknowledged", `${alert.title} acknowledged by ${user.name}`, user.name);
      addAuditLog(db, "alert_acknowledged", user, alert.incidentId, alert.id);
    }
    await writeDatabase(db);
    return sendJson(res, 200, { alert: alertForResponse(db, alert) });
  }

  const assignMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/assign-unit$/);
  if (req.method === "PATCH" && assignMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const incident = db.incidents.find((i) => i.id === assignMatch[1]);
    if (!incident) return sendJson(res, 404, { error: "Not found" });
    if (!["Verified", "Assigned"].includes(canonicalIncidentStatus(incident.status))) {
      return sendJson(res, 409, { error: "Verify the incident before assigning a response unit" });
    }
    const locationError = dispatchLocationError(incident);
    if (locationError) return sendJson(res, 409, { error: locationError });
    const unit = db.responseUnits.find((item) => item.id === body.unitId || item.unitCode === body.assignedUnit)
      || db.responseUnits.find((item) => item.id === incident.recommendedUnitId);
    if (!unit) return sendJson(res, 400, { error: "Recommend or select a valid response unit first" });
    if (!isPoliceResponseUnit(unit)) return sendJson(res, 400, { error: "Select an available police unit" });
    if (unit.status !== "available" && unit.assignedIncidentId !== incident.id) return sendJson(res, 409, { error: `${unit.unitCode} is not available` });
    const freshness = unitLocationFreshness(unit);
    if (!freshness.eligible && !isDemoPatrolUnit(unit) && body.overrideStale !== true) {
      return sendJson(res, 409, { error: `${unit.unitCode} location is ${freshness.label.toLowerCase()}. Manual override confirmation is required.`, requiresOverride: true });
    }
    incident.status = "Assigned";
    incident.assignedUnitId = unit.id;
    incident.updatedAt = now();
    Object.assign(unit, { status: "busy", assignedIncidentId: incident.id, currentIncidentId: incident.id, lastUpdated: incident.updatedAt });
    const linkedReport = syncLinkedCitizenReportStatus(db, incident);
    const event = addDispatchEvent(db, incident.id, "unit_assigned", `${unit.unitCode} assigned to ${incident.title}`, user.name);
    const audit = addAuditLog(db, "unit_assigned", user, incident.id, unit.unitCode);
    await writeIncidentWorkflowRecords(db, incident, { units: [unit], reports: [linkedReport], events: [event], audits: [audit] });
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
    if (["Assigned", "En Route", "On Scene"].includes(nextStatus)) {
      const locationError = dispatchLocationError(incident);
      if (locationError) return sendJson(res, 409, { error: locationError });
    }
    if (["Assigned", "En Route", "On Scene"].includes(nextStatus) && !incident.assignedUnitId) {
      return sendJson(res, 409, { error: "Assign a response unit before this status" });
    }
    const changedAt = now();
    const changedEvents = [];
    const changedAudits = [];
    const changedAlerts = [];
    const changedUnits = [];
    incident.status = nextStatus;
    incident.updatedAt = changedAt;
    const linkedReport = syncLinkedCitizenReportStatus(db, incident);
    const assignedUnit = db.responseUnits.find((item) => item.id === incident.assignedUnitId);
    if (["Assigned", "En Route", "On Scene"].includes(nextStatus) && assignedUnit) {
      assignedUnit.status = "busy";
      assignedUnit.assignedIncidentId = incident.id;
      assignedUnit.currentIncidentId = incident.id;
      assignedUnit.lastUpdated = changedAt;
      changedUnits.push(assignedUnit);
    }
    if (nextStatus === "Resolved") {
      incident.resolvedAt = changedAt;
      changedAudits.push(addAuditLog(db, "incident_resolved", user, incident.id, incident.title, changedAt));
    }
    if (nextStatus === "Rejected / False Alarm") {
      const reason = String(body.reason || "Marked as false alarm by operator").trim().slice(0, 300);
      incident.rejectedAt = changedAt;
      incident.rejectionReason = reason;
      changedAudits.push(addAuditLog(db, "false_alarm_rejected", user, incident.id, reason, changedAt));
    }
    if (["Closed", "Rejected / False Alarm"].includes(nextStatus)) {
      const closedAt = changedAt;
      incident.closedAt = closedAt;
      const unit = assignedUnit;
      if (unit) {
        Object.assign(unit, { status: "available", assignedIncidentId: null, currentIncidentId: null, lastUpdated: closedAt });
        changedUnits.push(unit);
      }
      db.alerts
        .filter((alert) => alert.incidentId === incident.id)
        .forEach((alert) => {
          alert.status = nextStatus === "Rejected / False Alarm" ? "False Alarm" : "Closed";
          alert.reviewStatus = nextStatus === "Rejected / False Alarm" ? "false_alarm" : alert.reviewStatus;
          if (nextStatus === "Rejected / False Alarm") alert.rejectionReason = incident.rejectionReason || "Marked as false alarm by operator";
          alert.closedAt = closedAt;
          changedAlerts.push(alert);
        });
    }
    changedEvents.push(addDispatchEvent(db, incident.id, "status_updated", `Incident status changed to ${nextStatus}`, user.name));
    changedAudits.push(addAuditLog(db, "incident_status_changed", user, incident.id, nextStatus));
    if (nextStatus === "Verified") changedAudits.push(addAuditLog(db, "incident_verified", user, incident.id, incident.title, changedAt));
    if (nextStatus === "Closed") changedAudits.push(addAuditLog(db, "incident_closed", user, incident.id, incident.title, changedAt));
    await writeIncidentWorkflowRecords(db, incident, {
      units: changedUnits,
      alerts: changedAlerts,
      reports: [linkedReport],
      events: changedEvents,
      audits: changedAudits
    });
    return sendJson(res, 200, {
      incident: incidentForResponse(db, incident),
      message: nextStatus === "Rejected / False Alarm" ? "Incident marked as false alarm" : "Incident status updated"
    });
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
  repairLegacyPersistedData,
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
