const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const jwt = require("jsonwebtoken");

// Test-only 32-byte key (64 hex chars). Never used outside this test process.
const TEST_CAMERA_KEY = "61".repeat(32);
const OTHER_CAMERA_KEY = "62".repeat(32);

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-camera-secrets-"));
const testDatabase = path.join(testDirectory, "db.json");
const sourceDatabase = path.join(__dirname, "fixtures", "db.fixture.json");

const LEGACY_STREAM_URL = "rtsp://legacy-user:legacy-pass@legacy-cam.local/stream1";
const LEGACY_USERNAME = "legacy-user";
const LEGACY_PASSWORD = "legacy-pass";
const ROTATED_PASSWORD = "rotated-pass-9";
const CREATED_STREAM_URL = "rtsp://secure-user:secure-pass@10.0.0.5/main";
const CREATED_USERNAME = "secure-user";
const CREATED_PASSWORD = "secure-pass";

const database = JSON.parse(fs.readFileSync(sourceDatabase, "utf8"));
// Legacy record: simulates a pre-Phase-2A row with plaintext credentials at rest.
database.cameraSources.push({
  id: "cam_legacy_plain",
  cameraId: "LEGACY-01",
  type: "rtsp",
  sourceType: "rtsp",
  name: "Legacy Plaintext Camera",
  location: "Legacy Zone",
  zone: "Legacy Zone",
  status: "online",
  streamUrl: LEGACY_STREAM_URL,
  username: LEGACY_USERNAME,
  password: LEGACY_PASSWORD,
  aiEnabled: true,
  enabled: true,
  isDemo: false
});
fs.writeFileSync(testDatabase, JSON.stringify(database, null, 2));

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.RAKSHAKAI_DATA_FILE = testDatabase;
process.env.EVIDENCE_STORAGE_DRIVER = "filesystem";
process.env.EVIDENCE_STORAGE_DIR = path.join(testDirectory, "evidence-storage");
process.env.JWT_SECRET = "rakshakai-test-secret-that-is-longer-than-32-characters";
process.env.CAMERA_CREDENTIAL_ENCRYPTION_KEY = TEST_CAMERA_KEY;
process.env.AI_SERVICE_URL = "";
process.env.OSRM_BASE_URL = "http://127.0.0.1:1";
process.env.API_RATE_LIMIT = "10000";
process.env.FRONTEND_ORIGINS = "https://ops.rakshak.example.com";

const { start } = require("../server");
const { readDatabase } = require("../services/core.service");
const cameraSecrets = require("../services/cameraSecrets.service");
const cameraSourcesRepository = require("../repositories/cameraSources.repository");

const {
  CAMERA_SECRET_FIELDS,
  encryptSecret,
  decryptSecret,
  encryptCameraSecrets,
  isEncryptedSecret,
  hasLegacyPlaintextSecrets,
  validateCameraCredentialConfig
} = cameraSecrets;

let server;
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

function request(route, options = {}) {
  return fetch(`${baseUrl}${route}`, options);
}

function storedSource(id) {
  return readDatabase().then((db) => db.cameraSources.find((source) => source.id === id));
}

function assertNoCameraSecrets(payload, extra = []) {
  const serialized = JSON.stringify(payload);
  const forbidden = [
    "streamUrl", "rtspUrl", "username", "password", "token", "enc:v1",
    "legacy-user", "legacy-pass", "legacy-cam.local",
    "secure-user", "secure-pass", ROTATED_PASSWORD,
    ...extra
  ];
  for (const needle of forbidden) {
    assert.equal(serialized.includes(needle), false, `camera response leaked ${needle}`);
  }
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
});

// ---------------------------------------------------------------------------
// Unit: AES-256-GCM credential encryption
// ---------------------------------------------------------------------------

test("encryptSecret stores versioned AES-256-GCM envelope, not plaintext", () => {
  const encrypted = encryptSecret("s3cret-camera-password");
  assert.match(encrypted, /^enc:v1:/);
  assert.equal(encrypted.includes("s3cret"), false);
  const parts = encrypted.split(":");
  assert.equal(parts.length, 5, "envelope must be enc:v1:<iv>:<ciphertext>:<authTag>");
  assert.equal(Buffer.from(parts[2], "base64url").length, 12, "96-bit IV/nonce");
  assert.ok(parts[3].length > 0, "ciphertext present");
  assert.equal(Buffer.from(parts[4], "base64url").length, 16, "128-bit GCM auth tag stored");
});

