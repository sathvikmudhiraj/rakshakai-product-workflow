const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const bcrypt = require("bcryptjs");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mg-debug-"));
const databasePath = path.join(testDirectory, "db.json");
const passwordHash = bcrypt.hashSync("Debug-Test-123!", 4);
const database = {
  users: [
    { id: "u_admin", name: "Admin", email: "admin@example.test", role: "Admin", passwordHash },
    { id: "u_officer", name: "Officer", email: "officer@example.test", role: "Police Officer", passwordHash }
  ],
  alerts: [], incidents: [], aiObservations: [], auditLogs: [], cameraSources: [], dispatchEvents: [],
  responseUnits: [], responseUnitMembers: [], policeOfficers: [], policeStations: [], officerRanks: []
};
fs.writeFileSync(databasePath, JSON.stringify(database));
process.env.RAKSHAKAI_DATA_FILE = databasePath;
process.env.JWT_SECRET = "debug-secret-debug-secret-debug-secret!";
process.env.EVIDENCE_STORAGE_DRIVER = "filesystem";
process.env.EVIDENCE_STORAGE_DIR = path.join(testDirectory, "evidence");
process.env.AI_SERVICE_URL = "";

const { app } = require("../server");
const { MediaGateway, SimulatorConnector } = require("../services/mediaGateway.service");
const { persistGatewayObservation } = require("../services/aiObservation.service");

let server, baseUrl;
test.before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise((r) => server.close(r)); });

async function request(pathname, { cookie, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await response.json(); } catch {}
  return { status: response.status, data };
}

async function login(email) {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "Debug-Test-123!" }) });
  return response.headers.get("set-cookie").split(";")[0];
}

test("debug rtsp acknowledge", async () => {
  const police = await login("officer@example.test");
  const gateway = new MediaGateway({
    connectorFactory: (source) => new SimulatorConnector(source, { intervalMs: 40 }),
    analyzeFrame: async () => ({ configured: true, detections: [{ label: "person", confidence: 0.94, box: [10, 20, 80, 160] }] }),
    persistObservation: persistGatewayObservation
  });
  const created = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("no observation")), 2000);
    gateway.once("observation_created", (p) => { clearTimeout(t); resolve(p.observation); });
  });
  await gateway.startCamera({ id: "cam_dbg", cameraId: "CAM-DBG", name: "Debug Camera", zone: "Z", enabled: true, streamEnabled: true, aiEnabled: true, samplingIntervalMs: 250 });
  const observation = await created.finally(() => gateway.stopAll());
  const review = await request(`/api/ai-observations/${observation.id}/review`, { cookie: police, method: "POST", body: { decision: "CONFIRMED", notes: "dbg" } });
  console.log("review status", review.status, "alert id", review.data?.alert?.id);
  const db1 = JSON.parse(fs.readFileSync(databasePath, "utf8"));
  console.log("alerts in db after review:", JSON.stringify(db1.alerts.map(a => a.id)));
  const ack = await request(`/api/alerts/${review.data.alert.id}/acknowledge`, { cookie: police, method: "POST", body: {} });
  console.log("ack status", ack.status, "body", JSON.stringify(ack.data).slice(0, 200));
  assert.equal(ack.status, 200);
});
