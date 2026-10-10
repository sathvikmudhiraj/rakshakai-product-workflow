const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const jwt = require("jsonwebtoken");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-tracking-rbac-"));
const dataFile = path.join(directory, "db.json");
const fixture = path.join(__dirname, "fixtures", "db.fixture.json");
fs.copyFileSync(fixture, dataFile);
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.RAKSHAKAI_DATA_FILE = dataFile;
process.env.JWT_SECRET = "rakshakai-tracking-rbac-secret-that-is-longer-than-32-characters";
process.env.API_RATE_LIMIT = "10000";
process.env.FRONTEND_ORIGINS = "https://ops.rakshak.example.com";
process.env.AI_SERVICE_URL = "";
process.env.AI_SERVICE_ALLOW_INSECURE = "true";

const { start } = require("../server");
const users = JSON.parse(fs.readFileSync(dataFile, "utf8")).users;
let server; let baseUrl;

function headers(role) {
  const user = users.find((item) => item.role === role);
  const token = jwt.sign({ role: user.role, email: user.email, name: user.name, sessionVersion: user.sessionVersion || null }, process.env.JWT_SECRET, { subject: user.id, expiresIn: "5m" });
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

test.before(async () => { server = await start(0); baseUrl = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });

test("tracking routes enforce API RBAC for unauthenticated and Citizen callers", async () => {
  assert.equal((await fetch(`${baseUrl}/api/tracking/sessions`)).status, 401);
  for (const request of [
    fetch(`${baseUrl}/api/tracking/sessions`, { headers: headers("Citizen") }),
    fetch(`${baseUrl}/api/tracking/sessions`, { method: "POST", headers: headers("Citizen"), body: JSON.stringify({ trackType: "PERSON", referenceDetectionId: "det", referenceCameraId: "cam_c19" }) }),
    fetch(`${baseUrl}/api/tracking/sessions/missing/search`, { method: "POST", headers: headers("Citizen"), body: "{}" })
  ]) assert.equal((await request).status, 403);
});

test("Police Officer and Admin can read tracking while only Admin can configure it", async () => {
  assert.equal((await fetch(`${baseUrl}/api/tracking/sessions`, { headers: headers("Police Officer") })).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/tracking/sessions`, { headers: headers("Admin") })).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/tracking/camera-adjacency`, { method: "POST", headers: headers("Police Officer"), body: "{}" })).status, 403);
  assert.equal((await fetch(`${baseUrl}/api/tracking/camera-adjacency`, { headers: headers("Admin") })).status, 200);
});
