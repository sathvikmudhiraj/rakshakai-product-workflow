const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const childProcess = require("node:child_process");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pathToFileURL } = require("node:url");
const aiContract = require("../services/ai.service");
const { PUBLIC_OSRM_BASE_URL, resolveOsrmBaseUrl } = require("../services/routingConfig.service");
const { ARCGIS_TILE_SOURCES, OSM_TILE_SOURCES, buildRakshakaiCsp } = require("../../csp.config.cjs");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-security-"));
const testDatabase = path.join(testDirectory, "db.json");
const sourceDatabase = path.join(__dirname, "fixtures", "db.fixture.json");
const TEST_PASSWORD = "RakshakAI-Test-123!";
const PATANCHERU_POINT = { lat: 17.5285, lng: 78.2636 };
const BHEL_POINT = { lat: 17.4933, lng: 78.3915 };
const DEFAULT_LOCAL_CENTER = { lat: 17.5109, lng: 78.3276 };

const database = JSON.parse(fs.readFileSync(sourceDatabase, "utf8"));
const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 4);
database.users.forEach((user) => {
  user.passwordHash = passwordHash;
  delete user.password;
});
database.users.push({
  id: "u_citizen_second",
  name: "Second Citizen",
  email: "second.citizen@rakshakai.local",
  role: "Citizen",
  passwordHash
});
database.incidents = [];
database.alerts = [
  {
    id: "alt_ai_admin_review",
    incidentId: null,
    title: "Possible unattended backpack detected",
    message: "Possible unattended object. Human verification required.",
    threatType: "abandoned_object",
    severity: "high",
    sourceType: "cctv",
    sourceName: "Test Camera A",
    zone: "Gate A",
    lat: PATANCHERU_POINT.lat,
    lng: PATANCHERU_POINT.lng,
    confidence: 0.91,
    detections: [{ label: "backpack", confidence: 0.91, box: [10, 10, 100, 120] }],
    frameTimestamp: new Date().toISOString(),
    threatLevel: "high",
    status: "Pending Review",
    reviewStatus: "pending_review",
    acknowledged: false,
    createdAt: new Date().toISOString()
  },
  {
    id: "alt_ai_police_review",
    incidentId: null,
    title: "Possible suspicious suitcase detected",
    message: "Possible suspicious object. Human verification required.",
    threatType: "suspicious_object",
    severity: "high",
    sourceType: "cctv",
    sourceName: "Test Camera B",
    zone: "Transit Hub",
    lat: 17.5004,
    lng: 78.3798,
    confidence: 0.89,
    detections: [{ label: "suitcase", confidence: 0.89, box: [20, 20, 80, 90] }],
    frameTimestamp: new Date().toISOString(),
    threatLevel: "high",
    status: "Pending Review",
    reviewStatus: "pending_review",
    acknowledged: false,
    createdAt: new Date().toISOString()
  },
  {
    id: "alt_ai_verify_convert",
    incidentId: null,
    title: "Possible crowd crush risk detected",
    message: "Crowd risk needs human verification.",
    threatType: "crowd_risk",
    severity: "critical",
    sourceType: "cctv",
    sourceName: "Test Camera C",
    zone: "Main Entry",
    lat: PATANCHERU_POINT.lat,
    lng: PATANCHERU_POINT.lng,
    confidence: 0.93,
    detections: [{ label: "crowd", confidence: 0.93, box: [0, 0, 200, 160] }],
    frameTimestamp: new Date().toISOString(),
    threatLevel: "critical",
    status: "Pending Review",
    reviewStatus: "pending_review",
    verificationStatus: "pending_review",
    acknowledged: false,
    createdAt: new Date().toISOString()
  },
  {
    id: "alt_ai_reject_review",
    incidentId: null,
    title: "Possible restricted object detected",
    message: "Object detection requires review.",
    threatType: "restricted_object",
    severity: "medium",
    sourceType: "cctv",
    sourceName: "Test Camera D",
    zone: "Food Court",
    lat: 17.5218,
    lng: 78.2815,
    confidence: 0.72,
    detections: [{ label: "object", confidence: 0.72, box: [5, 5, 75, 75] }],
    frameTimestamp: new Date().toISOString(),
    threatLevel: "medium",
    status: "Pending Review",
    reviewStatus: "pending_review",
    verificationStatus: "pending_review",
    acknowledged: false,
    createdAt: new Date().toISOString()
  },
  {
    id: "alt_demo_review",
    incidentId: null,
    title: "Demo training alert",
    message: "Seed alert for training only.",
    threatType: "demo",
    severity: "low",
    source: "demo_seed",
    sourceType: "command_center_demo",
    sourceName: "Seed",
    zone: "All Zones",
    lat: 28.6139,
    lng: 77.2295,
    status: "Pending Review",
    reviewStatus: "pending_review",
    verificationStatus: "pending_review",
    acknowledged: false,
    isDemo: true,
    actionable: false,
    createdAt: new Date().toISOString()
  }
];
database.reports = [{
  id: "report_other_citizen",
  reportType: "missing_object",
  category: "missing_object",
  name: "Other Citizen Phone",
  description: "Black phone",
  lastSeenLocation: "Transit Hub",
  address: "Transit Hub",
  urgency: "medium",
  status: "submitted_for_review",
  createdBy: "u_citizen_second",
  createdAt: new Date().toISOString()
}];
database.auditLogs = [];
database.dispatchEvents = [];
database.responseUnits.forEach((unit) => {
  unit.status = "available";
  unit.assignedIncidentId = null;
  unit.lastUpdated = new Date().toISOString();
  unit.lastLocationUpdatedAt = unit.lastUpdated;
});
database.cameraSources.push(
  {
    id: "test-camera",
    cameraId: "TEST-CAM-01",
    type: "rtsp",
    sourceType: "rtsp",
    name: "Test Camera",
    location: "Test Zone",
    zone: "Test Zone",
    status: "online",
    streamUrl: "rtsp://operator:secret@test-camera.local/live",
    username: "operator",
    password: "secret",
    aiEnabled: true,
    enabled: true,
    isDemo: false
  },
  {
    id: "observation-camera",
    cameraId: "OBS-CAM-01",
    type: "rtsp",
    sourceType: "rtsp",
    name: "Observation Camera",
    location: "Test Zone",
    zone: "Test Zone",
    status: "online",
    streamUrl: "rtsp://operator:secret@observation-camera.local/live",
    aiEnabled: true,
    enabled: true,
    isDemo: false
  }
);
fs.writeFileSync(testDatabase, JSON.stringify(database, null, 2));

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.RAKSHAKAI_DATA_FILE = testDatabase;
process.env.JWT_SECRET = "rakshakai-test-secret-that-is-longer-than-32-characters";
process.env.AI_SERVICE_URL = "";
process.env.OSRM_BASE_URL = "http://127.0.0.1:1";
process.env.API_RATE_LIMIT = "10000";
process.env.AUTH_RATE_LIMIT = "3";
process.env.FRONTEND_ORIGINS = "https://ops.rakshak.example.com";

const { start } = require("../server");
const { readDatabase, writeDatabase, repairLegacyPersistedData } = require("../services/core.service");

let server;
let osrmServer;
let osrmRequests = [];
let baseUrl;
let users;
let createdCitizenReportId;
let rejectedCitizenReportId;
let reviewedIncidentId;
let falseAlarmIncidentId;
let falseAlarmAlertId;
let assignedResponseUnitId;

function tokenFor(role) {
  const user = users.find((item) => item.role === role);
  assert.ok(user, `${role} test user must exist`);
  return jwt.sign(
    { role: user.role, email: user.email, name: user.name, sessionVersion: user.sessionVersion || null },
    process.env.JWT_SECRET,
    { subject: user.id, expiresIn: "5m" }
  );
}

function tokenForId(id) {
  const user = users.find((item) => item.id === id);
  assert.ok(user, `${id} test user must exist`);
  return jwt.sign(
    { role: user.role, email: user.email, name: user.name, sessionVersion: user.sessionVersion || null },
    process.env.JWT_SECRET,
    { subject: user.id, expiresIn: "5m" }
  );
}

function authHeaders(role, useCookie = false) {
  const token = tokenFor(role);
  return useCookie
    ? { Cookie: `rakshakai_session=${token}` }
    : { Authorization: `Bearer ${token}` };
}

function cookieFrom(response) {
  const header = response.headers.get("set-cookie") || "";
  const match = header.match(/rakshakai_session=[^;,\s]+/);
  return { header, cookie: match?.[0] || "" };
}

async function request(route, options = {}) {
  return fetch(`${baseUrl}${route}`, options);
}

const ROUTING_ENV_KEYS = ["GIS_ROUTING_PROVIDER", "OSRM_BASE_URL", "PUBLIC_OSRM_FALLBACK", "ROUTE_TIMEOUT_MS"];

function routingEnvSnapshot() {
  return Object.fromEntries(ROUTING_ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreRoutingEnv(snapshot) {
  for (const key of ROUTING_ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

function assertNoCameraSecrets(payload) {
  const serialized = JSON.stringify(payload);
  for (const forbidden of ["streamUrl", "rtspUrl", "username", "password", "token", "credentials", "operator:secret"]) {
    assert.equal(serialized.includes(forbidden), false, `camera response leaked ${forbidden}`);
  }
}

function assertNoEvidenceSecrets(payload) {
  const serialized = JSON.stringify(payload);
  for (const forbidden of ["fileData", "storagePath", "absolutePath", "C:\\\\", "/uploads/", "confirmed criminal", "confirmed crime", "confirmed missing person", "confirmed identity"]) {
    assert.equal(serialized.includes(forbidden), false, `evidence response leaked ${forbidden}`);
  }
}

function parseCsp(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/);
        return [name, sources];
      })
  );
}

function assertRestrictiveCsp(header, { allowDevelopmentStyleInline = false, allowDevelopmentLocalhost = false, requireUpgrade = false } = {}) {
  assert.ok(header, "CSP header must be configured");
  assert.equal(header.includes("*"), false, "CSP must not contain wildcard sources");
  assert.equal(header.includes("'unsafe-eval'"), false, "CSP must not allow unsafe-eval");
  const csp = parseCsp(header);
  assert.deepEqual(csp["default-src"], ["'self'"]);
  assert.deepEqual(csp["script-src"], ["'self'"]);
  assert.deepEqual(csp["object-src"], ["'none'"]);
  assert.deepEqual(csp["base-uri"], ["'self'"]);
  assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
  assert.deepEqual(csp["form-action"], ["'self'"]);
  assert.ok(csp["img-src"].includes("'self'"));
  assert.ok(csp["img-src"].includes("data:"));
  assert.ok(csp["img-src"].includes("blob:"));
  for (const source of OSM_TILE_SOURCES) assert.ok(csp["img-src"].includes(source), source);
  for (const source of ARCGIS_TILE_SOURCES) assert.ok(csp["img-src"].includes(source), source);
  assert.ok(csp["connect-src"].includes("'self'"));
  assert.equal(csp["connect-src"].includes("https://router.project-osrm.org"), false);
  assert.equal(csp["connect-src"].includes("https://nominatim.openstreetmap.org"), false);
  assert.deepEqual(csp["media-src"], ["'self'", "blob:"]);
  assert.deepEqual(csp["font-src"], ["'self'"]);
  if (allowDevelopmentStyleInline) {
    assert.deepEqual(csp["style-src"], ["'self'", "'unsafe-inline'"]);
  } else {
    assert.deepEqual(csp["style-src"], ["'self'"]);
  }
  if (allowDevelopmentLocalhost) {
    assert.ok(csp["connect-src"].includes("http://localhost:5000"));
    assert.ok(csp["connect-src"].includes("ws://localhost:3000"));
  } else {
    assert.equal(csp["connect-src"].some((source) => /localhost|127\.0\.0\.1|^http:|^ws:/.test(source)), false);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(csp, "upgrade-insecure-requests"), requireUpgrade);
}

async function login(role, origin = "http://localhost:3000") {
  const user = users.find((item) => item.role === role);
  const response = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email: user.email, password: TEST_PASSWORD })
  });
  return { response, ...(cookieFrom(response)) };
}

test.before(async () => {
  osrmServer = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, "http://localhost");
    if (parsedUrl.pathname.startsWith("/route/v1/")) {
      osrmRequests.push({ method: req.method, url: req.url });
    }
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "ok", modelLoaded: true }));
    }
    if (req.url === "/analyze-frame") {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const bodyText = Buffer.concat(chunks).toString("utf8");
        const objectMatch = bodyText.includes("Browser Object Match");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(objectMatch ? {
          configured: true,
          threatDetected: false,
          threatType: "object_detected",
          confidence: 0.88,
          severity: "low",
          alertClassification: "observation",
          detections: [{
            label: "backpack",
            confidence: 0.88,
            box: [12, 16, 96, 110],
            dominantColor: "blue"
          }],
          objectAnalysis: [{
            label: "backpack",
            confidence: 0.88,
            box: [12, 16, 96, 110],
            dominantColor: "blue"
          }],
          performance: { inferenceMs: 37, analyzedAt: new Date().toISOString(), imageWidth: 640, imageHeight: 360, device: "cpu" },
          message: "Possible object detected"
        } : {
          configured: true,
          threatDetected: false,
          threatType: "person_detected",
          confidence: 0.92,
          severity: "low",
          alertClassification: "observation",
          detections: [{
            label: "person",
            confidence: 0.92,
            box: [10, 10, 100, 200],
            dominantColor: "blue",
            approximateSizePixels: { width: 100, height: 200, area: 20000 }
          }],
          personAnalysis: [{
            trackingId: "person-001",
            upperClothingColor: "blue",
            lowerClothingColor: "black",
            boundingBoxHeightPixels: 200,
            carryingBag: "unknown",
            ridingVehicle: "unknown"
          }],
          performance: { inferenceMs: 42, analyzedAt: new Date().toISOString(), imageWidth: 640, imageHeight: 360, device: "cpu" },
          message: "Person detected for observation"
        }));
      });
      return;
    }
    const coordinatesPart = parsedUrl.pathname.split("/").at(-1);
    const [start, destination] = coordinatesPart.split(";").map((pair) => pair.split(",").map(Number));
    const distance = Math.max(100, Math.hypot(destination[1] - start[1], destination[0] - start[0]) * 100000);
    const alternateDistance = distance * 1.18;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      code: "Ok",
      routes: [
        {
          distance,
          duration: Math.max(60, distance / 8),
          geometry: { type: "LineString", coordinates: [start, destination] },
          legs: [{ steps: [] }]
        },
        {
          distance: alternateDistance,
          duration: Math.max(90, alternateDistance / 7),
          geometry: { type: "LineString", coordinates: [start, [(start[0] + destination[0]) / 2, (start[1] + destination[1]) / 2 + 0.002], destination] },
          legs: [{ steps: [] }]
        }
      ]
    }));
  });
  await new Promise((resolve) => osrmServer.listen(0, "127.0.0.1", resolve));
  process.env.OSRM_BASE_URL = `http://127.0.0.1:${osrmServer.address().port}`;
  users = (await readDatabase()).users;
  server = await start(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await new Promise((resolve, reject) => osrmServer.close((error) => error ? reject(error) : resolve()));
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

test("security headers are present and Express signature is hidden", async () => {
  const response = await request("/api/health");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.ok(response.headers.get("referrer-policy"));
  assertRestrictiveCsp(response.headers.get("content-security-policy"), { allowDevelopmentLocalhost: true });
});

test("malformed JSON returns 400 rather than 500", async () => {
  const response = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{invalid"
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Invalid JSON payload");
});

test("JSON mutations require the correct content type", async () => {
  const response = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "{}"
  });
  assert.equal(response.status, 415);
});

test("oversized JSON payloads are rejected", async () => {
  const response = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(1_600_000) })
  });
  assert.equal(response.status, 413);
});

test("unsafe origins are blocked and trusted local development origins work", async () => {
  const unsafe = await request("/api/logout", {
    method: "POST",
    headers: { Origin: "https://attacker.example" }
  });
  assert.equal(unsafe.status, 403);

  const safe = await request("/api/logout", {
    method: "POST",
    headers: { Origin: "http://localhost:3000" }
  });
  assert.equal(safe.status, 200);

  const dockerWslSafe = await request("/api/logout", {
    method: "POST",
    headers: { Origin: "http://172.25.32.1:3000" }
  });
  assert.equal(dockerWslSafe.status, 200);

  const productionFrontend = await request("/api/health", {
    headers: { Origin: "https://ops.rakshak.example.com" }
  });
  assert.equal(productionFrontend.status, 200);
  assert.equal(productionFrontend.headers.get("access-control-allow-origin"), "https://ops.rakshak.example.com");
});

test("login sets an HttpOnly cookie and never exposes a token in JSON", async () => {
  const { response, header, cookie } = await login("Admin");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.role, "Admin");
  assert.equal("sessionToken" in body, false);
  assert.equal("token" in body, false);
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=Strict/i);
  assert.ok(cookie.startsWith("rakshakai_session="));
});

test("session check works using only cookie credentials", async () => {
  const { cookie } = await login("Police Officer");
  const response = await request("/api/auth/me", { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.role, "Police Officer");
});

test("logout clears both current and legacy session cookies", async () => {
  const { cookie } = await login("Citizen");
  const response = await request("/api/auth/logout", {
    method: "POST",
    headers: { Cookie: cookie, Origin: "http://localhost:3000" }
  });
  assert.equal(response.status, 200);
  const header = response.headers.get("set-cookie") || "";
  assert.match(header, /Max-Age=0/i);
  assert.match(header, /Path=\/api/i);
});

test("Public registration always creates Citizen accounts only", async () => {
  const response = await request("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({
      name: "Public Staff Attempt",
      email: "public.staff.attempt@rakshakai.local",
      password: "Citizen123",
      role: "Police Officer"
    })
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.user.role, "Citizen");
  assert.equal("passwordHash" in body.user, false);
  assert.equal("password" in body.user, false);
  const db = await readDatabase();
  const stored = db.users.find((item) => item.email === "public.staff.attempt@rakshakai.local");
  assert.equal(stored.role, "Citizen");
});

test("Admin can securely change password while other roles cannot", async () => {
  const route = "/api/auth/change-password";
  const headersFor = (role) => ({
    ...authHeaders(role),
    "Content-Type": "application/json",
    Origin: "http://localhost:3000"
  });

  const unauthenticated = await request(route, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ currentPassword: TEST_PASSWORD, newPassword: "NewAdminPass456" })
  });
  assert.equal(unauthenticated.status, 401);

  const police = await request(route, {
    method: "POST",
    headers: headersFor("Police Officer"),
    body: JSON.stringify({ currentPassword: TEST_PASSWORD, newPassword: "NewAdminPass456" })
  });
  assert.equal(police.status, 403);

  const wrongCurrent = await request(route, {
    method: "POST",
    headers: headersFor("Admin"),
    body: JSON.stringify({ currentPassword: "incorrect-password", newPassword: "NewAdminPass456" })
  });
  assert.equal(wrongCurrent.status, 401);

  const weak = await request(route, {
    method: "POST",
    headers: headersFor("Admin"),
    body: JSON.stringify({ currentPassword: TEST_PASSWORD, newPassword: "short" })
  });
  assert.equal(weak.status, 400);

  const changed = await request(route, {
    method: "POST",
    headers: headersFor("Admin"),
    body: JSON.stringify({ currentPassword: TEST_PASSWORD, newPassword: "NewAdminPass456" })
  });
  assert.equal(changed.status, 200);
  assert.match(changed.headers.get("set-cookie") || "", /Max-Age=0/i);

  const oldSession = await request("/api/auth/me", { headers: authHeaders("Admin") });
  assert.equal(oldSession.status, 200);
  assert.equal((await oldSession.json()).user, null);

  const admin = users.find((item) => item.role === "Admin");
  const oldLogin = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ email: admin.email, password: TEST_PASSWORD })
  });
  assert.equal(oldLogin.status, 401);

  const newLogin = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ email: admin.email, password: "NewAdminPass456" })
  });
  assert.equal(newLogin.status, 200);

  const auditResponse = await request("/api/audit-logs", {
    headers: { Cookie: cookieFrom(newLogin).cookie }
  });
  assert.equal(auditResponse.status, 200);
  assert.ok((await auditResponse.json()).auditLogs.some((log) => log.action === "admin_password_changed"));

  const restored = await request(route, {
    method: "POST",
    headers: {
      Cookie: cookieFrom(newLogin).cookie,
      "Content-Type": "application/json",
      Origin: "http://localhost:3000"
    },
    body: JSON.stringify({ currentPassword: "NewAdminPass456", newPassword: TEST_PASSWORD })
  });
  assert.equal(restored.status, 200);
  users = (await readDatabase()).users;
});

test("Admin can access admin-only routes while Police and Citizen cannot", async () => {
  for (const route of ["/api/admin/users", "/api/admin/police-users", "/api/device-health", "/api/audit-logs", "/api/integrations/status"]) {
    assert.equal((await request(route, { headers: authHeaders("Admin") })).status, 200, route);
    assert.equal((await request(route, { headers: authHeaders("Police Officer") })).status, 403, route);
    assert.equal((await request(route, { headers: authHeaders("Citizen") })).status, 403, route);
  }
});

test("Admin can create, list, update, deactivate, activate, and reset Police accounts", async () => {
  const payload = {
    name: "Inspector Meera Singh",
    email: "meera.singh@rakshakai.local",
    temporaryPassword: "TempPolice123",
    badgeId: "DL-2042",
    unitId: "PCR-11",
    station: "Central Command",
    beat: "Sector 7",
    jurisdiction: "North Zone"
  };
  for (const role of ["Police Officer", "Citizen"]) {
    const denied = await request("/api/admin/police-users", {
      method: "POST",
      headers: { ...authHeaders(role), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify(payload)
    });
    assert.equal(denied.status, 403, role);
  }

  const created = await request("/api/admin/police-users", {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify(payload)
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.user.role, "Police Officer");
  assert.equal(createdBody.user.status, "active");
  assert.equal(createdBody.user.badgeId, "DL-2042");
  assert.equal("passwordHash" in createdBody.user, false);
  assert.equal("password" in createdBody.user, false);

  let db = await readDatabase();
  const stored = db.users.find((item) => item.id === createdBody.user.id);
  assert.ok(stored.passwordHash);
  assert.notEqual(stored.passwordHash, "TempPolice123");

  const list = await request("/api/admin/police-users", { headers: authHeaders("Admin") });
  assert.equal(list.status, 200);
  const listedUser = (await list.json()).users.find((item) => item.id === createdBody.user.id);
  assert.ok(listedUser);
  assert.equal("passwordHash" in listedUser, false);

  for (const role of ["Police Officer", "Citizen"]) {
    const deniedUpdate = await request(`/api/admin/police-users/${createdBody.user.id}`, {
      method: "PATCH",
      headers: { ...authHeaders(role), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "Unauthorized Edit" })
    });
    assert.equal(deniedUpdate.status, 403, `${role} update`);
    const deniedDeactivate = await request(`/api/admin/police-users/${createdBody.user.id}/deactivate`, {
      method: "PATCH",
      headers: { ...authHeaders(role), Origin: "http://localhost:3000" }
    });
    assert.equal(deniedDeactivate.status, 403, `${role} deactivate`);
    const deniedReset = await request(`/api/admin/police-users/${createdBody.user.id}/reset-password`, {
      method: "POST",
      headers: { ...authHeaders(role), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ temporaryPassword: "Blocked123" })
    });
    assert.equal(deniedReset.status, 403, `${role} reset`);
  }

  const updated = await request(`/api/admin/police-users/${createdBody.user.id}`, {
    method: "PATCH",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ name: "Inspector Meera Rao", email: payload.email, station: "Metro Command", beat: "Sector 8" })
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).user.name, "Inspector Meera Rao");

  const inactive = await request(`/api/admin/police-users/${createdBody.user.id}/deactivate`, {
    method: "PATCH",
    headers: { ...authHeaders("Admin"), Origin: "http://localhost:3000" }
  });
  assert.equal(inactive.status, 200);
  assert.equal((await inactive.json()).user.status, "inactive");

  const inactiveLogin = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ email: payload.email, password: payload.temporaryPassword })
  });
  assert.equal(inactiveLogin.status, 403);

  const active = await request(`/api/admin/police-users/${createdBody.user.id}/activate`, {
    method: "PATCH",
    headers: { ...authHeaders("Admin"), Origin: "http://localhost:3000" }
  });
  assert.equal(active.status, 200);
  assert.equal((await active.json()).user.status, "active");

  const reset = await request(`/api/admin/police-users/${createdBody.user.id}/reset-password`, {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ temporaryPassword: "NewPolice123" })
  });
  assert.equal(reset.status, 200);
  const resetBody = await reset.json();
  assert.equal("passwordHash" in resetBody.user, false);

  const login = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ email: payload.email, password: "NewPolice123" })
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).user.role, "Police Officer");

  const auditResponse = await request("/api/audit-logs", { headers: authHeaders("Admin") });
  const actions = (await auditResponse.json()).auditLogs.map((log) => log.action);
  for (const action of ["police_account_created", "police_account_updated", "police_account_deactivated", "police_account_activated", "police_password_reset"]) {
    assert.ok(actions.includes(action), action);
  }

  users = (await readDatabase()).users;
});

test("Admin and Police can access operational routes", async () => {
  for (const role of ["Admin", "Police Officer"]) {
    for (const route of ["/api/dashboard", "/api/cameras/sources", "/api/alerts", "/api/incidents", "/api/response-units", "/api/police-stations"]) {
      const response = await request(route, { headers: authHeaders(role) });
      assert.equal(response.status, 200, `${role}: ${route}`);
    }
  }
});

test("response unit registry exposes source-safe unit metadata and marks demo units", async () => {
  const response = await request("/api/response-units", { headers: authHeaders("Admin") });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.summary.total >= 1);
  const demo = body.units.find((unit) => unit.source === "demo_seed");
  assert.ok(demo);
  assert.equal(demo.isDemo, true);
  assert.equal(demo.badge, "DEMO UNIT");
  assert.equal("unitId" in demo, true);
  assert.equal("unitName" in demo, true);
  assert.equal("operational" in demo, true);
  assert.equal(demo.lat >= 17 && demo.lat <= 18, true);
  assert.equal(demo.lng >= 78 && demo.lng <= 79, true);
  assert.equal(demo.lat >= 28.4 && demo.lat <= 28.8, false);
  assert.equal(demo.lng >= 77.0 && demo.lng <= 77.4, false);
});

