const path = require("node:path");
const fs = require("node:fs");
const { AsyncLocalStorage } = require("node:async_hooks");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

let pool;
const transactionStorage = new AsyncLocalStorage();

function getDatabaseMode() {
  return process.env.DATABASE_URL ? "postgres" : "json";
}

function connectionOptions(env = process.env) {
  let url;
  try {
    url = new URL(env.DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (url.searchParams.has("host")) {
    throw new Error("Configure the PostgreSQL hostname in the DATABASE_URL authority, not a query parameter");
  }
  const isLocal = ["localhost", "127.0.0.1", "[::1]", "postgres"].includes(url.hostname);
  const sslMode = String(env.PG_SSL_MODE || url.searchParams.get("sslmode") || (isLocal ? "disable" : "verify-full")).toLowerCase();
  if (!["disable", "require", "verify-full"].includes(sslMode)) {
    throw new Error("PG_SSL_MODE must be disable, require or verify-full");
  }
  if (env.NODE_ENV === "production" && !isLocal && sslMode === "disable") {
    throw new Error("Remote PostgreSQL requires verified TLS in production");
  }
  if (["sslcert", "sslkey", "sslrootcert"].some((key) => url.searchParams.has(key))) {
    throw new Error("Configure the PostgreSQL trust certificate with PG_SSL_CA_FILE");
  }
  // pg parses URL SSL parameters after the explicit ssl option; do not let them override it.
  for (const key of ["sslmode", "ssl", "uselibpqcompat"]) url.searchParams.delete(key);
  const ssl = sslMode === "disable" ? false : {
    rejectUnauthorized: true,
    ...(env.PG_SSL_CA_FILE ? { ca: fs.readFileSync(env.PG_SSL_CA_FILE, "utf8") } : {})
  };
  return { connectionString: url.toString(), ssl };
}

function getPool() {
  if (getDatabaseMode() !== "postgres") {
    throw new Error("DATABASE_URL is required for PostgreSQL mode");
  }
  if (!pool) {
    pool = new Pool({
      ...connectionOptions(),
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
    pool.on("error", (error) => {
      console.error("Unexpected PostgreSQL pool error:", error.message);
    });
  }
  return pool;
}

function query(sql, params = []) {
  const activeClient = transactionStorage.getStore()?.client;
  if (activeClient) return activeClient.query(sql, params);
  return getPool().query(sql, params);
}

function onTransactionFailure(callback) {
  const context = transactionStorage.getStore();
  if (!context) return false;
  context.onFailure.push(callback);
  return true;
}

async function withTransaction(callback, transactionPool) {
  const activeClient = transactionStorage.getStore()?.client;
  if (activeClient) return callback(activeClient);
  const client = await (transactionPool || getPool()).connect();
  const context = { client, onFailure: [] };
  let commitAttempted = false;
  let discardClient = false;
  try {
    await client.query("BEGIN");
    const result = await transactionStorage.run(context, () => callback(client));
    commitAttempted = true;
    const committed = await client.query("COMMIT");
    if (committed.command === "ROLLBACK") {
      throw Object.assign(new Error("Database transaction rolled back"), { code: "40000" });
    }
    return result;
  } catch (error) {
    // A lost COMMIT acknowledgement is ambiguous. Never delete evidence that may be committed.
    const outcome = !commitAttempted || /^(23|40)/.test(error.code || "") ? "rolled_back" : "unknown";
    try {
      await client.query("ROLLBACK");
    } catch {
      discardClient = true;
    }
    if (outcome === "unknown") discardClient = true;
    for (const callback of context.onFailure.reverse()) {
      try {
        await callback({ outcome });
      } catch {
        console.error(JSON.stringify({ event: "transaction_cleanup_failed", outcome }));
      }
    }
    throw error;
  } finally {
    client.release(discardClient);
  }
}

async function withAdvisoryLock(callback) {
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [724211]);
    return callback(client);
  });
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = {
  query,
  connectionOptions,
  onTransactionFailure,
  getPool,
  getDatabaseMode,
  withTransaction,
  withAdvisoryLock,
  closePool
};
