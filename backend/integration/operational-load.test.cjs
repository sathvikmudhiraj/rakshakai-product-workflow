const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const dns = require("node:dns").promises;
const { spawnSync } = require("node:child_process");

if (process.env.RAKSHAKAI_LOAD_TEST === "isolated") {
  const database = new URL(process.env.DATABASE_URL);
  assert.equal(database.hostname, "postgres");
  assert.equal(database.pathname, "/rakshakai_test_release");
  const { readDatabase, writeDatabase } = require("../services/core.service");
  const { query, getPool, closePool } = require("../services/postgres.service");
  let backends = [];
  let nextBackend = 0;
  const assignmentCount = 60;
  const concurrency = 12;
  const sustainedDurationMs = Number(process.env.LOAD_TEST_DURATION_MS || 15000);
  function memory() {
    const status = fs.readFileSync("/proc/1/status", "utf8");
    return Object.fromEntries(["VmRSS", "VmHWM"].map((key) => [key + "KiB", Number(status.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))[1])]));
  }
  async function request(route, cookie, body, options = {}) {
    const base = backends[options.backendIndex ?? (nextBackend++ % backends.length)];
    const method = options.method || "POST";
    const response = await fetch(base + route, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
    const result = await response.json();
    return { status: response.status, headers: response.headers, result, base };
  }
  async function batch(count, limit, callback) {
    let next = 0;
    const timings = [];
    const start = performance.now();
    await Promise.all(Array.from({ length: limit }, async () => {
      while (next < count) {
        const index = next++;
        const began = performance.now();
        await callback(index);
        timings.push(performance.now() - began);
      }
    }));
    const totalMs = performance.now() - start;
    timings.sort((a, b) => a - b);
    return { requests: count, concurrency: limit, totalMs: Math.round(totalMs), p50Ms: Math.round(timings[Math.ceil(count * 0.5) - 1]), p95Ms: Math.round(timings[Math.ceil(count * 0.95) - 1]), maxMs: Math.round(timings.at(-1)), requestsPerSecond: Number((count * 1000 / totalMs).toFixed(2)) };
  }
  test.after(closePool);
  test("multi-instance sustained load, database contention, upload memory and failure recovery", { timeout: 240000 }, async () => {
    const addresses = [...new Set(await dns.resolve4("backend"))];
    assert.ok(addresses.length >= 2, `Expected at least two backend replicas, received ${addresses.length}`);
    backends = addresses.map((address) => `http://${address}:5000`);
    for (let index = 0; index < backends.length; index++) {
      const response = await fetch(`${backends[index]}/api/health`, { signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200, `Backend replica ${index + 1} must be healthy`);
    }
    const db = await readDatabase();
    const cookies = [];
    for (const [index, role] of ["Admin", "Police Officer"].entries()) {
      const user = db.users.find((item) => item.role === role);
      const login = await request("/api/login", null, { email: user.email, password: process.env.RELEASE_TEST_PASSWORD }, { backendIndex: index % backends.length });
      assert.equal(login.status, 200);
      cookies.push(login.headers.getSetCookie().find((item) => item.startsWith("rakshakai_session=")).split(";")[0]);
    }
    assert.equal((await request("/api/incidents", cookies[0], null, { method: "GET", backendIndex: 1 })).status, 200, "A session issued by replica 1 must work on replica 2");
    const revocable = await request("/api/login", null, { email: db.users.find((item) => item.role === "Police Officer").email, password: process.env.RELEASE_TEST_PASSWORD }, { backendIndex: 0 });
    assert.equal(revocable.status, 200);
    const revocableCookie = revocable.headers.getSetCookie().find((item) => item.startsWith("rakshakai_session=")).split(";")[0];
    assert.equal((await request("/api/logout", revocableCookie, null, { backendIndex: 0 })).status, 200);
    assert.equal((await request("/api/maps/route", revocableCookie, {}, { backendIndex: 1 })).status, 401, "Logout revocation must propagate across replicas");
    const now = new Date().toISOString();
    for (let i = 0; i <= assignmentCount; i++) {
      db.incidents.push({ id: `load_incident_${i}`, title: "Synthetic load incident", type: "manual", category: "manual", severity: "medium", status: "Verified", source: "Manual", sourceType: "manual", lat: 17.5285, lng: 78.2636, locationSource: "manual_latlng", locationStatus: "Verified", assignedUnitId: null, createdAt: now, updatedAt: now, occurrenceCount: 1 });
      db.responseUnits.push({ id: `load_unit_${i}`, unitCode: `LOAD-${i}`, unitId: `LOAD-${i}`, name: "Synthetic load unit", unitName: "Synthetic load unit", type: "police_patrol", unitType: "police_patrol", status: "available", lat: 17.5285, lng: 78.2636, source: "admin_registry", operational: true, isDemo: false, lastSeen: now, lastUpdated: now, lastLocationUpdatedAt: now, assignedIncidentId: null, currentIncidentId: null });
    }
    await writeDatabase(db);
    const assign = (i) => request(`/api/incidents/load_incident_${i}/assign-unit`, cookies[i % 2], { unitId: `load_unit_${i}`, expectedAssignedUnitId: null }, { backendIndex: i % backends.length });
    const blocker = await getPool().connect();
    await blocker.query("SELECT pg_advisory_lock(724211)");
    let maxLockWaiters = 0;
    const run = batch(assignmentCount, concurrency, async (i) => { assert.equal((await assign(i)).status, 200); });
    try {
      // Hold the real application lock to create a reproducible contention burst.
      const until = Date.now() + 750;
      while (Date.now() < until) {
        const result = await query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'");
        maxLockWaiters = Math.max(maxLockWaiters, result.rows[0].count);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      await blocker.query("SELECT pg_advisory_unlock(724211)");
      blocker.release();
    }
    const assignments = await run;
    assert.ok(maxLockWaiters > 0);
    const afterAssignments = await readDatabase();
    assert.equal(afterAssignments.incidents.filter((item) => item.id.startsWith("load_incident_") && item.assignedUnitId).length, assignmentCount);
    assert.equal(afterAssignments.auditLogs.filter((item) => item.incidentId?.startsWith("load_incident_") && item.action === "unit_assigned").length, assignmentCount);
    assert.equal(afterAssignments.dispatchEvents.filter((item) => item.incidentId?.startsWith("load_incident_") && item.type === "unit_assigned").length, assignmentCount);
    let sustainedRequestCount = 0;
    const sustainedPerReplica = Array(backends.length).fill(0);
    const sustainedStart = performance.now();
    await batch(concurrency, concurrency, async (worker) => {
      const deadline = performance.now() + sustainedDurationMs;
      while (performance.now() < deadline) {
        const backendIndex = worker % backends.length;
        const response = await request("/api/incidents", cookies[worker % cookies.length], null, { method: "GET", backendIndex });
        assert.equal(response.status, 200);
        sustainedRequestCount += 1;
        sustainedPerReplica[backendIndex] += 1;
      }
    });
    const sustainedElapsedMs = performance.now() - sustainedStart;
    const sustainedReads = {
      requests: sustainedRequestCount,
      concurrency,
      totalMs: Math.round(sustainedElapsedMs),
      requestsPerSecond: Number((sustainedRequestCount * 1000 / sustainedElapsedMs).toFixed(2)),
      perReplica: sustainedPerReplica
    };
    const beforeUploads = memory();
    const bytes = Buffer.alloc(384 * 1024, 0);
    Buffer.from([0, 0, 0, 24]).copy(bytes);
    bytes.write("ftypisom", 4, "ascii");
    const videoData = `data:video/mp4;base64,${bytes.toString("base64")}`;
    const uploads = await batch(12, 4, async (i) => {
      const uploadBackend = i % backends.length;
      const uploaded = await request("/api/video-evidence", cookies[0], { fileName: `load-${i}.mp4`, videoData }, { backendIndex: uploadBackend });
      assert.equal(uploaded.status, 201);
      const previewBackend = (uploadBackend + 1) % backends.length;
      const preview = await fetch(backends[previewBackend] + `/api/video-evidence/${uploaded.result.evidence.id}/preview`, { headers: { Cookie: cookies[0] }, signal: AbortSignal.timeout(60000) });
      assert.equal(preview.status, 200);
      assert.equal(crypto.createHash("sha256").update(Buffer.from(await preview.arrayBuffer())).digest("hex"), crypto.createHash("sha256").update(bytes).digest("hex"));
    });
    const afterUploads = memory();
    await query(`CREATE FUNCTION load_reject_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic commit failure' USING ERRCODE='23514'; END $$`);
    await query("CREATE CONSTRAINT TRIGGER load_reject_commit AFTER UPDATE ON incidents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION load_reject_commit()");
    try { assert.equal((await assign(assignmentCount)).status, 500); }
    finally {
      await query("DROP TRIGGER load_reject_commit ON incidents");
      await query("DROP FUNCTION load_reject_commit()");
    }
    const recoveryStart = performance.now();
    assert.equal((await assign(assignmentCount)).status, 200);
    const recoveryMs = Math.round(performance.now() - recoveryStart);
    for (const base of backends) assert.equal((await fetch(base + "/api/health")).status, 200);
    console.log(JSON.stringify({ event: "operational_load_results", backendReplicas: backends.length, sustainedDurationMs, sustainedReads, assignments, maxLockWaiters, uploadsIncludingPreview: uploads, uploadBytes: bytes.length, beforeUploads, afterUploads, successfulRetryMs: recoveryMs, routing: "self-hosted OSRM unavailable; approximate fallback", limitations: "synthetic workload; no production SLO asserted" }));
  });
} else {
  test("run isolated operational load drill", { timeout: 360000 }, () => {
    const project = `rakshakai-load-${crypto.randomBytes(6).toString("hex")}`;
    const env = { ...process.env, RELEASE_TEST_PASSWORD: crypto.randomBytes(24).toString("hex"), RELEASE_TEST_JWT: crypto.randomBytes(32).toString("hex") };
    env.DATABASE_URL = `postgresql://release_test:${env.RELEASE_TEST_PASSWORD}@postgres:5432/rakshakai_test_release`;
    const args = ["compose", "--project-name", project, "--file", "compose.test.yaml"];
    function docker(command, quiet = false) {
      const result = spawnSync("docker", command, { cwd: path.resolve(__dirname, "../.."), env, encoding: "utf8", timeout: 240000, maxBuffer: 15 * 1024 * 1024 });
      if (!quiet) for (const value of [result.stdout || "", result.stderr || ""]) process.stdout.write(value.replaceAll(env.RELEASE_TEST_PASSWORD, "[REDACTED]").replaceAll(env.RELEASE_TEST_JWT, "[REDACTED]"));
      if (result.error || result.status !== 0) throw new Error("Isolated load Docker operation failed");
      return result.stdout.trim();
    }
    const client = `${project}-client`;
    try {
      docker([...args, "up", "--build", "--detach", "--wait", "--wait-timeout", "180", "--scale", "backend=2", "backend"]);
      docker(["run", "--rm", "--name", client, "--network", `${project}_default`, "--pid", `container:${project}-backend-1`,
        "--mount", `type=bind,source=${__filename},target=/app/backend/integration/operational-load.test.cjs,readonly`,
        "-e", "RAKSHAKAI_LOAD_TEST=isolated", "-e", "DATABASE_URL", "-e", "RELEASE_TEST_PASSWORD", "-e", "PG_SSL_MODE=disable",
        `${project}-backend`, "node", "--test", "integration/operational-load.test.cjs"]);
    } finally {
      // Names and volume labels below are unique to this disposable drill.
      spawnSync("docker", ["rm", "-f", client], { stdio: "ignore" });
      docker([...args, "down", "--timeout", "30"]);
      const volumes = docker(["volume", "ls", "--quiet", "--filter", `label=com.docker.compose.project=${project}`], true).split(/\r?\n/).filter(Boolean);
      for (const volume of volumes) { assert.ok(volume.startsWith(`${project}_`)); docker(["volume", "rm", volume]); }
    }
  });
}