test("police station registry uses Hyderabad Patancheru BHEL demo area and blocks Citizen", async () => {
  const response = await request("/api/police-stations", { headers: authHeaders("Admin") });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.defaultCenter, DEFAULT_LOCAL_CENTER);
  const names = body.stations.map((station) => station.stationName);
  assert.equal(names.some((name) => /Patancheru/i.test(name)), true);
  assert.equal(names.some((name) => /BHEL|Ramachandrapuram/i.test(name)), true);
  for (const station of body.stations) {
    assert.equal(station.lat >= 17 && station.lat <= 18, true, station.stationName);
    assert.equal(station.lng >= 78 && station.lng <= 79, true, station.stationName);
    assert.equal(station.lat >= 28.4 && station.lat <= 28.8, false, station.stationName);
    assert.equal(station.lng >= 77.0 && station.lng <= 77.4, false, station.stationName);
    if (station.source === "demo_seed") {
      assert.equal(station.isDemo, true);
      assert.equal(station.badge, "DEMO STATION");
    }
  }
  assert.equal((await request("/api/police-stations", { headers: authHeaders("Citizen") })).status, 403);
});

test("Admin can manage response unit registry while Police and Citizen cannot", async () => {
  const createPayload = {
    unitId: "P-REG-01",
    unitName: "Registry Patrol 01",
    unitType: "police_patrol",
    officerName: "Inspector Registry",
    stationName: "Patancheru Police Station",
    beat: "Industrial Area",
    jurisdiction: "Patancheru",
    lat: PATANCHERU_POINT.lat + 0.002,
    lng: PATANCHERU_POINT.lng + 0.002,
    address: "Patancheru admin registry point",
    status: "available",
    source: "admin_registry",
    operational: true
  };
  for (const role of ["Police Officer", "Citizen"]) {
    const blocked = await request("/api/response-units", {
      method: "POST",
      headers: { ...authHeaders(role), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify(createPayload)
    });
    assert.equal(blocked.status, 403, role);
  }

  const created = await request("/api/response-units", {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify(createPayload)
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.unit.source, "admin_registry");
  assert.equal(createdBody.unit.isDemo, false);
  assert.equal(createdBody.unit.operational, true);

  const updated = await request(`/api/response-units/${createdBody.unit.id}`, {
    method: "PATCH",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ beat: "Industrial Area Updated", lat: PATANCHERU_POINT.lat + 0.003, lng: PATANCHERU_POINT.lng + 0.003, source: "live_gps", status: "available", operational: true })
  });
  assert.equal(updated.status, 200);
  const updatedBody = await updated.json();
  assert.equal(updatedBody.unit.source, "live_gps");
  assert.equal(updatedBody.unit.beat, "Industrial Area Updated");

  const deactivated = await request(`/api/response-units/${createdBody.unit.id}`, {
    method: "DELETE",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: "{}"
  });
  assert.equal(deactivated.status, 200);
  const deactivatedBody = await deactivated.json();
  assert.equal(deactivatedBody.unit.operational, false);
  assert.equal(deactivatedBody.unit.status, "offline");

  const audits = (await (await request("/api/audit-logs", { headers: authHeaders("Admin") })).json()).auditLogs.map((log) => log.action);
  for (const action of ["unit_created", "unit_updated", "unit_status_changed", "unit_location_updated"]) {
    assert.ok(audits.includes(action), action);
  }
});

test("Admin can manage station registry and station fallback is labelled", async () => {
  const original = await readDatabase();
  const originalStations = structuredClone(original.policeStations || []);
  const originalUnits = structuredClone(original.responseUnits || []);
  const stationPayload = {
    stationId: "PS-TEST-FALLBACK",
    stationName: "Test BHEL Station Fallback",
    source: "admin_registry",
    jurisdiction: "Ramachandrapuram",
    beat: "BHEL Township",
    lat: BHEL_POINT.lat,
    lng: BHEL_POINT.lng,
    address: "BHEL Township station fallback point",
    operational: true
  };
  try {
    for (const role of ["Police Officer", "Citizen"]) {
      const blocked = await request("/api/police-stations", {
        method: "POST",
        headers: { ...authHeaders(role), "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify(stationPayload)
      });
      assert.equal(blocked.status, 403, role);
    }

    const createdStation = await request("/api/police-stations", {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify(stationPayload)
    });
    assert.equal(createdStation.status, 201);
    const stationBody = await createdStation.json();
    assert.equal(stationBody.station.source, "admin_registry");
    assert.equal(stationBody.station.isDemo, false);

    const createdUnit = await request("/api/response-units", {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({
        unitId: "P-FALLBACK-01",
        unitName: "Station Fallback Patrol",
        unitType: "police_patrol",
        linkedStationId: stationBody.station.stationId,
        source: "admin_registry",
        status: "available",
        operational: true
      })
    });
    assert.equal(createdUnit.status, 201);
    const unitBody = await createdUnit.json();
    assert.equal(unitBody.unit.source, "admin_registry");
    assert.equal(unitBody.unit.locationSource, "station_registry");
    assert.equal(unitBody.unit.stationFallback, true);
    assert.equal(unitBody.unit.sourceBadge, "STATION FALLBACK");
    assert.match(unitBody.unit.sourceNotes, /station\/base location/i);
    assert.equal(unitBody.unit.lat, BHEL_POINT.lat);
    assert.equal(unitBody.unit.lng, BHEL_POINT.lng);
  } finally {
    const restored = await readDatabase();
    restored.policeStations = originalStations;
    restored.responseUnits = originalUnits;
    await writeDatabase(restored);
  }
});

test("CCTV camera registry exposes safe metadata only and marks demo feeds", async () => {
  const adminSources = await request("/api/camera-sources", { headers: authHeaders("Admin") });
  assert.equal(adminSources.status, 200);
  const sourceBody = await adminSources.json();
  assertNoCameraSecrets(sourceBody);
  assert.equal(
    sourceBody.sources.some((source) => /video evidence|video upload/i.test(`${source.name || ""} ${source.sourceLabel || ""}`)),
    false
  );

  const real = sourceBody.sources.find((source) => source.id === "test-camera");
  assert.ok(real);
  assert.equal(real.isDemo, false);
  assert.equal(real.sourceType, "rtsp");
  assert.equal(real.badge, "REAL CCTV");
  assert.equal(real.hasStreamConfig, true);
  assert.equal(real.aiEnabled, true);
  assert.equal("streamUrl" in real, false);
  assert.equal("username" in real, false);
  assert.equal("password" in real, false);

  const demo = sourceBody.sources.find((source) => source.id === "cam_c19");
  assert.ok(demo);
  assert.equal(demo.sourceType, "demo_seed");
  assert.equal(demo.isDemo, true);
  assert.match(demo.badge, /DEMO CAMERA/);

  const policeFeeds = await request("/api/camera-feeds", { headers: authHeaders("Police Officer") });
  assert.equal(policeFeeds.status, 200);
  const feedBody = await policeFeeds.json();
  assertNoCameraSecrets(feedBody);
  assert.ok(feedBody.cameras.some((camera) => camera.id === "test-camera" && camera.sourceType === "rtsp"));
  assert.ok(feedBody.cameras.some((camera) => camera.id === "cam_c19" && camera.sourceType === "demo_seed" && camera.isDemo));

  const policeSources = await request("/api/camera-sources", { headers: authHeaders("Police Officer") });
  assert.equal(policeSources.status, 200);
  const policeSourceBody = await policeSources.json();
  assertNoCameraSecrets(policeSourceBody);
  const policeReal = policeSourceBody.sources.find((source) => source.id === "test-camera");
  assert.ok(policeReal);
  assert.deepEqual(
    Object.keys(policeReal).filter((key) => ["streamUrl", "rtspUrl", "username", "password", "token", "credentials"].includes(key)),
    []
  );
});

test("Admin can create and update real camera config without leaking credentials", async () => {
  const create = await request("/api/camera-sources", {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({
      name: "Secure Gate Camera",
      location: "Secure Gate",
      sourceType: "rtsp",
      streamUrl: "rtsp://secure-user:secure-pass@10.0.0.5/main",
      username: "secure-user",
      password: "secure-pass",
      aiEnabled: true,
      status: "unknown"
    })
  });
  assert.equal(create.status, 201);
  const created = await create.json();
  assertNoCameraSecrets(created);
  assert.equal(created.source.name, "Secure Gate Camera");
  assert.equal(created.source.sourceType, "rtsp");
  assert.equal(created.source.hasStreamConfig, true);

  const update = await request(`/api/camera-sources/${created.source.id}/config`, {
    method: "PATCH",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ name: "Secure Gate Camera Updated", location: "Secure Gate", sourceType: "rtsp", aiEnabled: false, status: "offline" })
  });
  assert.equal(update.status, 200);
  const updated = await update.json();
  assertNoCameraSecrets(updated);
  assert.equal(updated.source.name, "Secure Gate Camera Updated");
  assert.equal(updated.source.aiEnabled, false);

  const blankSecretUpdate = await request(`/api/camera-sources/${created.source.id}/config`, {
    method: "PATCH",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({
      name: "Secure Gate Camera Updated Again",
      location: "Secure Gate",
      sourceType: "rtsp",
      streamUrl: "",
      username: "",
      password: "",
      aiEnabled: false,
      status: "unknown"
    })
  });
  assert.equal(blankSecretUpdate.status, 200);
  assertNoCameraSecrets(await blankSecretUpdate.json());

  const stored = (await readDatabase()).cameraSources.find((source) => source.id === created.source.id);
  assert.equal(stored.streamUrl, "rtsp://secure-user:secure-pass@10.0.0.5/main");
  assert.equal(stored.username, "secure-user");
  assert.equal(stored.password, "secure-pass");
});

test("Citizen cannot access CCTV APIs and camera analysis endpoints", async () => {
  for (const route of ["/api/camera-feeds", "/api/camera-sources", "/api/cameras/feeds", "/api/cameras/sources"]) {
    const response = await request(route, { headers: authHeaders("Citizen") });
    assert.equal(response.status, 403, route);
  }
  const test = await request("/api/camera-sources/test-camera/test", {
    method: "POST",
    headers: { ...authHeaders("Citizen"), Origin: "http://localhost:3000" }
  });
  assert.equal(test.status, 403);
  const analyze = await request("/api/camera-sources/test-camera/analyze", {
    method: "POST",
    headers: { ...authHeaders("Citizen"), Origin: "http://localhost:3000" }
  });
  assert.equal(analyze.status, 403);
  const create = await request("/api/camera-sources", {
    method: "POST",
    headers: { ...authHeaders("Citizen"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ name: "Citizen Camera", sourceType: "rtsp" })
  });
  assert.equal(create.status, 403);
  const remove = await request("/api/camera-sources/test-camera", {
    method: "DELETE",
    headers: { ...authHeaders("Citizen"), Origin: "http://localhost:3000" }
  });
  assert.equal(remove.status, 403);
});

test("Police can test cameras but cannot edit secure camera config", async () => {
  const testResponse = await request("/api/camera-sources/test-camera/test", {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), Origin: "http://localhost:3000" }
  });
  assert.equal(testResponse.status, 200);
  assertNoCameraSecrets(await testResponse.json());

  const update = await request("/api/camera-sources/test-camera/config", {
    method: "PATCH",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ name: "Police Edit Blocked", sourceType: "rtsp" })
  });
  assert.equal(update.status, 403);

  const create = await request("/api/camera-sources", {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ name: "Police Camera Blocked", sourceType: "rtsp" })
  });
  assert.equal(create.status, 403);

  const remove = await request("/api/camera-sources/test-camera", {
    method: "DELETE",
    headers: { ...authHeaders("Police Officer"), Origin: "http://localhost:3000" }
  });
  assert.equal(remove.status, 403);
});

test("alert access is role-filtered and exposes source traceability to operators", async () => {
  const citizen = await request("/api/alerts", { headers: authHeaders("Citizen") });
  assert.equal(citizen.status, 403);

  for (const role of ["Admin", "Police Officer"]) {
    const response = await request("/api/alerts", { headers: authHeaders(role) });
    assert.equal(response.status, 200, role);
    const alerts = (await response.json()).alerts;
    const alert = alerts.find((item) => item.id === "alt_ai_admin_review");
    assert.ok(alert, `${role} sees operational alert`);
    assert.equal(alert.source, "cctv_scan");
    assert.equal(alert.isDemo, false);
    assert.equal(alert.actionable, true);
    assert.equal(alert.createdBy, "system");
    assert.equal(alert.createdByRole, "System");
    assert.equal(alert.locationSource, "manual_latlng");
    assert.equal(alert.verificationStatus, "pending_review");
    assert.equal(alert.linkedIncidentId, null);
    assert.equal("detections" in alert, true);
    assert.equal(alert.detections[0].label, "backpack");
  }
});

test("manual alerts without coordinates do not fall back to Delhi", async () => {
  const response = await request("/api/send-alert", {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({
      type: "Emergency Broadcast",
      severity: "high",
      zone: "All Zones",
      message: "Location must be confirmed before action"
    })
  });
  assert.equal(response.status, 201);
  const alert = (await response.json()).alert;
  assert.equal(alert.locationSource, "unknown");
  assert.equal(alert.lat, null);
  assert.equal(alert.lng, null);
  assert.equal(alert.location, undefined);
  assert.notEqual(alert.lat, 28.6139);
  assert.notEqual(alert.lng, 77.2295);
});

test("Police cannot clear all alerts while Admin can acknowledge with audit trail", async () => {
  const policeClear = await request("/api/alerts/clear", {
    method: "PATCH",
    headers: { ...authHeaders("Police Officer"), Origin: "http://localhost:3000" }
  });
  assert.equal(policeClear.status, 403);

  const acknowledged = await request("/api/alerts/alt_ai_admin_review/ack", {
    method: "PATCH",
    headers: { ...authHeaders("Admin"), Origin: "http://localhost:3000" }
  });
  assert.equal(acknowledged.status, 200);
  const body = await acknowledged.json();
  assert.equal(body.alert.acknowledged, true);
  assert.equal(body.alert.status, "Acknowledged");
  assert.equal(body.alert.verificationStatus, "pending_review");
  assert.equal(body.alert.linkedIncidentId, null);
  assert.equal(body.alert.acknowledgedBy.some((item) => item.role === "Admin"), true);

  const auditResponse = await request("/api/audit-logs", { headers: authHeaders("Admin") });
  const auditLogs = (await auditResponse.json()).auditLogs;
  assert.ok(auditLogs.some((log) => log.action === "alert_acknowledged" && log.details === "alt_ai_admin_review"));
});

test("Admin and Police can verify, reject, and convert reviewed alerts with audit logs", async () => {
  const prematureConvert = await request("/api/alerts/alt_ai_verify_convert/review", {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ action: "convert_incident" })
  });
  assert.equal(prematureConvert.status, 409);
  assert.match((await prematureConvert.json()).error, /acknowledge/i);

  const acknowledgedForVerify = await request("/api/alerts/alt_ai_verify_convert/ack", {
    method: "PATCH",
    headers: { ...authHeaders("Police Officer"), Origin: "http://localhost:3000" }
  });
  assert.equal(acknowledgedForVerify.status, 200);

  const convertBeforeVerify = await request("/api/alerts/alt_ai_verify_convert/review", {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ action: "convert_incident" })
  });
  assert.equal(convertBeforeVerify.status, 409);
  assert.match((await convertBeforeVerify.json()).error, /verify/i);

  const verified = await request("/api/alerts/alt_ai_verify_convert/review", {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ action: "verify" })
  });
  assert.equal(verified.status, 200);
  const verifiedBody = await verified.json();
  assert.equal(verifiedBody.alert.verificationStatus, "verified");
  assert.equal(verifiedBody.alert.linkedIncidentId, null);
  assert.equal(verifiedBody.alert.actionable, true);

  const converted = await request("/api/alerts/alt_ai_verify_convert/review", {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ action: "convert_incident" })
  });
  const convertedBody = await converted.json();
  assert.equal(converted.status, 200, JSON.stringify(convertedBody));
  assert.equal(convertedBody.alert.verificationStatus, "verified_incident_created");
  assert.equal(convertedBody.alert.linkedIncidentId, convertedBody.incident.id);
  assert.equal(convertedBody.incident.status, "Verified");

  const repeatConvert = await request("/api/alerts/alt_ai_verify_convert/review", {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ action: "convert_incident" })
  });
  assert.equal(repeatConvert.status, 409);

  const acknowledgedForReject = await request("/api/alerts/alt_ai_reject_review/ack", {
    method: "PATCH",
    headers: { ...authHeaders("Admin"), Origin: "http://localhost:3000" }
  });
  assert.equal(acknowledgedForReject.status, 200);

  const rejected = await request("/api/alerts/alt_ai_reject_review/review", {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ action: "reject" })
  });
  assert.equal(rejected.status, 200);
  const rejectedBody = await rejected.json();
  assert.equal(rejectedBody.alert.verificationStatus, "rejected_false_alarm");
  assert.equal(rejectedBody.alert.actionable, false);
  assert.equal(rejectedBody.alert.status, "False Alarm");

  const activeAlerts = await request("/api/alerts", { headers: authHeaders("Admin") });
  assert.equal((await activeAlerts.json()).alerts.some((alert) => alert.id === "alt_ai_reject_review"), false);

  const acknowledgedDemo = await request("/api/alerts/alt_demo_review/ack", {
    method: "PATCH",
    headers: { ...authHeaders("Admin"), Origin: "http://localhost:3000" }
  });
  assert.equal(acknowledgedDemo.status, 200);

  const verifiedDemo = await request("/api/alerts/alt_demo_review/review", {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ action: "verify" })
  });
  assert.equal(verifiedDemo.status, 200);

  const demoConvert = await request("/api/alerts/alt_demo_review/review", {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ action: "convert_incident" })
  });
  assert.equal(demoConvert.status, 409);
  assert.match((await demoConvert.json()).error, /demo/i);

  const citizenVerify = await request("/api/alerts/alt_demo_review/review", {
    method: "POST",
    headers: { ...authHeaders("Citizen"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ action: "verify" })
  });
  assert.equal(citizenVerify.status, 403);

  const auditResponse = await request("/api/audit-logs", { headers: authHeaders("Admin") });
  const auditLogs = (await auditResponse.json()).auditLogs;
  assert.ok(auditLogs.some((log) => log.action === "alert_verified" && log.details === "alt_ai_verify_convert: verify"));
  assert.ok(auditLogs.some((log) => log.action === "alert_converted_to_incident" && log.details === "alt_ai_verify_convert: convert_incident"));
  assert.ok(auditLogs.some((log) => log.action === "alert_rejected" && log.details === "alt_ai_reject_review: reject"));
});

test("Dashboard Missing Persons KPI excludes objects and inactive reports", async () => {
  const db = await readDatabase();
  db.reports.push(
    {
      id: "kpi_missing_person_active",
      reportType: "missing_person",
      category: "missing_person",
      name: "Active Person",
      status: "under_review",
      lastSeenLocation: "Gate A",
      address: "Gate A",
      createdBy: "u_citizen",
      createdAt: new Date().toISOString()
    },
    {
      id: "kpi_missing_object_active",
      reportType: "missing_object",
      category: "missing_object",
      name: "Active AirPods",
      status: "under_review",
      lastSeenLocation: "Gate A",
      address: "Gate A",
      createdBy: "u_citizen",
      createdAt: new Date().toISOString()
    },
    {
      id: "kpi_missing_person_closed",
      reportType: "missing_person",
      category: "missing_person",
      name: "Closed Person",
      status: "closed",
      lastSeenLocation: "Gate A",
      address: "Gate A",
      createdBy: "u_citizen",
      createdAt: new Date().toISOString()
    },
    {
      id: "kpi_missing_person_rejected",
      reportType: "missing_person",
      category: "missing_person",
      name: "Rejected Person",
      status: "rejected",
      lastSeenLocation: "Gate A",
      address: "Gate A",
      createdBy: "u_citizen",
      createdAt: new Date().toISOString()
    }
  );
  await writeDatabase(db);

  const response = await request("/api/dashboard", { headers: authHeaders("Admin") });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.summary.missingPersons, 1);
  assert.equal(body.summary.missingObjects, 2);
  assert.equal(body.summary.pendingCitizenReports >= 2, true);
});

test("Citizen and unauthenticated users cannot access operational routes", async () => {
  for (const route of ["/api/dashboard", "/api/cameras/sources", "/api/alerts", "/api/incidents", "/api/response-units", "/api/police-stations"]) {
    assert.equal((await request(route, { headers: authHeaders("Citizen") })).status, 403, `Citizen: ${route}`);
    assert.ok([401, 403].includes((await request(route)).status), `Unauthenticated: ${route}`);
  }
});

test("missing or invalid session cookies fail safely", async () => {
  const missing = await request("/api/ai/health");
  assert.equal(missing.status, 401);
  const invalid = await request("/api/dashboard", {
    headers: { Cookie: "rakshakai_session=invalid-token" }
  });
  assert.ok([401, 403].includes(invalid.status));
  const body = await invalid.json();
  assert.ok(body.error || body.message);
});

test("Citizen can use report routes but receives only the public-safe contract", async () => {
  const headers = authHeaders("Citizen");
  const listResponse = await request("/api/missing-persons", { headers });
  assert.equal(listResponse.status, 200);
  const listed = await listResponse.json();
  assert.ok(Array.isArray(listed.reports));
  assert.equal(listed.reports.some((report) => report.id === "report_other_citizen"), false);

  const createResponse = await request("/api/missing-persons", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({
      reportType: "missing_object",
      name: "Test Backpack",
      description: "Blue test backpack",
      lastSeenLocation: "India Gate"
    })
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  createdCitizenReportId = created.report.id;
  assert.equal(created.message, "Submitted for review");
  assert.equal("incident" in created, false);
  assert.equal("alert" in created, false);
  for (const field of ["matchConfidence", "matchedCameraId", "verificationStatus"]) {
    assert.equal(field in created.report, false);
  }
});

test("Admin video evidence upload creates AI observations and converts only after verification", async () => {
  const videoData = `data:video/mp4;base64,${Buffer.from("admin-video-evidence").toString("base64")}`;
  const upload = await request("/api/video-evidence", {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({
      fileName: "admin-investigation.mp4",
      fileSize: 20,
      mimeType: "video/mp4",
      durationSeconds: 12,
      dataUrl: videoData,
      linkedReportId: createdCitizenReportId,
      notes: "Admin chain-of-custody upload"
    })
  });
  assert.equal(upload.status, 201);
  const uploaded = await upload.json();
  assertNoEvidenceSecrets(uploaded);
  assert.equal(uploaded.evidence.source, "video_upload");
  assert.ok(uploaded.evidence.checksum);

  const list = await request("/api/video-evidence", { headers: authHeaders("Admin") });
  assert.equal(list.status, 200);
  assertNoEvidenceSecrets(await list.json());

  const analyzed = await request(`/api/video-evidence/${uploaded.evidence.id}/analyze`, {
    method: "POST",
    headers: { ...authHeaders("Admin"), Origin: "http://localhost:3000" }
  });
  assert.equal(analyzed.status, 200);
  const analyzedBody = await analyzed.json();
  assertNoEvidenceSecrets(analyzedBody);
  assert.equal("incident" in analyzedBody, false);
  assert.ok(analyzedBody.observations.length >= 1);
  const vehicleObservation = analyzedBody.observations.find((item) => item.detectionType === "vehicle_detected");
  assert.ok(vehicleObservation);
  assert.equal(vehicleObservation.vehicleType, "possible vehicle");
  assert.equal(vehicleObservation.possibleColor, "dark");
  assert.equal(vehicleObservation.plateDetected, true);
  assert.equal(vehicleObservation.possiblePlateText, "possible plate region");
  assert.equal(vehicleObservation.actionable, false);
  assert.match(vehicleObservation.message, /Possible/i);
  assert.doesNotMatch(vehicleObservation.message, /confirmed/i);
  const missingObjectObservation = analyzedBody.observations.find((item) => item.detectionType === "missing_object_possible_match");
  assert.ok(missingObjectObservation);
  assert.equal(missingObjectObservation.objectType, "backpack");
  assert.equal(missingObjectObservation.possibleColor, "blue");
  assert.equal(missingObjectObservation.actionable, false);
  const observation = analyzedBody.observations[0];
  assert.equal(observation.source, "video_upload");
  assert.equal(observation.actionable, false);
  assert.equal(observation.operationalAlert, false);
  assert.match(observation.message, /Possible/i);

  const verified = await request(`/api/video-observations/${observation.id}/review`, {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ action: "verify", notes: "Verified by human reviewer" })
  });
  assert.equal(verified.status, 200);
  const verifiedBody = await verified.json();
  assert.equal(verifiedBody.observation.reviewStatus, "verified");
  assert.equal(verifiedBody.observation.actionable, true);
  assert.equal(verifiedBody.observation.operationalAlert, false);

  const converted = await request(`/api/video-observations/${observation.id}/convert-incident`, {
    method: "POST",
    headers: { ...authHeaders("Admin"), Origin: "http://localhost:3000" }
  });
  assert.equal(converted.status, 200);
  const convertedBody = await converted.json();
  assert.equal(convertedBody.incident.sourceType, "video_upload");
  assert.equal(convertedBody.incident.sourceRecordId, observation.id);

  const audits = (await (await request("/api/audit-logs", { headers: authHeaders("Admin") })).json()).auditLogs.map((log) => log.action);
  for (const action of ["evidence_uploaded", "video_ai_analysis_started", "ai_observation_created", "observation_verified", "observation_converted_to_incident", "incident_created_from_video_observation"]) {
    assert.ok(audits.includes(action), action);
  }
});

