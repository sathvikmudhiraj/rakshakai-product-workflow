const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const {
  loadImportDatabase,
  parseImportOptions
} = require("../scripts/import-json-to-postgres");

const fixturePath = path.join(__dirname, "fixtures", "db.fixture.json");
const examplePath = path.join(__dirname, "..", "data", "db.example.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const example = JSON.parse(fs.readFileSync(examplePath, "utf8"));

const requiredCollections = [
  "users",
  "cameras",
  "zones",
  "reports",
  "incidents",
  "alerts",
  "devices",
  "auditLogs",
  "cameraSources",
  "detections",
  "dispatchEvents",
  "responseUnits",
  "videoEvidence",
  "policeStations"
];

function assertRequiredCollections(db, label) {
  assert.equal(typeof db, "object", `${label} must parse as an object`);
  assert.equal(Array.isArray(db), false, `${label} must not be an array`);
  for (const collection of requiredCollections) {
    assert.ok(Array.isArray(db[collection]), `${label}.${collection} must be an array`);
  }
}

test("sanitized runtime JSON fixture parses with all required collections", () => {
  assertRequiredCollections(fixture, "fixture");
  assertRequiredCollections(example, "example");
});

test("sanitized fixture contains only expected roles and reserved email domains", () => {
  const roles = new Set((fixture.users || []).map((user) => user.role));
  assert.deepEqual([...roles].sort(), ["Admin", "Citizen", "Police Officer"].sort());

  for (const user of fixture.users || []) {
    assert.match(user.email, /@example\.test$/);
    assert.doesNotMatch(user.email, /(?:gitam|gmail|yahoo|outlook|hotmail|rakshakai\.local)/i);
    assert.equal(Object.hasOwn(user, "password"), false);
    assert.match(user.passwordHash, /^\$2[aby]\$/);
  }
});

test("sanitized fixture does not contain runtime audit history or plaintext passwords", () => {
  assert.deepEqual(fixture.auditLogs, []);
  const serialized = JSON.stringify(fixture);
  assert.doesNotMatch(serialized, /"password"\s*:/i);
  assert.doesNotMatch(serialized, /(?:gitam|gmail|yahoo|outlook|hotmail|rakshakai\.local)/i);
});

test("security access tests use a temporary runtime copy instead of the committed fixture", () => {
  const source = fs.readFileSync(path.join(__dirname, "security-access.test.js"), "utf8");
  assert.match(source, /fixtures["'], ["']db\.fixture\.json/);
  assert.doesNotMatch(source, /\.\.["'], ["']data["'], ["']db\.json/);
  assert.match(source, /fs\.mkdtempSync/);
  assert.match(source, /const testDatabase = path\.join\(testDirectory, "db\.json"\)/);
  assert.match(source, /fs\.writeFileSync\(testDatabase/);
  assert.match(source, /process\.env\.RAKSHAKAI_DATA_FILE = testDatabase/);
});

test("committed fixture is not mutated when tests use a temporary runtime file", () => {
  const before = fs.readFileSync(fixturePath, "utf8");
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-fixture-copy-"));
  const tempDb = path.join(tempDirectory, "db.json");
  fs.writeFileSync(tempDb, before);
  const copy = JSON.parse(fs.readFileSync(tempDb, "utf8"));
  copy.auditLogs.push({ id: "fixture_temp_audit", action: "test_only" });
  fs.writeFileSync(tempDb, JSON.stringify(copy, null, 2));
  assert.equal(fs.readFileSync(fixturePath, "utf8"), before);
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test("import script accepts explicit fixture source", () => {
  const options = parseImportOptions(["--source", fixturePath], {});
  assert.equal(options.dbPath, fixturePath);
  const db = loadImportDatabase(options.dbPath);
  assert.equal(Array.isArray(db.users), true);
});

test("import script accepts the committed sanitized example source", () => {
  const options = parseImportOptions([], { RAKSHAKAI_IMPORT_FILE: examplePath });
  assert.equal(options.dbPath, examplePath);
  const db = loadImportDatabase(options.dbPath);
  assertRequiredCollections(db, "example");
});

test("import script fails clearly for a missing explicit source", () => {
  const missing = path.join(os.tmpdir(), `rakshakai-missing-${Date.now()}.json`);
  assert.throws(
    () => loadImportDatabase(missing),
    /Import source not found:/
  );
});

test("import source validation command succeeds for explicit fixture", () => {
  const scriptPath = path.join(__dirname, "..", "scripts", "import-json-to-postgres.js");
  const result = childProcess.spawnSync(
    process.execPath,
    [scriptPath, "--source", fixturePath, "--validate-source-only"],
    {
      cwd: path.join(__dirname, "..", ".."),
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "" }
    }
  );
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Import source validation passed\./);
  assert.equal(result.stderr, "");
});
