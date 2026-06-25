const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pathToFileURL } = require("node:url");
const aiContract = require("../services/ai.service");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-security-"));
const testDatabase = path.join(testDirectory, "db.json");
const sourceDatabase = path.join(__dirname, "..", "data", "db.json");
const TEST_PASSWORD = "RakshakAI-Test-123!";

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
    lat: 28.6164,
    lng: 77.2257,
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
    lat: 28.6079,
    lng: 77.2215,
    confidence: 0.89,
    detections: [{ label: "suitcase", confidence: 0.89, box: [20, 20, 80, 90] }],
    frameTimestamp: new Date().toISOString(),
    threatLevel: "high",
    status: "Pending Review",
    reviewStatus: "pending_review",
    acknowledged: false,
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
fs.writeFileSync(testDatabase, JSON.stringify(database, null, 2));

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.RAKSHAKAI_DATA_FILE = testDatabase;
process.env.JWT_SECRET = "rakshakai-test-secret-that-is-longer-than-32-characters";
process.env.AI_SERVICE_URL = "";
process.env.OSRM_BASE_URL = "http://127.0.0.1:1";
process.env.API_RATE_LIMIT = "10000";
process.env.AUTH_RATE_LIMIT = "3";

const { start } = require("../server");
const { readDatabase, writeDatabase } = require("../services/core.service");

let server;
let osrmServer;
let baseUrl;
let users;
let createdCitizenReportId;
let reviewedIncidentId;
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
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "ok", modelLoaded: true }));
    }
    if (req.url === "/analyze-frame") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
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
    }
    const coordinatesPart = new URL(req.url, "http://localhost").pathname.split("/").at(-1);
    const [start, destination] = coordinatesPart.split(";").map((pair) => pair.split(",").map(Number));
    const distance = Math.max(100, Math.hypot(destination[1] - start[1], destination[0] - start[0]) * 100000);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      code: "Ok",
      routes: [{
        distance,
        duration: Math.max(60, distance / 8),
        geometry: { type: "LineString", coordinates: [start, destination] },
        legs: [{ steps: [] }]
      }]
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
  for (const route of ["/api/admin/users", "/api/device-health", "/api/audit-logs", "/api/integrations/status"]) {
    assert.equal((await request(route, { headers: authHeaders("Admin") })).status, 200, route);
    assert.equal((await request(route, { headers: authHeaders("Police Officer") })).status, 403, route);
    assert.equal((await request(route, { headers: authHeaders("Citizen") })).status, 403, route);
  }
});

test("Admin and Police can access operational routes", async () => {
  for (const role of ["Admin", "Police Officer"]) {
    for (const route of ["/api/dashboard", "/api/cameras/sources", "/api/alerts", "/api/incidents", "/api/response-units"]) {
      const response = await request(route, { headers: authHeaders(role) });
      assert.equal(response.status, 200, `${role}: ${route}`);
    }
  }
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
  for (const route of ["/api/dashboard", "/api/cameras/sources", "/api/alerts", "/api/incidents", "/api/response-units"]) {
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
  assert.match(body.incident.locationSafetyLabel, /Location missing/i);
  assert.equal(body.incident.source, "Citizen");
});

test("AI alerts remain pending review and do not auto-create incidents", async () => {
  const response = await request("/api/incidents", { headers: authHeaders("Admin") });
  const incidents = (await response.json()).incidents;
  assert.equal(incidents.some((incident) => incident.sourceRecordId === "alt_ai_admin_review"), false);
  assert.equal(incidents.some((incident) => incident.sourceRecordId === "alt_ai_police_review"), false);
});

test("Admin and Police can explicitly create verified incidents from reviewed AI alerts", async () => {
  for (const [role, alertId] of [["Admin", "alt_ai_admin_review"], ["Police Officer", "alt_ai_police_review"]]) {
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
  }
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
    body: "{}"
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
  for (const status of ["En Route", "On Scene", "Resolved", "Closed"]) {
    const response = await request(`/api/incidents/${reviewedIncidentId}/status`, {
      method: "PATCH",
      headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ status })
    });
    assert.equal(response.status, 200, status);
    assert.equal((await response.json()).incident.status, status);
  }

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
});

test("workflow actions create audit logs", async () => {
  const response = await request("/api/audit-logs", { headers: authHeaders("Admin") });
  assert.equal(response.status, 200);
  const actions = (await response.json()).auditLogs.map((log) => log.action);
  for (const action of ["citizen_report_submitted", "citizen_report_converted", "ai_alert_reviewed", "incident_verified", "unit_assigned", "incident_resolved", "incident_closed"]) {
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
    assert.ok((await route.json()).distanceKm >= 0);
  }

  for (const route of ["/api/maps/search?q=Delhi", "/api/maps/reverse?lat=28.6&lng=77.2"]) {
    assert.equal((await request(route, { headers: authHeaders("Citizen") })).status, 403);
  }
  const citizenRoute = await request("/api/maps/route", {
    method: "POST",
    headers: { ...authHeaders("Citizen"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ start: { lat: 28, lng: 77 }, destination: { lat: 29, lng: 78 } })
  });
  assert.equal(citizenRoute.status, 403);
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
    body: JSON.stringify({ ...editedPoint, address: "Verified test destination", confirmed: true })
  });
  assert.equal(edited.status, 200);
  const editedIncident = (await edited.json()).incident;
  assert.deepEqual(editedIncident.location, editedPoint);
  assert.equal(editedIncident.locationStatus, "Verified");

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
    assert.match((await recommend.json()).error, /Location missing/i);

    const assignment = await request(`/api/incidents/${incident.id}/assign-nearest`, {
      method: "POST",
      headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: "{}"
    });
    assert.equal(assignment.status, 409);
    assert.match((await assignment.json()).error, /Location missing|Verify the incident/i);
  }
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
});

test("stale and offline units are excluded from automatic nearest-unit dispatch", async () => {
  const db = await readDatabase();
  db.responseUnits.forEach((unit, index) => {
    unit.status = index === 0 ? "available" : "offline";
    unit.assignedIncidentId = null;
    unit.lastLocationUpdatedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  });
  await writeDatabase(db);

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
  assert.equal(assignment.status, 503);

  const restored = await readDatabase();
  restored.responseUnits.forEach((unit) => {
    unit.status = "available";
    unit.assignedIncidentId = null;
    unit.lastLocationUpdatedAt = new Date().toISOString();
  });
  await writeDatabase(restored);
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
    assert.match(body.message, /not driving route/i);
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
  assert.equal((await citizen.json()).message, "Access denied");
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

test("frontend role landing and menu restrictions remain configured", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "index.html"), "utf8");
  assert.match(appSource, /role === "Citizen"\) return "missing"/);
  assert.match(appSource, /role === "Admin"\) return "dashboard"/);
  assert.match(html, /data-view="cctv" data-roles="Police Officer,Admin"/);
  assert.match(html, /data-view="live-vision" data-roles="Police Officer,Admin"/);
  assert.match(html, /data-view="missing" data-roles="Police Officer,Admin,Citizen"/);
  assert.match(html, /data-view="settings" data-roles="Admin"/);
});