test("Police video evidence must be case-linked and rejected observations cannot convert", async () => {
  const videoData = `data:video/webm;base64,${Buffer.from("police-video-evidence").toString("base64")}`;
  const unlinked = await request("/api/video-evidence", {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ fileName: "unlinked.webm", dataUrl: videoData })
  });
  assert.equal(unlinked.status, 400);

  const linked = await request("/api/video-evidence", {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ fileName: "linked.webm", dataUrl: videoData, linkedReportId: "report_other_citizen" })
  });
  assert.equal(linked.status, 201);
  const linkedBody = await linked.json();
  assertNoEvidenceSecrets(linkedBody);

  const analyzed = await request(`/api/video-evidence/${linkedBody.evidence.id}/analyze`, {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), Origin: "http://localhost:3000" }
  });
  assert.equal(analyzed.status, 200);
  const observation = (await analyzed.json()).observations[0];

  const rejected = await request(`/api/video-observations/${observation.id}/review`, {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ action: "reject", notes: "False positive" })
  });
  assert.equal(rejected.status, 200);
  const rejectedBody = await rejected.json();
  assert.equal(rejectedBody.observation.reviewStatus, "false_alarm");
  assert.equal(rejectedBody.observation.actionable, false);

  const convertRejected = await request(`/api/video-observations/${observation.id}/convert-incident`, {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), Origin: "http://localhost:3000" }
  });
  assert.equal(convertRejected.status, 409);
});

test("Citizen can upload evidence only for own report and cannot access operational video evidence", async () => {
  const videoData = `data:video/mp4;base64,${Buffer.from("citizen-video-evidence").toString("base64")}`;
  const operational = await request("/api/video-evidence", {
    method: "POST",
    headers: { ...authHeaders("Citizen"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ fileName: "citizen-operational.mp4", dataUrl: videoData })
  });
  assert.equal(operational.status, 403);

  const own = await request(`/api/reports/${createdCitizenReportId}/evidence`, {
    method: "POST",
    headers: { ...authHeaders("Citizen"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ fileName: "own-report-video.mp4", dataUrl: videoData })
  });
  assert.equal(own.status, 201);
  const ownBody = await own.json();
  assertNoEvidenceSecrets(ownBody);
  assert.equal(ownBody.message, "Evidence submitted for staff review.");
  assert.equal("confidence" in ownBody.evidence, false);
  assert.equal("observations" in ownBody, false);
  const ownEvidenceId = ownBody.evidence.evidenceId;

  const other = await request("/api/reports/report_other_citizen/evidence", {
    method: "POST",
    headers: { ...authHeaders("Citizen"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ fileName: "not-own.mp4", dataUrl: videoData })
  });
  assert.equal(other.status, 403);

  const secondCitizenHeaders = { Authorization: `Bearer ${tokenForId("u_citizen_second")}` };
  const secondCitizenEvidence = await request("/api/reports/report_other_citizen/evidence", {
    method: "POST",
    headers: { ...secondCitizenHeaders, "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ fileName: "second-citizen-own.mp4", dataUrl: videoData })
  });
  assert.equal(secondCitizenEvidence.status, 201);
  const secondCitizenEvidenceId = (await secondCitizenEvidence.json()).evidence.evidenceId;

  const ownPreview = await request(`/api/video-evidence/${ownEvidenceId}/preview`, { headers: authHeaders("Citizen") });
  assert.equal(ownPreview.status, 200);

  const secondCannotPreviewFirst = await request(`/api/video-evidence/${ownEvidenceId}/preview`, { headers: secondCitizenHeaders });
  assert.equal(secondCannotPreviewFirst.status, 403);

  const firstCannotPreviewSecond = await request(`/api/video-evidence/${secondCitizenEvidenceId}/preview`, { headers: authHeaders("Citizen") });
  assert.equal(firstCannotPreviewSecond.status, 403);

  assert.equal((await request("/api/video-evidence", { headers: authHeaders("Citizen") })).status, 403);
  const ownReports = await request("/api/missing-persons", { headers: authHeaders("Citizen") });
  assert.equal(ownReports.status, 200);
  const ownReportPayload = JSON.stringify(await ownReports.json());
  assert.equal(ownReportPayload.includes("confidence"), false);
  assert.equal(ownReportPayload.includes("detections"), false);
});

test("a second Citizen cannot view the first Citizen's report", async () => {
  const response = await request("/api/missing-persons", {
    headers: { Authorization: `Bearer ${tokenForId("u_citizen_second")}` }
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.reports.some((report) => report.id === createdCitizenReportId), false);
  assert.equal(body.reports.some((report) => report.id === "report_other_citizen"), true);
});

test("Police and Admin can review all citizen reports", async () => {
  for (const role of ["Police Officer", "Admin"]) {
    const response = await request("/api/missing-persons", { headers: authHeaders(role) });
    assert.equal(response.status, 200);
    const ids = (await response.json()).reports.map((report) => report.id);
    assert.ok(ids.includes(createdCitizenReportId), role);
    assert.ok(ids.includes("report_other_citizen"), role);
  }
});

test("new citizen reports appear first and can be rejected without creating incidents", async () => {
  const createResponse = await request("/api/missing-persons", {
    method: "POST",
    headers: { ...authHeaders("Citizen"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({
      reportType: "emergency_report",
      name: "Duplicate noise report",
      description: "Submitted for rejection workflow test",
      lastSeenLocation: "Gate A"
    })
  });
  assert.equal(createResponse.status, 201);
  rejectedCitizenReportId = (await createResponse.json()).report.id;

  const queue = await request("/api/missing-persons", { headers: authHeaders("Admin") });
  assert.equal(queue.status, 200);
  assert.equal((await queue.json()).reports[0].id, rejectedCitizenReportId);

  const rejected = await request(`/api/reports/${rejectedCitizenReportId}/reject`, {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ reason: "Duplicate / insufficient detail" })
  });
  assert.equal(rejected.status, 200);
  const body = await rejected.json();
  assert.equal(body.report.status, "rejected");
  assert.equal(body.report.incidentId, undefined);

  const incidents = await request("/api/incidents", { headers: authHeaders("Admin") });
  assert.equal((await incidents.json()).incidents.some((incident) => incident.sourceRecordId === rejectedCitizenReportId), false);
});

test("Citizen report remains review-only until Police converts it with location verification required", async () => {
  const before = await request("/api/incidents", { headers: authHeaders("Police Officer") });
  assert.equal((await before.json()).incidents.some((incident) => incident.sourceRecordId === createdCitizenReportId), false);
  const converted = await request(`/api/reports/${createdCitizenReportId}/create-incident`, {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: "{}"
  });
  assert.equal(converted.status, 201);
  const body = await converted.json();
  assert.equal(body.incident.status, "Verification Required");
  assert.equal(body.incident.dispatchable, false);
  assert.equal(body.incident.lat, null);
  assert.equal(body.incident.lng, null);
  assert.notEqual(body.incident.location?.lat, 28.6139);
  assert.notEqual(body.incident.location?.lng, 77.2295);
  assert.match(body.incident.locationSafetyLabel, /Location missing/i);
  assert.equal(body.incident.source, "Citizen");
  assert.equal(body.report.status, "verified");
});

test("Admin verifies citizen report, creates incident, removes queue item, and citizen status advances after assignment", async () => {
  const createResponse = await request("/api/missing-persons", {
    method: "POST",
    headers: { ...authHeaders("Citizen"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({
      reportType: "emergency_report",
      name: "Gate A assistance request",
      description: "Crowd assistance needed near the entry gate",
      lastSeenLocation: "Gate A",
      address: "Gate A",
      lat: 28.6164,
      lng: 77.2257,
      urgency: "high"
    })
  });
  assert.equal(createResponse.status, 201);
  const reportId = (await createResponse.json()).report.id;

  const queueBefore = await request("/api/missing-persons", { headers: authHeaders("Admin") });
  assert.equal(queueBefore.status, 200);
  assert.equal((await queueBefore.json()).reports.some((report) => report.id === reportId), true);

  const verified = await request(`/api/reports/${reportId}/create-incident`, {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: "{}"
  });
  assert.equal(verified.status, 201);
  const verifiedBody = await verified.json();
  assert.equal(verifiedBody.report.id, reportId);
  assert.equal(verifiedBody.report.status, "verified");
  assert.equal(verifiedBody.incident.source, "Citizen");
  assert.equal(verifiedBody.incident.sourceRecordId, reportId);
  assert.equal(verifiedBody.incident.status, "Verified");
  assert.match(verifiedBody.message, /Confirm the incident location before dispatch/i);

  const queueAfter = await request("/api/missing-persons", { headers: authHeaders("Admin") });
  assert.equal((await queueAfter.json()).reports.some((report) => report.id === reportId && report.status === "submitted_for_review"), false);

  const incidents = await request("/api/incidents", { headers: authHeaders("Police Officer") });
  assert.equal((await incidents.json()).incidents.some((incident) => incident.sourceRecordId === reportId), true);

  const citizenBeforeAssignment = await request("/api/missing-persons", { headers: authHeaders("Citizen") });
  assert.equal((await citizenBeforeAssignment.json()).reports.find((report) => report.id === reportId).status, "Verified");

  const auditResponse = await request("/api/audit-logs", { headers: authHeaders("Admin") });
  const auditLogs = (await auditResponse.json()).auditLogs;
  assert.ok(auditLogs.some((log) => log.action === "citizen_report_verified" && log.incidentId === verifiedBody.incident.id));
  assert.ok(auditLogs.some((log) => log.action === "citizen_report_converted" && log.incidentId === verifiedBody.incident.id));

  const confirmed = await request(`/api/incidents/${verifiedBody.incident.id}/confirm-location`, {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({
      lat: 28.6164,
      lng: 77.2257,
      address: "Browser GPS confirmed Gate A",
      locationSource: "browser_gps"
    })
  });
  assert.equal(confirmed.status, 200);
  const confirmedBody = await confirmed.json();
  assert.equal(confirmedBody.incident.locationSource, "browser_gps");
  assert.equal(confirmedBody.incident.dispatchable, true);

  const assigned = await request(`/api/incidents/${verifiedBody.incident.id}/assign-nearest`, {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: "{}"
  });
  assert.equal(assigned.status, 200);

  const citizenAfterAssignment = await request("/api/missing-persons", { headers: authHeaders("Citizen") });
  assert.equal((await citizenAfterAssignment.json()).reports.find((report) => report.id === reportId).status, "Assigned");
});

test("AI alerts remain pending review and do not auto-create incidents", async () => {
  const response = await request("/api/incidents", { headers: authHeaders("Admin") });
  const incidents = (await response.json()).incidents;
  assert.equal(incidents.some((incident) => incident.sourceRecordId === "alt_ai_admin_review"), false);
  assert.equal(incidents.some((incident) => incident.sourceRecordId === "alt_ai_police_review"), false);
});

test("Admin and Police can explicitly create verified incidents from reviewed AI alerts", async () => {
  for (const [role, alertId] of [["Admin", "alt_ai_admin_review"], ["Police Officer", "alt_ai_police_review"]]) {
    const acknowledged = await request(`/api/alerts/${alertId}/ack`, {
      method: "PATCH",
      headers: { ...authHeaders(role), Origin: "http://localhost:3000" }
    });
    assert.equal(acknowledged.status, 200, role);

    const verified = await request(`/api/alerts/${alertId}/review`, {
      method: "POST",
      headers: { ...authHeaders(role), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ action: "verify" })
    });
    assert.equal(verified.status, 200, role);

    const response = await request(`/api/alerts/${alertId}/review`, {
      method: "POST",
      headers: { ...authHeaders(role), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ action: "create_incident" })
    });
    assert.equal(response.status, 200, role);
    const body = await response.json();
    assert.equal(body.incident.status, "Verified");
    assert.equal(body.incident.source, "AI");
    assert.ok(body.incident.detectionMetadata.detectedObjects.length > 0);
    if (role === "Admin") reviewedIncidentId = body.incident.id;
    else {
      falseAlarmIncidentId = body.incident.id;
      falseAlarmAlertId = alertId;
    }
  }
});

test("Admin and Police can reject AI incidents as false alarms with audit/history cleanup", async () => {
  const citizen = await request(`/api/incidents/${falseAlarmIncidentId}/status`, {
    method: "PATCH",
    headers: { ...authHeaders("Citizen"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ status: "Rejected / False Alarm", reason: "Citizen should not be allowed" })
  });
  assert.equal(citizen.status, 403);

  const rejected = await request(`/api/incidents/${falseAlarmIncidentId}/status`, {
    method: "PATCH",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ status: "Rejected / False Alarm", reason: "Marked as false alarm by operator" })
  });
  assert.equal(rejected.status, 200);
  const body = await rejected.json();
  assert.equal(body.incident.status, "Rejected / False Alarm");
  assert.equal(body.incident.rejectionReason, "Marked as false alarm by operator");
  assert.match(body.message, /false alarm/i);

  const active = await request("/api/incidents", { headers: authHeaders("Admin") });
  assert.equal((await active.json()).incidents.some((incident) => incident.id === falseAlarmIncidentId), false);

  const history = await request("/api/incidents/history", { headers: authHeaders("Police Officer") });
  assert.equal((await history.json()).incidents.some((incident) => incident.id === falseAlarmIncidentId && incident.status === "Rejected / False Alarm"), true);

  const alerts = await request("/api/alerts", { headers: authHeaders("Admin") });
  assert.equal((await alerts.json()).alerts.some((alert) => alert.id === falseAlarmAlertId), false);

  const auditResponse = await request("/api/audit-logs", { headers: authHeaders("Admin") });
  const auditLogs = (await auditResponse.json()).auditLogs;
  assert.ok(auditLogs.some((log) => log.action === "false_alarm_rejected"
    && log.incidentId === falseAlarmIncidentId
    && log.details === "Marked as false alarm by operator"));

  const repeat = await request(`/api/incidents/${falseAlarmIncidentId}/status`, {
    method: "PATCH",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ status: "Assigned" })
  });
  assert.equal(repeat.status, 409);
  assert.match((await repeat.json()).error, /cannot transition/i);
});

test("Citizen cannot assign units while Police can assign the nearest available unit", async () => {
  const citizen = await request(`/api/incidents/${reviewedIncidentId}/assign-nearest`, {
    method: "POST",
    headers: { ...authHeaders("Citizen"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: "{}"
  });
  assert.equal(citizen.status, 403);

  const prematureDispatch = await request(`/api/incidents/${reviewedIncidentId}/status`, {
    method: "PATCH",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ status: "En Route" })
  });
  assert.equal(prematureDispatch.status, 409);

  const confirmLocation = await request(`/api/incidents/${reviewedIncidentId}/confirm-location`, {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({
      lat: 28.6139,
      lng: 77.2295,
      address: "Operator browser GPS point",
      locationSource: "browser_gps"
    })
  });
  assert.equal(confirmLocation.status, 200);
  assert.equal((await confirmLocation.json()).incident.locationStatus, "Verified");

  const police = await request(`/api/incidents/${reviewedIncidentId}/assign-nearest`, {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: "{}"
  });
  assert.equal(police.status, 200);
  const body = await police.json();
  assert.equal(body.incident.status, "Assigned");
  assert.equal(body.unit.status, "busy");
  assert.ok(body.incident.etaMinutes >= 1);
  assignedResponseUnitId = body.unit.id;
});

test("incident lifecycle supports En Route, On Scene, Resolved, and Closed", async () => {
  for (const status of ["En Route", "On Scene", "Resolved"]) {
    const response = await request(`/api/incidents/${reviewedIncidentId}/status`, {
      method: "PATCH",
      headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ status })
    });
    assert.equal(response.status, 200, status);
    assert.equal((await response.json()).incident.status, status);
  }

  const resolvedHistory = await request("/api/incidents/history", { headers: authHeaders("Police Officer") });
  assert.equal(resolvedHistory.status, 200);
  assert.equal((await resolvedHistory.json()).incidents.some((incident) => incident.id === reviewedIncidentId && incident.status === "Resolved"), true);

  const closeResponse = await request(`/api/incidents/${reviewedIncidentId}/status`, {
    method: "PATCH",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ status: "Closed" })
  });
  assert.equal(closeResponse.status, 200);
  assert.equal((await closeResponse.json()).incident.status, "Closed");

  const reopen = await request(`/api/incidents/${reviewedIncidentId}/status`, {
    method: "PATCH",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ status: "On Scene" })
  });
  assert.equal(reopen.status, 409);

  const unitsResponse = await request("/api/response-units", { headers: authHeaders("Police Officer") });
  assert.equal(unitsResponse.status, 200);
  const releasedUnit = (await unitsResponse.json()).units.find((unit) => unit.id === assignedResponseUnitId);
  assert.equal(releasedUnit.status, "available");
  assert.equal(releasedUnit.assignedIncidentId, null);

  const closedHistory = await request("/api/incidents/history", { headers: authHeaders("Police Officer") });
  assert.equal(closedHistory.status, 200);
  assert.equal((await closedHistory.json()).incidents.some((incident) => incident.id === reviewedIncidentId && incident.status === "Closed"), true);
});

test("workflow actions create audit logs", async () => {
  const response = await request("/api/audit-logs", { headers: authHeaders("Admin") });
  assert.equal(response.status, 200);
  const actions = (await response.json()).auditLogs.map((log) => log.action);
  for (const action of ["citizen_report_submitted", "citizen_report_verified", "citizen_report_converted", "citizen_report_rejected", "ai_alert_reviewed", "incident_verified", "unit_assigned", "incident_resolved", "incident_closed"]) {
    assert.ok(actions.includes(action), action);
  }
});

test("GIS command endpoints allow Admin/Police and reject Citizen", async () => {
  for (const role of ["Admin", "Police Officer"]) {
    const headers = authHeaders(role);
    assert.equal((await request("/api/maps/search?q=x", { headers })).status, 400);
    assert.equal((await request("/api/maps/reverse?lat=999&lng=77", { headers })).status, 400);
    const route = await request("/api/maps/route", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({
        start: { lat: 28.6139, lng: 77.209 },
        destination: { lat: 28.6129, lng: 77.2295 },
        mode: "driving"
      })
    });
    assert.equal(route.status, 200, role);
    const routeBody = await route.json();
    assert.ok(routeBody.distanceKm >= 0);
    assert.equal(routeBody.routeOptions.length >= 2, true);
    assert.equal(routeBody.routeOptions[0].label, "Recommended");
    assert.match(routeBody.alternativeMessage, /route options/i);
  }

  for (const route of ["/api/maps/search?q=Delhi", "/api/maps/reverse?lat=28.6&lng=77.2", "/api/response-units/nearest?lat=28.6&lng=77.2"]) {
    assert.equal((await request(route, { headers: authHeaders("Citizen") })).status, 403);
  }
  const citizenRoute = await request("/api/maps/route", {
    method: "POST",
    headers: { ...authHeaders("Citizen"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ start: { lat: 28, lng: 77 }, destination: { lat: 29, lng: 78 } })
  });
  assert.equal(citizenRoute.status, 403);
});

test("self-hosted OSRM URL is used by map and backend route calculations", async () => {
  const snapshot = routingEnvSnapshot();
  osrmRequests = [];
  process.env.GIS_ROUTING_PROVIDER = "self_hosted";
  process.env.OSRM_BASE_URL = `http://127.0.0.1:${osrmServer.address().port}`;
  process.env.PUBLIC_OSRM_FALLBACK = "false";
  process.env.ROUTE_TIMEOUT_MS = "3000";
  try {
    const mapRoute = await request("/api/maps/route", {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ start: { lat: 28.6139, lng: 77.209 }, destination: { lat: 28.6129, lng: 77.2295 } })
    });
    assert.equal(mapRoute.status, 200);
    const mapBody = await mapRoute.json();
    assert.equal(mapBody.approximate, false);
    assert.equal(mapBody.isApproximate, false);
    assert.equal(mapBody.routeType, "osrm");

    const backendRoute = await request("/api/route?fromLat=28.6139&fromLng=77.209&toLat=28.6129&toLng=77.2295", {
      headers: authHeaders("Admin")
    });
    assert.equal(backendRoute.status, 200);
    const backendBody = await backendRoute.json();
    assert.equal(backendBody.route.approximate, false);
    assert.equal(backendBody.route.isApproximate, false);
    assert.equal(backendBody.route.routeType, "osrm");

    assert.equal(osrmRequests.length >= 2, true);
    assert.ok(osrmRequests.every((item) => item.url.startsWith("/route/v1/")));
  } finally {
    restoreRoutingEnv(snapshot);
    osrmRequests = [];
  }
});

test("public OSRM is not used when public fallback is disabled", async () => {
  const snapshot = routingEnvSnapshot();
  osrmRequests = [];
  process.env.GIS_ROUTING_PROVIDER = "public";
  delete process.env.OSRM_BASE_URL;
  process.env.PUBLIC_OSRM_FALLBACK = "false";
  process.env.ROUTE_TIMEOUT_MS = "3000";
  try {
    const mapRoute = await request("/api/maps/route", {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ start: { lat: 28.61, lng: 77.20 }, destination: { lat: 28.62, lng: 77.23 } })
    });
    assert.equal(mapRoute.status, 200);
    const mapBody = await mapRoute.json();
    assert.equal(mapBody.routeType, "approximate_fallback");
    assert.equal(mapBody.isApproximate, true);
    assert.equal(mapBody.provider, "haversine");

    const backendRoute = await request("/api/route?fromLat=28.61&fromLng=77.20&toLat=28.62&toLng=77.23", {
      headers: authHeaders("Admin")
    });
    assert.equal(backendRoute.status, 200);
    const backendBody = await backendRoute.json();
    assert.equal(backendBody.route.routeType, "approximate_fallback");
    assert.equal(backendBody.route.isApproximate, true);
    assert.equal(backendBody.route.provider, "local-fallback");

    assert.equal(osrmRequests.length, 0);
  } finally {
    restoreRoutingEnv(snapshot);
  }
});

test("production routing config refuses public OSRM", () => {
  const snapshot = routingEnvSnapshot();
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  process.env.GIS_ROUTING_PROVIDER = "public";
  delete process.env.OSRM_BASE_URL;
  process.env.PUBLIC_OSRM_FALLBACK = "true";
  try {
    assert.throws(() => resolveOsrmBaseUrl(), /public is not allowed in production/);

    process.env.GIS_ROUTING_PROVIDER = "self_hosted";
    process.env.OSRM_BASE_URL = PUBLIC_OSRM_BASE_URL;
    assert.throws(() => resolveOsrmBaseUrl(), /Public OSRM is not allowed in production/);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    restoreRoutingEnv(snapshot);
  }
});

test("unavailable self-hosted OSRM returns approximate fallback instead of 500", async () => {
  const snapshot = routingEnvSnapshot();
  process.env.GIS_ROUTING_PROVIDER = "self_hosted";
  process.env.OSRM_BASE_URL = "http://127.0.0.1:1";
  process.env.PUBLIC_OSRM_FALLBACK = "false";
  process.env.ROUTE_TIMEOUT_MS = "100";
  try {
    const response = await request("/api/maps/route", {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ start: { lat: 28.61, lng: 77.20 }, destination: { lat: 28.62, lng: 77.23 } })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.routeType, "approximate_fallback");
    assert.equal(body.isApproximate, true);
    assert.match(body.warning, /Self-hosted routing unavailable/);
  } finally {
    restoreRoutingEnv(snapshot);
  }
});

test("routes outside the local OSRM extract fall back to approximate routing", async () => {
  const noRouteServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "NoRoute", routes: [] }));
  });
  await new Promise((resolve) => noRouteServer.listen(0, "127.0.0.1", resolve));
  const snapshot = routingEnvSnapshot();
  process.env.GIS_ROUTING_PROVIDER = "self_hosted";
  process.env.OSRM_BASE_URL = `http://127.0.0.1:${noRouteServer.address().port}`;
  process.env.PUBLIC_OSRM_FALLBACK = "false";
  process.env.ROUTE_TIMEOUT_MS = "3000";
  try {
    const response = await request("/api/maps/route", {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ start: { lat: 28.61, lng: 77.20 }, destination: { lat: 19.07, lng: 72.87 } })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.routeType, "approximate_fallback");
    assert.equal(body.isApproximate, true);
    assert.match(body.warning, /Self-hosted routing unavailable/);
  } finally {
    restoreRoutingEnv(snapshot);
    await new Promise((resolve, reject) => noRouteServer.close((error) => error ? reject(error) : resolve()));
  }
});

test("map defaults and demo registries do not fall back to Delhi coordinates", async () => {
  const stationResponse = await request("/api/police-stations", { headers: authHeaders("Admin") });
  const stationBody = await stationResponse.json();
  assert.deepEqual(stationBody.defaultCenter, DEFAULT_LOCAL_CENTER);

  const unitResponse = await request("/api/response-units", { headers: authHeaders("Admin") });
  const unitBody = await unitResponse.json();
  const demoUnits = unitBody.units.filter((unit) => unit.isDemo);
  assert.ok(demoUnits.length >= 1);
  for (const item of [...stationBody.stations, ...demoUnits]) {
    assert.equal(item.lat >= 17 && item.lat <= 18, true, item.stationName || item.unitName);
    assert.equal(item.lng >= 78 && item.lng <= 79, true, item.stationName || item.unitName);
    assert.equal(item.lat >= 28.4 && item.lat <= 28.8, false, item.stationName || item.unitName);
    assert.equal(item.lng >= 77.0 && item.lng <= 77.4, false, item.stationName || item.unitName);
  }

  const zones = await request("/api/zones", { headers: authHeaders("Admin") });
  for (const zone of (await zones.json()).zones) {
    assert.equal(zone.lat >= 17 && zone.lat <= 18, true, zone.name);
    assert.equal(zone.lng >= 78 && zone.lng <= 79, true, zone.name);
  }

  const indexHtml = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "index.html"), "utf8");
  const appJs = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "app.js"), "utf8");
  assert.match(indexHtml, /data-map-lat="17\.5109"/);
  assert.match(indexHtml, /data-map-lng="78\.3276"/);
  assert.equal(/data-map-lat="28\./.test(indexHtml), false);
  assert.equal(/New Delhi|Delhi", lat: 28\./.test(appJs), false);
});

