const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

async function main() {
  const requestedFiles = process.argv.slice(2);
  const testFiles = requestedFiles.length
    ? requestedFiles
    : fs.readdirSync(path.join(__dirname, "..", "tests"))
      .filter((file) => file.endsWith(".test.js"))
      .sort()
      .map((file) => path.join("tests", file));

  if (!process.env.DATABASE_URL) {
    const child = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...testFiles], {
      cwd: path.join(__dirname, ".."), env: process.env, stdio: "inherit"
    });
    process.exitCode = child.status ?? 1;
    return;
  }

  const schema = `rakshakai_test_${process.pid}_${crypto.randomBytes(5).toString("hex")}`;
  const baseUrl = new URL(process.env.DATABASE_URL);
  // Neon pooled endpoints reject the startup search_path option. Test isolation
  // requires a session-scoped schema, so use the matching direct endpoint.
  if (baseUrl.hostname.includes("-pooler.")) {
    baseUrl.hostname = baseUrl.hostname.replace("-pooler.", ".");
  }
  const isLocal = ["localhost", "127.0.0.1", "[::1]", "postgres"].includes(baseUrl.hostname);
  const sslMode = String(process.env.PG_SSL_MODE || baseUrl.searchParams.get("sslmode") || (isLocal ? "disable" : "verify-full")).toLowerCase();
  for (const key of ["sslmode", "ssl", "uselibpqcompat", "options"]) baseUrl.searchParams.delete(key);
  const poolOptions = {
    connectionString: baseUrl.toString(),
    ssl: sslMode === "disable" ? false : { rejectUnauthorized: true }
  };
  const adminPool = new Pool(poolOptions);
  let scopedPool;
  try {
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    const scopedUrl = new URL(baseUrl);
    scopedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    process.env.DATABASE_URL = scopedUrl.toString();
    scopedPool = new Pool({ ...poolOptions, connectionString: scopedUrl.toString() });
    const client = await scopedPool.connect();
    try {
      const { __testables } = require("./migrate");
      await __testables.runMigrations({ client });
    } finally {
      client.release();
    }
    await scopedPool.end();
    scopedPool = null;

    const child = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...testFiles], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, DATABASE_URL: scopedUrl.toString(), RAKSHAKAI_TEST_SCHEMA: schema },
      stdio: "inherit"
    });
    process.exitCode = child.status ?? 1;
  } finally {
    if (scopedPool) await scopedPool.end().catch(() => {});
    if (/^rakshakai_test_[a-z0-9_]+$/.test(schema)) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await adminPool.end();
  }
}

main().catch((error) => {
  console.error("Isolated test runner failed:", error.message);
  process.exitCode = 1;
});
