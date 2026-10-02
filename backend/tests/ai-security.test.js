const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-ai-security-"));
const testDatabase = path.join(testDirectory, "db.json");
const sourceDatabase = path.join(__dirname, "fixtures", "db.fixture.json");
const TEST_PASSWORD = "RakshakAI-Test-123!";
const TEST_API_KEY = "rakshakai-test-ai-key-1234567890";
const VALID_FRAME = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString("base64")}`;

const database = JSON.parse(fs.readFileSync(sourceDatabase, "utf8"));
database.users.forEach((user) => {
  user.passwordHash = bcrypt.hashSync(TEST_PASSWORD, 4);
  delete user.password;
});
fs.writeFileSync(testDatabase, JSON.stringify(database, null, 2));

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.RAKSHAKAI_DATA_FILE = testDatabase;
process.env.EVIDENCE_STORAGE_DRIVER = "filesystem";
process.env.EVIDENCE_STORAGE_DIR = path.join(testDirectory, "evidence-storage");
process.env.JWT_SECRET = "rakshakai-test-secret-that-is-longer-than-32-characters";
process.env.AI_SERVICE_URL = "";
process.env.AI_SERVICE_API_KEY = TEST_API_KEY;
process.env.AI_SERVICE_TIMEOUT_MS = "500";
process.env.OSRM_BASE_URL = "http://127.0.0.1:1";
process.env.API_RATE_LIMIT = "10000";
process.env.AI_FRAME_RATE_LIMIT = "300";
process.env.FRONTEND_ORIGINS = "https://ops.rakshak.example.com";

const { start, validateAiServiceConfig } = require("../server");
const aiService = require("../services/ai.service");
const { readDatabase } = require("../services/core.service");

let server;
let aiMockServer;
let aiMockRequests = [];
let baseUrl;
let users;

function tokenFor(role) {
  const user = users.find((item) => item.role === role);
  assert.ok(user, `${role} test user must exist`);
  return jwt.sign(
    { role: user.role, email: user.email, name: user.name, sessionVersion: user.sessionVersion || null },
    process.env.JWT_SECRET,
    { subject: user.id, expiresIn: "5m" }
  );
}

function authHeaders(role) {
  return { Authorization: `Bearer ${tokenFor(role)}` };
}

function framePayload(overrides = {}) {
  return {
    sourceType: "phone_camera",
    sourceId: "phone_001",
    sourceName: "Regression Live Vision",
    zone: "Mobile Source",
    timestamp: new Date().toISOString(),
    imageBase64: VALID_FRAME,
    ...overrides
  };
}

function safeAiResponse() {
  return {
    configured: true,
    threatDetected: false,
    threatType: "person_detected",
    confidence: 0.92,
    severity: "low",
    alertClassification: "observation",
    detections: [
      { label: "person", confidence: 0.92, box: [10, 10, 100, 200], dominantColor: "blue" },
      { label: "backpack", confidence: 0.74, box: [30, 40, 60, 90], dominantColor: "black" }
    ],
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
  };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

test.before(async () => {
  users = JSON.parse(fs.readFileSync(testDatabase, "utf8")).users;
  server = await start(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  if (aiMockServer) {
    await new Promise((resolve) => aiMockServer.close(resolve));
  }
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

test("backend sends AI_SERVICE_API_KEY to the AI service", async () => {
  let receivedHeaders = {};
  aiMockRequests = [];
  if (aiMockServer) {
    await new Promise((resolve) => aiMockServer.close(resolve));
  }
  aiMockServer = http.createServer((req, res) => {
    receivedHeaders = req.headers;
    aiMockRequests.push({ method: req.method, url: req.url });
    readRequestBody(req).then(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(safeAiResponse()));
    });
  });
  await new Promise((resolve) => aiMockServer.listen(0, "127.0.0.1", resolve));
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${aiMockServer.address().port}`;
  const result = await aiService.analyzeFrame(framePayload());
  assert.equal(result.configured, true);
  assert.equal(receivedHeaders["x-api-key"], TEST_API_KEY);
  assert.equal(aiMockRequests[0].url, "/analyze-frame");
});

test("missing required AI key configuration is detected at startup", () => {
  const previousUrl = process.env.AI_SERVICE_URL;
  const previousKey = process.env.AI_SERVICE_API_KEY;
  const previousInsecure = process.env.AI_SERVICE_ALLOW_INSECURE;
  try {
    process.env.AI_SERVICE_URL = "http://127.0.0.1:8000";
    process.env.AI_SERVICE_API_KEY = "";
    delete process.env.AI_SERVICE_ALLOW_INSECURE;
    assert.throws(() => validateAiServiceConfig(), /AI_SERVICE_API_KEY is required/);

    process.env.AI_SERVICE_API_KEY = TEST_API_KEY;
    const secure = validateAiServiceConfig();
    assert.equal(secure.authenticated, true);

    process.env.AI_SERVICE_API_KEY = "";
    process.env.AI_SERVICE_ALLOW_INSECURE = "true";
    const insecure = validateAiServiceConfig();
    assert.equal(insecure.authenticated, false);
    assert.equal(insecure.insecureDevelopment, true);

    process.env.AI_SERVICE_URL = "";
    assert.equal(validateAiServiceConfig(), null);
  } finally {
    process.env.AI_SERVICE_URL = previousUrl;
    process.env.AI_SERVICE_API_KEY = previousKey;
    if (previousInsecure === undefined) delete process.env.AI_SERVICE_ALLOW_INSECURE;
    else process.env.AI_SERVICE_ALLOW_INSECURE = previousInsecure;
  }
});