test("legacy Delhi fallback data is quarantined or normalized before dispatch", async () => {
  const untrustedIncidentId = "inc_untrusted_legacy_delhi";
  const normalizedIncidentId = "inc_legacy_gate_a_normalized";
  const trustedIncidentId = "inc_trusted_manual_delhi";
  const untrustedAlertId = "alt_untrusted_legacy_delhi";
  const releaseUnitId = "unit_legacy_release";
  const realRegistryUnitId = "unit_real_registry_delhi_preserved";
  const db = await readDatabase();
  const originalUnits = structuredClone(db.responseUnits);
  const originalIncidents = structuredClone(db.incidents);
  const originalAlerts = structuredClone(db.alerts);
  const originalAudits = structuredClone(db.auditLogs);
  const fresh = new Date().toISOString();
  db.responseUnits.unshift({
    id: releaseUnitId,
    unitCode: "P-LEG",
    name: "Legacy Assigned Patrol",
    unitType: "police_patrol",
    status: "busy",
    lat: PATANCHERU_POINT.lat,
    lng: PATANCHERU_POINT.lng,
    source: "admin_registry",
    isDemo: false,
    operational: true,
    assignedIncidentId: untrustedIncidentId,
    currentIncidentId: untrustedIncidentId,
    lastUpdated: fresh,
    lastLocationUpdatedAt: fresh
  }, {
    id: realRegistryUnitId,
    unitCode: "P-REAL",
    name: "Admin Registered Patrol",
    unitType: "police_patrol",
    status: "available",
    lat: 28.6139,
    lng: 77.2295,
    source: "admin_registry",
    isDemo: false,
    operational: true,
    assignedIncidentId: null,
    currentIncidentId: null,
    lastUpdated: fresh,
    lastLocationUpdatedAt: fresh
  });
  db.incidents.unshift(
    {
      id: untrustedIncidentId,
      title: "Legacy fallback incident",
      category: "manual",
      sourceType: "manual",
      sourceName: "Legacy Import",
      status: "En Route",
      zone: "All Zones",
      lat: 28.6139,
      lng: 77.2295,
      assignedUnitId: releaseUnitId,
      distanceKm: 2.3,
      etaMinutes: 6,
      createdAt: fresh
    },
    {
      id: normalizedIncidentId,
      title: "Legacy Gate A incident",
      category: "manual",
      sourceType: "manual",
      sourceName: "Legacy Import",
      status: "Assigned",
      zone: "Gate A",
      address: "Main Entry Gate A",
      lat: 28.6164,
      lng: 77.2257,
      assignedUnitId: releaseUnitId,
      distanceKm: 1.1,
      etaMinutes: 4,
      createdAt: fresh
    },
    {
      id: trustedIncidentId,
      title: "Trusted manual Delhi incident",
      category: "manual",
      sourceType: "manual",
      sourceName: "Manual Coordinates",
      status: "Verified",
      zone: "Delhi",
      lat: 28.6139,
      lng: 77.2295,
      locationSource: "manual_latlng",
      locationStatus: "Verified",
      createdAt: fresh
    }
  );
  db.alerts.unshift({
    id: untrustedAlertId,
    title: "Legacy fallback alert",
    sourceType: "manual",
    sourceName: "Legacy Import",
    zone: "All Zones",
    lat: 28.6139,
    lng: 77.2295,
    acknowledged: false,
    actionable: true,
    verificationStatus: "verified",
    reviewStatus: "verified",
    status: "New",
    createdAt: fresh
  });
  await writeDatabase(db);

  try {
    const repairs = await repairLegacyPersistedData();
    assert.ok(repairs.some((item) => item.action === "legacy_location_unconfirmed"));
    assert.ok(repairs.some((item) => item.action === "legacy_location_normalized"));
    assert.ok(repairs.some((item) => item.action === "unit_released_legacy_location"));

    const incidentsResponse = await request("/api/incidents", { headers: authHeaders("Admin") });
    const incidents = (await incidentsResponse.json()).incidents;
    const untrusted = incidents.find((incident) => incident.id === untrustedIncidentId);
    const normalized = incidents.find((incident) => incident.id === normalizedIncidentId);
    const trusted = incidents.find((incident) => incident.id === trustedIncidentId);
    assert.equal(untrusted.lat, null);
    assert.equal(untrusted.lng, null);
    assert.equal(untrusted.location, null);
    assert.equal(untrusted.locationSource, "unknown");
    assert.equal(untrusted.locationStatus, "Needs Confirmation");
    assert.equal(untrusted.dispatchable, false);
    assert.equal(untrusted.assignedUnitId, null);
    assert.equal(untrusted.etaMinutes, null);
    assert.equal(untrusted.distanceKm, null);
    assert.deepEqual(normalized.location, PATANCHERU_POINT);
    assert.equal(normalized.isDemo, true);
    assert.equal(normalized.locationSource, "demo_seed_normalized");
    assert.equal(normalized.locationStatus, "Verified");
    assert.equal(normalized.status, "Verified");
    assert.deepEqual(trusted.location, { lat: 28.6139, lng: 77.2295 });
    assert.equal(trusted.locationSource, "manual_latlng");

    const unitsResponse = await request("/api/response-units", { headers: authHeaders("Admin") });
    const unitsBody = await unitsResponse.json();
    const releasedUnit = unitsBody.units.find((unit) => unit.id === releaseUnitId);
    const preservedRealUnit = unitsBody.units.find((unit) => unit.id === realRegistryUnitId);
    assert.equal(releasedUnit.status, "available");
    assert.equal(releasedUnit.assignedIncidentId, null);
    assert.equal(releasedUnit.source, "admin_registry");
    assert.equal(releasedUnit.isDemo, false);
    assert.equal(preservedRealUnit.lat, 28.6139);
    assert.equal(preservedRealUnit.lng, 77.2295);
    assert.equal(preservedRealUnit.source, "admin_registry");
    assert.equal(preservedRealUnit.isDemo, false);

    const alertsResponse = await request("/api/alerts", { headers: authHeaders("Admin") });
    const alert = (await alertsResponse.json()).alerts.find((item) => item.id === untrustedAlertId);
    assert.equal(alert.lat, null);
    assert.equal(alert.lng, null);
    assert.equal(alert.locationSource, "unknown");
    assert.equal(alert.actionable, false);
    assert.equal(alert.verificationStatus, "location_needs_confirmation");

    const acknowledged = await request(`/api/alerts/${untrustedAlertId}/ack`, {
      method: "PATCH",
      headers: { ...authHeaders("Admin"), Origin: "http://localhost:3000" }
    });
    assert.equal(acknowledged.status, 200);
    const verified = await request(`/api/alerts/${untrustedAlertId}/review`, {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ action: "verify" })
    });
    assert.equal(verified.status, 200);
    const convert = await request(`/api/alerts/${untrustedAlertId}/review`, {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ action: "convert_incident" })
    });
    assert.equal(convert.status, 409);
    assert.match((await convert.json()).error, /actionable/i);

    const auditActions = (await readDatabase()).auditLogs.map((log) => log.action);
    assert.ok(auditActions.includes("legacy_location_unconfirmed"));
    assert.ok(auditActions.includes("legacy_location_normalized"));
    assert.ok(auditActions.includes("unit_released_legacy_location"));
  } finally {
    const restored = await readDatabase();
    restored.responseUnits = originalUnits;
    restored.incidents = originalIncidents;
    restored.alerts = originalAlerts;
    restored.auditLogs = originalAudits;
    await writeDatabase(restored);
  }
});

test("GIS validation rejects invalid route and search payloads safely", async () => {
  const headers = authHeaders("Admin");
  assert.equal((await request("/api/maps/search?q=", { headers })).status, 400);
  const response = await request("/api/maps/route", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ start: { lat: 999, lng: 77 }, destination: null })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /coordinates/i);

  const swapped = await request("/api/maps/route", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ start: { lat: 120, lng: 28.6 }, destination: { lat: 28.61, lng: 77.22 } })
  });
  assert.equal(swapped.status, 400);
});

test("incident locations require operator verification and route recalculation uses the edited coordinates", async () => {
  const created = await request("/api/incidents", {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({
      title: "Navigation accuracy test",
      category: "manual",
      status: "Verified",
      lat: 28.61,
      lng: 77.21,
      address: "Initial test location",
      locationStatus: "Approximate"
    })
  });
  assert.equal(created.status, 201);
  const incident = (await created.json()).incident;
  assert.equal(incident.locationStatus, "Approximate");

  const blockedDispatch = await request(`/api/incidents/${incident.id}/assign-nearest`, {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: "{}"
  });
  assert.equal(blockedDispatch.status, 409);

  const citizenEdit = await request(`/api/incidents/${incident.id}/location`, {
    method: "PATCH",
    headers: { ...authHeaders("Citizen"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ lat: 28.6201, lng: 77.2302, address: "Forbidden edit" })
  });
  assert.equal(citizenEdit.status, 403);

  const editedPoint = { lat: 28.6201, lng: 77.2302 };
  const edited = await request(`/api/incidents/${incident.id}/location`, {
    method: "PATCH",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ ...editedPoint, address: "Verified test destination", locationSource: "manual_latlng", confirmed: true })
  });
  assert.equal(edited.status, 200);
  const editedIncident = (await edited.json()).incident;
  assert.deepEqual(editedIncident.location, editedPoint);
  assert.equal(editedIncident.locationStatus, "Verified");
  assert.equal(editedIncident.locationSource, "manual_latlng");

  const route = await request("/api/maps/route", {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ start: { lat: 28.61, lng: 77.20 }, destination: editedIncident.location })
  });
  assert.equal(route.status, 200);
  const routeBody = await route.json();
  assert.deepEqual(routeBody.requestedDestination, editedPoint);
  assert.equal(routeBody.approximate, false);
});

test("incidents with invalid coordinates cannot be assigned or routed", async () => {
  for (const payload of [
    { title: "Zero coordinate incident", category: "manual", status: "Verified", lat: 0, lng: 0, address: "Invalid zero point", locationStatus: "Verified" },
    { title: "Null coordinate incident", category: "manual", status: "Verified", lat: null, lng: null, address: "Missing point", locationStatus: "Verified" }
  ]) {
    const created = await request("/api/incidents", {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify(payload)
    });
    assert.equal(created.status, 201);
    const incident = (await created.json()).incident;
    assert.equal(incident.location, null);
    assert.equal(incident.dispatchable, false);
    assert.equal(incident.status, "Verification Required");
    assert.match(incident.locationSafetyLabel, /Location missing/i);

    const recommend = await request(`/api/incidents/${incident.id}/recommend-unit`, {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: "{}"
    });
    assert.equal(recommend.status, 409);
    assert.match((await recommend.json()).error, /Incident location missing/i);

    const assignment = await request(`/api/incidents/${incident.id}/assign-nearest`, {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: "{}"
    });
    assert.equal(assignment.status, 409);
    assert.match((await assignment.json()).error, /Incident location missing|Verify the incident/i);
  }
});

test("default-like coordinates with unknown source are not dispatchable", async () => {
  const created = await request("/api/incidents", {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({
      title: "Unknown source dispatch block",
      category: "manual",
      status: "Verified",
      lat: 28.6139,
      lng: 77.2295,
      address: "Unconfirmed default-like point",
      locationStatus: "Verified",
      locationSource: "unknown"
    })
  });
  assert.equal(created.status, 201);
  const incident = (await created.json()).incident;
  assert.equal(incident.dispatchable, false);
  assert.equal(incident.locationSource, "unknown");
  assert.match(incident.locationSafetyLabel, /source unconfirmed/i);

  const assignment = await request(`/api/incidents/${incident.id}/assign-nearest`, {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: "{}"
  });
  assert.equal(assignment.status, 409);
  assert.match((await assignment.json()).error, /Incident location missing|GPS, search, map click, or manual coordinates/i);
});

test("valid verified incident remains assignable", async () => {
  const db = await readDatabase();
  db.responseUnits.forEach((unit) => {
    unit.status = "available";
    unit.assignedIncidentId = null;
    unit.lastUpdated = new Date().toISOString();
    unit.lastLocationUpdatedAt = unit.lastUpdated;
  });
  await writeDatabase(db);

  const created = await request("/api/incidents", {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({
      title: "Valid dispatch point",
      category: "manual",
      status: "Verified",
      lat: 28.61,
      lng: 77.22,
      address: "Verified valid point",
      locationStatus: "Verified"
    })
  });
  assert.equal(created.status, 201);
  const incident = (await created.json()).incident;
  assert.equal(incident.dispatchable, true);

  const assignment = await request(`/api/incidents/${incident.id}/assign-nearest`, {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: "{}"
  });
  assert.equal(assignment.status, 200);
  const body = await assignment.json();
  assert.equal(body.incident.status, "Assigned");
  assert.ok(body.incident.etaMinutes >= 1);
  assert.match(body.unit.vehicleType, /Patrol/i);
});

test("dispatch prefers real operational registry units over demo seed units", async () => {
  const db = await readDatabase();
  const originalUnits = structuredClone(db.responseUnits);
  const fresh = new Date().toISOString();
  db.responseUnits = [
    {
      id: "demo_closer_unit",
      unitCode: "P-D1",
      name: "Closer Demo Patrol",
      vehicleType: "Patrol Car",
      unitType: "police_patrol",
      status: "available",
      lat: 28.6101,
      lng: 77.2201,
      source: "demo_seed",
      isDemo: true,
      operational: true,
      assignedIncidentId: null,
      lastUpdated: fresh,
      lastLocationUpdatedAt: fresh
    },
    {
      id: "real_registry_unit",
      unitCode: "P-R1",
      name: "Real Registry Patrol",
      vehicleType: "Patrol SUV",
      unitType: "police_patrol",
      status: "available",
      lat: 28.613,
      lng: 77.223,
      beat: "Gate A",
      jurisdiction: "Sector 7",
      source: "admin_registry",
      isDemo: false,
      operational: true,
      assignedIncidentId: null,
      lastUpdated: fresh,
      lastLocationUpdatedAt: fresh
    }
  ];
  await writeDatabase(db);
  try {
    const created = await request("/api/incidents", {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({
        title: "Real unit preference test",
        category: "manual",
        status: "Verified",
        lat: 28.61,
        lng: 77.22,
        address: "Gate A response point",
        zone: "Gate A",
        locationStatus: "Verified"
      })
    });
    const incident = (await created.json()).incident;
    const assignment = await request(`/api/incidents/${incident.id}/assign-nearest`, {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: "{}"
    });
    assert.equal(assignment.status, 200);
    const body = await assignment.json();
    assert.equal(body.unit.id, "real_registry_unit");
    assert.equal(body.unit.isDemo, false);
    assert.equal(body.unit.source, "admin_registry");
    assert.equal(body.excludedUnits.some((unit) => unit.id === "demo_closer_unit" && /Demo unit excluded/i.test(unit.exclusionReason)), true);
    assert.match(body.selectionReason, /Source: Admin registry/i);
  } finally {
    const restored = await readDatabase();
    restored.responseUnits = originalUnits.map((unit) => ({
      ...unit,
      status: "available",
      assignedIncidentId: null,
      lastUpdated: new Date().toISOString(),
      lastLocationUpdatedAt: new Date().toISOString()
    }));
    await writeDatabase(restored);
  }
});

test("nearest dispatch ranks available police units by ETA and distance with exclusion reasons", async () => {
  const db = await readDatabase();
  const originalUnits = structuredClone(db.responseUnits);
  const originalIncidents = structuredClone(db.incidents);
  const fresh = new Date().toISOString();
  db.responseUnits = [
    {
      id: "rank_fast",
      unitCode: "P-10",
      name: "Fast Patrol",
      officerName: "Inspector Fast",
      vehicleType: "Patrol Car",
      status: "available",
      lat: 28.611,
      lng: 77.221,
      zone: "Gate A",
      assignedIncidentId: null,
      lastUpdated: fresh,
      lastLocationUpdatedAt: fresh
    },
    {
      id: "rank_far",
      unitCode: "P-11",
      name: "Far Patrol",
      officerName: "Inspector Far",
      vehicleType: "Patrol SUV",
      status: "available",
      lat: 28.64,
      lng: 77.26,
      zone: "Central Sector",
      assignedIncidentId: null,
      lastUpdated: fresh,
      lastLocationUpdatedAt: fresh
    },
    {
      id: "rank_busy",
      unitCode: "P-12",
      name: "Busy Patrol",
      vehicleType: "Patrol Car",
      status: "busy",
      lat: 28.6105,
      lng: 77.2205,
      assignedIncidentId: "other_incident",
      lastUpdated: fresh,
      lastLocationUpdatedAt: fresh
    },
    {
      id: "rank_offline",
      unitCode: "P-13",
      name: "Offline Patrol",
      vehicleType: "Patrol Car",
      status: "offline",
      lat: 28.6104,
      lng: 77.2204,
      assignedIncidentId: null,
      lastUpdated: fresh,
      lastLocationUpdatedAt: fresh
    },
    {
      id: "rank_stale",
      unitCode: "P-14",
      name: "Stale Patrol",
      vehicleType: "Patrol Car",
      status: "available",
      lat: 28.6103,
      lng: 77.2203,
      assignedIncidentId: null,
      lastUpdated: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      lastLocationUpdatedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString()
    }
  ];
  db.incidents.push({
    id: "rank_busy_existing_incident",
    title: "Existing busy assignment",
    category: "manual",
    severity: "low",
    status: "Assigned",
    assignedUnitId: "rank_busy",
    lat: 28.615,
    lng: 77.225,
    address: "Existing assignment",
    locationStatus: "Verified",
    locationSource: "manual_latlng",
    createdAt: fresh,
    updatedAt: fresh
  });
  await writeDatabase(db);
  try {
    const created = await request("/api/incidents", {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({
        title: "Ranked dispatch test",
        category: "manual",
        status: "Verified",
        lat: 28.61,
        lng: 77.22,
        address: "Verified ranked dispatch point",
        locationStatus: "Verified"
      })
    });
    const incident = (await created.json()).incident;
    const assignment = await request(`/api/incidents/${incident.id}/assign-nearest`, {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: "{}"
    });
    assert.equal(assignment.status, 200);
    const body = await assignment.json();
    assert.equal(body.unit.id, "rank_fast");
    assert.equal(body.candidates[0].id, "rank_fast");
    assert.equal(body.candidates[0].rank, 1);
    assert.match(body.selectionReason, /closest by ETA/i);
    assert.ok(body.candidates[0].etaMinutes >= 1);
    assert.ok(body.candidates[0].distanceKm > 0);
    assert.equal(body.excludedUnits.some((unit) => unit.id === "rank_busy" && /Busy/i.test(unit.exclusionReason)), true);
    assert.equal(body.excludedUnits.some((unit) => unit.id === "rank_offline" && /Offline/i.test(unit.exclusionReason)), true);
    assert.equal(body.excludedUnits.some((unit) => unit.id === "rank_stale" && /Stale GPS/i.test(unit.exclusionReason)), true);
    assert.match(body.warnings.join(" "), /stale/i);
    assert.ok(body.route.routeOptions.length >= 2);
    assert.ok(body.incident.distanceKm > 0);
    assert.ok(body.incident.etaMinutes >= 1);
    assert.equal(body.incident.navigationReady, true);
  } finally {
    const restored = await readDatabase();
    restored.incidents = originalIncidents;
    restored.responseUnits = originalUnits.map((unit) => ({
      ...unit,
      status: "available",
      assignedIncidentId: null,
      lastUpdated: new Date().toISOString(),
      lastLocationUpdatedAt: new Date().toISOString()
    }));
    await writeDatabase(restored);
  }
});

test("stale and offline units are excluded from automatic nearest-unit dispatch", async () => {
  const db = await readDatabase();
  const originalUnits = structuredClone(db.responseUnits);
  db.responseUnits = [
    {
      id: "stale_police_unit",
      unitCode: "P-90",
      name: "Stale Patrol Unit",
      officerName: "Inspector Stale",
      vehicleType: "Patrol Car",
      status: "available",
      lat: 28.612,
      lng: 77.221,
      assignedIncidentId: null,
      lastUpdated: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      lastLocationUpdatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString()
    },
    {
      id: "offline_police_unit",
      unitCode: "P-91",
      name: "Offline Patrol Unit",
      officerName: "Inspector Offline",
      vehicleType: "Patrol SUV",
      status: "offline",
      lat: 28.613,
      lng: 77.222,
      assignedIncidentId: null,
      lastUpdated: new Date().toISOString(),
      lastLocationUpdatedAt: new Date().toISOString()
    }
  ];
  await writeDatabase(db);
  try {
    const created = await request("/api/incidents", {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({
        title: "Stale unit dispatch test",
        category: "manual",
        status: "Verified",
        lat: 28.61,
        lng: 77.22,
        address: "Verified dispatch point",
        locationStatus: "Verified"
      })
    });
    const incident = (await created.json()).incident;
    const assignment = await request(`/api/incidents/${incident.id}/assign-nearest`, {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: "{}"
    });
    assert.equal(assignment.status, 409);
    assert.match((await assignment.json()).error, /stale GPS/i);
  } finally {
    const restored = await readDatabase();
    restored.responseUnits = originalUnits.map((unit) => ({
      ...unit,
      status: "available",
      assignedIncidentId: null,
      lastUpdated: new Date().toISOString(),
      lastLocationUpdatedAt: new Date().toISOString()
    }));
    await writeDatabase(restored);
  }
});

test("nearest assignment falls back to approximate ETA when route service is unavailable", async () => {
  const healthyUrl = process.env.OSRM_BASE_URL;
  process.env.OSRM_BASE_URL = "http://127.0.0.1:1";
  const db = await readDatabase();
  db.responseUnits.forEach((unit) => {
    unit.status = "offline";
    unit.assignedIncidentId = null;
    unit.lastUpdated = new Date().toISOString();
    unit.lastLocationUpdatedAt = unit.lastUpdated;
  });
  db.responseUnits.push({
    id: "fresh_fallback_police",
    unitCode: "P-95",
    name: "Fallback Patrol Unit",
    officerName: "Inspector Fallback",
    vehicleType: "Patrol Car",
    status: "available",
    lat: 28.612,
    lng: 77.218,
    assignedIncidentId: null,
    lastUpdated: new Date().toISOString(),
    lastLocationUpdatedAt: new Date().toISOString()
  });
  await writeDatabase(db);
  try {
    const created = await request("/api/incidents", {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({
        title: "Approximate route assignment",
        category: "manual",
        status: "Verified",
        lat: 28.61,
        lng: 77.22,
        address: "Verified fallback point",
        locationStatus: "Verified"
      })
    });
    const incident = (await created.json()).incident;
    const assignment = await request(`/api/incidents/${incident.id}/assign-nearest`, {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: "{}"
    });
    assert.equal(assignment.status, 200);
    const body = await assignment.json();
    assert.equal(body.incident.status, "Assigned");
    assert.equal(body.route.approximate, true);
    assert.equal(body.route.routeLabel, "Approximate fallback route");
    assert.equal(body.route.routeOptions[0].label, "Approximate fallback route");
    assert.ok(body.incident.distanceKm > 0);
    assert.ok(body.incident.etaMinutes >= 1);
    assert.equal(body.incident.navigationReady, true);
    assert.match(body.unit.vehicleType, /Patrol/i);
  } finally {
    process.env.OSRM_BASE_URL = healthyUrl;
  }
});

test("OSRM failure returns a clearly labelled degraded response without a fabricated ETA", async () => {
  const healthyUrl = process.env.OSRM_BASE_URL;
  process.env.OSRM_BASE_URL = "http://127.0.0.1:1";
  try {
    const response = await request("/api/maps/route", {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ start: { lat: 28.61, lng: 77.20 }, destination: { lat: 28.62, lng: 77.23 } })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.approximate, true);
    assert.equal(body.durationMinutes, null);
    assert.equal(body.routeLabel, "Air-line estimate");
    assert.match(body.warnings.join(" "), /Road distance and travel time are unavailable/i);
  } finally {
    process.env.OSRM_BASE_URL = healthyUrl;
  }
});

test("AI health is safe and requires an authenticated session", async () => {
  assert.equal((await request("/api/ai/health")).status, 401);
  for (const role of ["Admin", "Police Officer", "Citizen"]) {
    const response = await request("/api/ai/health", { headers: authHeaders(role) });
    assert.equal(response.status, 200, role);
    const body = await response.json();
    assert.equal(body.configured, false);
    assert.equal(body.serviceUrl, "not_configured");
  }
});

test("AI Vision role policy distinguishes unauthenticated sessions from forbidden Citizens", async () => {
  const unauthenticatedFrame = await request("/api/ai/analyze-frame", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({})
  });
  assert.equal(unauthenticatedFrame.status, 401);
  assert.equal((await unauthenticatedFrame.json()).error, "Authentication required");

  const citizenScan = await request("/api/ai/run-scan", {
    method: "POST",
    headers: { ...authHeaders("Citizen"), Origin: "http://localhost:3000" }
  });
  assert.equal(citizenScan.status, 403);

  const legacyVisionRoutes = [
    { method: "GET", route: "/api/camera-feeds" },
    { method: "GET", route: "/api/cameras/feeds" },
    { method: "GET", route: "/api/camera-sources" },
    { method: "GET", route: "/api/cameras/sources" },
    { method: "POST", route: "/api/camera-sources/test-camera/test", body: {} },
    { method: "POST", route: "/api/cameras/sources/test-camera/test", body: {} },
    { method: "POST", route: "/api/camera-sources/test-camera/analyze", body: {} },
    { method: "POST", route: "/api/cameras/sources/test-camera/analyze", body: {} },
    { method: "GET", route: "/api/video-evidence" },
    { method: "POST", route: "/api/video-evidence", body: {} },
    { method: "POST", route: "/api/video-evidence/missing/analyze", body: {} },
    { method: "POST", route: "/api/video-observations/missing/review", body: { action: "verify" } },
    { method: "POST", route: "/api/video-observations/missing/convert-incident", body: {} },
    { method: "POST", route: "/api/browser-observations/missing/review", body: { action: "verify" } }
  ];

  for (const item of legacyVisionRoutes) {
    const options = { method: item.method, headers: { Origin: "http://localhost:3000" } };
    if (item.body) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(item.body);
    }
    const missing = await request(item.route, options);
    assert.equal(missing.status, 401, `Unauthenticated ${item.method} ${item.route}`);
    assert.equal((await missing.json()).error, "Authentication required");

    const citizenOptions = {
      method: item.method,
      headers: { ...authHeaders("Citizen"), Origin: "http://localhost:3000" }
    };
    if (item.body) {
      citizenOptions.headers["Content-Type"] = "application/json";
      citizenOptions.body = JSON.stringify(item.body);
    }
    const citizen = await request(item.route, citizenOptions);
    assert.equal(citizen.status, 403, `Citizen ${item.method} ${item.route}`);
  }
});

