const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { assertSafeTestDatabase, prepareIntegrationTestEnvironment } = require("../services/testDatabaseSafety");

const base = "postgresql://tester:example@127.0.0.1:5432/rakshakai_test_disposable";
const schema = "rakshakai_test_123_abcd";
const scoped = new URL(base);
scoped.searchParams.set("options", `-csearch_path=${schema}`);
const approved = { NODE_ENV: "test", TEST_DATABASE_URL: base, RAKSHAKAI_TEST_DATABASE_NAME: "rakshakai_test_disposable", RAKSHAKAI_TEST_SCHEMA: schema, DATABASE_URL: scoped.toString() };

test("destructive integration configuration rejects application and remote databases", () => {
  assert.throws(() => prepareIntegrationTestEnvironment({ DATABASE_URL: "postgresql://remote.example/production" }), /DATABASE_URL alone/);
  assert.throws(() => assertSafeTestDatabase({ ...approved, NODE_ENV: "production" }, { scoped: true }), /NODE_ENV/);
  assert.throws(() => assertSafeTestDatabase({ ...approved, TEST_DATABASE_URL: "" }, { scoped: true }), /TEST_DATABASE_URL/);
  assert.throws(() => assertSafeTestDatabase({ ...approved, TEST_DATABASE_URL: base.replace("127.0.0.1", "remote.example") }, { scoped: true }), /loopback/);
  assert.throws(() => assertSafeTestDatabase({ ...approved, TEST_DATABASE_URL: base.replace("rakshakai_test_disposable", "production"), RAKSHAKAI_TEST_DATABASE_NAME: "production" }, { scoped: true }), /disposable/);
  assert.throws(() => assertSafeTestDatabase({ ...approved, DATABASE_URL: "postgresql://remote.example/production" }, { scoped: true }), /match/);
  assert.throws(() => assertSafeTestDatabase({ ...approved, RAKSHAKAI_TEST_SCHEMA: "public" }, { scoped: true }), /schema/);
  assert.throws(() => assertSafeTestDatabase({ ...approved, TEST_DATABASE_URL: base + "?host=remote.example" }, { scoped: true }), /option/);
  assert.doesNotThrow(() => assertSafeTestDatabase(approved, { scoped: true }));
});

test("runner rejects an inherited DATABASE_URL before connecting", () => {
  const child = spawnSync(process.execPath, [path.join(__dirname, "../scripts/run-tests-isolated.js")], {
    env: { ...process.env, NODE_ENV: "test", DATABASE_URL: "postgresql://remote.example/production", TEST_DATABASE_URL: "" }, encoding: "utf8"
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /TEST_DATABASE_URL/);
});

test("PostgreSQL pool rejects a remote default before creating a connection", () => {
  const service = path.join(__dirname, "../services/postgres.service.js");
  const child = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(service)}).getPool()`], {
    env: { ...process.env, NODE_ENV: "test", DATABASE_URL: "postgresql://remote.example/production", TEST_DATABASE_URL: "" }, encoding: "utf8"
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /TEST_DATABASE_URL/);
});

test("no test URL disables dotenv database inheritance", () => {
  const env = {};
  prepareIntegrationTestEnvironment(env);
  assert.equal(env.DATABASE_URL, "");
});
