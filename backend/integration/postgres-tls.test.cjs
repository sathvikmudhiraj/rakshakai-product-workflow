const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

if (process.env.RAKSHAKAI_TLS_TEST_CONTAINER === "1") {
  const { Pool } = require("pg");
  const { connectionOptions } = require("../services/postgres.service");
  assert.ok(process.env.TLS_TEST_PASSWORD, "isolated test password is required");
  const base = `postgresql://tls_test:${encodeURIComponent(process.env.TLS_TEST_PASSWORD)}@tls-db.example.invalid:5432/tls_test`;
  const ca = "/tls/server.crt";

  async function connect({ host, suffix = "", trusted = true, mode } = {}) {
    const options = connectionOptions({
      NODE_ENV: "production",
      DATABASE_URL: (host ? base.replace("tls-db.example.invalid", host) : base) + suffix,
      ...(trusted ? { PG_SSL_CA_FILE: ca } : {}),
      ...(mode ? { PG_SSL_MODE: mode } : {})
    });
    assert.equal(options.ssl.rejectUnauthorized, true);
    const pool = new Pool({ ...options, connectionTimeoutMillis: 5000 });
    try {
      const result = await pool.query("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()");
      assert.equal(result.rows[0].ssl, true);
    } finally {
      await pool.end();
    }
  }

  test("trusted certificate and matching hostname succeed with production default TLS", () => connect());
  test("sslmode=require retains certificate verification", () => connect({ suffix: "?sslmode=require&uselibpqcompat=true" }));
  test("untrusted certificate fails the real PostgreSQL handshake", async () => {
    await assert.rejects(connect({ trusted: false }), (error) => {
      assert.ok(["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"].includes(error.code));
      return true;
    });
  });
  test("trusted certificate with wrong hostname fails the real PostgreSQL handshake", async () => {
    await assert.rejects(connect({ host: "tls-wrong.example.invalid" }), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
  });
  test("URL SSL flags cannot bypass verification of an untrusted server", async () => {
    await assert.rejects(connect({ trusted: false, suffix: "?ssl=false&sslmode=require&uselibpqcompat=true" }), (error) => {
      assert.ok(["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"].includes(error.code));
      return true;
    });
  });
  test("remote production plaintext configuration fails before connecting", () => {
    assert.throws(() => connectionOptions({ NODE_ENV: "production", DATABASE_URL: base, PG_SSL_MODE: "disable" }), /requires verified TLS/);
  });
} else {
  test("isolated PostgreSQL certificate verification", { timeout: 240000 }, async () => {
    const root = path.resolve(__dirname, "../..");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-tls-"));
    const id = `rakshakai-tls-${crypto.randomBytes(6).toString("hex")}`;
    const image = `${id}:test`;
    const database = `${id}-postgres`;
    const client = `${id}-client`;
    const password = crypto.randomBytes(24).toString("hex");
    const env = { ...process.env, POSTGRES_PASSWORD: password, TLS_TEST_PASSWORD: password };
    const openssl = process.env.OPENSSL_BIN || (process.platform === "win32" ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl");
    function run(binary, args, { quiet = false, allowFailure = false } = {}) {
      const result = spawnSync(binary, args, { cwd: root, env, encoding: "utf8", timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
      if (!quiet) {
        process.stdout.write((result.stdout || "").replaceAll(password, "[REDACTED]"));
        process.stderr.write((result.stderr || "").replaceAll(password, "[REDACTED]"));
      }
      if (!allowFailure && (result.error || result.status !== 0)) throw new Error(`${path.basename(binary)} ${args[0]} failed`);
      return result.status;
    }
    let networkCreated = false;
    let imageCreated = false;
    let databaseCreated = false;
    try {
      run(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=tls-db.example.invalid", "-addext", "subjectAltName=DNS:tls-db.example.invalid", "-keyout", path.join(directory, "server.key"), "-out", path.join(directory, "server.crt")], { quiet: true });
      fs.chmodSync(directory, 0o755);
      fs.chmodSync(path.join(directory, "server.crt"), 0o644);
      fs.chmodSync(path.join(directory, "server.key"), 0o600);
      run("docker", ["build", "-q", "-f", "backend/Dockerfile", "-t", image, "."]);
      imageCreated = true;
      run("docker", ["network", "create", id]);
      networkCreated = true;
      run("docker", ["create", "--name", database, "--network", id, "--network-alias", "tls-db.example.invalid", "--network-alias", "tls-wrong.example.invalid", "--tmpfs", "/var/lib/postgresql/data", "--mount", `type=bind,source=${directory},target=/tls,readonly`, "-e", "POSTGRES_PASSWORD", "-e", "POSTGRES_USER=tls_test", "-e", "POSTGRES_DB=tls_test", "--entrypoint", "sh", "postgres:16-alpine", "-c", "cp /tls/server.key /tmp/server.key && chown postgres:postgres /tmp/server.key && chmod 600 /tmp/server.key && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tls/server.crt -c ssl_key_file=/tmp/server.key"]);
      databaseCreated = true;
      run("docker", ["start", database]);
      let ready = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        if (run("docker", ["exec", database, "pg_isready", "-h", "127.0.0.1", "-U", "tls_test", "-d", "tls_test"], { quiet: true, allowFailure: true }) === 0) { ready = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!ready) run("docker", ["logs", database], { allowFailure: true });
      assert.equal(ready, true, "isolated TLS PostgreSQL becomes ready");
      run("docker", ["run", "--rm", "--name", client, "--network", id,
        "--mount", `type=bind,source=${path.join(directory, "server.crt")},target=/tls/server.crt,readonly`,
        "--mount", `type=bind,source=${__filename},target=/app/backend/integration/postgres-tls.test.cjs,readonly`,
        "-e", "TLS_TEST_PASSWORD", "-e", "RAKSHAKAI_TLS_TEST_CONTAINER=1", image, "node", "--test", "integration/postgres-tls.test.cjs"]);
    } finally {
      // Only names generated for this test run are eligible for cleanup.
      run("docker", ["rm", "-f", client], { quiet: true, allowFailure: true });
      if (databaseCreated) run("docker", ["rm", "-f", database]);
      if (networkCreated) run("docker", ["network", "rm", id]);
      if (imageCreated) run("docker", ["image", "rm", image]);
      const resolved = path.resolve(directory);
      assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
      assert.ok(path.basename(resolved).startsWith("rakshakai-tls-"));
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  });
}