test("AI frame validation rejects invalid input and protected analysis rejects Citizen", async () => {
  const invalid = await request("/api/ai/analyze-frame", {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ sourceType: "invalid" })
  });
  assert.equal(invalid.status, 400);

  const citizen = await request("/api/ai/analyze-frame", {
    method: "POST",
    headers: { ...authHeaders("Citizen"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({})
  });
  assert.equal(citizen.status, 403);
  assert.match((await citizen.json()).error, /permission/i);

  const citizenUpload = await request("/api/ai/analyze-frame", {
    method: "POST",
    headers: { ...authHeaders("Citizen"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({
      sourceType: "upload",
      sourceName: "Citizen Operational Upload Blocked",
      imageBase64: `data:image/jpeg;base64,${Buffer.from("citizen-upload-frame").toString("base64")}`
    })
  });
  assert.equal(citizenUpload.status, 403);
});

test("normal AI response never fabricates a threat when service is not configured", async () => {
  const payload = JSON.stringify({
    sourceType: "cctv",
    sourceId: "test-camera",
    sourceName: "Test Camera",
    zone: "Test Zone",
    timestamp: new Date().toISOString(),
    imageBase64: `data:image/jpeg;base64,${Buffer.from("safe-test-frame").toString("base64")}`
  });
  for (const role of ["Admin", "Police Officer"]) {
    const response = await request("/api/ai/analyze-frame", {
      method: "POST",
      headers: { ...authHeaders(role), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: payload
    });
    assert.equal(response.status, 200, role);
    const body = await response.json();
    assert.equal(body.threatDetected, false);
    assert.equal(body.threatType, "no_threat");
    assert.equal(body.actionable, false);
    assert.equal(body.alert, null);
    assert.equal(body.incident, null);
  }
});

test("Admin and Police can access Live Vision and upload analysis as observation-only sources", async () => {
  for (const role of ["Admin", "Police Officer"]) {
    const liveVision = await request("/api/ai/analyze-frame", {
      method: "POST",
      headers: { ...authHeaders(role), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({
        sourceType: "phone_camera",
        sourceId: "phone_001",
        sourceName: "Rakshak Live Vision",
        zone: "Mobile Source",
        imageBase64: `data:image/jpeg;base64,${Buffer.from(`${role}-live-frame`).toString("base64")}`
      })
    });
    assert.equal(liveVision.status, 200, `${role} live vision`);
    const liveBody = await liveVision.json();
    assert.equal(liveBody.actionable, false);
    assert.equal(liveBody.incident, null);

    const upload = await request("/api/ai/analyze-frame", {
      method: "POST",
      headers: { ...authHeaders(role), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({
        sourceType: "upload",
        sourceId: "upload_001",
        sourceName: "Video Upload",
        zone: "Evidence Review",
        imageBase64: `data:image/jpeg;base64,${Buffer.from(`${role}-upload-frame`).toString("base64")}`
      })
    });
    assert.equal(upload.status, 200, `${role} upload`);
    const uploadBody = await upload.json();
    assert.equal(uploadBody.actionable, false);
    assert.equal(uploadBody.incident, null);
  }
});

test("Browser AI Vision creates pending observations and object matches without incidents", async () => {
  const previousUrl = process.env.AI_SERVICE_URL;
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${osrmServer.address().port}`;
  const db = await readDatabase();
  db.reports.unshift({
    id: "report_browser_blue_backpack",
    reportType: "missing_object",
    category: "missing_object",
    name: "Blue backpack",
    description: "Lost blue backpack near Mobile Source",
    color: "blue",
    lastSeenLocation: "Mobile Source",
    address: "Mobile Source",
    urgency: "medium",
    status: "submitted_for_review",
    createdBy: "u_citizen_second",
    createdAt: new Date().toISOString()
  });
  await writeDatabase(db);
  try {
    const response = await request("/api/ai/analyze-frame", {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({
        sourceType: "browser_camera",
        sourceId: "phone_001",
        sourceName: "Browser Object Match",
        zone: "Mobile Source",
        imageBase64: `data:image/jpeg;base64,${Buffer.from("browser-object-match").toString("base64")}`
      })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.incident, null);
    assert.equal(body.actionable, false);
    assert.ok(Array.isArray(body.observations));
    const browserObservation = body.observations.find((item) => item.source === "browser_camera" && item.threatType === "object_detected");
    const matchObservation = body.observations.find((item) => item.threatType === "missing_object_possible_match");
    assert.ok(browserObservation, "browser object observation created");
    assert.ok(matchObservation, "missing object match observation created");
    assert.ok(matchObservation.id, JSON.stringify(matchObservation));
    assert.equal(browserObservation.reviewStatus, "pending_review");
    assert.equal(browserObservation.verificationStatus, "human_verification_required");
    assert.equal(browserObservation.actionable, false);
    assert.equal(matchObservation.linkedReportId, "report_browser_blue_backpack");
    assert.equal(matchObservation.actionable, false);
    assert.match(matchObservation.message, /Possible missing object match found/i);
    assert.doesNotMatch(JSON.stringify(body).toLowerCase(), /confirmed criminal|confirmed identity|confirmed missing person/);
    const afterScanDb = await readDatabase();
    assert.ok(
      afterScanDb.alerts.some((item) => item.id === matchObservation.id),
      JSON.stringify({
        response: body.observations.map((item) => ({ id: item.id, source: item.source, sourceType: item.sourceType, threatType: item.threatType })),
        persisted: afterScanDb.alerts.slice(0, 5).map((item) => ({ id: item.id, source: item.source, sourceType: item.sourceType, threatType: item.threatType }))
      })
    );

    const citizenReview = await request(`/api/browser-observations/${matchObservation.id}/review`, {
      method: "POST",
      headers: { ...authHeaders("Citizen"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ action: "verify" })
    });
    assert.equal(citizenReview.status, 403);

    const review = await request(`/api/browser-observations/${matchObservation.id}/review`, {
      method: "POST",
      headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ action: "verify", notes: "Backpack appears similar; continue report verification." })
    });
    const reviewBody = await review.json();
    assert.equal(review.status, 200, JSON.stringify(reviewBody));
    assert.equal(reviewBody.observation.reviewStatus, "verified");
    assert.equal(reviewBody.observation.actionable, false);
    assert.equal(reviewBody.report.status, "Verification pending");
    assert.equal(reviewBody.audit.action, "browser_ai_observation_verified");
  } finally {
    process.env.AI_SERVICE_URL = previousUrl;
  }
});

test("Browser AI Vision offline state creates no fake observation", async () => {
  const previousUrl = process.env.AI_SERVICE_URL;
  process.env.AI_SERVICE_URL = "";
  try {
    const response = await request("/api/ai/analyze-frame", {
      method: "POST",
      headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({
        sourceType: "browser_camera",
        sourceId: "phone_001",
        sourceName: "Rakshak Live Vision",
        zone: "Mobile Source",
        imageBase64: `data:image/jpeg;base64,${Buffer.from("offline-browser-frame").toString("base64")}`
      })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.configured, false);
    assert.equal(body.alert, null);
    assert.equal(body.incident, null);
    assert.deepEqual(body.observations, []);
  } finally {
    process.env.AI_SERVICE_URL = previousUrl;
  }
});

test("normal person, phone, and vehicle detections remain observation-only", () => {
  for (const [threatType, label] of [
    ["person_detected", "person"],
    ["object_detected", "cell phone"],
    ["vehicle_detected", "car"]
  ]) {
    const result = aiContract.normalizeResponse({
      threatDetected: false,
      threatType,
      severity: "critical",
      confidence: 0.96,
      detections: [{ label, confidence: 0.96, box: [10, 20, 100, 200] }]
    });
    assert.equal(result.threatDetected, false);
    assert.equal(result.severity, "low");
    assert.equal(result.alertClassification, "observation");
    assert.equal(aiContract.evaluateResult(result).actionable, false);
  }
});

test("normal AI observations enter human review without creating an incident or critical alert", async () => {
  const previousUrl = process.env.AI_SERVICE_URL;
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${osrmServer.address().port}`;
  try {
    const payload = {
      sourceType: "cctv",
      sourceId: "observation-camera",
      sourceName: "Observation Camera",
      zone: "Test Zone",
      timestamp: new Date().toISOString(),
      imageBase64: `data:image/jpeg;base64,${Buffer.from("observation-frame").toString("base64")}`
    };
    const response = await request("/api/ai/analyze-frame", {
      method: "POST",
      headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify(payload)
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.actionable, false);
    assert.equal(body.alert.severity, "low");
    assert.equal(body.alert.operationalAlert, false);
    assert.equal(body.alert.status, "Pending Review");
    assert.equal(body.incident, null);

    const duplicate = await request("/api/ai/analyze-frame", {
      method: "POST",
      headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ ...payload, timestamp: new Date().toISOString() })
    });
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).deduplicated, true);
  } finally {
    process.env.AI_SERVICE_URL = previousUrl;
  }
});

test("vehicle and person assist fields are normalized without fabricated identity or model", () => {
  const result = aiContract.normalizeResponse({
    threatType: "vehicle_detected",
    detections: [{ label: "car", confidence: 0.91, box: [1, 2, 100, 80] }],
    vehicleAnalysis: [{
      vehicleType: "car",
      dominantColor: "blue",
      vehicleModel: "Imaginary Motors X",
      confidence: 0.91,
      box: [1, 2, 100, 80],
      plate: { detected: false, status: "plate OCR unavailable" }
    }],
    personAnalysis: [{
      trackingId: "person-001",
      upperClothingColor: "red",
      lowerClothingColor: "black",
      identity: "Known Person"
    }],
    personIdentity: { identified: true, name: "Fabricated Name" }
  });
  assert.equal(result.vehicleAnalysis[0].dominantColor, "blue");
  assert.equal(result.vehicleAnalysis[0].vehicleModel, "unsupported");
  assert.equal(result.vehicleAnalysis[0].plate.status, "plate OCR unavailable");
  assert.equal(result.vehicleAnalysis[0].plate.verification, "human_verification_required");
  assert.equal(result.personIdentity.identified, false);
  assert.equal(result.personIdentity.status, "unsupported");
  assert.equal(result.personAnalysis[0].identity, "not_inferred");
  assert.match(result.personAnalysis[0].message, /human verification/i);
});

test("Live Vision beep policy, cooldown, and duplicate suppression are safe", async () => {
  const policyUrl = pathToFileURL(path.join(__dirname, "..", "..", "frontend", "src", "liveVisionPolicy.js")).href;
  const policy = await import(policyUrl);
  assert.equal(policy.shouldPlayAlertBeep({ severity: "low", alertClassification: "observation", detections: [{ label: "person" }] }), false);
  assert.equal(policy.shouldPlayAlertBeep({ severity: "high", alertClassification: "warning", actionable: true }), true);
  assert.equal(policy.shouldPlayAlertBeep({ severity: "critical", alertClassification: "critical", alert: { id: "a1" } }), true);
  assert.equal(policy.beepCooldownReady(1000, 5000, 10000), false);
  assert.equal(policy.beepCooldownReady(1000, 12000, 10000), true);
  const prior = [{ label: "backpack", box: [10, 10, 100, 100], timestampMs: 1000 }];
  assert.equal(policy.duplicateObservation(prior, { label: "backpack", box: [12, 12, 98, 98] }, 3000, 8000), true);
  assert.equal(policy.duplicateObservation(prior, { label: "backpack", box: [300, 300, 50, 50] }, 3000, 8000), false);
});

test("login rate limiting returns 429 after repeated failures", async () => {
  const user = users.find((item) => item.role === "Admin");
  const statuses = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ email: user.email, password: "wrong-password" })
    });
    statuses.push(response.status);
  }
  assert.equal(statuses.at(-1), 429);
});

test("frontend session client does not persist JWTs", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "services", "api.js"), "utf8");
  assert.doesNotMatch(source, /sessionToken\s*\)/);
  assert.doesNotMatch(source, /localStorage\.setItem/);
  assert.match(source, /credentials:\s*"include"/);
});

