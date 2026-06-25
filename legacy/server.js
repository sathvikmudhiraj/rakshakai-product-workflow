const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = __dirname;
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
const port = Number(process.env.PORT || 4173);
const dataDir = path.join(root, "data");
const dbPath = path.join(dataDir, "db.json");
const sessions = new Map();

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
      { id: "u_police", name: "Inspector Kavya Rao", email: "police@rakshakai.local", role: "Police Officer", password: "demo123" },
      { id: "u_admin", name: "Admin Control Room", email: "admin@rakshakai.local", role: "Admin", password: "demo123" },
      { id: "u_citizen", name: "Citizen Reporter", email: "citizen@rakshakai.local", role: "Citizen", password: "demo123" }
    ],
    cameras: [
      { id: "cam_c19", cameraId: "C-19", name: "C-19 Red Zone", zone: "Red Zone", health: "online", aiStatus: "Face match 91%", density: 68, scene: "cctv-red-zone.svg" },
      { id: "cam_c12", cameraId: "C-12", name: "C-12 Gate A", zone: "Gate A", health: "online", aiStatus: "Crowd 74%", density: 74, scene: "cctv-gate-a.svg" },
      { id: "cam_c27", cameraId: "C-27", name: "C-27 Exit", zone: "Exit Corridor", health: "online", aiStatus: "Normal", density: 42, scene: "cctv-exit.svg" },
      { id: "cam_d03", cameraId: "D-03", name: "D-03 Drone", zone: "Transit Hub", health: "warning", aiStatus: "Motion spike", density: 57, scene: "cctv-drone.svg" },
      { id: "cam_c05", cameraId: "C-05", name: "C-05 Parking", zone: "Parking", health: "offline", aiStatus: "Stream disconnected", density: 0, scene: "cctv-parking.svg" }
    ],
    cameraSources: [
      { id: "cam_c19", type: "cctv", name: "C-19 Red Zone", zone: "Red Zone", status: "demo", rtspUrl: "", enabled: true },
      { id: "cam_c12", type: "cctv", name: "C-12 Gate A", zone: "Gate A", status: "demo", rtspUrl: "", enabled: true },
      { id: "cam_c27", type: "cctv", name: "C-27 Exit", zone: "Exit Corridor", status: "demo", rtspUrl: "", enabled: true },
      { id: "cam_d03", type: "cctv", name: "D-03 Drone", zone: "Transit Hub", status: "demo", rtspUrl: "", enabled: true },
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
    reports: [
      { id: "mp_aarav", name: "Aarav Sharma", age: 8, lastSeenLocation: "Gate A, Sector 7", status: "possible_match", matchConfidence: 91, matchedCameraId: "C-19", createdAt: t }
    ],
    incidents: [
      {
        id: "inc_missing",
        type: "Missing child possible match",
        severity: "critical",
        priority: "P1",
        zone: "Red Zone",
        source: "AI face match from CCTV C-19",
        status: "assigned",
        assignedUnit: "P-04",
        recommendedUnit: "P-04",
        etaMinutes: 4,
        recommendedAction: "Verify identity, hold camera lock, and create a soft cordon.",
        location: { lat: 28.6139, lng: 77.2295 },
        unitLocation: { lat: 28.6281, lng: 77.2186 },
        timeline: ["Citizen report received", "AI embedding matched", "Police unit P-04 assigned"],
        openedAt: t
      },
      {
        id: "inc_crowd",
        type: "Crowd surge at main entry",
        severity: "high",
        priority: "P1",
        zone: "Main Entry",
        source: "Crowd heatmap threshold",
        status: "open",
        assignedUnit: null,
        recommendedUnit: "P-02",
        etaMinutes: 3,
        recommendedAction: "Pause incoming footfall, open diversion lane, and deploy crowd marshals.",
        location: { lat: 28.6164, lng: 77.2257 },
        unitLocation: { lat: 28.6196, lng: 77.2189 },
        timeline: ["Density crossed 82%", "Flow direction conflict detected", "Recommended diversion lane opened"],
        openedAt: t
      },
      {
        id: "inc_medical",
        type: "Medical SOS near food court",
        severity: "medium",
        priority: "P2",
        zone: "Food Court",
        source: "Citizen SOS app",
        status: "open",
        assignedUnit: "M-02",
        recommendedUnit: "M-02",
        etaMinutes: 5,
        recommendedAction: "Move stretcher team, clear pedestrian path, and notify medical desk.",
        location: { lat: 28.6108, lng: 77.2266 },
        unitLocation: { lat: 28.6087, lng: 77.2323 },
        timeline: ["Citizen SOS received", "Medical response team M-02 assigned"],
        openedAt: t
      }
    ],
    alerts: [
      { id: "a1", type: "Missing Person", severity: "critical", zone: "Red Zone", status: "assigned", assignedUnit: "P-04", message: "Missing child possible match near Camera C-19", timestamp: t },
      { id: "a2", type: "Crowd", severity: "high", zone: "Gate A", status: "open", assignedUnit: null, message: "Gate A density above threshold", timestamp: t }
    ],
    devices: [
      { id: "d1", name: "Camera C-19", type: "CCTV", status: "online", zone: "Red Zone", latencyMs: 210 },
      { id: "d2", name: "Drone D-03", type: "Drone", status: "warning", zone: "Transit Hub", latencyMs: 380 },
      { id: "d3", name: "Camera C-05", type: "CCTV", status: "offline", zone: "Parking", latencyMs: null }
    ],
    auditLogs: [
      { id: "aud_1", actorName: "RakshakAI Engine", action: "seeded_demo_event", timestamp: t }
    ]
  };
}

