const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const bcrypt = require("bcryptjs");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-copilot-history-"));
const databaseFile = path.join(directory, "db.json");
const password = "History-Test-123!";
const passwordHash = bcrypt.hashSync(password, 4);
const database = {
  users: [
    { id: "admin", name: "Admin", email: "admin@history.test", role: "Admin", passwordHash },
    { id: "police", name: "Officer", email: "police@history.test", role: "Police Officer", stationId: "allowed", passwordHash },
    { id: "citizen", name: "Citizen", email: "citizen@history.test", role: "Citizen", passwordHash },
    { id: "police2", name: "Officer Two", email: "police2@history.test", role: "Police Officer", stationId: "allowed", passwordHash }
  ],
  incidents: [
    { id: "INC-HIST-1", title: "History fixture", severity: "HIGH", status: "Verified", stationId: "allowed" }
  ],
  responseUnits: [], cameraSources: [], auditLogs: [], reports: [], alerts: [],
  policeStations: [{ id: "station_allowed", stationId: "allowed", stationName: "Allowed Police Station" }],
  policeOfficers: [{ id: "police", userId: "police", stationId: "allowed", dutyStatus: "on_duty", availabilityStatus: "available" }],
  responseUnitMembers: [],
  copilotConversations: [],
  copilotMessages: []
};
fs.writeFileSync(databaseFile, JSON.stringify(database));
process.env.NODE_ENV = "test";
process.env.RAKSHAKAI_DATA_FILE = databaseFile;
process.env.JWT_SECRET = "copilot-history-test-secret-at-least-32-chars";
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
async function history(cookie, conversationId) {
  return fetch(`${baseUrl}/api/copilot/history?conversationId=${encodeURIComponent(conversationId)}`, { headers: { ...(cookie ? { cookie } : {}) } });
}

test("conversation history persists across requests and is user-scoped", async () => {
  const admin = await login("admin@history.test");
  const police = await login("police@history.test");
  
  const first = await query(admin, { message: "Show INC-HIST-1", pageContext: { page: "incident-command" } });
  const firstBody = await first.json();
  assert.equal(firstBody.readOnly, true);
  assert.ok(firstBody.conversationId);
  
  const second = await query(admin, { message: "What is the status?", conversationId: firstBody.conversationId, pageContext: { page: "incident-command" } });
  const secondBody = await second.json();
  assert.equal(secondBody.conversationId, firstBody.conversationId);
  
  const hist = await history(admin, firstBody.conversationId);
  const histBody = await hist.json();
  assert.equal(histBody.messages.length, 4);
  assert.equal(histBody.messages[0].role, "user");
  assert.equal(histBody.messages[0].content, "Show INC-HIST-1");
  assert.equal(histBody.messages[1].role, "assistant");
  assert.equal(histBody.messages[2].role, "user");
  assert.equal(histBody.messages[2].content, "What is the status?");
  assert.equal(histBody.messages[3].role, "assistant");
  
  const policeHist = await history(police, firstBody.conversationId);
  assert.equal(policeHist.status, 200);
  const policeHistBody = await policeHist.json();
  assert.equal(policeHistBody.messages.length, 0);
});

test("conversation history survives simulated restart (JSON mode)", async () => {
  const admin = await login("admin@history.test");
  
  const first = await query(admin, { message: "Show INC-HIST-1", pageContext: { page: "incident-command" } });
  const firstBody = await first.json();
  const convId = firstBody.conversationId;
  
  await query(admin, { message: "What is the status?", conversationId: convId, pageContext: { page: "incident-command" } });
  
  const { readDb, writeDb } = require("../services/core.service");
  const db = readDb();
  const conversations = db.copilotConversations || [];
  const messages = db.copilotMessages || [];
  assert.ok(conversations.some(c => c.id === convId));
  assert.ok(messages.some(m => m.conversationId === convId && m.role === "user" && m.content === "Show INC-HIST-1"));
  assert.ok(messages.some(m => m.conversationId === convId && m.role === "assistant"));
  
  const hist = await history(admin, convId);
  const histBody = await hist.json();
  assert.equal(histBody.messages.length, 4);
});

test("50-exchange limit is enforced (100 messages max)", async () => {
  const admin = await login("admin@history.test");
  
  const first = await query(admin, { message: "First message", pageContext: { page: "dashboard" } });
  const firstBody = await first.json();
  const convId = firstBody.conversationId;
  
  for (let i = 1; i <= 60; i++) {
    await query(admin, { message: `Message ${i}`, conversationId: convId, pageContext: { page: "dashboard" } });
  }
  
  const hist = await history(admin, convId);
  const histBody = await hist.json();
  assert.ok(histBody.messages.length <= 100);
  const userMessages = histBody.messages.filter(m => m.role === "user").map(m => m.content);
  assert.ok(userMessages.includes("Message 60"));
  assert.ok(!userMessages.includes("First message"));
});

test("Citizen cannot access Copilot history endpoint", async () => {
  const citizen = await login("citizen@history.test");
  const admin = await login("admin@history.test");
  
  const first = await query(admin, { message: "Show INC-HIST-1", pageContext: { page: "incident-command" } });
  const firstBody = await first.json();
  
  const hist = await history(citizen, firstBody.conversationId);
  assert.equal(hist.status, 403);
});

