// A test schema is not a safety boundary if its parent database is real data.
function assertSafeTestDatabase(env = process.env, { scoped = false } = {}) {
  if (env.NODE_ENV !== "test") throw new Error("PostgreSQL integration tests require NODE_ENV=test");
  if (!env.TEST_DATABASE_URL) throw new Error("PostgreSQL integration tests require explicit TEST_DATABASE_URL");
  let url;
  try { url = new URL(env.TEST_DATABASE_URL); } catch { throw new Error("Invalid TEST_DATABASE_URL"); }
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^rakshakai_test_[a-z0-9_]+$/.test(name) || env.RAKSHAKAI_TEST_DATABASE_NAME !== name) {
    throw new Error("Test database must be explicitly named, disposable, and on loopback");
  }
  if ([...url.searchParams.keys()].some((key) => !['sslmode'].includes(key))) throw new Error("Unsupported TEST_DATABASE_URL option");
  if (scoped) {
    const schema = env.RAKSHAKAI_TEST_SCHEMA || "";
    if (!/^rakshakai_test_[a-z0-9_]+$/.test(schema)) throw new Error("A disposable test schema is required");
    let actual;
    try { actual = new URL(env.DATABASE_URL); } catch { throw new Error("Invalid scoped DATABASE_URL"); }
    const options = actual.searchParams.getAll('options');
    actual.searchParams.delete('options');
    if (options.length !== 1 || options[0] !== `-csearch_path=${schema}` || actual.toString() !== url.toString()) throw new Error("DATABASE_URL must match TEST_DATABASE_URL and the isolated test schema");
  }
  return url;
}
function prepareIntegrationTestEnvironment(env = process.env) {
  if (!env.TEST_DATABASE_URL) {
    if (env.DATABASE_URL) throw new Error("DATABASE_URL alone cannot enable PostgreSQL integration tests");
    env.DATABASE_URL = ""; // Prevent dotenv from inheriting a configured application database.
    return;
  }
  assertSafeTestDatabase(env, { scoped: true });
}
module.exports = { assertSafeTestDatabase, prepareIntegrationTestEnvironment };