function ensureDb() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify(seedDb(), null, 2));
}

function readDb() {
  ensureDb();
  const db = ensureCameraSourceShape(JSON.parse(fs.readFileSync(dbPath, "utf8").replace(/^\uFEFF/, "")));
  return db;
}

function writeDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function ensureCameraSourceShape(db) {
  db.cameraSources = Array.isArray(db.cameraSources) ? db.cameraSources : [];
  db.detections = Array.isArray(db.detections) ? db.detections : [];
  const sourceById = new Map(db.cameraSources.map((source) => [source.id, source]));
  (db.cameras || []).forEach((camera) => {
    if (!sourceById.has(camera.id)) {
      db.cameraSources.push({
        id: camera.id,
        type: "cctv",
        name: camera.name,
        zone: camera.zone,
        status: camera.health === "offline" ? "offline" : "demo",
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
  return db;
}

function sendJson(res, code, payload, headers = {}) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(payload));
}

function getBody(req) {
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
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => {
        const i = x.indexOf("=");
        return [x.slice(0, i), decodeURIComponent(x.slice(i + 1))];
      })
  );
}

function userFromReq(req, db) {
  const bearer = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer || cookies(req).rakshakai_session;
  const session = sessions.get(token);
  return db.users.find((u) => u.id === session?.userId) || null;
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
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
  return sendJson(res, 403, { error: "You do not have permission for this action" });
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
  return "Demo Feed";
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
    const detections = db.detections.filter((item) => item.sourceId === source.id || item.sourceName === source.name);
    const latestDetection = detections[0] || null;
    const relatedAlerts = db.alerts.filter((alert) => alert.sourceId === source.id || alert.sourceName === source.name || alert.message.includes(source.name));
    const incidentCount = db.incidents.filter((incident) => incident.sourceId === source.id || incident.sourceName === source.name || incident.source === source.name).length;
    return {
      ...source,
      statusLabel: sourceStatusLabel(source),
      latestDetection,
      latestAlertTime: relatedAlerts[0]?.timestamp || null,
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
      sourceStatus: source?.status || (camera.health === "offline" ? "offline" : "demo"),
      sourceStatusLabel: sourceStatusLabel(source || { status: camera.health === "offline" ? "offline" : "demo" }),
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
  const mongoUri = envValue("MONGODB_URI");
  const firebaseKey = envValue("FIREBASE_SERVER_KEY") || envValue("FIREBASE_SERVICE_ACCOUNT");
  const jwtSecret = envValue("JWT_SECRET") || envValue("SESSION_SECRET");
  const osrmBaseUrl = envValue("OSRM_BASE_URL") || "https://router.project-osrm.org";
  return [
    { id: "rtsp", name: "Real CCTV RTSP Streams", configured: rtsp.length > 0, detail: rtsp.length ? `${rtsp.length} stream(s) configured` : "Set RTSP_CAMERA_URLS in .env" },
    { id: "ai", name: "Python OpenCV / DeepFace AI Service", configured: Boolean(aiServiceUrl), detail: aiServiceUrl ? `Connected to ${aiServiceUrl}` : "Set AI_SERVICE_URL, then run real-product/ai-service" },
    { id: "mongo", name: "MongoDB Atlas Database", configured: Boolean(mongoUri), detail: mongoUri ? `Atlas URI ${maskSecret(mongoUri)}` : "Set MONGODB_URI; local JSON fallback is active" },
    { id: "firebase", name: "Firebase Push Notifications", configured: Boolean(firebaseKey), detail: firebaseKey ? "Firebase credentials configured" : "Set FIREBASE_SERVER_KEY or FIREBASE_SERVICE_ACCOUNT" },
    { id: "deployment", name: "Vercel / Render Deployment", configured: Boolean(envValue("VERCEL_URL") || envValue("RENDER_EXTERNAL_URL")), detail: envValue("VERCEL_URL") || envValue("RENDER_EXTERNAL_URL") || "Ready to deploy with provided env vars" },
    { id: "auth", name: "Production Authentication", configured: Boolean(jwtSecret), detail: jwtSecret ? "Session/JWT secret configured" : "Demo login active; set JWT_SECRET for production" },
    { id: "routing", name: "Police Route Assignment", configured: true, detail: `Route engine: ${osrmBaseUrl}` }
  ];
}

const INCIDENT_SCENARIOS = [
  {
    type: "Missing child possible match",
    alertType: "Missing Person",
    severity: "critical",
    priority: "P1",
    zone: "Red Zone",
    source: "AI face match from CCTV C-19",
    recommendedUnit: "P-04",
    etaMinutes: 4,
    recommendedAction: "Verify identity, hold camera lock, and create a soft cordon.",
    location: { lat: 28.6139, lng: 77.2295 },
    unitLocation: { lat: 28.6281, lng: 77.2186 },
    timeline: ["Citizen report linked to face embedding", "CCTV C-19 returned 91% possible match", "Nearest police unit calculated: P-04"]
  },
  {
    type: "Crowd surge at main entry",
    alertType: "Crowd",
    severity: "high",
    priority: "P1",
    zone: "Main Entry",
    source: "Crowd heatmap threshold",
    recommendedUnit: "P-02",
    etaMinutes: 3,
    recommendedAction: "Pause incoming footfall, open diversion lane, and deploy crowd marshals.",
    location: { lat: 28.6164, lng: 77.2257 },
    unitLocation: { lat: 28.6196, lng: 77.2189 },
    timeline: ["Density crossed 82%", "Flow direction conflict detected", "Recommended diversion lane opened"]
  },
  {
    type: "Medical SOS near food court",
    alertType: "Medical",
    severity: "medium",
    priority: "P2",
    zone: "Food Court",
    source: "Citizen SOS app",
    recommendedUnit: "M-02",
    etaMinutes: 5,
    recommendedAction: "Move stretcher team, clear pedestrian path, and notify medical desk.",
    location: { lat: 28.6108, lng: 77.2266 },
    unitLocation: { lat: 28.6087, lng: 77.2323 },
    timeline: ["Citizen SOS received", "Caller location matched to food court", "Medical response team M-02 recommended"]
  },
  {
    type: "Unattended bag detected",
    alertType: "Security",
    severity: "high",
    priority: "P1",
    zone: "Parking Zone B",
    source: "CCTV C-05 object detection",
    recommendedUnit: "BDS-01",
    etaMinutes: 7,
    recommendedAction: "Create 50m cordon, hold nearby movement, and send bomb detection squad.",
    location: { lat: 28.6205, lng: 77.2325 },
    unitLocation: { lat: 28.6269, lng: 77.2235 },
    timeline: ["Static object detected for 8 minutes", "Owner not visible in recent frames", "Bomb detection squad BDS-01 recommended"]
  },
  {
    type: "Lost elderly person assistance",
    alertType: "Citizen Help",
    severity: "high",
    priority: "P2",
    zone: "Help Desk Corridor",
    source: "Help desk call and CCTV replay",
    recommendedUnit: "P-03",
    etaMinutes: 4,
    recommendedAction: "Search last-seen corridor, notify help desks, and keep public announcement ready.",
    location: { lat: 28.6118, lng: 77.2344 },
    unitLocation: { lat: 28.6152, lng: 77.2381 },
    timeline: ["Help desk report received", "Last movement found on corridor camera", "Patrol unit P-03 recommended"]
  },
  {
    type: "Exit bottleneck at transit hub",
    alertType: "Traffic",
    severity: "high",
    priority: "P1",
    zone: "Transit Hub",
    source: "Drone D-03 aerial scan",
    recommendedUnit: "P-06",
    etaMinutes: 6,
    recommendedAction: "Reverse one pedestrian lane, hold vehicle entry, and send traffic support.",
    location: { lat: 28.6079, lng: 77.2215 },
    unitLocation: { lat: 28.6028, lng: 77.2261 },
    timeline: ["Drone D-03 detected exit queue", "Average movement dropped below 0.4 m/s", "Traffic unit P-06 recommended"]
  }
];

function nextIncidentScenario(db, body = {}) {
  const requestedIndex = Number(body.scenarioIndex);
  const rawIndex = Number.isInteger(requestedIndex) ? requestedIndex : db.incidents.length;
  const scenarioIndex = ((rawIndex % INCIDENT_SCENARIOS.length) + INCIDENT_SCENARIOS.length) % INCIDENT_SCENARIOS.length;
  const base = INCIDENT_SCENARIOS[scenarioIndex];
  return {
    ...base,
    type: body.type || base.type,
    severity: body.severity || base.severity,
    zone: body.zone || base.zone,
    priority: body.priority || base.priority,
    source: body.source || base.source,
    recommendedUnit: body.recommendedUnit || base.recommendedUnit,
    etaMinutes: Number(body.etaMinutes || base.etaMinutes),
    recommendedAction: body.recommendedAction || base.recommendedAction,
    location: body.location || base.location,
    unitLocation: body.unitLocation || base.unitLocation,
    timeline: Array.isArray(body.timeline) && body.timeline.length ? body.timeline : base.timeline
  };
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

async function runRealAiScan(report, cameras) {
  const aiServiceUrl = envValue("AI_SERVICE_URL");
  if (!aiServiceUrl) return null;
  return callJson(`${aiServiceUrl.replace(/\/$/, "")}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ report, cameras })
  });
}

function normalizedDetectionResult(result) {
  const threatDetected = Boolean(result?.threatDetected || result?.threat || result?.detected);
  const confidence = Number(result?.confidence || result?.score || (threatDetected ? 0.87 : 0));
  return {
    threatDetected,
    threatType: threatDetected ? String(result?.threatType || result?.type || "suspicious_activity") : null,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence > 1 ? confidence / 100 : confidence)) : 0,
    message: threatDetected ? String(result?.message || "Suspicious activity detected") : "No threat detected"
  };
}

async function analyzeFrameWithAi(payload) {
  const aiServiceUrl = envValue("AI_SERVICE_URL");
  if (aiServiceUrl) {
    try {
      const result = await callJson(`${aiServiceUrl.replace(/\/$/, "")}/analyze-frame`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      return { ...normalizedDetectionResult(result), mode: "real-service" };
    } catch (error) {
      return { ...normalizedDetectionResult({ threatDetected: false }), configured: true, mode: "service-unavailable", error: error.message };
    }
  }
  return {
    ...normalizedDetectionResult({ threatDetected: false }),
    configured: false,
    mode: "not-configured",
    message: "AI service is not connected"
  };
}

function severityForThreat(threatType, confidence) {
  if (threatType === "weapon" || confidence >= 0.9) return "critical";
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.55) return "medium";
  return "low";
}

function createAiIncident(db, detection, payload) {
  const severity = severityForThreat(detection.threatType, detection.confidence);
  const sourceName = String(payload.sourceName || "Camera Source").slice(0, 120);
  const sourceType = String(payload.sourceType || "phone_camera");
  const source = db.cameraSources.find((item) => item.type === sourceType && item.name === sourceName) || db.cameraSources.find((item) => item.type === sourceType);
  const timestamp = payload.timestamp || now();
  const incident = {
    id: uid("inc"),
    type: detection.threatType || "suspicious_activity",
    severity,
    priority: severity === "critical" || severity === "high" ? "P1" : "P2",
    zone: source?.zone || "Mobile Source",
    source: sourceName,
    sourceId: source?.id || null,
    sourceType,
    sourceName,
    threatType: detection.threatType,
    confidence: detection.confidence,
    status: "New",
    createdBy: "system_ai",
    assignedUnit: null,
    recommendedUnit: "P-04",
    etaMinutes: 4,
    recommendedAction: "Verify live source, dispatch nearest patrol, and preserve the frame for review.",
    location: { lat: 28.6139, lng: 77.2295 },
    unitLocation: { lat: 28.6281, lng: 77.2186 },
    timeline: [`AI detection received from ${sourceName}`, `${detection.threatType} confidence ${Math.round(detection.confidence * 100)}%`, "Incident opened by system_ai"],
    openedAt: timestamp,
    timestamp
  };
  const alert = {
    id: uid("alt"),
    type: "AI Vision",
    severity,
    zone: incident.zone,
    status: "open",
    assignedUnit: null,
    sourceId: incident.sourceId,
    sourceType,
    sourceName,
    message: `${detection.message} from ${sourceName}`,
    location: incident.location,
    timestamp
  };
  db.incidents.unshift(incident);
  db.alerts.unshift(alert);
  return { incident, alert };
}

async function sendFirebaseNotification(alert) {
  const key = envValue("FIREBASE_SERVER_KEY");
  if (!key) return { sent: false, mode: "demo" };
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
    distanceMeters: Math.round(distanceKm * 1000),
    durationSeconds: Math.round((distanceKm / 28) * 3600),
    coordinates: [
      [fromLng, fromLat],
      [toLng, toLat]
    ]
  };
}

async function routeBetween(url) {
  const fromLat = numberParam(url, "fromLat");
  const fromLng = numberParam(url, "fromLng");
  const toLat = numberParam(url, "toLat");
  const toLng = numberParam(url, "toLng");
  if ([fromLat, fromLng, toLat, toLng].some((value) => value === null)) throw new Error("Route coordinates required");
  const base = envValue("OSRM_BASE_URL") || "https://router.project-osrm.org";
  const pathUrl = `${base.replace(/\/$/, "")}/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
  try {
    const data = await callJson(pathUrl, {}, 4500);
    const route = data.routes?.[0];
    if (!route) throw new Error("No route found");
    return {
      provider: "osrm",
      distanceMeters: Math.round(route.distance),
      durationSeconds: Math.round(route.duration),
      coordinates: route.geometry?.coordinates || []
    };
  } catch (error) {
    return fallbackRoute(fromLat, fromLng, toLat, toLng);
  }
}

function summary(db) {
  const density = Math.round(db.zones.reduce((sum, z) => sum + z.currentDensity, 0) / db.zones.length);
  const sources = cameraSourcesForResponse(db);
  return {
    crowdDensity: density,
    crowdStatus: density >= 80 ? "Danger" : density >= 60 ? "Moderate" : "Safe",
    activeCameras: sources.filter((source) => source.enabled !== false).length,
    healthyCameras: camerasForResponse(db).filter((c) => c.health === "online").length,
    activeSources: sources.length,
    onlineSources: sources.filter((source) => ["online", "available", "ready", "demo"].includes(source.status)).length,
    openAlerts: db.alerts.filter((a) => a.status !== "closed").length,
    criticalAlerts: db.alerts.filter((a) => a.severity === "critical").length,
    responseUnits: 3,
    nearbyUnits: 3,
    activeIncidents: db.incidents.filter((i) => i.status !== "closed").length
  };
}

async function api(req, res, url) {
  const db = readDb();
  const user = userFromReq(req, db);
  const body = req.method === "GET" ? {} : await getBody(req);

  if (req.method === "GET" && url.pathname === "/api/health") return sendJson(res, 200, { ok: true, service: "RakshakAI Local API", timestamp: now() });
  if (req.method === "GET" && url.pathname === "/api/me") return sendJson(res, 200, { user: publicUser(user) });

  if (req.method === "POST" && url.pathname === "/api/login") {
    const email = normalizeEmail(body.email);
    const found = db.users.find((u) => normalizeEmail(u.email) === email && u.password === body.password);
    if (!found) return sendJson(res, 401, { error: "Invalid email or password" });
    const token = uid("sess");
    sessions.set(token, { userId: found.id });
    return sendJson(res, 200, { user: publicUser(found), sessionToken: token }, { "Set-Cookie": `rakshakai_session=${token}; Path=/; SameSite=Lax` });
  }

  if (req.method === "POST" && url.pathname === "/api/register") {
    const name = String(body.name || "").trim();
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const role = normalizeRole(body.role);
    if (name.length < 2) return sendJson(res, 400, { error: "Enter a valid name" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { error: "Enter a valid email" });
    if (password.length < 6) return sendJson(res, 400, { error: "Password must be at least 6 characters" });
    if (db.users.some((u) => normalizeEmail(u.email) === email)) return sendJson(res, 409, { error: "Email already registered. Please login." });
    const created = { id: uid("u"), name, email, role, password };
    db.users.push(created);
    db.auditLogs.unshift({ id: uid("aud"), actorName: name, action: `registered_${role.toLowerCase().replace(/\s+/g, "_")}`, timestamp: now() });
    writeDb(db);
    const token = uid("sess");
    sessions.set(token, { userId: created.id });
    return sendJson(res, 201, { user: publicUser(created), sessionToken: token }, { "Set-Cookie": `rakshakai_session=${token}; Path=/; SameSite=Lax` });
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const bearer = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
    sessions.delete(bearer || cookies(req).rakshakai_session);
    return sendJson(res, 200, { ok: true }, { "Set-Cookie": "rakshakai_session=; Path=/; Max-Age=0" });
  }

  if (req.method === "GET" && url.pathname === "/api/dashboard") return sendJson(res, 200, { summary: summary(db) });
  if (req.method === "GET" && url.pathname === "/api/camera-feeds") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    return sendJson(res, 200, { cameras: camerasForResponse(db) });
  }
  if (req.method === "GET" && url.pathname === "/api/camera-sources") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    return sendJson(res, 200, { sources: cameraSourcesForResponse(db) });
  }
  if (req.method === "GET" && url.pathname === "/api/zones") return sendJson(res, 200, { zones: db.zones });
  if (req.method === "GET" && url.pathname === "/api/reports") return sendJson(res, 200, { reports: db.reports });
  if (req.method === "GET" && url.pathname === "/api/alerts") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    return sendJson(res, 200, { alerts: db.alerts });
  }
  if (req.method === "GET" && url.pathname === "/api/incidents/live") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    return sendJson(res, 200, { incidents: db.incidents.filter((i) => i.status !== "closed") });
  }
  if (req.method === "GET" && url.pathname === "/api/devices/health") return sendJson(res, 200, { devices: db.devices });
  if (req.method === "GET" && url.pathname === "/api/audit-logs") return sendJson(res, 200, { auditLogs: db.auditLogs });
  if (req.method === "GET" && url.pathname === "/api/integrations/status") return sendJson(res, 200, { integrations: integrationStatus() });
  if (req.method === "GET" && url.pathname === "/api/route") {
    try {
      return sendJson(res, 200, { route: await routeBetween(url) });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (!user) return sendJson(res, 401, { error: "Authentication required" });

  const cameraConfigMatch = url.pathname.match(/^\/api\/camera-sources\/([^/]+)\/config$/);
  if (req.method === "PATCH" && cameraConfigMatch) {
    if (!hasRole(user, ["Admin"])) return forbidden(res);
    const source = db.cameraSources.find((item) => item.id === cameraConfigMatch[1]);
    if (!source) return sendJson(res, 404, { error: "Camera source not found" });
    if (source.type !== "cctv") return sendJson(res, 400, { error: "RTSP config is available for CCTV sources only" });
    const rtspUrl = String(body.rtspUrl || "").trim().slice(0, 400);
    source.rtspUrl = rtspUrl;
    source.status = rtspUrl ? "online" : source.status === "offline" ? "offline" : "demo";
    db.auditLogs.unshift({ id: uid("aud"), actorName: user.name, action: "updated_camera_source_config", timestamp: now() });
    writeDb(db);
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
    source.lastTestStatus = ok ? "configured" : "demo";
    db.auditLogs.unshift({ id: uid("aud"), actorName: user.name, action: "tested_camera_source_connection", timestamp: now() });
    writeDb(db);
    return sendJson(res, 200, { ok, mode: ok ? "config-only" : "demo-feed", message: ok ? "RTSP URL saved. Streaming gateway not enabled in this MVP." : "No RTSP URL set; demo feed remains active." });
  }

  if (req.method === "POST" && url.pathname === "/api/rakshak/analyze-frame") {
    if (!hasRole(user, ["Citizen", "Police Officer", "Admin"])) return forbidden(res);
    const allowedSources = ["phone_camera", "cctv", "upload"];
    const sourceType = String(body.sourceType || "").trim();
    const sourceName = String(body.sourceName || "").trim().slice(0, 120);
    const image = String(body.image || "");
    const timestamp = body.timestamp && !Number.isNaN(Date.parse(body.timestamp)) ? body.timestamp : now();
    if (!allowedSources.includes(sourceType)) return sendJson(res, 400, { error: "Invalid sourceType" });
    if (user.role === "Citizen" && (sourceType !== "phone_camera" || body.sosMode !== true)) {
      return sendJson(res, 403, { error: "Citizens can only share phone camera frames during SOS mode" });
    }
    if (!sourceName) return sendJson(res, 400, { error: "sourceName is required" });
    if (!image.startsWith("data:image/") || image.length > 1200000) return sendJson(res, 400, { error: "Valid base64 image frame is required" });
    const payload = { sourceType, sourceName, timestamp, image };
    const detection = await analyzeFrameWithAi(payload);
    const source = db.cameraSources.find((item) => item.type === sourceType && item.name === sourceName) || db.cameraSources.find((item) => item.type === sourceType);
    const detectionRecord = {
      id: uid("det"),
      sourceId: source?.id || null,
      sourceType,
      sourceName,
      timestamp,
      threatDetected: detection.threatDetected,
      threatType: detection.threatType,
      confidence: detection.confidence,
      message: detection.message,
      mode: detection.mode
    };
    db.detections.unshift(detectionRecord);
    db.detections = db.detections.slice(0, 80);
    if (source) {
      source.status = sourceType === "phone_camera" ? "online" : source.status;
      source.latestDetectionId = detectionRecord.id;
      source.lastSeenAt = timestamp;
    }
    let incident = null;
    let alert = null;
    if (detection.threatDetected) {
      ({ incident, alert } = createAiIncident(db, detection, payload));
      db.auditLogs.unshift({ id: uid("aud"), actorName: "RakshakAI Engine", action: "auto_created_ai_vision_incident", timestamp });
    }
    writeDb(db);
    return sendJson(res, 200, { ...detection, detection: detectionRecord, incident, alert });
  }

  if (req.method === "GET" && url.pathname === "/api/incidents/history") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const incidents = db.incidents
      .filter((incident) => incident.status === "closed")
      .sort((a, b) => String(b.closedAt || b.openedAt || "").localeCompare(String(a.closedAt || a.openedAt || "")));
    return sendJson(res, 200, { incidents });
  }

  if (req.method === "DELETE" && url.pathname === "/api/incidents/history") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const before = db.incidents.length;
    db.incidents = db.incidents.filter((incident) => incident.status !== "closed");
    const cleared = before - db.incidents.length;
    db.auditLogs.unshift({ id: uid("aud"), actorName: user.name, action: `cleared_${cleared}_incident_history`, timestamp: now() });
    writeDb(db);
    return sendJson(res, 200, { cleared });
  }

  if (req.method === "POST" && url.pathname === "/api/report-missing") {
    if (!hasRole(user, ["Citizen", "Police Officer", "Admin"])) return forbidden(res);
    const image = typeof body.image === "string" && body.image.startsWith("data:image/") && body.image.length < 900000 ? body.image : null;
    const imageName = image && body.imageName ? String(body.imageName).slice(0, 120) : null;
    const report = { id: uid("mp"), name: body.name, age: Number(body.age || 0), lastSeenLocation: body.lastSeenLocation, status: "active", matchConfidence: 0, matchedCameraId: null, image, imageName, createdAt: now() };
    db.reports.unshift(report);
    db.incidents.unshift({
      id: uid("inc"),
      type: "Missing person report",
      severity: "critical",
      priority: "P1",
      zone: report.lastSeenLocation,
      source: "Citizen missing person portal",
      status: "open",
      assignedUnit: null,
      recommendedUnit: "P-04",
      etaMinutes: 4,
      recommendedAction: "Start CCTV scan, verify last-seen point, and assign nearest police unit.",
      location: { lat: 28.6139, lng: 77.2295 },
      unitLocation: { lat: 28.6281, lng: 77.2186 },
      timeline: ["Citizen report received", "Face embedding queued", "Nearest police unit recommended: P-04"],
      openedAt: now()
    });
    db.alerts.unshift({ id: uid("alt"), type: "Missing Person", severity: "critical", zone: report.lastSeenLocation, status: "open", assignedUnit: null, message: `New missing person report: ${report.name}`, location: { lat: 28.6139, lng: 77.2295 }, timestamp: now() });
    db.auditLogs.unshift({ id: uid("aud"), actorName: user.name, action: "created_missing_person_report", timestamp: now() });
    writeDb(db);
    return sendJson(res, 201, { report });
  }

  if (req.method === "POST" && url.pathname === "/api/send-alert") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const location = body.location && Number.isFinite(Number(body.location.lat)) && Number.isFinite(Number(body.location.lng)) ? { lat: Number(body.location.lat), lng: Number(body.location.lng) } : null;
    const alert = { id: uid("alt"), type: body.type || "Manual", severity: body.severity || "critical", zone: body.zone || "All Zones", status: "open", assignedUnit: null, message: body.message || "Manual command alert sent", location, timestamp: now() };
    db.alerts.unshift(alert);
    db.auditLogs.unshift({ id: uid("aud"), actorName: user.name, action: "sent_alert", timestamp: now() });
    writeDb(db);
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
    writeDb(db);
    return sendJson(res, 200, { cleared });
  }

  const ackAlertMatch = url.pathname.match(/^\/api\/alerts\/([^/]+)\/ack$/);
  if (req.method === "PATCH" && ackAlertMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const alert = db.alerts.find((item) => item.id === ackAlertMatch[1]);
    if (!alert) return sendJson(res, 404, { error: "Alert not found" });
    alert.acknowledgedBy = Array.isArray(alert.acknowledgedBy) ? alert.acknowledgedBy : [];
    if (!alert.acknowledgedBy.some((item) => item.userId === user.id)) {
      alert.acknowledgedBy.push({ userId: user.id, name: user.name, role: user.role, timestamp: now() });
    }
    if (alert.status === "open") alert.status = "acknowledged";
    db.auditLogs.unshift({ id: uid("aud"), actorName: user.name, action: "acknowledged_alert", timestamp: now() });
    writeDb(db);
    return sendJson(res, 200, { alert });
  }

  if (req.method === "POST" && url.pathname === "/api/incidents/sample") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const scenario = nextIncidentScenario(db, body);
    const incident = {
      id: uid("inc"),
      type: scenario.type,
      severity: scenario.severity,
      priority: scenario.priority,
      zone: scenario.zone,
      source: scenario.source,
      status: "open",
      assignedUnit: null,
      recommendedUnit: scenario.recommendedUnit,
      etaMinutes: scenario.etaMinutes,
      recommendedAction: scenario.recommendedAction,
      location: scenario.location,
      unitLocation: scenario.unitLocation,
      timeline: [...scenario.timeline, "Incident opened from command center"],
      openedAt: now()
    };
    db.incidents.unshift(incident);
    db.alerts.unshift({ id: uid("alt"), type: scenario.alertType || "Incident", severity: incident.severity, zone: incident.zone, status: "open", assignedUnit: null, message: `${incident.type} at ${incident.zone}`, location: incident.location, timestamp: now() });
    db.auditLogs.unshift({ id: uid("aud"), actorName: user.name, action: "opened_live_incident", timestamp: now() });
    writeDb(db);
    return sendJson(res, 201, { incident });
  }

  if (req.method === "POST" && url.pathname === "/api/ai/run-scan") {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const report = db.reports.find((r) => r.status !== "found");
    const aiResult = report ? await runRealAiScan(report, camerasForResponse(db)).catch((error) => ({ error: error.message })) : null;
    if (report && aiResult && !aiResult.error && Number(aiResult.confidence || aiResult.matchConfidence || 0) >= 0.85) {
      report.status = "possible_match";
      report.matchConfidence = Number(aiResult.confidence || aiResult.matchConfidence);
      report.matchedCameraId = aiResult.cameraId || null;
      report.verificationStatus = "human_verification_required";
      db.alerts.unshift({ id: uid("alt"), type: "Possible Match", severity: "high", zone: "Unassigned", status: "verification_required", assignedUnit: null, message: "Possible missing person match detected. Human verification required.", timestamp: now() });
    }
    db.auditLogs.unshift({ id: uid("aud"), actorName: user.name, action: "ran_ai_scan", timestamp: now() });
    writeDb(db);
    return sendJson(res, 200, { report, aiMode: aiResult && !aiResult.error ? "real-service" : "unavailable", aiResult });
  }

  const assignMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/assign-unit$/);
  if (req.method === "PATCH" && assignMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const incident = db.incidents.find((i) => i.id === assignMatch[1]);
    if (!incident) return sendJson(res, 404, { error: "Not found" });
    const unit = body.assignedUnit || incident.recommendedUnit || "P-04";
    incident.status = "assigned";
    incident.assignedUnit = unit;
    if (!incident.timeline.includes(`Unit ${unit} assigned`)) incident.timeline.push(`Unit ${unit} assigned`);
    if (incident.recommendedAction && !incident.timeline.includes(`SOP: ${incident.recommendedAction}`)) incident.timeline.push(`SOP: ${incident.recommendedAction}`);
    db.alerts
      .filter((alert) => alert.status !== "closed" && alert.zone === incident.zone)
      .forEach((alert) => {
        alert.status = "assigned";
        alert.assignedUnit = unit;
      });
    writeDb(db);
    return sendJson(res, 200, { incident });
  }

  const statusMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/status$/);
  if (req.method === "PATCH" && statusMatch) {
    if (!hasRole(user, ["Police Officer", "Admin"])) return forbidden(res);
    const incident = db.incidents.find((i) => i.id === statusMatch[1]);
    if (!incident) return sendJson(res, 404, { error: "Not found" });
    const nextStatus = body.status || incident.status;
    incident.status = nextStatus;
    if (nextStatus === "closed") incident.closedAt = now();
    incident.timeline.push(`Status changed to ${incident.status}`);
    db.alerts
      .filter((alert) => alert.zone === incident.zone && alert.message.includes(incident.type))
      .forEach((alert) => {
        alert.status = nextStatus;
        if (nextStatus === "closed") alert.closedAt = now();
      });
    writeDb(db);
    return sendJson(res, 200, { incident });
  }

  return sendJson(res, 404, { error: "Not found" });
}

function staticFile(req, res, url) {
  const requested = url.pathname === "/" || url.pathname === "/rakshak/live-vision" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(root, requested));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

ensureDb();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${host}:${port}`);
  if (url.pathname.startsWith("/api/")) {
    api(req, res, url).catch((error) => sendJson(res, 500, { error: error.message }));
    return;
  }
  staticFile(req, res, url);
});

server.listen(port, host, () => {
  console.log(`RakshakAI running at http://${host}:${port}`);
});
