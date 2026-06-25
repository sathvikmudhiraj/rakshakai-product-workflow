const path = require("node:path");
const { AsyncLocalStorage } = require("node:async_hooks");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

let pool;
const transactionStorage = new AsyncLocalStorage();

function getDatabaseMode() {
  return process.env.DATABASE_URL ? "postgres" : "json";
}

function getPool() {
  if (getDatabaseMode() !== "postgres") {
    throw new Error("DATABASE_URL is required for PostgreSQL mode");
  }
  if (!pool) {
    let databaseHost = "";
    try {
      databaseHost = new URL(process.env.DATABASE_URL).hostname;
    } catch {
      databaseHost = "";
    }
    const isLocal = ["localhost", "127.0.0.1", "postgres"].includes(databaseHost);
    const sslMode = String(process.env.PG_SSL_MODE || (isLocal ? "disable" : "require")).toLowerCase();
    const ssl = sslMode === "disable"
      ? false
      : sslMode === "verify-full"
        ? { rejectUnauthorized: true }
        : { rejectUnauthorized: false };
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl,
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
  return getPool().query(sql, params);
}

async function withTransaction(callback) {
  const activeClient = transactionStorage.getStore();
  if (activeClient) return callback(activeClient);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await transactionStorage.run(client, () => callback(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
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
  getPool,
  getDatabaseMode,
  withTransaction,
  withAdvisoryLock,
  closePool
};