test("decryptSecret round-trips with the correct key", () => {
  const value = "rtsp://user:pass@cam.internal/feed";
  const encrypted = encryptSecret(value);
  assert.equal(decryptSecret(encrypted), value);
});

test("decryptSecret fails safely with a wrong key", () => {
  const encrypted = encryptSecret("s3cret-camera-password");
  process.env.CAMERA_CREDENTIAL_ENCRYPTION_KEY = OTHER_CAMERA_KEY;
  try {
    assert.throws(() => decryptSecret(encrypted), /decryption failed/i);
  } finally {
    process.env.CAMERA_CREDENTIAL_ENCRYPTION_KEY = TEST_CAMERA_KEY;
  }
});

test("decryptSecret fails safely on tampered ciphertext", () => {
  const encrypted = encryptSecret("s3cret-camera-password");
  const parts = encrypted.split(":");
  const tamperedChar = parts[3][0] === "A" ? "B" : "A";
  parts[3] = tamperedChar + parts[3].slice(1);
  assert.throws(() => decryptSecret(parts.join(":")), /decryption failed|Malformed/i);
});

test("two encryptions of the same password produce different ciphertext (random IV)", () => {
  const first = encryptSecret("same-password");
  const second = encryptSecret("same-password");
  assert.notEqual(first, second);
  assert.equal(decryptSecret(first), "same-password");
  assert.equal(decryptSecret(second), "same-password");
});

test("encryptCameraSecrets is idempotent and never double-encrypts", () => {
  const source = { username: "operator", password: "s3cret", streamUrl: "rtsp://operator:s3cret@cam/1" };
  const firstCount = encryptCameraSecrets(source);
  assert.equal(firstCount, 3);
  const snapshot = { ...source };
  const secondCount = encryptCameraSecrets(source);
  assert.equal(secondCount, 0, "second pass must not re-encrypt");
  assert.deepEqual(source, snapshot);
  assert.ok(isEncryptedSecret(source.password));
  assert.equal(hasLegacyPlaintextSecrets(source), false);
});

test("encryptCameraSecrets rejects unknown enc: envelope versions safely", () => {
  const source = { password: "enc:v0:legacy-envelope" };
  assert.throws(() => encryptCameraSecrets(source), /Unsupported camera credential encryption version/);
});

test("camera secret field list covers URLs and credential fields", () => {
  for (const field of ["streamUrl", "rtspUrl", "hlsUrl", "onvifUrl", "username", "password", "token", "apiKey", "secret"]) {
    assert.ok(CAMERA_SECRET_FIELDS.includes(field), `${field} must be encrypted at rest`);
  }
});

// ---------------------------------------------------------------------------
// Unit: key configuration validation
// ---------------------------------------------------------------------------

test("production startup without CAMERA_CREDENTIAL_ENCRYPTION_KEY fails fast", () => {
  assert.throws(
    () => validateCameraCredentialConfig({ production: true, env: { NODE_ENV: "production" } }),
    /CAMERA_CREDENTIAL_ENCRYPTION_KEY is required in production/
  );
});

test("malformed CAMERA_CREDENTIAL_ENCRYPTION_KEY is rejected in every environment", () => {
  for (const production of [true, false]) {
    assert.throws(
      () => validateCameraCredentialConfig({ production, env: { CAMERA_CREDENTIAL_ENCRYPTION_KEY: "too-short" } }),
      /must be 32 bytes/
    );
  }
});

test("hex and base64 32-byte keys are accepted", () => {
  const hex = validateCameraCredentialConfig({ production: true, env: { CAMERA_CREDENTIAL_ENCRYPTION_KEY: TEST_CAMERA_KEY } });
  assert.deepEqual(hex, { configured: true, developmentFallback: false });
  const base64Key = Buffer.alloc(32, 7).toString("base64");
  const b64 = validateCameraCredentialConfig({ production: true, env: { CAMERA_CREDENTIAL_ENCRYPTION_KEY: base64Key } });
  assert.deepEqual(b64, { configured: true, developmentFallback: false });
  const roundtrip = encryptSecret("base64-key-check", { CAMERA_CREDENTIAL_ENCRYPTION_KEY: base64Key });
  assert.equal(decryptSecret(roundtrip, { CAMERA_CREDENTIAL_ENCRYPTION_KEY: base64Key }), "base64-key-check");
});