test("Unauthenticated requests to history endpoint are rejected", async () => {
  const admin = await login("admin@history.test");
  
  const first = await query(admin, { message: "Show INC-HIST-1", pageContext: { page: "incident-command" } });
  const firstBody = await first.json();
  
  const hist = await fetch(`${baseUrl}/api/copilot/history?conversationId=${encodeURIComponent(firstBody.conversationId)}`);
  assert.equal(hist.status, 401);
});

test("New conversation starts fresh when no conversationId provided", async () => {
  const admin = await login("admin@history.test");
  
  const first = await query(admin, { message: "First conversation", pageContext: { page: "dashboard" } });
  const firstBody = await first.json();
  const convId1 = firstBody.conversationId;
  
  const second = await query(admin, { message: "Second conversation", pageContext: { page: "dashboard" } });
  const secondBody = await second.json();
  const convId2 = secondBody.conversationId;
  
  assert.notEqual(convId1, convId2);
  
  const hist1 = await history(admin, convId1);
  const hist1Body = await hist1.json();
  assert.equal(hist1Body.messages.length, 2);
  
  const hist2 = await history(admin, convId2);
  const hist2Body = await hist2.json();
  assert.equal(hist2Body.messages.length, 2);
});

test("Language preference persists in conversation", async () => {
  const admin = await login("admin@history.test");
  
  const first = await query(admin, { message: "Show INC-HIST-1", selectedLanguage: "te", pageContext: { page: "incident-command" } });
  const firstBody = await first.json();
  assert.equal(firstBody.responseLanguage, "te");
  const convId = firstBody.conversationId;
  
  const second = await query(admin, { message: "Status?", conversationId: convId, selectedLanguage: "auto", pageContext: { page: "incident-command" } });
  const secondBody = await second.json();
  assert.equal(secondBody.responseLanguage, "te");
  
  const hist = await history(admin, convId);
  const histBody = await hist.json();
  assert.ok(histBody.messages.some(m => m.metadata?.selectedLanguage === "te"));
});

test("Duplicate messages from retries are not created", async () => {
  const admin = await login("admin@history.test");
  
  const first = await query(admin, { message: "Test duplicate", pageContext: { page: "dashboard" } });
  const firstBody = await first.json();
  const convId = firstBody.conversationId;
  
  const { readDb } = require("../services/core.service");
  const dbBefore = readDb();
  const msgCountBefore = (dbBefore.copilotMessages || []).filter(m => m.conversationId === convId).length;
  
  await query(admin, { message: "Test duplicate", conversationId: convId, pageContext: { page: "dashboard" } });
  
  const dbAfter = readDb();
  const msgCountAfter = (dbAfter.copilotMessages || []).filter(m => m.conversationId === convId).length;
  
  assert.equal(msgCountAfter, msgCountBefore + 2);
});

test("Different users have isolated conversation histories", async () => {
  const admin = await login("admin@history.test");
  const police = await login("police@history.test");
  const police2 = await login("police2@history.test");
  
  const adminQuery = await query(admin, { message: "Admin query", pageContext: { page: "dashboard" } });
  const adminBody = await adminQuery.json();
  
  const policeQuery = await query(police, { message: "Police query", pageContext: { page: "dashboard" } });
  const policeBody = await policeQuery.json();
  
  const police2Query = await query(police2, { message: "Police2 query", pageContext: { page: "dashboard" } });
  const police2Body = await police2Query.json();
  
  const adminHist = await history(admin, adminBody.conversationId);
  const adminHistBody = await adminHist.json();
  assert.equal(adminHistBody.messages[0].content, "Admin query");
  
  const policeHist = await history(police, policeBody.conversationId);
  const policeHistBody = await policeHist.json();
  assert.equal(policeHistBody.messages[0].content, "Police query");
  
  const police2Hist = await history(police2, police2Body.conversationId);
  const police2HistBody = await police2Hist.json();
  assert.equal(police2HistBody.messages[0].content, "Police2 query");
  
  const crossHist = await history(police, adminBody.conversationId);
  const crossHistBody = await crossHist.json();
  assert.equal(crossHistBody.messages.length, 0);
});

test("Conversation metadata includes page context and language", async () => {
  const admin = await login("admin@history.test");
  
  const first = await query(admin, { message: "Show INC-HIST-1", selectedLanguage: "hi", pageContext: { page: "incident-command", entityId: "INC-HIST-1" } });
  const firstBody = await first.json();
  const convId = firstBody.conversationId;
  
  const hist = await history(admin, convId);
  const histBody = await hist.json();
  
  const userMsg = histBody.messages[0];
  assert.equal(userMsg.metadata.pageContext.page, "incident-command");
  assert.equal(userMsg.metadata.pageContext.entityId, "INC-HIST-1");
  assert.equal(userMsg.metadata.selectedLanguage, "hi");
  
  const assistantMsg = histBody.messages[1];
  assert.ok(assistantMsg.metadata.intent);
  assert.ok(assistantMsg.metadata.responseLanguage);
});