test("AI-service timeout is handled safely", async () => {
  if (aiMockServer) {
    await new Promise((resolve) => aiMockServer.close(resolve));
  }
  aiMockServer = http.createServer(() => {});
  await new Promise((resolve) => aiMockServer.listen(0, "127.0.0.1", resolve));
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${aiMockServer.address().port}`;
  const result = await aiService.analyzeFrame(framePayload());
  assert.equal(result.configured, true);
  assert.equal(result.threatDetected, false);
  assert.equal(result.threatType, "no_threat");
  assert.equal(result.detections.length, 0);
  assert.match(result.serviceError, /timed out/);
});

test("multiple detections preserve labels, confidence, and boxes", () => {
  const normalized = aiService.normalizeResponse(safeAiResponse());
  assert.equal(normalized.detections.length, 2);
  assert.equal(normalized.detections[0].label, "person");
  assert.equal(normalized.detections[0].confidence, 0.92);
  assert.deepEqual(normalized.detections[0].box, [10, 10, 100, 200]);
  assert.equal(normalized.detections[1].label, "backpack");
  assert.equal(normalized.detections[1].confidence, 0.74);
  assert.deepEqual(normalized.detections[1].box, [30, 40, 60, 90]);
  assert.equal(normalized.threatType, "person_detected");
});

test("citizen cannot use AI inference", async () => {
  const previousUrl = process.env.AI_SERVICE_URL;
  process.env.AI_SERVICE_URL = "";
  try {
    const response = await fetch(`${baseUrl}/api/ai/analyze-frame`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders("Citizen"), Origin: "https://ops.rakshak.example.com" },
      body: JSON.stringify(framePayload())
    });
    assert.equal(response.status, 403);
  } finally {
    process.env.AI_SERVICE_URL = previousUrl;
  }
});

test("police and admin are permitted to use AI inference", async () => {
  if (aiMockServer) {
    await new Promise((resolve) => aiMockServer.close(resolve));
  }
  aiMockRequests = [];
  aiMockServer = http.createServer((req, res) => {
    aiMockRequests.push({ method: req.method, url: req.url, apiKey: req.headers["x-api-key"] });
    readRequestBody(req).then(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(safeAiResponse()));
    });
  });
  await new Promise((resolve) => aiMockServer.listen(0, "127.0.0.1", resolve));
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${aiMockServer.address().port}`;
  try {
    for (const role of ["Police Officer", "Admin"]) {
      const response = await fetch(`${baseUrl}/api/ai/analyze-frame`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(role), Origin: "https://ops.rakshak.example.com" },
        body: JSON.stringify(framePayload())
      });
      assert.equal(response.status, 200, role);
      const result = await response.json();
      assert.equal(result.configured, true);
      assert.equal(result.detection.detections.length, 2);
      assert.equal(aiMockRequests.at(-1).apiKey, TEST_API_KEY);
      assert.equal(aiMockRequests.at(-1).url, "/analyze-frame");
    }
  } finally {
    process.env.AI_SERVICE_URL = "";
  }
});

test("dedicated AI-frame limiter allows the intended Live Vision sampling rate", async () => {
  const express = require("express");
  const { aiFrameLimiter } = require("../middleware/aiFrameLimiter.middleware");
  const limiterApp = express();
  limiterApp.post("/frame", aiFrameLimiter, (req, res) => res.json({ ok: true }));
  const limiterServer = limiterApp.listen(0, "127.0.0.1");
  await new Promise((resolve) => limiterServer.once("listening", resolve));
  const limiterUrl = `http://127.0.0.1:${limiterServer.address().port}`;
  try {
    const statuses = await Promise.all(
      Array.from({ length: 80 }, () =>
        fetch(`${limiterUrl}/frame`, { method: "POST" }).then((response) => response.status)
      )
    );
    assert.equal(statuses.filter((status) => status === 429).length, 0,
      "a burst at the intended Live Vision sampling rate must not be rate limited");
  } finally {
    limiterServer.closeAllConnections();
    await new Promise((resolve) => limiterServer.close(resolve));
  }
});

test("dedicated AI-frame limiter still limits abusive request rates", async () => {
  const express = require("express");
  const { aiFrameLimiter } = require("../middleware/aiFrameLimiter.middleware");
  const limiterApp = express();
  limiterApp.post("/frame", aiFrameLimiter, (req, res) => res.json({ ok: true }));
  const limiterServer = limiterApp.listen(0, "127.0.0.1");
  await new Promise((resolve) => limiterServer.once("listening", resolve));
  const limiterUrl = `http://127.0.0.1:${limiterServer.address().port}`;
  try {
    const statuses = [];
    for (let batch = 0; batch < 11 && !statuses.includes(429); batch += 1) {
      const batchStatuses = await Promise.all(
        Array.from({ length: 40 }, () =>
          fetch(`${limiterUrl}/frame`, { method: "POST" }).then((response) => response.status)
        )
      );
      statuses.push(...batchStatuses);
    }
    assert.equal(statuses.filter((status) => status === 429).length > 0, true,
      "abusive request rates must eventually receive 429");
  } finally {
    limiterServer.closeAllConnections();
    await new Promise((resolve) => limiterServer.close(resolve));
  }
});