test("development without a key permits demo config but refuses credential storage", () => {
  const result = validateCameraCredentialConfig({ production: false, env: {} });
  assert.deepEqual(result, { configured: false, developmentFallback: false });
  assert.throws(() => encryptSecret("dev-mode-secret", { NODE_ENV: "development" }), /CAMERA_CREDENTIAL_ENCRYPTION_KEY is required/);
  assert.equal(encryptCameraSecrets({ id: "demo", type: "demo" }, { NODE_ENV: "development" }), 0);
});

// ---------------------------------------------------------------------------
// Unit: PostgreSQL repository persistence receives encrypted payloads
// ---------------------------------------------------------------------------

test("cameraSources repository upsert serializes only encrypted credentials", async () => {
  const record = {
    id: "cam_pg_unit",
    type: "rtsp",
    status: "unknown",
    streamUrl: CREATED_STREAM_URL,
    username: CREATED_USERNAME,
    password: CREATED_PASSWORD
  };
  const calls = [];
  const fakeClient = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; } };
  await cameraSourcesRepository.upsert(record, fakeClient);
  assert.equal(calls.length, 1);
  const dataParam = JSON.parse(calls[0].params.at(-1));
  const serialized = JSON.stringify(dataParam);
  assert.match(dataParam.streamUrl, /^enc:v1:/);
  assert.match(dataParam.username, /^enc:v1:/);
  assert.match(dataParam.password, /^enc:v1:/);
  for (const plaintext of [CREATED_STREAM_URL, CREATED_USERNAME, CREATED_PASSWORD]) {
    assert.equal(serialized.includes(plaintext), false, `PostgreSQL payload must not contain ${plaintext}`);
  }
  assert.equal(record.password, CREATED_PASSWORD, "repository must not mutate its input");
});

test("PostgreSQL repository refuses plaintext credentials without a key", async () => {
  const previous = process.env.CAMERA_CREDENTIAL_ENCRYPTION_KEY;
  delete process.env.CAMERA_CREDENTIAL_ENCRYPTION_KEY;
  let queries = 0;
  try {
    await assert.rejects(
      cameraSourcesRepository.upsert({ id: "cam_no_key", password: "private" }, { query: async () => { queries += 1; } }),
      /CAMERA_CREDENTIAL_ENCRYPTION_KEY is required/
    );
    assert.equal(queries, 0);
  } finally {
    process.env.CAMERA_CREDENTIAL_ENCRYPTION_KEY = previous;
  }
});

// ---------------------------------------------------------------------------
// API: legacy plaintext migration on read (JSON mode)
// ---------------------------------------------------------------------------

test("legacy plaintext camera credentials are migrated to encrypted storage", async () => {
  const stored = await storedSource("cam_legacy_plain");
  assert.ok(stored, "legacy camera must exist");
  assert.match(stored.streamUrl, /^enc:v1:/);
  assert.match(stored.username, /^enc:v1:/);
  assert.match(stored.password, /^enc:v1:/);
  const onDisk = fs.readFileSync(testDatabase, "utf8");
  assert.equal(onDisk.includes(LEGACY_USERNAME), false, "JSON store must not retain plaintext username");
  assert.equal(onDisk.includes(LEGACY_PASSWORD), false, "JSON store must not retain plaintext password");
  assert.equal(onDisk.includes("legacy-cam.local"), false, "JSON store must not retain the embedded-credential URL");
  assert.equal(decryptSecret(stored.streamUrl), LEGACY_STREAM_URL);
  assert.equal(decryptSecret(stored.username), LEGACY_USERNAME);
  assert.equal(decryptSecret(stored.password), LEGACY_PASSWORD);
});

test("legacy migration is idempotent across repeated reads", async () => {
  const first = await storedSource("cam_legacy_plain");
  const second = await storedSource("cam_legacy_plain");
  assert.equal(second.password, first.password, "ciphertext must be stable across reads");
  assert.equal(second.streamUrl, first.streamUrl);
});

test("GET camera sources never exposes plaintext or encrypted credential material", async () => {
  const response = await request("/api/camera-sources", { headers: authHeaders("Admin") });
  assert.equal(response.status, 200);
  const body = await response.json();
  assertNoCameraSecrets(body);
  const legacy = body.sources.find((source) => source.id === "cam_legacy_plain");
  assert.ok(legacy);
  assert.equal(legacy.hasStreamConfig, true);
  assert.equal(legacy.hasCredentials, true);
  assert.equal("streamUrl" in legacy, false);
  assert.equal("username" in legacy, false);
  assert.equal("password" in legacy, false);
});

