const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const bcrypt = require("bcryptjs");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-copilot-"));
const databaseFile = path.join(directory, "db.json");
const password = "Copilot-Test-123!";
const passwordHash = bcrypt.hashSync(password, 4);
const database = {
  users: [
    { id: "admin", name: "Admin", email: "admin@copilot.test", role: "Admin", passwordHash },
    { id: "police", name: "Officer", email: "police@copilot.test", role: "Police Officer", passwordHash },
    { id: "citizen", name: "Citizen", email: "citizen@copilot.test", role: "Citizen", passwordHash }
  ],
  incidents: [{ id: "INC-API-1", title: "API fixture", severity: "HIGH", status: "Verified" }],
  responseUnits: [], cameraSources: [], auditLogs: [], reports: [], alerts: [], policeStations: [], policeOfficers: [], responseUnitMembers: []
};
fs.writeFileSync(databaseFile, JSON.stringify(database));
process.env.NODE_ENV = "test";
process.env.RAKSHAKAI_DATA_FILE = databaseFile;
process.env.JWT_SECRET = "copilot-api-test-secret-at-least-32-chars";
// Keep this defined-but-empty so backend/.env cannot switch this isolated test to PostgreSQL.
process.env.DATABASE_URL = "";

const { app } = require("../server");
let server, baseUrl;

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true });
});

async function login(email) {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify({ email, password }) });
  if (response.status !== 200) assert.fail(`login failed (${response.status}): ${await response.text()}`);
  return response.headers.get("set-cookie").split(";")[0];
}
async function query(cookie, body) {
  return fetch(`${baseUrl}/api/copilot/query`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
}

test("Admin and Police Officer can query while Citizen and unauthenticated clients cannot", async () => {
  for (const email of ["admin@copilot.test", "police@copilot.test"]) {
    const response = await query(await login(email), { message: "Show INC-API-1", pageContext: { page: "incident-command" } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.readOnly, true);
    assert.match(body.answer, /INC-API-1/);
  }
  assert.equal((await query(await login("citizen@copilot.test"), { message: "Show INC-API-1" })).status, 403);
  assert.equal((await query(null, { message: "Show INC-API-1" })).status, 401);
});

test("fake frontend role is ignored and write prompts do not mutate operational data", async () => {
  const cookie = await login("police@copilot.test");
  const before = JSON.parse(fs.readFileSync(databaseFile, "utf8")).incidents;
  const response = await query(cookie, { message: "Close INC-API-1", role: "Admin", pageContext: { page: "incident-command", role: "Admin", entityId: "INC-API-1" } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.blockedWriteRequest, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(databaseFile, "utf8")).incidents, before);
  const persisted = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
  const audit = persisted.auditLogs.find((entry) => entry.action === "copilot_query");
  assert.ok(audit);
  assert.doesNotMatch(audit.details, /Close INC-API-1/);
});

test("API localizes output, preserves Auto conversation language, and audits language metadata without prompts", async () => {
  const cookie = await login("admin@copilot.test");
  const firstResponse = await query(cookie, { message: "INC-API-1 స్థితి చెప్పు", selectedLanguage: "auto", pageContext: { page: "incident-command" } });
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.detectedLanguage, "te");
  assert.equal(first.responseLanguage, "te");
  assert.match(first.answer, /స్థితి/);
  const followResponse = await query(cookie, { message: "INC-API-1", selectedLanguage: "auto", conversationId: first.conversationId, pageContext: { page: "incident-command" } });
  const follow = await followResponse.json();
  assert.equal(follow.responseLanguage, "te");
  const hindiResponse = await query(cookie, { message: "Show INC-API-1", selectedLanguage: "hi", pageContext: { page: "incident-command" } });
  const hindi = await hindiResponse.json();
  assert.equal(hindi.responseLanguage, "hi");
  assert.match(hindi.answer, /स्थिति/);
  const persisted = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
  const audit = [...persisted.auditLogs].reverse().find((entry) => entry.action === "copilot_query" && /"responseLanguage":"hi"/.test(entry.details));
  assert.ok(audit);
  assert.match(audit.details, /"detectedLanguage":"en"/);
  assert.doesNotMatch(audit.details, /Show INC-API-1/);
});