test("frontend login errors are specific and keep submit state recoverable", () => {
  const frontendRoot = path.join(__dirname, "..", "..", "frontend");
  const apiSource = fs.readFileSync(path.join(frontendRoot, "src", "services", "api.js"), "utf8");
  const appSource = fs.readFileSync(path.join(frontendRoot, "src", "app.js"), "utf8");
  const viteConfig = fs.readFileSync(path.join(frontendRoot, "vite.config.js"), "utf8");
  const loginStart = appSource.indexOf("$(\"#loginForm\").addEventListener(\"submit\"");
  const registerStart = appSource.indexOf("$(\"#registerForm\").addEventListener(\"submit\"", loginStart);
  const loginBlock = appSource.slice(loginStart, registerStart);

  assert.match(apiSource, /const API_TIMEOUT_MS = Number\(import\.meta\.env\.VITE_API_TIMEOUT_MS \|\| 15000\)/);
  assert.match(apiSource, /function safeApiMessage\(path, status, data = \{\}, code = ""\)/);
  assert.match(apiSource, /Network request timed out\. Check that RakshakAI services are reachable and try again\./);
  assert.match(apiSource, /Backend unavailable\. Start the RakshakAI backend service and try again\./);
  assert.match(apiSource, /if \(status === 401 && loginRequest\) return "Invalid email or password\."/);
  assert.match(apiSource, /if \(status === 429 && loginRequest\) return "Too many login attempts\. Please wait and try again\."/);
  assert.match(apiSource, /if \(status >= 500\) return "Server error\. Please try again\."/);
  assert.match(apiSource, /const code = cause\?\.name === "AbortError" \? "API_TIMEOUT" : "API_UNAVAILABLE"/);
  assert.match(apiSource, /const data = await parseResponseBody\(res\)/);
  assert.match(apiSource, /new Error\(safeApiMessage\(path, res\.status, data\)\)/);
  assert.match(apiSource, /window\.clearTimeout\(timeout\)/);

  assert.equal((loginBlock.match(/api\("\/api\/login"/g) || []).length, 1);
  assert.match(loginBlock, /if \(loginSubmissionInFlight\) return/);
  assert.match(loginBlock, /submitButton\.disabled = true/);
  assert.match(loginBlock, /if \(!login\?\.user\) throw new Error\("Session could not be created\. Please try again\."\)/);
  assert.match(loginBlock, /catch \(error\) \{[\s\S]*showPortal\(error\.message\)/);
  assert.match(loginBlock, /finally \{[\s\S]*loginSubmissionInFlight = false;[\s\S]*submitButton\.disabled = false/);
  assert.match(loginBlock, /resetGisNavigationState\("GIS route state reset for the new session\."\);[\s\S]*state\.user = login\.user/);
  assert.doesNotMatch(loginBlock, /renderSatelliteMaps\(|renderSatelliteMap\(|setView\(.*gis/);

  assert.match(viteConfig, /proxy\.on\("error", \(error, req, res\) => \{/);
  assert.match(viteConfig, /res\.writeHead\(503, \{[\s\S]*"Content-Type": "application\/json; charset=utf-8"/);
  assert.match(viteConfig, /res\.end\(JSON\.stringify\(\{ error: "Backend unavailable" \}\)\)/);
});

test("frontend HTML-serving layers enforce a restrictive CSP", () => {
  const frontendRoot = path.join(__dirname, "..", "..", "frontend");
  const nginx = fs.readFileSync(path.join(frontendRoot, "nginx.conf"), "utf8");
  const dockerfile = fs.readFileSync(path.join(frontendRoot, "Dockerfile"), "utf8");
  const entrypoint = fs.readFileSync(path.join(frontendRoot, "docker-entrypoint.d", "10-csp-defaults.sh"), "utf8");
  const renderer = fs.readFileSync(path.join(frontendRoot, "docker-entrypoint.d", "render-csp.cjs"), "utf8");
  const viteConfig = fs.readFileSync(path.join(frontendRoot, "vite.config.js"), "utf8");
  const composeDev = fs.readFileSync(path.join(__dirname, "..", "..", "compose.dev.yaml"), "utf8");
  const composeProd = fs.readFileSync(path.join(__dirname, "..", "..", "compose.prod.yaml"), "utf8");

  assert.match(nginx, /add_header Content-Security-Policy "\$\{RAKSHAKAI_CSP\}" always;/);
  assert.match(dockerfile, /COPY csp\.config\.cjs \/etc\/rakshakai\/csp\.config\.cjs/);
  assert.match(dockerfile, /COPY frontend\/nginx\.conf \/etc\/nginx\/templates\/default\.conf\.template/);
  assert.match(dockerfile, /COPY frontend\/docker-entrypoint\.d\/10-csp-defaults\.sh \/docker-entrypoint\.d\/10-csp-defaults\.envsh/);
  assert.match(entrypoint, /node \/docker-entrypoint\.d\/render-csp\.cjs/);
  assert.match(renderer, /buildRakshakaiCsp/);
  assert.match(viteConfig, /res\.setHeader\("Content-Security-Policy", DEVELOPMENT_CSP\)/);
  assert.match(viteConfig, /buildRakshakaiCsp\(\{ environment: "development" \}\)\.header/);
  assert.match(composeDev, /CSP_ENV:\s*development/);
  assert.match(composeProd, /CSP_ENV:\s*production/);

  assertRestrictiveCsp(buildRakshakaiCsp({ environment: "production" }).header, { requireUpgrade: true });
  assertRestrictiveCsp(buildRakshakaiCsp({ environment: "development" }).header, {
    allowDevelopmentStyleInline: true,
    allowDevelopmentLocalhost: true
  });
});

test("frontend CSS assets load statically and render paths preserve document head", () => {
  const frontendRoot = path.join(__dirname, "..", "..", "frontend");
  const html = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");
  const appSource = fs.readFileSync(path.join(frontendRoot, "src", "app.js"), "utf8");
  const assetHealth = fs.readFileSync(path.join(frontendRoot, "src", "assetHealth.js"), "utf8");
  const viteConfig = fs.readFileSync(path.join(frontendRoot, "vite.config.js"), "utf8");
  const styles = fs.readFileSync(path.join(frontendRoot, "src", "styles.css"), "utf8");

  assert.match(appSource, /^import "\.\/styles\.css";/);
  assert.match(appSource, /^import "leaflet\/dist\/leaflet\.css";/m);
  assert.doesNotMatch(appSource, /import\(["']\.\/styles\.css["']\)|await import\(["']\.\/styles\.css["']\)/);
  assert.match(html, /<link rel="stylesheet" href="\/src\/styles\.css" data-rakshakai-stylesheet="main" \/>/);
  assert.match(html, /<script type="module" src="\/src\/assetHealth\.js"><\/script>\s*<script type="module" src="\/src\/app\.js"><\/script>/);

  assert.match(assetHealth, /const MAIN_STYLESHEET_SELECTOR = 'link\[data-rakshakai-stylesheet="main"\]'/);
  assert.match(assetHealth, /const STYLESHEET_SELECTOR = `\$\{MAIN_STYLESHEET_SELECTOR\}, link\[rel="stylesheet"\]`/);
  assert.match(assetHealth, /document\.querySelectorAll\(STYLESHEET_SELECTOR\)/);
  assert.match(assetHealth, /stylesheet\.addEventListener\("error"/);
  assert.match(assetHealth, /console\.error\("\[RakshakAI\] UI asset failure"/);
  assert.match(assetHealth, /document\.createElement\("dialog"\)/);
  assert.match(assetHealth, /window\.location\.reload\(\)/);
  assert.match(assetHealth, /getPropertyValue\("--rakshakai-css-ready"\)\.trim\(\) === "loaded"/);
  assert.match(assetHealth, /getPropertyValue\("--teal"\)\.trim\(\) === "#087d78"/);
  assert.match(styles, /\.ui-asset-failure \{/);

  assert.doesNotMatch(appSource, /document\.open|document\.write|document\.close|document\.documentElement\s*=|document\.head\s*=|document\.head\.innerHTML|document\.body\.innerHTML|outerHTML\s*=/);
  assert.doesNotMatch(appSource, /querySelectorAll\(["']link\[rel=["']stylesheet/);
  for (const marker of ["function setView", "function showPortal", "function showApp", "function initSatelliteMaps"]) {
    const start = appSource.indexOf(marker);
    assert.notEqual(start, -1, marker);
    const block = appSource.slice(start, appSource.indexOf("\nfunction ", start + marker.length) === -1 ? appSource.length : appSource.indexOf("\nfunction ", start + marker.length));
    assert.doesNotMatch(block, /document\.head|document\.documentElement|outerHTML|body\.innerHTML|link\[rel=["']stylesheet/);
  }

  assert.match(viteConfig, /function rakshakaiStylesheetFallbackGuard\(\)/);
  assert.match(viteConfig, /pathname\.endsWith\("\.css"\)/);
  assert.match(viteConfig, /res\.statusCode = 404/);
  assert.match(viteConfig, /res\.setHeader\("X-Content-Type-Options", "nosniff"\)/);
  assert.equal(/serviceWorker|caches\.open|navigator\.serviceWorker/.test(html + appSource + assetHealth), false);
});

test("frontend production build emits a stylesheet bundle", () => {
  const frontendRoot = path.join(__dirname, "..", "..", "frontend");
  const buildOut = path.join(testDirectory, "frontend-dist-css");
  fs.rmSync(buildOut, { recursive: true, force: true });
  childProcess.execFileSync(process.execPath, [path.join(frontendRoot, "node_modules", "vite", "bin", "vite.js"), "build", "--outDir", buildOut, "--emptyOutDir"], {
    cwd: frontendRoot,
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: "pipe"
  });

  const distHtml = fs.readFileSync(path.join(buildOut, "index.html"), "utf8");
  const cssLinks = [...distHtml.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/g)].map((match) => match[1]);
  assert.ok(cssLinks.length >= 1, "production HTML should reference a CSS bundle");
  assert.equal(distHtml.includes("/src/styles.css"), false);
  assert.match(distHtml, /src="\/assets\/[^"]+\.js"/);

  for (const href of cssLinks) {
    const cssPath = path.join(buildOut, href.replace(/^\//, ""));
    assert.ok(fs.existsSync(cssPath), `missing built stylesheet ${href}`);
    const css = fs.readFileSync(cssPath, "utf8");
    assert.match(css, /--teal:\s*#087d78/);
    assert.match(css, /\.portal-login/);
  }
});

test("CSP builder supports same-origin and explicit HTTPS production API origins only", () => {
  const sameOrigin = parseCsp(buildRakshakaiCsp({ environment: "production" }).header);
  assert.deepEqual(sameOrigin["connect-src"], ["'self'"]);

  const separateApi = parseCsp(buildRakshakaiCsp({
    environment: "production",
    connectSrc: "https://api.rakshak.example.com"
  }).header);
  assert.deepEqual(separateApi["connect-src"], ["'self'", "https://api.rakshak.example.com"]);

  assert.throws(() => buildRakshakaiCsp({ environment: "production", connectSrc: "http://api.rakshak.example.com" }), /must use HTTPS/);
  assert.throws(() => buildRakshakaiCsp({ environment: "production", connectSrc: "https://api.rakshak.example.com/api" }), /without path/);
  assert.throws(() => buildRakshakaiCsp({ environment: "production", connectSrc: "not-an-origin" }), /must be an origin/);
  assert.throws(() => buildRakshakaiCsp({ environment: "production", connectSrc: "*" }), /wildcards are forbidden/);
  assert.throws(() => buildRakshakaiCsp({ environment: "production", connectSrc: "'unsafe-eval'" }), /unsafe-eval/);
});

test("frontend CSP allowlist covers maps, Browser AI Vision, previews, and API calls", () => {
  const frontendRoot = path.join(__dirname, "..", "..", "frontend");
  const appSource = fs.readFileSync(path.join(frontendRoot, "src", "app.js"), "utf8");
  const apiSource = fs.readFileSync(path.join(frontendRoot, "src", "services", "api.js"), "utf8");
  const csp = parseCsp(buildRakshakaiCsp({ environment: "development" }).header);

  assert.match(appSource, /https:\/\/tile\.openstreetmap\.org/);
  assert.match(appSource, /https:\/\/server\.arcgisonline\.com/);
  for (const source of OSM_TILE_SOURCES) assert.ok(csp["img-src"].includes(source), source);
  for (const source of ARCGIS_TILE_SOURCES) assert.ok(csp["img-src"].includes(source), source);
  assert.match(appSource, /api\(`\/api\/maps\/search/);
  assert.match(appSource, /api\(`\/api\/maps\/reverse/);
  assert.match(appSource, /api\("\/api\/maps\/route"/);
  assert.equal(appSource.includes("router.project-osrm.org"), false);
  assert.equal(appSource.includes("/route/v1/"), false);
  assert.equal(appSource.includes("OSRM_BASE_URL"), false);
  assert.equal(csp["connect-src"].includes("https://router.project-osrm.org"), false);
  assert.equal(csp["connect-src"].includes("https://nominatim.openstreetmap.org"), false);

  assert.match(apiSource, /const API_BASE_URL = import\.meta\.env\.VITE_API_BASE_URL \|\| "\/api"/);
  assert.match(apiSource, /credentials:\s*"include"/);
  assert.ok(csp["connect-src"].includes("'self'"));
  assert.ok(csp["connect-src"].includes("http://127.0.0.1:5000"));

  assert.match(appSource, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(appSource, /video\.srcObject = stream/);
  assert.match(appSource, /canvas\.toDataURL\("image\/jpeg"/);
  assert.match(appSource, /URL\.createObjectURL\(file\)/);
  assert.ok(csp["img-src"].includes("data:"));
  assert.ok(csp["img-src"].includes("blob:"));
  assert.deepEqual(csp["media-src"], ["'self'", "blob:"]);
});

test("frontend Incident Command uses a fluid enterprise workspace without weakening role gates", () => {
  const frontendRoot = path.join(__dirname, "..", "..", "frontend");
  const appSource = fs.readFileSync(path.join(frontendRoot, "src", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(frontendRoot, "src", "styles.css"), "utf8");
  const incidentSection = html.match(/<section class="view" data-panel="incident-command">[\s\S]*?<section class="view" data-panel="gis">/)?.[0] || "";

  assert.doesNotMatch(incidentSection, /<h2>Incident Command<\/h2>/);
  assert.match(incidentSection, /class="incident-command-workspace"/);
  assert.match(incidentSection, /class="incident-command-main"/);
  assert.match(incidentSection, /class="incident-command-rail" aria-label="Incident command operations"/);
  assert.match(incidentSection, /id="commandIncidentSearch" type="search"/);
  assert.match(incidentSection, /id="commandSeverityFilter"/);
  assert.match(incidentSection, /id="commandStatusFilter"/);
  assert.match(incidentSection, /id="commandSourceFilter"/);
  assert.match(incidentSection, /id="commandAssignmentFilter"/);
  assert.match(incidentSection, /class="panel command-map-panel"[\s\S]*id="commandMap"/);
  assert.match(incidentSection, /class="panel command-dispatch-panel"[\s\S]*id="commandUnitPanel"[\s\S]*id="dispatchCandidatePanel"/);
  assert.match(incidentSection, /class="panel command-review-panel"[\s\S]*id="commandReviewQueue"/);

  assert.match(styles, /\.view\[data-panel="incident-command"\] \{ width: min\(100%, 1680px\); margin: 0 auto; overflow-x: hidden; \}/);
  assert.match(styles, /\.incident-command-workspace \{[\s\S]*grid-template-columns: minmax\(0, 2\.25fr\) minmax\(360px, \.95fr\)/);
  assert.match(styles, /\.command-filter-bar \{[\s\S]*grid-template-columns: minmax\(220px,1\.4fr\) repeat\(4,minmax\(120px,\.75fr\)\)/);
  assert.match(styles, /\.command-incident-row \{[\s\S]*grid-template-columns: minmax\(230px,1\.65fr\)[\s\S]*minmax\(112px,\.6fr\)/);
  assert.match(styles, /\.command-map \{ min-height: clamp\(500px, 56vh, 620px\); aspect-ratio: auto; \}/);
  assert.match(styles, /#commandUnitPanel \.unit-mini-list \{ max-height: 240px; \}/);
  assert.match(styles, /\.command-review-list \{[\s\S]*max-height: 300px; overflow: auto/);
  assert.match(styles, /@media \(max-width: 1200px\) \{[\s\S]*\.incident-command-workspace \{ grid-template-columns: 1fr; \}[\s\S]*\.command-map \{ min-height: 480px; \}/);
  assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*\.command-map \{ min-height: 420px; \}/);

  assert.match(appSource, /commandFilters: \{ search: "", severity: "all", status: "all", source: "all", assignment: "all" \}/);
  assert.match(appSource, /function commandIncidentMatchesFilters\(incident\)/);
  assert.match(appSource, /const visibleIncidents = active\.filter\(commandIncidentMatchesFilters\)/);
  assert.match(appSource, /row\.setAttribute\("aria-pressed", String\(incident\.id === state\.selectedIncidentId\)\)/);
  assert.match(appSource, /node\("span", "command-row-meta"\)/);
  assert.match(appSource, /scheduleMapResizeRender\(\)/);
  assert.match(appSource, /\$\("#commandIncidentSearch"\)\?\.addEventListener\("input"/);
  assert.match(appSource, /state\.commandFilters\[key\] = event\.currentTarget\.value/);

  assert.match(appSource, /if \(incidentNavigationReady\(incident\)\) addAction\("Navigate", "navigate"\)/);
  assert.match(appSource, /if \(incident\.status === "Verified" && isDispatchableIncident\(incident\) && !incident\.assignedUnitId\) addAction\("Assign Nearest Unit", "assign", "primary"\)/);
  assert.match(appSource, /if \(incident\.assignedUnitId && incident\.status === "Assigned"\) addAction\("Mark En Route", "En Route"\)/);
  assert.match(appSource, /if \(incident\.status === "En Route"\) addAction\("Mark On Scene", "On Scene"\)/);
  assert.match(appSource, /if \(incident\.status === "On Scene"\) addAction\("Resolve", "Resolved"\)/);
  assert.match(appSource, /if \(incident\.status === "Resolved"\) addAction\("Close", "Closed"\)/);
});

test("frontend Incident Command map simplifies markers with default layers and clustering", () => {
  const frontendRoot = path.join(__dirname, "..", "..", "frontend");
  const appSource = fs.readFileSync(path.join(frontendRoot, "src", "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(frontendRoot, "src", "styles.css"), "utf8");
  const persisted = JSON.parse(fs.readFileSync(sourceDatabase, "utf8"));

  assert.match(appSource, /mapLayers: \{ incidents: true, responseUnits: true, dangerZones: false, heatOverlay: false, policeStations: false, labels: false \}/);
  assert.match(appSource, /function makeMapLayersControl\(instance\)/);
  assert.match(appSource, /\["incidents", "Incidents"\]/);
  assert.match(appSource, /\["responseUnits", "Response Units"\]/);
  assert.match(appSource, /\["dangerZones", "Danger Zones"\]/);
  assert.match(appSource, /\["heatOverlay", "Heat Overlay"\]/);
  assert.match(appSource, /\["policeStations", "Police Stations"\]/);
  assert.match(appSource, /\["labels", "Labels"\]/);

  assert.match(appSource, /const HIDDEN_INCIDENT_STATUSES = new Set\(\["closed", "rejected \/ false alarm", "archived"\]\)/);
  assert.match(appSource, /function isIncidentVisibleOnMap\(incident\)/);
  assert.match(appSource, /status === "resolved" && !resolvedIncidentStillRetained\(incident\)/);
  assert.match(appSource, /if \(state\.mapLayers\.incidents\) state\.incidents\.forEach/);
  assert.match(appSource, /if \(!isIncidentVisibleOnMap\(incident\)\) return/);

  assert.match(appSource, /function isResponseUnitVisibleOnMap\(unit\)/);
  assert.match(appSource, /return \["available", "busy", "assigned", "responding", "en route"\]\.includes\(status\)/);
  assert.match(appSource, /function unitMapLabel\(unit\)/);
  assert.match(appSource, /return "R"/);
  assert.match(appSource, /return "B"/);
  assert.match(appSource, /return "A"/);
  assert.match(appSource, /markerLabel: unitMapLabel\(unit\)/);

  assert.match(appSource, /if \(state\.mapLayers\.dangerZones\) state\.zones\.forEach/);
  assert.match(appSource, /if \(state\.mapLayers\.policeStations\) state\.policeStations\.forEach/);
  assert.match(appSource, /function activeRouteWorkflow\(\)/);
  assert.match(appSource, /\[routeWorkflow \? start : null, "route-marker start-marker", "S"\]/);
  assert.match(appSource, /previousView === "gis" && view !== "gis" && activeRouteWorkflow\(\)/);
  assert.match(appSource, /resetGisNavigationState\("GIS route markers cleared after leaving route workflow\."\)/);

  assert.match(appSource, /function clusterMarkerDescriptors\(descriptors\)/);
  assert.match(appSource, /Math\.hypot\(item\.point\.lat - descriptor\.point\.lat, item\.point\.lng - descriptor\.point\.lng\) <= 0\.004/);
  assert.match(appSource, /function addLeafletMarkerCluster\(instance, cluster\)/);
  assert.match(appSource, /className\.includes\("marker-cluster"\) \? \[34, 34\]/);
  assert.match(appSource, /marker\.bindPopup\(`<strong>\$\{cluster\.items\.length\} map records<\/strong><ul class="map-cluster-list">/);
  assert.match(appSource, /function dedupeMarkerDescriptors\(descriptors\)/);

  assert.match(appSource, /function validOperationalMapPoints\(\) \{[\s\S]*state\.mapLayers\.incidents[\s\S]*state\.mapLayers\.responseUnits[\s\S]*state\.mapLayers\.policeStations[\s\S]*state\.mapLayers\.dangerZones/);
  assert.match(styles, /\.map-layer-control/);
  assert.match(styles, /\.marker-cluster/);
  assert.match(styles, /\.event-map\.labels-visible \.incident-marker::after/);
  assert.match(styles, /\.rakshak-leaflet-marker:hover \.incident-marker::after/);
  assert.match(styles, /\.unit-available/);
  assert.match(styles, /\.unit-busy/);
  assert.match(styles, /\.unit-assigned/);

  assert.ok(persisted.incidents.some((incident) => incident.id === "fixture_incident_active"), "fixture incidents remain present");
  assert.ok(persisted.responseUnits.some((unit) => unit.id === "fixture_unit_alpha"), "fixture response units remain present");
  assert.ok(persisted.policeStations.some((station) => station.id === "fixture_station_01"), "fixture stations remain present");
});

test("frontend GIS navigation controls are gated and mode-driven", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "app.js"), "utf8");
  const searchUiSource = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "gisPlaceSearchUi.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "styles.css"), "utf8");
  const gisSection = html.match(/<section class="view" data-panel="gis">[\s\S]*?<section class="view" data-panel="cctv">/)?.[0] || "";

  assert.match(gisSection, /id="setMapStart"[\s\S]*Set Start/);
  assert.match(gisSection, /id="setMapDestination"[\s\S]*Set Destination/);
  assert.match(gisSection, /id="navigateMap"[\s\S]*disabled[\s\S]*>Calculate Route</);
  assert.match(gisSection, /id="recalculateRoute"[\s\S]*disabled[\s\S]*>Recalculate</);
  assert.match(gisSection, /id="openExternalRoute"[\s\S]*disabled[\s\S]*>Open Full Route</);
  assert.match(gisSection, /id="clearMapRoute"[\s\S]*disabled[\s\S]*>Clear Route</);
  assert.match(gisSection, /id="streetMapLayer"[\s\S]*aria-label="Show street map tiles\."/);
  assert.match(gisSection, /id="satelliteMapLayer"[\s\S]*aria-label="Show satellite map tiles\."/);
  assert.match(gisSection, /id="satelliteMapLayer" class="ghost"[\s\S]*aria-pressed="false"/);
  assert.match(gisSection, /id="resetGisMap"[\s\S]*Reset Map/);
  assert.match(gisSection, /aria-label="Reset Map View\. Return to the local operational center and clear stale route markers\."/);
  assert.match(gisSection, /id="gisMap"[\s\S]*data-map-layer="satellite"/);
  assert.doesNotMatch(gisSection, /<span class="heat heat-two"><\/span>/);
  assert.match(gisSection, /id="navigateMap"[\s\S]*aria-label="Calculate Route\. Choose a route start and destination before calculating\."/);
  assert.match(gisSection, /id="recalculateRoute"[\s\S]*aria-label="Recalculate\. Calculate a route before using this action\."/);
  assert.match(gisSection, /id="openExternalRoute"[\s\S]*aria-label="Open Full Route\. Calculate a route before using this action\."/);
  assert.match(gisSection, /id="clearMapRoute"[\s\S]*aria-label="Clear Route\. Choose a point or calculate a route before clearing\."/);
  assert.match(gisSection, /class="panel gis-map-card"/);
  assert.match(gisSection, /class="gis-toolbar" aria-label="GIS navigation controls"/);
  assert.match(gisSection, /<span>Map<\/span>[\s\S]*id="streetMapLayer"[\s\S]*id="satelliteMapLayer"[\s\S]*id="useMyLocation"[\s\S]*id="fitGisMap"[\s\S]*id="resetGisMap"/);
  assert.match(gisSection, /<span>Points<\/span>[\s\S]*id="setMapStart"[\s\S]*id="setMapDestination"/);
  assert.match(gisSection, /<span>Route<\/span>[\s\S]*id="navigateMap"[\s\S]*id="clearMapRoute"/);
  assert.match(gisSection, /id="mapNavigationStatus" class="gis-status-bar" aria-live="polite"/);
  assert.match(gisSection, /id="routePointCards" class="route-point-cards"/);
  assert.match(gisSection, /id="clearRouteStart"[\s\S]*disabled[\s\S]*Clear Start/);
  assert.match(gisSection, /id="swapRoutePoints"[\s\S]*disabled[\s\S]*Swap/);
  assert.match(gisSection, /id="clearRouteDestination"[\s\S]*disabled[\s\S]*Clear Destination/);
  assert.doesNotMatch(gisSection, /zone-analytics-panel|Demo Zone Analytics|id="zoneTable"/);

  assert.match(appSource, /function setNavigationSelectionMode\(mode\)/);
  assert.match(appSource, /Click the map to choose the route start\./);
  assert.match(appSource, /Click the map to choose the destination\./);
  assert.match(appSource, /state\.mapNavigation\.selectionMode === "start"/);
  assert.match(appSource, /state\.mapNavigation\.selectionMode === "destination"/);
  assert.match(appSource, /async function selectNavigationPointFromMap\(event\)/);
  assert.match(appSource, /return event\.target\.closest\("\.map-control, \.map-zoom-slider, \.map-search, \.map-layer-control, \.operational-marker"\)/);
  assert.match(appSource, /instance\.map\.addEventListener\("click", \(event\) => \{[\s\S]*selectNavigationPointFromMap\(event\)/);
  assert.match(appSource, /if \(instance\.map\.id === "gisMap" && state\.mapNavigation\.selectionMode && !blockedMapSelectionTarget\(event\)\) return/);
  assert.match(appSource, /setRouteStart\(validPoint, "Selected map start"\)/);
  assert.match(appSource, /setRouteDestination\(validPoint, "Selected map destination", \{ locationStatus: "Approximate" \}\)/);
  assert.match(appSource, /Route start selected\./);
  assert.match(appSource, /Destination selected\. Click Calculate Route\./);
  assert.match(appSource, /state\.mapNavigation\.selectionMode = null;[\s\S]*setMapStart"\)\?\.classList\.remove\("active"\)[\s\S]*setMapDestination"\)\?\.classList\.remove\("active"\)/);
  assert.match(appSource, /function canonicalRoutePoint\(point, fallbackLabel = "Route point"\)/);
  assert.match(appSource, /mapNavigation: emptyRouteNavigationState\(\)/);
  assert.match(appSource, /function clearSearchPreview\(\)/);
  assert.match(appSource, /function setSearchPreview\(point, label = "Search preview", metadata = \{\}\)/);
  assert.match(appSource, /state\.mapNavigation = previewPlace\(state\.mapNavigation/);
  assert.match(searchUiSource, /Confirm Destination/);
  assert.match(searchUiSource, /Cancel Preview/);
  assert.match(appSource, /Preview shown for \$\{fullLabel\}\. Confirm it to set destination D\./);
  assert.match(appSource, /route-marker search-preview-marker/);
  assert.match(appSource, /const \{ currentLocation, searchPreview, routes = \[\], selectedRouteId \} = state\.mapNavigation/);
  assert.match(appSource, /const start = routeValidation\.start;[\s\S]*const destination = routeValidation\.destination/);
  assert.match(appSource, /clearSearchPreview\(\);[\s\S]*clearRouteResult\(\);[\s\S]*return true;/);
  assert.match(appSource, /function routePointValidation\(\)/);
  assert.match(appSource, /return routePointValidation\(\)\.valid/);
  assert.match(appSource, /const routeValidation = routePointValidation\(\);[\s\S]*start: routeValidation\.start,[\s\S]*destination: routeValidation\.destination,[\s\S]*routePointError: routeValidation\.valid \? "" : routeValidation\.message/);
  assert.match(appSource, /rawLat = point\?\.lat \?\? point\?\.latitude \?\? point\?\.location\?\.lat/);
  assert.match(appSource, /rawLng = point\?\.lng \?\? point\?\.lon \?\? point\?\.longitude \?\? point\?\.location\?\.lng/);
  assert.match(appSource, /Route start has invalid coordinates\./);
  assert.match(appSource, /Destination has invalid coordinates\./);
  assert.match(appSource, /Route start and destination cannot be the same point\./);
  assert.match(appSource, /Start and destination selected\. Click Calculate Route\./);
  assert.match(appSource, /point\s*\? `\$\{point\.lat\.toFixed\(5\)\}, \$\{point\.lng\.toFixed\(5\)\}`[\s\S]*\? `\$\{label\.toLowerCase\(\)\} has invalid coordinates\.`/);
  assert.match(appSource, /setText\("#routeStartCoordinates", `Status: \$\{routeLoading \? "Calculating" : meta\.status\}`\)/);
  assert.match(appSource, /setText\("#routeDestinationCoordinates", `Type: \$\{meta\.type\}`\)/);
  assert.match(appSource, /Choose Set Start or Set Destination before selecting a map point\./);
  assert.match(appSource, /import \{ gisRouteButtonStates \} from "\.\/gisButtonState\.js"/);
  assert.match(appSource, /function applyGisButtonState\(button, config = \{\}\)/);
  assert.match(appSource, /function updateGisButtonStates\(\)/);
  assert.match(appSource, /const states = gisRouteButtonStates\(/);
  assert.match(appSource, /function routeDisplayMeta\(route\)/);
  assert.match(appSource, /title: approximate \? "Air-line estimate" : route\.label/);
  assert.match(appSource, /warning: \(route\.warnings/);
  assert.match(appSource, /setText\("#routeProvider", meta\.title\)/);
  assert.doesNotMatch(appSource, /setText\("#routeProvider", route \? `\$\{route\.routeLabel[\s\S]*routeType/);
  assert.match(appSource, /function setMapStatus\(message\)/);
  assert.match(appSource, /status\.classList\.add\(mapStatusKind\(message\)\)/);
  assert.match(appSource, /gis-button-icon gis-icon-\$\{config\.icon\}/);
  assert.match(appSource, /button\.append\(node\("span", "gis-button-label", label\)\)/);
  assert.match(appSource, /applyGisButtonState\(\$\(\"\#navigateMap\"\), states\.calculate\)/);
  assert.match(appSource, /applyGisButtonState\(\$\(\"\#recalculateRoute\"\), states\.recalculate\)/);
  assert.match(appSource, /applyGisButtonState\(\$\(\"\#openExternalRoute\"\), states\.external\)/);
  assert.match(appSource, /applyGisButtonState\(\$\(\"\#clearMapRoute\"\), states\.clear\)/);
  assert.match(appSource, /button\.disabled = Boolean\(config\.disabled\)/);
  assert.match(appSource, /button\.setAttribute\("aria-label", config\.disabled && config\.reason/);
  assert.match(appSource, /button\.dataset\.disabledReason = config\.reason/);
  assert.match(appSource, /function renderRoutePointCards\(\)/);
  assert.match(appSource, /Not selected/);
  assert.match(appSource, /if \(!routeValidation\.valid\) return updateNavigationPanel\(routeValidation\.message\)/);
  assert.match(appSource, /state\.mapNavigation\.routeLoading = true;[\s\S]*clearRouteResult\(\);[\s\S]*updateNavigationPanel\("Calculating route\.\.\."\)/);
  assert.match(appSource, /api\("\/api\/maps\/route", \{[\s\S]*body: \{[\s\S]*start: \{ lat: start\.lat, lng: start\.lng \},[\s\S]*destination: \{ lat: destination\.lat, lng: destination\.lng \},[\s\S]*mode: "driving"[\s\S]*\}/);
  assert.match(appSource, /logRouteDevelopment\("request", \{ start, destination \}\)/);
  assert.match(appSource, /logRouteDevelopment\(route\?\.isApproximate \? "approximate_fallback" : "success", \{ start, destination \}\)/);
  assert.match(appSource, /state\.mapNavigation\.routeLoading = false;[\s\S]*updateNavigationPanel\(\)/);
  assert.match(appSource, /catch \(error\) \{[\s\S]*clearRouteResult\(\);[\s\S]*Route could not be calculated/);
  assert.match(appSource, /Calculate a route before opening full navigation\./);
  assert.match(appSource, /Choose a route start and destination before calculating\./);
  assert.match(appSource, /function clearRouteStart\(\)/);
  assert.match(appSource, /function clearRouteDestination\(\)/);
  assert.match(appSource, /function clearRouteDestination\(\) \{[\s\S]*state\.mapNavigation\.destination = null;[\s\S]*clearSearchPreview\(\)/);
  assert.match(appSource, /function emptyMapNavigationState\(\) \{[\s\S]*return emptyRouteNavigationState\(\)/);
  assert.match(appSource, /function resetGisNavigationState\(message = "", \{ preserveRoute = false \} = \{\}\)/);
  assert.match(appSource, /state\.mapNavigation = emptyMapNavigationState\(\)/);
  assert.match(appSource, /satelliteMaps\.forEach\(removeNavigationLayerArtifacts\)/);
  assert.match(appSource, /if \(instance\.navigationLayer\) instance\.navigationLayer\.textContent = ""/);
  const resetBlock = appSource.slice(
    appSource.indexOf("function resetGisNavigationState"),
    appSource.indexOf("function routeDisplayMeta")
  );
  assert.doesNotMatch(resetBlock, /renderSatelliteMaps|renderSatelliteMap|setView\(|showApp\(|showPortal\(|api\(|refresh\(|state\.user|dispatchEvent/);
  assert.match(appSource, /setView\(view, options = \{\}\)/);
  assert.match(appSource, /if \(view === "gis" && previousView !== "gis" && !options\.preserveGisNavigation\)/);
  assert.match(appSource, /setView\("gis", \{ preserveGisNavigation: true \}\)/);
  assert.match(appSource, /function swapRoutePoints\(\)/);

  assert.match(appSource, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(appSource, /Getting location\.\.\./);
  assert.match(appSource, /Current location selected as route start\./);
  assert.match(appSource, /Location permission denied\. Use manual search or map click\./);
  assert.match(appSource, /current-location-marker/);

  assert.match(appSource, /\$\(\"\#streetMapLayer\"\)\.addEventListener\(\"click\", \(\) => \{[\s\S]*setBaseLayer\(instance, "streets"\)/);
  assert.match(appSource, /\$\(\"\#satelliteMapLayer\"\)\.addEventListener\(\"click\", \(\) => \{[\s\S]*setBaseLayer\(instance, "satellite"\)/);
  assert.match(appSource, /const baseLayer = TILE_SOURCES\[map\.dataset\.mapLayer\] \? map\.dataset\.mapLayer : "streets"/);
  assert.match(appSource, /makeMapControl\("FIT", "zoom-fit", "Fit map to local operational markers", fitGisMapToOperationalMarkers\)/);
  assert.match(appSource, /function fitGisMapToPoints\(points, label = "Operational markers"\)/);
  assert.match(appSource, /\.filter\(\(point\) => point && isLocalOperationalPoint\(point\) && !isDefaultFallbackPoint\(point\)\)/);
  assert.match(appSource, /clearSearchPreview\(\);[\s\S]*setRouteStart\(point, `\$\{unitLabel\(unit\)\} location`\);[\s\S]*fitGisMapToPoints\(\[point, \.\.\.validOperationalMapPoints\(\)\]/);
  assert.match(appSource, /function makeMapLayersControl\(instance\)/);
  assert.match(appSource, /\["incidents", "Incidents"\]/);
  assert.match(appSource, /\["responseUnits", "Response Units"\]/);
  assert.match(appSource, /\["dangerZones", "Danger Zones"\]/);
  assert.match(appSource, /\["heatOverlay", "Heat Overlay"\]/);
  assert.match(appSource, /\["policeStations", "Police Stations"\]/);
  assert.match(appSource, /\["labels", "Labels"\]/);
  assert.match(appSource, /function removeHeatLayers\(map\) \{[\s\S]*map\.querySelectorAll\("\.heat"\)\.forEach\(\(layer\) => layer\.remove\(\)\)/);
  assert.match(appSource, /function renderHeatOverlay\(instance\)/);
  assert.match(appSource, /function setMapLayerVisibility\(key, visible\)/);
  assert.match(appSource, /if \(key === "heatOverlay"\) \{[\s\S]*if \(!visible\) removeHeatLayers\(instance\.map\)/);
  assert.match(appSource, /window\.addEventListener\("resize", scheduleMapResizeRender\)/);
  assert.match(appSource, /window\.addEventListener\("pageshow", \(event\) => \{[\s\S]*event\.persisted[\s\S]*handleBrowserNavigationRestore\(\)/);
  assert.match(appSource, /window\.addEventListener\("popstate", \(\) => \{[\s\S]*handleBrowserNavigationRestore\("GIS route state reset after browser navigation\."\)/);
  assert.match(appSource, /Satellite tiles failed to load|tiles failed to load/);
  assert.match(styles, /\.event-map\.selection-active/);
  assert.match(styles, /\.current-location-marker/);
  assert.match(styles, /\.search-preview-marker/);
  assert.match(styles, /\.heatmap-hidden \.heat \{ display: none; \}/);
  assert.match(styles, /\.map-layer-control/);
  assert.match(styles, /\.satellite-tiles \{[\s\S]*pointer-events: none/);
  assert.match(styles, /\.route-overlay \{[\s\S]*pointer-events: none/);
  assert.match(styles, /\.map-status \{[\s\S]*pointer-events: none/);
  assert.match(styles, /\.map-attribution \{[\s\S]*pointer-events: none/);
  assert.match(styles, /\.operational-marker \{[\s\S]*pointer-events: auto/);
  assert.match(styles, /button:disabled \{ cursor: not-allowed; opacity: \.82; filter: none; \}/);
  assert.match(styles, /button\.ghost:disabled \{[\s\S]*color: #3f5664/);
  assert.match(styles, /button\.active, button\[aria-pressed="true"\] \{[\s\S]*outline: 2px solid rgba\(8,125,120,\.34\)/);
  assert.match(styles, /\.gis-tool-group button \{[\s\S]*white-space: nowrap/);
  assert.match(styles, /\.gis-button-icon \{[\s\S]*flex: 0 0 14px/);
  assert.match(styles, /\.gis-icon-location::before, \.gis-icon-pin::before \{[\s\S]*border-radius: 50% 50% 50% 0/);
  assert.match(styles, /\.gis-icon-location::after, \.gis-icon-pin::after \{[\s\S]*border-radius: 50%/);
  assert.match(styles, /\.gis-icon-pin \{ color: #d9443f; \}/);
  assert.match(styles, /\.gis-tool-group \.ghost \{[\s\S]*background: #fff;[\s\S]*color: #132f3d/);
  assert.match(styles, /\.gis-tool-group \.primary \{[\s\S]*background: #087f7a;[\s\S]*color: #fff/);
  assert.match(styles, /\.gis-tool-group \.ghost:disabled \{[\s\S]*background: #fff;[\s\S]*color: #415966;[\s\S]*opacity: \.88/);
  assert.match(styles, /\.gis-tool-group \.primary:disabled \{[\s\S]*background: #087f7a;[\s\S]*opacity: \.78/);
  assert.match(styles, /\.gis-layout \{[\s\S]*grid-template-columns: minmax\(0, 2\.85fr\) minmax\(320px, 1fr\)[\s\S]*overflow-x: hidden/);
  assert.match(styles, /\.gis-toolbar \{[\s\S]*grid-template-columns: minmax\(0,1fr\) minmax\(0,\.72fr\) minmax\(0,1fr\)/);
  assert.match(styles, /#gisMap \{ min-height: clamp\(600px,68vh,700px\)/);
  assert.match(styles, /\.navigation-panel \{[\s\S]*display: grid/);
  assert.match(styles, /\.unit-summary-grid \{[\s\S]*grid-template-columns: repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.unit-mini-list \{[\s\S]*max-height: 300px; overflow: auto/);
  assert.match(styles, /\.route-point-actions \{[\s\S]*grid-template-columns: repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.gis-status-bar\.success/);
  assert.match(styles, /\.gis-status-bar\.warning/);
  assert.match(styles, /\.gis-status-bar\.error/);
  assert.match(styles, /\.route-badge\.warning/);
  assert.match(styles, /\.route-option-selected/);
  assert.match(styles, /@media \(max-width: 1120px\) \{[\s\S]*\.gis-layout \{ grid-template-columns: 1fr; \}[\s\S]*#gisMap \{ min-height: 480px; \}/);
  assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*#gisMap \{ min-height: 480px; \}/);

  assert.match(appSource, /Replace current route start with \$\{unitLabel\(unit\)\}/);
  assert.match(appSource, /\$\{unitLabel\(unit\)\} selected as route start\./);
  assert.match(appSource, /Selected Unit/);
  assert.match(appSource, /All Response Units/);
  assert.match(appSource, /\["Busy", summary\.busy \?\? 0\]/);
  assert.match(appSource, /\["Offline", summary\.offline \?\? 0\]/);
  assert.match(appSource, /\["Stale", summary\.stale \?\? 0\]/);
  assert.match(appSource, /selected-unit-section/);
  assert.match(appSource, /unit-mini-list/);
  assert.match(appSource, /route\.warning/);
  assert.match(appSource, /Air-line estimate ready\. Road distance and travel time are unavailable\./);
  assert.match(appSource, /const GIS_HOME_ZOOM = 12/);
  assert.match(appSource, /const LOCAL_OPERATIONAL_BOUNDS/);
  assert.match(appSource, /function isLocalOperationalPoint\(point\)/);
  assert.match(appSource, /function isDefaultFallbackPoint\(point\)/);
  assert.match(appSource, /function validOperationalMapPoints\(\)/);
  assert.match(appSource, /\.filter\(\(point\) => isLocalOperationalPoint\(point\) && !isDefaultFallbackPoint\(point\)\)/);
  assert.match(appSource, /function fitGisMapToOperationalMarkers\(\)/);
  assert.match(appSource, /Map fitted to valid local operational markers\./);
  assert.match(appSource, /function resetGisMapToOperationalCenter/);
  assert.match(appSource, /setMapView\(instance, DEFAULT_MAP_CENTER, GIS_HOME_ZOOM, "Operational center"\)/);
  assert.match(appSource, /const DEFAULT_MAP_CENTER = \{ lat: 17\.5109, lng: 78\.3276 \}/);
  assert.match(appSource, /function resetGisMapView\(\) \{[\s\S]*resetGisNavigationState\(""\);[\s\S]*resetGisMapToOperationalCenter\("Map reset to local operational center\. Route markers cleared\."\)/);
  assert.match(appSource, /\$\(\"\#resetGisMap\"\)\.addEventListener\(\"click\", resetGisMapView\)/);
  assert.match(appSource, /Route cleared\. Map restored to Patancheru\/BHEL operational center\./);
  const clearRouteBlock = appSource.match(/function clearMapRoute\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(clearRouteBlock, /showWorldMap|zoom\s*=\s*[0-9]/);
  assert.match(clearRouteBlock, /resetGisMapToOperationalCenter/);
  assert.match(clearRouteBlock, /resetGisNavigationState\(""\)/);

  assert.match(appSource, /\[routeWorkflow \? destination : null, "route-marker destination-marker", "D"\]/);
  assert.match(appSource, /addLeafletMarker\(instance, point, className, label, kind/);
  assert.match(appSource, /L\.marker\(\[validPoint\.lat, validPoint\.lng\]/);
  assert.match(appSource, /addLeafletMarker\(instance, preview, "route-marker search-preview-marker", "P", "Search preview"/);
  assert.match(appSource, /markerLabel: "!",[\s\S]*kind: "Incident"/);
  assert.match(appSource, /Incident \$\{incident\.id\}: \$\{incidentTitle\(incident\)\} - severity \$\{displayValue\(incident\.severity\)\} - status \$\{displayValue\(incident\.status\)\} - source \$\{incidentSource\(incident\)\} - \$\{point\.lat\.toFixed\(5\)\}, \$\{point\.lng\.toFixed\(5\)\}/);
  assert.match(appSource, /Click to set as destination/);
  assert.match(appSource, /setRouteDestination\(point, incident\.address \|\| incidentTitle\(incident\)/);
  assert.match(appSource, /if \(state\.mapLayers\.dangerZones\) state\.zones\.forEach/);
  assert.match(appSource, /markerLabel: "Z",[\s\S]*kind: "Danger zone"/);
  assert.match(appSource, /Zone \$\{zone\.name \|\| zone\.id\}: \$\{zone\.isDemo \? "demo" : "operational"\}/);
  assert.doesNotMatch(appSource, /marker\.style\.left = `\$\{pixel\.x\}px`/);
  assert.doesNotMatch(appSource, /marker\.style\.top = `\$\{pixel\.y\}px`/);
  assert.match(appSource, /\$\(\"\#fitGisMap\"\)\.addEventListener\(\"click\", fitGisMapToOperationalMarkers\)/);
  assert.match(appSource, /\$\(\"\#clearRouteStart\"\)\.addEventListener\(\"click\", clearRouteStart\)/);
  assert.match(appSource, /\$\(\"\#clearRouteDestination\"\)\.addEventListener\(\"click\", clearRouteDestination\)/);
  assert.match(appSource, /\$\(\"\#swapRoutePoints\"\)\.addEventListener\(\"click\", swapRoutePoints\)/);
  assert.match(appSource, /const zoneTable = \$\("\#zoneTable"\);[\s\S]*if \(zoneTable\)/);
});

test("frontend GIS route button state table keeps controls visible and synchronized", async () => {
  const stateUrl = pathToFileURL(path.join(__dirname, "..", "..", "frontend", "src", "gisButtonState.js")).href;
  const { gisRouteButtonStates } = await import(stateUrl);
  const start = { lat: 17.51, lng: 78.32 };
  const destination = { lat: 17.53, lng: 78.38 };
  const route = {
    provider: "osrm",
    isApproximate: false,
    distanceKm: 1,
    durationMinutes: 2,
    geometry: { type: "LineString", coordinates: [[78.32, 17.51], [78.38, 17.53]] }
  };
  const fallbackRoute = {
    provider: "haversine",
    isApproximate: true,
    distanceKm: 0.9,
    durationMinutes: null,
    geometry: { type: "LineString", coordinates: [[78.32, 17.51], [78.38, 17.53]] }
  };

  const initial = gisRouteButtonStates({});
  assert.equal(initial.street.disabled, false);
  assert.equal(initial.street.label, "Street View");
  assert.equal(initial.street.active, true);
  assert.equal(initial.satellite.disabled, false);
  assert.equal(initial.satellite.label, "Satellite View");
  assert.equal(initial.satellite.active, false);
  assert.equal(initial.location.disabled, false);
  assert.equal(initial.location.icon, "location");
  assert.equal(initial.destination.icon, "pin");
  assert.equal(initial.fit.disabled, false);
  assert.equal(initial.start.disabled, false);
  assert.equal(initial.destination.disabled, false);
  assert.equal(initial.calculate.disabled, true);
  assert.equal(initial.calculate.label, "Calculate Route");
  assert.match(initial.calculate.reason, /start and destination/);
  assert.equal(initial.recalculate.disabled, true);
  assert.equal(initial.external.disabled, true);
  assert.equal(initial.clear.disabled, true);

  const startOnly = gisRouteButtonStates({ start, hasRouteWork: true });
  assert.equal(startOnly.calculate.disabled, true);
  assert.match(startOnly.calculate.reason, /destination/);
  assert.equal(startOnly.recalculate.disabled, true);
  assert.equal(startOnly.external.disabled, true);
  assert.equal(startOnly.clear.disabled, false);

  const pointsOnly = gisRouteButtonStates({ start, destination, hasRouteWork: true });
  assert.equal(pointsOnly.calculate.disabled, false);
  assert.equal(pointsOnly.calculate.label, "Calculate Route");
  assert.equal(pointsOnly.recalculate.disabled, true);
  assert.equal(pointsOnly.external.disabled, true);
  assert.equal(pointsOnly.clear.disabled, false);

  const invalidPoints = gisRouteButtonStates({ start, destination, hasRouteWork: true, routePointError: "Route start and destination cannot be the same point." });
  assert.equal(invalidPoints.calculate.disabled, true);
  assert.match(invalidPoints.calculate.reason, /same point/);
  assert.equal(invalidPoints.recalculate.disabled, true);
  assert.equal(invalidPoints.external.disabled, true);

  const calculated = gisRouteButtonStates({ start, destination, route, hasRouteWork: true });
  assert.equal(calculated.calculate.disabled, false);
  assert.equal(calculated.calculate.label, "Calculate Again");
  assert.equal(calculated.recalculate.disabled, false);
  assert.equal(calculated.external.disabled, false);
  assert.equal(calculated.clear.disabled, false);

  const approximate = gisRouteButtonStates({ start, destination, route: fallbackRoute, hasRouteWork: true });
  assert.equal(approximate.recalculate.disabled, false);
  assert.equal(approximate.external.disabled, true);
  assert.equal(approximate.clear.disabled, false);

  const failed = gisRouteButtonStates({ start, destination, route: null, hasRouteWork: true });
  assert.equal(failed.calculate.disabled, false);
  assert.equal(failed.recalculate.disabled, true);
  assert.equal(failed.external.disabled, true);
  assert.equal(failed.clear.disabled, false);

  const loading = gisRouteButtonStates({ start, destination, route, routeLoading: true, hasRouteWork: true });
  assert.equal(loading.calculate.disabled, true);
  assert.equal(loading.calculate.label, "Calculating...");
  assert.equal(loading.calculate.loading, true);
  assert.equal(loading.recalculate.disabled, true);
  assert.equal(loading.external.disabled, true);
  assert.equal(loading.clear.disabled, true);
  assert.match(loading.recalculate.reason, /already in progress/);

  const selecting = gisRouteButtonStates({ selectionMode: "destination" });
  assert.equal(selecting.destination.active, true);
  assert.equal(selecting.destination.pressed, true);
  assert.equal(selecting.start.active, false);
});

test("frontend login and GIS restore paths do not recursively render or navigate", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "app.js"), "utf8");
  const loginStart = appSource.indexOf("$(\"#loginForm\").addEventListener(\"submit\"");
  const registerStart = appSource.indexOf("$(\"#registerForm\").addEventListener(\"submit\"", loginStart);
  const loginBlock = appSource.slice(loginStart, registerStart);
  const resetBlock = appSource.slice(
    appSource.indexOf("function resetGisNavigationState"),
    appSource.indexOf("function routeDisplayMeta")
  );
  const leafletMoveStart = appSource.indexOf("instance.leafletMap.on(\"moveend zoomend resize\"");
  const leafletMoveEnd = appSource.indexOf("});", leafletMoveStart) + 3;
  const leafletMoveBlock = appSource.slice(leafletMoveStart, leafletMoveEnd);

  assert.match(appSource, /let loginSubmissionInFlight = false/);
  assert.match(loginBlock, /if \(loginSubmissionInFlight\) return/);
  assert.match(loginBlock, /loginSubmissionInFlight = true/);
  assert.equal((loginBlock.match(/api\("\/api\/login"/g) || []).length, 1);
  assert.match(loginBlock, /resetGisNavigationState\("GIS route state reset for the new session\."\)/);
  assert.match(loginBlock, /state\.user = login\.user;[\s\S]*showApp\(\);[\s\S]*await refresh\(\);[\s\S]*setView\(/);
  assert.match(loginBlock, /finally \{[\s\S]*loginSubmissionInFlight = false/);
  assert.match(loginBlock, /submitButton\.disabled = true/);

  assert.doesNotMatch(resetBlock, /renderSatelliteMaps|renderSatelliteMap|setView\(|showApp\(|showPortal\(|api\(|refresh\(|state\.user|dispatchEvent/);
  assert.match(appSource, /let browserNavigationRestoreInProgress = false/);
  assert.match(appSource, /function handleBrowserNavigationRestore\(message = "GIS route state reset after navigation restore\."\)/);
  assert.match(appSource, /if \(browserNavigationRestoreInProgress\) return/);
  assert.match(appSource, /window\.addEventListener\("popstate"/);

  assert.match(appSource, /function syncLeafletMapToState\(instance\)/);
  assert.match(appSource, /function scheduleLeafletRender\(instance\)/);
  assert.match(leafletMoveBlock, /if \(instance\.syncingLeafletView \|\| instance\.renderingLeafletMap\) return/);
  assert.match(leafletMoveBlock, /syncInstanceFromLeaflet\(instance\)/);
  assert.match(leafletMoveBlock, /scheduleLeafletRender\(instance\)/);
  assert.doesNotMatch(leafletMoveBlock, /renderSatelliteMap\(instance\)/);
});

test("frontend GIS Satellite View uses ArcGIS imagery tiles and falls back safely", () => {
  const frontendRoot = path.join(__dirname, "..", "..", "frontend");
  const appSource = fs.readFileSync(path.join(frontendRoot, "src", "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(frontendRoot, "src", "styles.css"), "utf8");
  const csp = parseCsp(buildRakshakaiCsp({ environment: "production" }).header);

  assert.deepEqual(ARCGIS_TILE_SOURCES, ["https://server.arcgisonline.com"]);
  assert.ok(csp["img-src"].includes("https://server.arcgisonline.com"));
  assert.equal(csp["img-src"].some((source) => source.includes("*.arcgisonline") || source === "*"), false);
  assert.match(appSource, /urlTemplate: "https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}"/);
  assert.match(appSource, /url: \(zoom, x, y\) => `https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\/\$\{zoom\}\/\$\{y\}\/\$\{x\}`/);

  assert.match(appSource, /function createLeafletTileLayer\(key\) \{[\s\S]*L\.tileLayer\(TILE_SOURCES\[key\]\.urlTemplate/);
  assert.match(appSource, /crossOrigin: true/);
  assert.match(appSource, /layer\.on\("tileloadstart", \(\) => handleLeafletTileEvent\(instance, key, "tileloadstart"\)\)/);
  assert.match(appSource, /layer\.on\("tileload", \(\) => handleLeafletTileEvent\(instance, key, "tileload"\)\)/);
  assert.match(appSource, /layer\.on\("tileerror", \(\) => handleLeafletTileEvent\(instance, key, "tileerror"\)\)/);
  assert.match(appSource, /layer\.on\("load", \(\) => handleLeafletTileEvent\(instance, key, "load"\)\)/);

  assert.match(appSource, /function updateLeafletLayerStatus\(instance, message = ""\)/);
  assert.match(appSource, /function visibleLeafletTileReport\(instance, key = instance\.baseLayer\)/);
  assert.match(appSource, /querySelectorAll\("img\.leaflet-tile, img\.leaflet-tile-loaded"\)/);
  assert.match(appSource, /tile\.isConnected[\s\S]*tile\.naturalWidth > 0[\s\S]*tile\.naturalHeight > 0/);
  assert.match(appSource, /style\.display !== "none"[\s\S]*style\.visibility !== "hidden"[\s\S]*opacity > 0\.01/);
  assert.match(appSource, /!hiddenByFilter[\s\S]*!masked[\s\S]*style\.mixBlendMode === "normal"/);
  assert.match(appSource, /function hasVisibleUsableLeafletTiles\(instance, key = instance\.baseLayer\)/);
  assert.match(appSource, /instance\.leafletMap\.hasLayer\(layer\)[\s\S]*visibleLeafletTileReport\(instance, key\)\.usableTiles\.length > 0/);
  assert.match(appSource, /function centerMapTopElement\(instance\)/);
  assert.match(appSource, /document\.elementFromPoint\(rect\.left \+ rect\.width \/ 2, rect\.top \+ rect\.height \/ 2\)/);
  assert.match(appSource, /function logLeafletTileDiagnostics\(instance, key = instance\.baseLayer\)/);
  assert.match(appSource, /function scheduleSatelliteVisibilityFallback\(instance\)/);
  assert.match(appSource, /window\.setTimeout\(\(\) => \{[\s\S]*!hasVisibleUsableLeafletTiles\(instance, "satellite"\)[\s\S]*fallbackSatelliteToStreet\(instance\)/);
  assert.match(appSource, /const hasVisibleTiles = hasVisibleUsableLeafletTiles\(instance, instance\.baseLayer\)/);
  assert.match(appSource, /if \(tileState\.loaded > 0 && hasVisibleTiles && !tileState\.failedCompletely\) \{[\s\S]*instance\.status\.textContent = `\$\{source\.label\} tiles - zoom/);
  assert.match(appSource, /if \(instance\.baseLayer === "satellite" && tileState\.loaded > 0 && !hasVisibleTiles\) \{[\s\S]*scheduleSatelliteVisibilityFallback\(instance\)/);
  assert.match(appSource, /instance\.status\.textContent = message \|\| `Loading \$\{source\.label\} imagery - zoom/);
  assert.match(appSource, /function fallbackSatelliteToStreet\(instance, reason = "Satellite imagery unavailable"\)/);
  assert.match(appSource, /clearSatelliteVisibilityTimer\(instance\)/);
  assert.match(appSource, /instance\.baseLayer = "streets"/);
  assert.match(appSource, /instance\.activeBaseLayer = "streets"/);
  assert.match(appSource, /instance\.leafletTileLayers\?\.streets\?\.redraw\(\)/);
  assert.match(appSource, /updateNavigationPanel\(`\$\{reason\}; switched to Street View\.`\)/);
  assert.match(appSource, /if \(key === "satellite" && tileState\.failedCompletely\) \{[\s\S]*fallbackSatelliteToStreet\(instance\)/);
  assert.match(appSource, /if \(key === "satellite" && tileState\.loaded > 0 && !hasVisibleUsableLeafletTiles\(instance, "satellite"\)\) \{[\s\S]*scheduleSatelliteVisibilityFallback\(instance\)/);
  assert.match(appSource, /updateNavigationPanel\(`Loading \$\{TILE_SOURCES\[instance\.baseLayer\]\.label\} imagery\.\.\.`\)/);
  assert.match(appSource, /if \(tileState\.loaded > 0 && hasVisibleTiles && !tileState\.failedCompletely\) \{[\s\S]*instance\.activeBaseLayer = instance\.baseLayer;[\s\S]*syncLayerButtons\(instance\)/);
  assert.match(appSource, /function syncLayerButtons\(instance\) \{[\s\S]*const activeLayer = instance\.activeBaseLayer \|\| null/);
  assert.match(appSource, /if \(instance\.baseLayer === "satellite"\) scheduleSatelliteVisibilityFallback\(instance\)/);

  assert.match(appSource, /if \(key === instance\.baseLayer && !hasLayer\) layer\.addTo\(instance\.leafletMap\)/);
  assert.match(appSource, /if \(key !== instance\.baseLayer && hasLayer\) layer\.remove\(\)/);
  assert.match(appSource, /instance\.leafletTileLayers\?\.\[instance\.baseLayer\]\?\.redraw\(\)/);
  assert.doesNotMatch(appSource, /leafletHost\.(innerHTML|textContent)\s*=/);
  assert.match(appSource, /renderHeatOverlay\(instance\);[\s\S]*renderNavigationOverlay\(instance\)/);

  assert.match(styles, /\.leaflet-host \{ position: absolute; inset: 0; z-index: 1; background: transparent; \}/);
  assert.match(styles, /\.event-map\[data-base-layer="satellite"\] \{ background: #e3e9dc; background-image: none; \}/);
  assert.match(styles, /\.leaflet-container \{ width: 100%; height: 100%; font: inherit; background: transparent; \}/);
  assert.match(styles, /\.leaflet-tile-pane \{ z-index: 100; \}/);
  assert.match(styles, /\.leaflet-overlay-pane \{ z-index: 420; \}/);
  assert.match(styles, /\.leaflet-marker-pane \{ z-index: 650; \}/);
  assert.match(styles, /\.leaflet-popup-pane \{ z-index: 720; \}/);
  assert.match(styles, /\.leaflet-tile \{ display: block; visibility: visible; opacity: 1; filter: none; mix-blend-mode: normal; \}/);
  assert.match(styles, /\.event-map\[data-base-layer="satellite"\] \.satellite-tile \{ filter: none; \}/);
  assert.doesNotMatch(styles, /\.event-map\[data-base-layer="satellite"\][\s\S]*brightness\(\s*0\s*\)/);
});

test("frontend GIS markers use Leaflet lat-lng projection for local incident coordinates", () => {
  const frontendRoot = path.join(__dirname, "..", "..", "frontend");
  const appSource = fs.readFileSync(path.join(frontendRoot, "src", "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(frontendRoot, "src", "styles.css"), "utf8");
  const frontendPackage = JSON.parse(fs.readFileSync(path.join(frontendRoot, "package.json"), "utf8"));

  assert.equal(frontendPackage.dependencies.leaflet, "^1.9.4");
  assert.match(appSource, /import L from "leaflet"/);
  assert.match(appSource, /import "leaflet\/dist\/leaflet\.css"/);
  assert.match(appSource, /function initializeLeafletInstance\(instance, centerLatLng\)/);
  assert.match(appSource, /L\.map\(instance\.leafletHost/);
  assert.match(appSource, /\.setView\(\[centerLatLng\.lat, centerLatLng\.lng\], instance\.zoom\)/);
  assert.match(appSource, /instance\.leafletTileLayers = \{[\s\S]*streets: createLeafletTileLayer\("streets"\),[\s\S]*satellite: createLeafletTileLayer\("satellite"\)/);
  assert.match(appSource, /function syncLeafletBaseLayer\(instance\)/);
  assert.match(appSource, /syncLeafletBaseLayer\(instance\)/);
  assert.match(appSource, /L\.marker\(\[validPoint\.lat, validPoint\.lng\]/);
  assert.doesNotMatch(appSource, /L\.marker\(\[validPoint\.lng, validPoint\.lat\]/);
  assert.match(appSource, /L\.polyline\(points/);
  assert.match(appSource, /\.map\(\(\[lng, lat\]\) => validMapPoint\(\{ lat, lng \}\)\)/);
  assert.match(appSource, /setMapView\(instance, DEFAULT_MAP_CENTER, GIS_HOME_ZOOM, "Operational center"\)/);
  assert.match(appSource, /const DEFAULT_MAP_CENTER = \{ lat: 17\.5109, lng: 78\.3276 \}/);
  assert.match(appSource, /const GIS_HOME_ZOOM = 12/);
  assert.match(appSource, /instance\.leafletMap\.on\("moveend zoomend resize"/);
  assert.match(appSource, /syncInstanceFromLeaflet\(instance\);[\s\S]*scheduleLeafletRender\(instance\)/);
  assert.match(appSource, /if \(instance\.syncingLeafletView \|\| instance\.renderingLeafletMap\) return/);
  assert.match(appSource, /function assertMarkerWithinMapBounds\(instance, point, label\)/);
  assert.match(appSource, /bounds\.contains\(\[point\.lat, point\.lng\]\)/);
  assert.match(appSource, /console\.assert\(inside, "\[GIS marker bounds\]"/);
  assert.match(styles, /\.leaflet-host \{ position: absolute; inset: 0/);
  assert.match(styles, /\.rakshak-leaflet-marker \.route-marker,[\s\S]*\.rakshak-leaflet-marker \.operational-marker \{[\s\S]*position: relative/);

  const hyderabad = { lat: 17.5109, lng: 78.3276 };
  const delhi = { lat: 28.6139, lng: 77.2295 };
  assert.ok(hyderabad.lat >= 16.8 && hyderabad.lat <= 18.1);
  assert.ok(hyderabad.lng >= 77.8 && hyderabad.lng <= 79.1);
  assert.equal(delhi.lat >= 16.8 && delhi.lat <= 18.1, false);
  assert.equal(delhi.lng >= 77.8 && delhi.lng <= 79.1, false);
});

test("Docker OSRM service is internal only and backend public fallback is disabled", () => {
  const compose = fs.readFileSync(path.join(__dirname, "..", "..", "compose.yaml"), "utf8");
  const osrmBlock = compose.match(/\n  osrm:\n([\s\S]*?)\n\n  backend:/)?.[1] || "";
  const backendBlock = compose.match(/\n  backend:\n([\s\S]*?)\n\n  frontend:/)?.[1] || "";

  assert.match(osrmBlock, /image:\s*osrm\/osrm-backend:v5\.27\.1/);
  assert.match(osrmBlock, /osrm-routed/);
  assert.match(osrmBlock, /--algorithm", "mld"/);
  assert.match(osrmBlock, /expose:\s*\n\s*-\s*"5000"/);
  assert.doesNotMatch(osrmBlock, /\n\s*ports:/);
  assert.match(backendBlock, /GIS_ROUTING_PROVIDER:\s*\$\{GIS_ROUTING_PROVIDER:-self_hosted\}/);
  assert.match(backendBlock, /OSRM_BASE_URL:\s*\$\{OSRM_BASE_URL:-http:\/\/osrm:5000\}/);
  assert.match(backendBlock, /PUBLIC_OSRM_FALLBACK:\s*\$\{PUBLIC_OSRM_FALLBACK:-false\}/);
  assert.doesNotMatch(backendBlock, /router\.project-osrm\.org/);
});

test("frontend role landing and menu restrictions remain configured", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "index.html"), "utf8");
  const registerForm = html.match(/<form id="registerForm"[\s\S]*?<\/form>/)?.[0] || "";
  assert.match(appSource, /role === "Citizen"\) return "missing"/);
  assert.match(appSource, /role === "Admin"\) return "dashboard"/);
  assert.match(html, /data-view="cctv" data-roles="Police Officer,Admin"/);
  assert.match(html, /data-view="live-vision" data-roles="Police Officer,Admin"/);
  assert.match(html, /data-view="video-evidence" data-roles="Police Officer,Admin"/);
  assert.match(html, /data-view="missing" data-roles="Police Officer,Admin,Citizen"/);
  assert.match(html, /data-view="police-management" data-roles="Admin"/);
  assert.match(html, /data-view="settings" data-roles="Admin"/);
  assert.match(html, /data-panel="police-management"/);
  assert.match(appSource, /Browser \/ Device Camera/);
  assert.match(appSource, /Video Evidence Upload/);
  assert.match(appSource, /Citizen Evidence/);
  assert.match(appSource, /title: "Video Evidence Upload"[\s\S]*view: "video-evidence"/);
  assert.match(appSource, /title: "CCTV Registry"[\s\S]*view: "cctv"/);
  assert.match(appSource, /dashboardSourceCards/);
  assert.match(appSource, /"police-management": "Police Management"/);
  assert.match(appSource, /nav\?\.hidden/);
  const settingsSection = html.match(/<section class="view" data-panel="settings">[\s\S]*?<section class="view" data-panel="police-management">/)?.[0] || "";
  assert.doesNotMatch(settingsSection, /policeUserForm|Police Account Management/);
  assert.match(registerForm, /Citizen account only/);
  assert.doesNotMatch(registerForm, /<option value="Police Officer"|<option value="Admin"/);
});

let assignmentFixtureCounter = 0;

function assignmentFixtureId(label) {
  assignmentFixtureCounter += 1;
  return `${label}_${Date.now()}_${assignmentFixtureCounter}`;
}

function createAssignmentTestUnit(overrides = {}) {
  const id = overrides.id || assignmentFixtureId("test_unit");
  const unitCode = overrides.unitCode || `TEST-${assignmentFixtureCounter}`;
  const timestamp = new Date().toISOString();
  return {
    id,
    unitId: unitCode,
    unitCode,
    unitName: overrides.unitName || `Concurrency Test Unit ${assignmentFixtureCounter}`,
    name: overrides.unitName || `Concurrency Test Unit ${assignmentFixtureCounter}`,
    unitType: "police_patrol",
    type: "police_patrol",
    officerName: "Test Officer",
    teamName: "Test Officer",
    stationName: "Test Station",
    station: "Test Station",
    linkedStationId: null,
    stationId: null,
    beat: "Test Beat",
    sector: "Test Beat",
    jurisdiction: "Test Jurisdiction",
    vehicleType: "Test Vehicle",
    status: "available",
    lat: PATANCHERU_POINT.lat,
    lng: PATANCHERU_POINT.lng,
    address: "Test Location",
    currentAddress: "Test Location",
    source: "admin_registry",
    sourceLabel: "Admin registry",
    isDemo: false,
    stationFallback: false,
    operational: true,
    lastSeen: timestamp,
    lastUpdated: timestamp,
    lastLocationUpdatedAt: timestamp,
    assignedIncidentId: null,
    currentIncidentId: null,
    ...overrides
  };
}

function createAssignmentTestIncident(adminUser, overrides = {}) {
  const timestamp = new Date().toISOString();
  const id = overrides.id || assignmentFixtureId("test_incident");
  return {
    id,
    title: overrides.title || `Concurrency Test Incident ${assignmentFixtureCounter}`,
    type: "test_incident",
    category: "test_incident",
    severity: "medium",
    status: "Verified",
    source: "Manual",
    sourceType: "manual",
    sourceName: "Test",
    zone: "Test Zone",
    address: "Test Address",
    lat: BHEL_POINT.lat,
    lng: BHEL_POINT.lng,
    locationSource: "manual_latlng",
    locationStatus: "Verified",
    reportedBy: adminUser.id,
    assignedUnitId: null,
    recommendedUnitId: null,
    etaMinutes: null,
    distanceKm: null,
    occurrenceCount: 1,
    confidence: 0.9,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastDetectedAt: timestamp,
    createdBy: adminUser.id,
    ...overrides
  };
}

function unitAssignmentBody(unitId, expectedAssignedUnitId = null) {
  return JSON.stringify({ unitId, expectedAssignedUnitId });
}

test("concurrent assignment: two operators assign same incident", async () => {
  const db = await readDatabase();
  const adminUser = users.find((u) => u.role === "Admin");

  const testUnit = {
    id: `test_unit_${Date.now()}`,
    unitId: `TEST-${Date.now()}`,
    unitCode: `TEST-${Date.now()}`,
    unitName: "Concurrency Test Unit",
    name: "Concurrency Test Unit",
    unitType: "police_patrol",
    type: "police_patrol",
    officerName: "Test Officer",
    teamName: "Test Officer",
    stationName: "Test Station",
    station: "Test Station",
    linkedStationId: null,
    stationId: null,
    beat: "Test Beat",
    sector: "Test Beat",
    jurisdiction: "Test Jurisdiction",
    vehicleType: "Test Vehicle",
    status: "available",
    lat: 17.5285,
    lng: 78.2636,
    address: "Test Location",
    currentAddress: "Test Location",
    source: "admin_registry",
    sourceLabel: "Admin registry",
    isDemo: false,
    stationFallback: false,
    operational: true,
    lastSeen: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    lastLocationUpdatedAt: new Date().toISOString(),
    assignedIncidentId: null,
    currentIncidentId: null
  };
  db.responseUnits.unshift(testUnit);

  const incident = {
    id: `test_incident_${Date.now()}`,
    title: "Concurrency Test Incident",
    type: "test_incident",
    category: "test_incident",
    severity: "medium",
    status: "Verified",
    source: "Manual",
    sourceType: "manual",
    sourceName: "Test",
    zone: "Test Zone",
    address: "Test Address",
    lat: 17.5285,
    lng: 78.2636,
    locationSource: "manual_latlng",
    locationStatus: "Verified",
    reportedBy: adminUser.id,
    assignedUnitId: null,
    recommendedUnitId: null,
    etaMinutes: null,
    distanceKm: null,
    occurrenceCount: 1,
    confidence: 0.9,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastDetectedAt: new Date().toISOString(),
    createdBy: adminUser.id
  };
  db.incidents.unshift(incident);

  await writeDatabase(db);

  const adminHeaders = authHeaders("Admin");

  const [result1, result2] = await Promise.all([
    request(`/api/incidents/${incident.id}/assign-nearest`, { method: "POST", headers: { ...adminHeaders, Origin: "http://localhost:3000" } }),
    request(`/api/incidents/${incident.id}/assign-nearest`, { method: "POST", headers: { ...adminHeaders, Origin: "http://localhost:3000" } })
  ]);

  const results = [result1, result2];
  const statuses = results.map((result) => result.status).sort();
  assert.deepEqual(statuses, [200, 409], "Only one assignment succeeds; the concurrent request is rejected safely");
  const conflict = results.find((result) => result.status === 409);
  assert.equal((await conflict.json()).code, "ASSIGNMENT_CONFLICT");

  const successResult = result1.status === 200 ? await result1.json() : await result2.json();

  assert.ok(successResult.incident.assignedUnitId, "Successful assignment has unit");

  const updatedDb = await readDatabase();
  const updatedIncident = updatedDb.incidents.find((i) => i.id === incident.id);
  assert.ok(updatedIncident.assignedUnitId, "Incident has assigned unit in database");
  assert.equal(updatedIncident.status, "Assigned", "Incident status is Assigned");

  const assignedUnit = updatedDb.responseUnits.find((u) => u.id === updatedIncident.assignedUnitId);
  assert.ok(assignedUnit, "Assigned unit exists");
  assert.equal(assignedUnit.status, "busy", "Assigned unit status is busy");
  assert.equal(assignedUnit.assignedIncidentId, incident.id, "Unit assigned to correct incident");
  const assignAudits = updatedDb.auditLogs.filter((log) => log.action === "unit_assigned" && log.incidentId === incident.id);
  assert.equal(assignAudits.length, 1, "Only one unit_assigned audit record");
  const dispatchEvents = updatedDb.dispatchEvents.filter((event) => event.incidentId === incident.id && event.type === "unit_assigned");
  assert.equal(dispatchEvents.length, 1, "Only one unit_assigned dispatch event");
});

test("concurrent assignment: two incidents claim same unit", async () => {
  const db = await readDatabase();
  const adminUser = users.find((u) => u.role === "Admin");

  const testUnit = {
    id: `test_unit_${Date.now()}_2`,
    unitId: `TEST-${Date.now()}-2`,
    unitCode: `TEST-${Date.now()}-2`,
    unitName: "Concurrency Test Unit 2",
    name: "Concurrency Test Unit 2",
    unitType: "police_patrol",
    type: "police_patrol",
    officerName: "Test Officer 2",
    teamName: "Test Officer 2",
    stationName: "Test Station 2",
    station: "Test Station 2",
    linkedStationId: null,
    stationId: null,
    beat: "Test Beat 2",
    sector: "Test Beat 2",
    jurisdiction: "Test Jurisdiction 2",
    vehicleType: "Test Vehicle 2",
    status: "available",
    lat: 17.5285,
    lng: 78.2636,
    address: "Test Location 2",
    currentAddress: "Test Location 2",
    source: "admin_registry",
    sourceLabel: "Admin registry",
    isDemo: false,
    stationFallback: false,
    operational: true,
    lastSeen: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    lastLocationUpdatedAt: new Date().toISOString(),
    assignedIncidentId: null,
    currentIncidentId: null
  };
  db.responseUnits.unshift(testUnit);

  const incident1 = {
    id: `test_incident_${Date.now()}_1`,
    title: "Concurrency Test Incident 1",
    type: "test_incident",
    category: "test_incident",
    severity: "medium",
    status: "Verified",
    source: "Manual",
    sourceType: "manual",
    sourceName: "Test",
    zone: "Test Zone",
    address: "Test Address",
    lat: 17.5285,
    lng: 78.2636,
    locationSource: "manual_latlng",
    locationStatus: "Verified",
    reportedBy: adminUser.id,
    assignedUnitId: null,
    recommendedUnitId: null,
    etaMinutes: null,
    distanceKm: null,
    occurrenceCount: 1,
    confidence: 0.9,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastDetectedAt: new Date().toISOString(),
    createdBy: adminUser.id
  };

  const incident2 = {
    id: `test_incident_${Date.now()}_2`,
    title: "Concurrency Test Incident 2",
    type: "test_incident",
    category: "test_incident",
    severity: "medium",
    status: "Verified",
    source: "Manual",
    sourceType: "manual",
    sourceName: "Test",
    zone: "Test Zone 2",
    address: "Test Address 2",
    lat: 17.4933,
    lng: 78.3915,
    locationSource: "manual_latlng",
    locationStatus: "Verified",
    reportedBy: adminUser.id,
    assignedUnitId: null,
    recommendedUnitId: null,
    etaMinutes: null,
    distanceKm: null,
    occurrenceCount: 1,
    confidence: 0.9,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastDetectedAt: new Date().toISOString(),
    createdBy: adminUser.id
  };

  db.incidents.unshift(incident1, incident2);
  await writeDatabase(db);

  const adminHeaders = authHeaders("Admin");

  const body1 = { unitId: testUnit.id };
  const body2 = { unitId: testUnit.id };

  const [result1, result2] = await Promise.all([
    request(`/api/incidents/${incident1.id}/assign-unit`, { method: "POST", headers: { ...adminHeaders, "Content-Type": "application/json", Origin: "http://localhost:3000" }, body: JSON.stringify(body1) }),
    request(`/api/incidents/${incident2.id}/assign-unit`, { method: "POST", headers: { ...adminHeaders, "Content-Type": "application/json", Origin: "http://localhost:3000" }, body: JSON.stringify(body2) })
  ]);

  const results = [result1, result2];
  const statuses = results.map((result) => result.status).sort();
  assert.deepEqual(statuses, [200, 409], "Only one incident can claim the unit");
  const conflict = results.find((result) => result.status === 409);
  assert.equal((await conflict.json()).code, "ASSIGNMENT_CONFLICT");

  const successResult = result1.status === 200 ? await result1.json() : await result2.json();
  assert.ok(successResult.incident.assignedUnitId, "Successful assignment has unit");

  const updatedDb = await readDatabase();
  const unit = updatedDb.responseUnits.find((u) => u.id === testUnit.id);
  assert.equal(unit.status, "busy", "Unit status is busy");
  assert.ok(unit.assignedIncidentId === incident1.id || unit.assignedIncidentId === incident2.id, "Unit assigned to one of the incidents");

  const incident1Updated = updatedDb.incidents.find((i) => i.id === incident1.id);
  const incident2Updated = updatedDb.incidents.find((i) => i.id === incident2.id);
  const assignedCount = [incident1Updated.assignedUnitId, incident2Updated.assignedUnitId].filter(Boolean).length;
  assert.equal(assignedCount, 1, "Only one incident has the unit assigned");
});

test("concurrent assignment: state consistency and no duplicate audit records", async () => {
  const db = await readDatabase();
  const adminUser = users.find((u) => u.role === "Admin");

  const testUnit = {
    id: `test_unit_${Date.now()}_3`,
    unitId: `TEST-${Date.now()}-3`,
    unitCode: `TEST-${Date.now()}-3`,
    unitName: "Concurrency Test Unit 3",
    name: "Concurrency Test Unit 3",
    unitType: "police_patrol",
    type: "police_patrol",
    officerName: "Test Officer 3",
    teamName: "Test Officer 3",
    stationName: "Test Station 3",
    station: "Test Station 3",
    linkedStationId: null,
    stationId: null,
    beat: "Test Beat 3",
    sector: "Test Beat 3",
    jurisdiction: "Test Jurisdiction 3",
    vehicleType: "Test Vehicle 3",
    status: "available",
    lat: 17.5285,
    lng: 78.2636,
    address: "Test Location 3",
    currentAddress: "Test Location 3",
    source: "admin_registry",
    sourceLabel: "Admin registry",
    isDemo: false,
    stationFallback: false,
    operational: true,
    lastSeen: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    lastLocationUpdatedAt: new Date().toISOString(),
    assignedIncidentId: null,
    currentIncidentId: null
  };
  db.responseUnits.unshift(testUnit);

  const incident = {
    id: `test_incident_${Date.now()}_3`,
    title: "Concurrency Test Incident 3",
    type: "test_incident",
    category: "test_incident",
    severity: "medium",
    status: "Verified",
    source: "Manual",
    sourceType: "manual",
    sourceName: "Test",
    zone: "Test Zone 3",
    address: "Test Address 3",
    lat: 17.5004,
    lng: 78.3798,
    locationSource: "manual_latlng",
    locationStatus: "Verified",
    reportedBy: adminUser.id,
    assignedUnitId: null,
    recommendedUnitId: null,
    etaMinutes: null,
    distanceKm: null,
    occurrenceCount: 1,
    confidence: 0.9,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastDetectedAt: new Date().toISOString(),
    createdBy: adminUser.id
  };
  db.incidents.unshift(incident);

  await writeDatabase(db);

  const adminHeaders = authHeaders("Admin");

  const results = await Promise.all([
    request(`/api/incidents/${incident.id}/assign-nearest`, { method: "POST", headers: { ...adminHeaders, Origin: "http://localhost:3000" } }),
    request(`/api/incidents/${incident.id}/assign-nearest`, { method: "POST", headers: { ...adminHeaders, Origin: "http://localhost:3000" } }),
    request(`/api/incidents/${incident.id}/assign-nearest`, { method: "POST", headers: { ...adminHeaders, Origin: "http://localhost:3000" } })
  ]);
  assert.equal(results.filter((result) => result.status === 200).length, 1, "Only one concurrent assignment succeeds");
  assert.equal(results.filter((result) => result.status === 409).length, 2, "Duplicate concurrent assignments return conflict");
  for (const conflict of results.filter((result) => result.status === 409)) {
    assert.equal((await conflict.json()).code, "ASSIGNMENT_CONFLICT");
  }

  const updatedDb = await readDatabase();
  const updatedIncident = updatedDb.incidents.find((i) => i.id === incident.id);
  assert.ok(updatedIncident.assignedUnitId, "Incident has assigned unit");

  const unit = updatedDb.responseUnits.find((u) => u.id === updatedIncident.assignedUnitId);
  assert.ok(unit, "Assigned unit exists");
  assert.equal(unit.status, "busy");
  assert.equal(unit.assignedIncidentId, incident.id);

  const assignAudits = updatedDb.auditLogs.filter((log) => log.action === "unit_assigned" && log.incidentId === incident.id);
  assert.equal(assignAudits.length, 1, "Only one unit_assigned audit record");

  const dispatchEvents = updatedDb.dispatchEvents.filter((event) => event.incidentId === incident.id && event.type === "unit_assigned");
  assert.equal(dispatchEvents.length, 1, "Only one unit_assigned dispatch event");
});

test("concurrent assignment: same incident different units rejects stale competing intent", async () => {
  const db = await readDatabase();
  const adminUser = users.find((u) => u.role === "Admin");
  const unitA = createAssignmentTestUnit({ unitCode: `DIFF-A-${Date.now()}` });
  const unitB = createAssignmentTestUnit({ unitCode: `DIFF-B-${Date.now()}` });
  const incident = createAssignmentTestIncident(adminUser, { title: "Different Unit Concurrency Incident" });
  db.responseUnits.unshift(unitA, unitB);
  db.incidents.unshift(incident);
  await writeDatabase(db);

  const adminHeaders = authHeaders("Admin");
  const [resultA, resultB] = await Promise.all([
    request(`/api/incidents/${incident.id}/assign-unit`, {
      method: "POST",
      headers: { ...adminHeaders, "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: unitAssignmentBody(unitA.id, null)
    }),
    request(`/api/incidents/${incident.id}/assign-unit`, {
      method: "POST",
      headers: { ...adminHeaders, "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: unitAssignmentBody(unitB.id, null)
    })
  ]);

  const results = [resultA, resultB];
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const conflictBody = await results.find((result) => result.status === 409).json();
  assert.equal(conflictBody.code, "ASSIGNMENT_STALE");
  assert.match(conflictBody.error, /assignment changed/i);

  const successBody = await results.find((result) => result.status === 200).json();
  const winningUnitId = successBody.unit.id;
  const losingUnitId = winningUnitId === unitA.id ? unitB.id : unitA.id;
  const losingUnitCode = winningUnitId === unitA.id ? unitB.unitCode : unitA.unitCode;

  const updatedDb = await readDatabase();
  const updatedIncident = updatedDb.incidents.find((item) => item.id === incident.id);
  assert.equal(updatedIncident.assignedUnitId, winningUnitId);
  const winningUnit = updatedDb.responseUnits.find((item) => item.id === winningUnitId);
  const losingUnit = updatedDb.responseUnits.find((item) => item.id === losingUnitId);
  assert.equal(winningUnit.status, "busy");
  assert.equal(winningUnit.assignedIncidentId, incident.id);
  assert.equal(losingUnit.status, "available");
  assert.equal(losingUnit.assignedIncidentId, null);
  assert.equal(losingUnit.currentIncidentId, null);

  const assignEvents = updatedDb.dispatchEvents.filter((event) => event.incidentId === incident.id && event.type === "unit_assigned");
  assert.equal(assignEvents.length, 1);
  assert.doesNotMatch(JSON.stringify(assignEvents), new RegExp(losingUnitCode));
  const assignAudits = updatedDb.auditLogs.filter((log) => log.incidentId === incident.id && log.action === "unit_assigned");
  assert.equal(assignAudits.length, 1);
  assert.doesNotMatch(JSON.stringify(assignAudits), new RegExp(losingUnitCode));
});

test("manual reassignment succeeds only when expected assignment matches", async () => {
  const db = await readDatabase();
  const adminUser = users.find((u) => u.role === "Admin");
  const firstUnit = createAssignmentTestUnit({ unitCode: `REASSIGN-A-${Date.now()}`, status: "busy" });
  const secondUnit = createAssignmentTestUnit({ unitCode: `REASSIGN-B-${Date.now()}` });
  const incident = createAssignmentTestIncident(adminUser, {
    title: "Intentional Reassignment Incident",
    status: "Assigned",
    assignedUnitId: firstUnit.id
  });
  firstUnit.assignedIncidentId = incident.id;
  firstUnit.currentIncidentId = incident.id;
  db.responseUnits.unshift(firstUnit, secondUnit);
  db.incidents.unshift(incident);
  await writeDatabase(db);

  const response = await request(`/api/incidents/${incident.id}/assign-unit`, {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: unitAssignmentBody(secondUnit.id, firstUnit.id)
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.incident.assignedUnitId, secondUnit.id);

  const updatedDb = await readDatabase();
  const updatedIncident = updatedDb.incidents.find((item) => item.id === incident.id);
  const updatedFirstUnit = updatedDb.responseUnits.find((item) => item.id === firstUnit.id);
  const updatedSecondUnit = updatedDb.responseUnits.find((item) => item.id === secondUnit.id);
  assert.equal(updatedIncident.assignedUnitId, secondUnit.id);
  assert.equal(updatedFirstUnit.status, "available");
  assert.equal(updatedFirstUnit.assignedIncidentId, null);
  assert.equal(updatedFirstUnit.currentIncidentId, null);
  assert.equal(updatedSecondUnit.status, "busy");
  assert.equal(updatedSecondUnit.assignedIncidentId, incident.id);
});

test("manual reassignment rejects stale expected assignment without side effects", async () => {
  const db = await readDatabase();
  const adminUser = users.find((u) => u.role === "Admin");
  const oldUnit = createAssignmentTestUnit({ unitCode: `STALE-OLD-${Date.now()}` });
  const currentUnit = createAssignmentTestUnit({ unitCode: `STALE-CURRENT-${Date.now()}`, status: "busy" });
  const requestedUnit = createAssignmentTestUnit({ unitCode: `STALE-REQUESTED-${Date.now()}` });
  const incident = createAssignmentTestIncident(adminUser, {
    title: "Stale Reassignment Incident",
    status: "Assigned",
    assignedUnitId: currentUnit.id
  });
  currentUnit.assignedIncidentId = incident.id;
  currentUnit.currentIncidentId = incident.id;
  db.responseUnits.unshift(oldUnit, currentUnit, requestedUnit);
  db.incidents.unshift(incident);
  const eventCountBefore = db.dispatchEvents.length;
  const auditCountBefore = db.auditLogs.length;
  await writeDatabase(db);

  const response = await request(`/api/incidents/${incident.id}/assign-unit`, {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: unitAssignmentBody(requestedUnit.id, oldUnit.id)
  });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "ASSIGNMENT_STALE");

  const updatedDb = await readDatabase();
  const updatedIncident = updatedDb.incidents.find((item) => item.id === incident.id);
  const updatedCurrentUnit = updatedDb.responseUnits.find((item) => item.id === currentUnit.id);
  const updatedRequestedUnit = updatedDb.responseUnits.find((item) => item.id === requestedUnit.id);
  assert.equal(updatedIncident.assignedUnitId, currentUnit.id);
  assert.equal(updatedCurrentUnit.status, "busy");
  assert.equal(updatedCurrentUnit.assignedIncidentId, incident.id);
  assert.equal(updatedRequestedUnit.status, "available");
  assert.equal(updatedRequestedUnit.assignedIncidentId, null);
  assert.equal(updatedRequestedUnit.currentIncidentId, null);
  assert.equal(updatedDb.dispatchEvents.length, eventCountBefore);
  assert.equal(updatedDb.auditLogs.length, auditCountBefore);
});

test("citizen cannot assign a selected unit", async () => {
  const db = await readDatabase();
  const adminUser = users.find((u) => u.role === "Admin");
  const unit = createAssignmentTestUnit({ unitCode: `CITIZEN-BLOCK-${Date.now()}` });
  const incident = createAssignmentTestIncident(adminUser, { title: "Citizen Assignment Block Incident" });
  db.responseUnits.unshift(unit);
  db.incidents.unshift(incident);
  await writeDatabase(db);

  const response = await request(`/api/incidents/${incident.id}/assign-unit`, {
    method: "POST",
    headers: { ...authHeaders("Citizen"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: unitAssignmentBody(unit.id, null)
  });
  assert.equal(response.status, 403);

  const updatedDb = await readDatabase();
  const updatedIncident = updatedDb.incidents.find((item) => item.id === incident.id);
  const updatedUnit = updatedDb.responseUnits.find((item) => item.id === unit.id);
  assert.equal(updatedIncident.assignedUnitId, null);
  assert.equal(updatedUnit.status, "available");
});