test("Police Officer camera listing receives safe metadata only", async () => {
  const response = await request("/api/camera-sources", { headers: authHeaders("Police Officer") });
  assert.equal(response.status, 200);
  assertNoCameraSecrets(await response.json());
  const feeds = await request("/api/camera-feeds", { headers: authHeaders("Police Officer") });
  assert.equal(feeds.status, 200);
  assertNoCameraSecrets(await feeds.json());
});

// ---------------------------------------------------------------------------
// API: create / update semantics
// ---------------------------------------------------------------------------

test("Admin create stores encrypted credentials and returns safe metadata", async () => {
  const create = await request("/api/camera-sources", {
    method: "POST",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({
      name: "Night Gate Camera",
      location: "Night Gate",
      sourceType: "rtsp",
      streamUrl: CREATED_STREAM_URL,
      username: CREATED_USERNAME,
      password: CREATED_PASSWORD,
      aiEnabled: true
    })
  });
  assert.equal(create.status, 201);
  const body = await create.json();
  assertNoCameraSecrets(body);
  assert.equal(body.source.hasStreamConfig, true);
  assert.equal(body.source.hasCredentials, true);
  const stored = await storedSource(body.source.id);
  assert.match(stored.password, /^enc:v1:/);
  assert.equal(decryptSecret(stored.password), CREATED_PASSWORD);
  assert.equal(decryptSecret(stored.streamUrl), CREATED_STREAM_URL);
});

test("PATCH without password preserves the stored secret; PATCH with a new password replaces it securely", async () => {
  const target = "cam_legacy_plain";
  const before = await storedSource(target);

  const keep = await request(`/api/camera-sources/${target}/config`, {
    method: "PATCH",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ name: "Legacy Plaintext Camera Renamed" })
  });
  assert.equal(keep.status, 200);
  assertNoCameraSecrets(await keep.json());
  const afterKeep = await storedSource(target);
  assert.equal(afterKeep.password, before.password, "PATCH without password must preserve ciphertext");
  assert.equal(afterKeep.streamUrl, before.streamUrl);

  // Blank password must never erase the stored secret.
  const blank = await request(`/api/camera-sources/${target}/config`, {
    method: "PATCH",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ password: "" })
  });
  assert.equal(blank.status, 200);
  const afterBlank = await storedSource(target);
  assert.equal(afterBlank.password, before.password, "blank password must preserve the stored secret");

  // Supplying a new password replaces the secret with freshly encrypted material.
  const rotate = await request(`/api/camera-sources/${target}/config`, {
    method: "PATCH",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ password: ROTATED_PASSWORD })
  });
  assert.equal(rotate.status, 200);
  assertNoCameraSecrets(await rotate.json());
  const afterRotate = await storedSource(target);
  assert.notEqual(afterRotate.password, before.password, "new password must produce new ciphertext");
  assert.match(afterRotate.password, /^enc:v1:/);
  assert.equal(afterRotate.password.includes(ROTATED_PASSWORD), false);
  assert.equal(decryptSecret(afterRotate.password), ROTATED_PASSWORD);
  assert.equal(afterRotate.streamUrl, before.streamUrl, "untouched secret fields stay intact");
});

test("Explicit clearCredentials removes stored credentials only when requested", async () => {
  const target = "cam_legacy_plain";
  const before = await storedSource(target);
  assert.ok(before.password, "precondition: password stored from previous test");
  const response = await request(`/api/camera-sources/${target}/config`, {
    method: "PATCH",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ clearCredentials: true })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assertNoCameraSecrets(body);
  assert.equal(body.source.hasCredentials, false);
  const stored = await storedSource(target);
  assert.equal(stored.username, undefined);
  assert.equal(stored.password, undefined);
  assert.match(stored.streamUrl, /^enc:v1:/);
  assert.equal(decryptSecret(stored.streamUrl), "rtsp://legacy-cam.local/stream1", "URL credentials are removed while stream location remains");
  assert.notEqual(stored.streamUrl, before.streamUrl);
});

// ---------------------------------------------------------------------------
// API: RBAC and demo regression
// ---------------------------------------------------------------------------

test("Citizen remains blocked from camera source APIs", async () => {
  for (const route of ["/api/camera-sources", "/api/camera-feeds"]) {
    const response = await request(route, { headers: authHeaders("Citizen") });
    assert.equal(response.status, 403, route);
  }
  const create = await request("/api/camera-sources", {
    method: "POST",
    headers: { ...authHeaders("Citizen"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ name: "Citizen Camera", sourceType: "rtsp" })
  });
  assert.equal(create.status, 403);
});

test("Police Officer cannot create or configure camera sources", async () => {
  const create = await request("/api/camera-sources", {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ name: "Police Camera", sourceType: "rtsp" })
  });
  assert.equal(create.status, 403);
  const patch = await request("/api/camera-sources/cam_legacy_plain/config", {
    method: "PATCH",
    headers: { ...authHeaders("Police Officer"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ password: ROTATED_PASSWORD })
  });
  assert.equal(patch.status, 403);
});

test("Demo cameras keep working without credentials", async () => {
  const testResponse = await request("/api/camera-sources/cam_c19/test", {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), Origin: "http://localhost:3000" }
  });
  assert.equal(testResponse.status, 200);
  const testBody = await testResponse.json();
  assert.equal(testBody.mode, "demo-simulated");
  assertNoCameraSecrets(testBody);

  const demoConfig = await request("/api/camera-sources/cam_c19/config", {
    method: "PATCH",
    headers: { ...authHeaders("Admin"), "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ name: "Demo Rename Attempt" })
  });
  assert.equal(demoConfig.status, 400, "demo cameras cannot be converted to real CCTV config");

  const analyze = await request("/api/camera-sources/cam_c19/analyze", {
    method: "POST",
    headers: { ...authHeaders("Police Officer"), Origin: "http://localhost:3000" }
  });
  assert.equal(analyze.status, 200);
  assertNoCameraSecrets(await analyze.json());
});

test("Audit logs never contain camera secrets or encrypted material", async () => {
  const db = await readDatabase();
  const serialized = JSON.stringify(db.auditLogs);
  for (const forbidden of [LEGACY_PASSWORD, LEGACY_USERNAME, "legacy-cam.local", CREATED_PASSWORD, CREATED_USERNAME, ROTATED_PASSWORD, "enc:v1"]) {
    assert.equal(serialized.includes(forbidden), false, `audit log leaked ${forbidden}`);
  }
  assert.ok(
    db.auditLogs.some((entry) => /camera_source_config|camera_source_connection|camera_snapshot/.test(String(entry.action))),
    "camera audit actions must still be recorded"
  );
});

// ---------------------------------------------------------------------------
// Explicit migration utility (spawned, JSON store, counts-only output)
// ---------------------------------------------------------------------------

function runMigrationScript(dbFile) {
  return childProcess.spawnSync(process.execPath, [path.join(__dirname, "..", "scripts", "migrate-camera-credentials.js")], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: "",
      RAKSHAKAI_DATA_FILE: dbFile,
      CAMERA_CREDENTIAL_ENCRYPTION_KEY: TEST_CAMERA_KEY
    },
    encoding: "utf8"
  });
}

test("migration utility encrypts legacy plaintext, is idempotent and reports counts only", () => {
  const migrationDb = path.join(testDirectory, "migration-db.json");
  const seed = JSON.parse(fs.readFileSync(testDatabase, "utf8"));
  // Reintroduce a legacy plaintext record to exercise the utility directly.
  const pristine = seed.cameraSources.find((source) => source.id === "cam_legacy_plain");
  pristine.streamUrl = LEGACY_STREAM_URL;
  pristine.username = LEGACY_USERNAME;
  pristine.password = LEGACY_PASSWORD;
  fs.writeFileSync(migrationDb, JSON.stringify(seed, null, 2));

  const first = runMigrationScript(migrationDb);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /migrated=1/);
  const afterFirst = fs.readFileSync(migrationDb, "utf8");
  assert.equal(afterFirst.includes(LEGACY_USERNAME), false);
  assert.equal(afterFirst.includes(LEGACY_PASSWORD), false);
  assert.equal(afterFirst.includes("legacy-cam.local"), false);
  assert.match(afterFirst, /enc:v1:/);

  const second = runMigrationScript(migrationDb);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /migrated=0/);

  // Output must contain counts only, never credential material.
  for (const output of [first.stdout, first.stderr, second.stdout, second.stderr]) {
    assert.equal(output.includes(LEGACY_PASSWORD), false, "migration output must not contain credentials");
    assert.equal(output.includes(LEGACY_USERNAME), false, "migration output must not contain credentials");
  }
});
