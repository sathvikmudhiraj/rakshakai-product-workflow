const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const artifacts = path.join(root, "artifacts", `sla-monitoring-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-sla-browser-"));
const seedFile = path.join(isolatedDir, "synthetic-sla-seed.json");
const dbUrl = process.env.SLA_E2E_DATABASE_URL || "";
const adminPassword = "IsolatedSlaAdmin-2026!";
const citizenPassword = "IsolatedSlaCitizen-2026!";
const backendPort = 56000 + Math.floor(Math.random() * 600);
const frontendPort = 57000 + Math.floor(Math.random() * 600);
const backendUrl = `http://127.0.0.1:${backendPort}`;
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const children = [];
const browserEvents = { console: [], page: [], failedRequests: [], http: [] };

function assertDisposableDatabase(raw) {
  assert.ok(raw, "SLA_E2E_DATABASE_URL must explicitly target isolated PostgreSQL");
  const url = new URL(raw);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(url.hostname), "SLA E2E only accepts a loopback PostgreSQL server");
  assert.equal(decodeURIComponent(url.pathname.slice(1)), "rakshakai_sla_e2e", "SLA E2E database name must be rakshakai_sla_e2e");
  return url.toString();
}

function runNode(script, env) {
  const result = spawnSync(process.execPath, [script], { cwd: root, env, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${path.relative(root, script)} exit code ${result.status}`);
}

async function resetDedicatedSlaDatabase(databaseUrl) {
  const { Pool } = require(path.join(root, "backend", "node_modules", "pg"));
  const target = new URL(databaseUrl);
  assert.equal(decodeURIComponent(target.pathname.slice(1)), "rakshakai_sla_e2e", "only the named disposable SLA database may be reset");
  target.pathname = "/postgres";
  const pool = new Pool({ connectionString: target.toString(), max: 1 });
  try {
    await pool.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'rakshakai_sla_e2e' AND pid <> pg_backend_pid()");
    await pool.query("DROP DATABASE IF EXISTS rakshakai_sla_e2e");
    await pool.query("CREATE DATABASE rakshakai_sla_e2e");
  } finally { await pool.end(); }
}

async function seedDatabase(databaseUrl) {
  await resetDedicatedSlaDatabase(databaseUrl);
  process.env.DATABASE_URL = databaseUrl;
  process.env.RAKSHAKAI_DATA_FILE = path.join(isolatedDir, "seed-builder.json");
  const { seedDb } = require(path.join(root, "backend", "services", "core.service.js"));
  const db = seedDb();
  const now = Date.now();
  const stationId = "station_sla_e2e";
  db.users = db.users.map((user) => {
    if (user.id === "u_police") return { ...user, stationId, jurisdiction: "SLA QA", data: { ...user.data, stationId, jurisdiction: "SLA QA" } };
    return user;
  });
  db.policeStations = [
    { id: stationId, stationId: "SLA-QA-01", stationCode: "SLA-QA-01", stationName: "SLA QA Station", name: "SLA QA Station", jurisdiction: "SLA QA", operational: true },
    { id: "station_sla_remote", stationId: "SLA-REMOTE", stationCode: "SLA-REMOTE", stationName: "Remote Station", name: "Remote Station", jurisdiction: "Remote District", operational: true }
  ];
  db.policeBeats = [];
  db.policeOfficers = [];
  db.responseUnits = [{ id: "unit_sla_e2e", unitId: "SLA-UNIT-01", unitCode: "SLA-UNIT-01", name: "SLA QA Patrol", unitName: "SLA QA Patrol", linkedStationId: stationId, stationId, stationName: "SLA QA Station", jurisdiction: "SLA QA", status: "available", operational: true, unitType: "police_patrol", lat: 17.5285, lng: 78.2636, assignedIncidentId: null }];
  db.responseUnitMembers = [];
  db.unitCapabilities = [];
  db.incidentOfficerAssignments = [];
  db.dispatchEvents = [];
  db.incidentTimeline = [];
  db.escalationAlerts = [];
  const incident = (id, title, severity, status, createdAt, assignmentDeadline, responseDeadline, assignedUnitId = null, extra = {}) => ({
    id, incidentId: id, title, type: "synthetic_sla_test", severity, status, createdAt, updatedAt: createdAt,
    assignmentDeadline, responseDeadline, assignedUnitId, jurisdiction: "SLA QA", stationId, stationName: "SLA QA Station",
    source: "Command Center", sourceName: "Synthetic SLA E2E", lat: 17.5285, lng: 78.2636, locationStatus: "Verified", ...extra
  });
  db.incidents = [
    incident("SLA-QA-BREACHED", "Synthetic unassigned critical breach", "CRITICAL", "New", new Date(now - 600000).toISOString(), new Date(now - 60000).toISOString(), new Date(now + 240000).toISOString(), null, { assignmentBreachedAt: new Date(now - 60000).toISOString(), escalationLevel: "L2" }),
    incident("SLA-QA-APPROACHING", "Synthetic unassigned approaching case", "MEDIUM", "Verified", new Date(now - 8 * 60000).toISOString(), new Date(now + 2 * 60000).toISOString(), new Date(now + 22 * 60000).toISOString(), null),
    incident("SLA-QA-WITHIN", "Synthetic assigned case within target", "LOW", "Assigned", new Date(now - 5 * 60000).toISOString(), new Date(now + 25 * 60000).toISOString(), new Date(now + 115 * 60000).toISOString(), null),
    incident("SLA-QA-NO-DEADLINE", "Synthetic missing policy dates", "MEDIUM", "New", new Date(now - 120000).toISOString(), null, null, null),
    incident("SLA-QA-CLOSED", "Synthetic completed record", "LOW", "Resolved", new Date(now - 86400000).toISOString(), new Date(now - 23 * 3600000).toISOString(), new Date(now - 22 * 3600000).toISOString(), null, { resolvedAt: new Date(now - 22 * 3600000).toISOString() }),
    incident("SLA-QA-REMOTE", "Synthetic out-of-jurisdiction case", "LOW", "New", new Date(now - 60000).toISOString(), new Date(now + 30 * 60000).toISOString(), new Date(now + 120 * 60000).toISOString(), null, { stationId: "station_sla_remote", stationName: "Remote Station", jurisdiction: "Remote District" })
  ];
  fs.writeFileSync(seedFile, JSON.stringify(db, null, 2));
  const env = {
    ...process.env, DATABASE_URL: databaseUrl, RAKSHAKAI_IMPORT_FILE: seedFile,
    SEED_ADMIN_PASSWORD: adminPassword, SEED_POLICE_PASSWORD: "IsolatedSlaPolice-2026!", SEED_CITIZEN_PASSWORD: citizenPassword
  };
  runNode(path.join(root, "backend", "scripts", "migrate.js"), env);
  const { Pool } = require(path.join(root, "backend", "node_modules", "pg"));
  runNode(path.join(root, "backend", "scripts", "import-json-to-postgres.js"), env);
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const bcrypt = require(path.join(root, "backend", "node_modules", "bcryptjs"));
    for (const [email, password] of [
      ["admin@rakshakai.local", adminPassword],
      ["police@rakshakai.local", "IsolatedSlaPolice-2026!"],
      ["citizen@rakshakai.local", citizenPassword]
    ]) {
      await pool.query("UPDATE users SET password_hash = $2 WHERE lower(email) = lower($1)", [email, await bcrypt.hash(password, 12)]);
    }
    await pool.query("UPDATE incidents SET assigned_unit_id = $2 WHERE id = $1", ["SLA-QA-WITHIN", "unit_sla_e2e"]);
    await pool.query("UPDATE response_units SET status = 'busy', assigned_incident_id = $2 WHERE id = $1", ["unit_sla_e2e", "SLA-QA-WITHIN"]);
  } finally { await pool.end(); }
}

function startNode(script, args, cwd, env) {
  const child = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  children.push(child);
  return child;
}

async function waitReady(url, child) {
  const endAt = Date.now() + 45000;
  while (Date.now() < endAt) {
    if (child.exitCode !== null) throw new Error(`Service exited with code ${child.exitCode}: ${url}`);
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Readiness check timed out: ${url}`);
}

async function availablePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(port)));
  });
}

async function persistedSyntheticRows(databaseUrl) {
  const { Pool } = require(path.join(root, "backend", "node_modules", "pg"));
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await pool.query("SELECT data->>'id' AS id, data->>'assignmentDeadline' AS assignment_deadline, data->>'responseDeadline' AS response_deadline FROM incidents WHERE data->>'id' LIKE 'SLA-QA-%' ORDER BY data->>'id'");
    return result.rows;
  } finally { await pool.end(); }
}

async function persistedSlaAudits(databaseUrl) {
  const { Pool } = require(path.join(root, "backend", "node_modules", "pg"));
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await pool.query("SELECT data->>'action' AS action, data->>'incidentId' AS incident_id FROM audit_logs WHERE data->>'incidentId' LIKE 'SLA-QA-%' AND data->>'action' LIKE 'sla_escalation_%'");
    return result.rows;
  } finally { await pool.end(); }
}

function monitor(page) {
  page.on("console", (message) => { if (message.type() === "error") browserEvents.console.push(message.text()); });
  page.on("pageerror", (error) => browserEvents.page.push(error.message));
  page.on("requestfailed", (request) => browserEvents.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }));
  page.on("response", (response) => { if (response.status() >= 400) browserEvents.http.push({ url: response.url(), status: response.status() }); });
}

async function login(page, email, password) {
  await page.goto(frontendUrl, { waitUntil: "domcontentloaded" });
  await page.locator("#loginForm input[name='email']").fill(email);
  await page.locator("#loginForm input[name='password']").fill(password);
  const loginResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/login", { timeout: 15000 }).catch(() => null);
  await page.locator("#loginForm button[type='submit']").click();
  const loginResponse = await loginResponsePromise;
  try { await page.locator("#appShell:not(.app-hidden)").waitFor({ timeout: 12000 }); }
  catch (error) {
    const formState = await page.locator("#loginForm").innerText().catch(() => "login form missing");
    const apiState = await page.evaluate(async () => {
      const response = await fetch("/api/auth/me");
      return { status: response.status, body: await response.text() };
    }).catch((probeError) => ({ error: probeError.message }));
    throw new Error(`Browser login failed for ${email}; form=${formState}; loginStatus=${loginResponse?.status() || "no response"}; session=${JSON.stringify(apiState)}; ${error.message}`);
  }
}

async function main() {
  const databaseUrl = assertDisposableDatabase(dbUrl);
  await availablePort(backendPort);
  await availablePort(frontendPort);
  fs.mkdirSync(artifacts, { recursive: true });
  await seedDatabase(databaseUrl);
  const backend = startNode(path.join(root, "backend", "server.js"), [], root, {
    PORT: String(backendPort), NODE_ENV: "development", DATABASE_URL: databaseUrl,
    JWT_SECRET: "isolated-sla-e2e-secret-at-least-32-characters", SKIP_STARTUP_DATA_REPAIR: "true",
    ESCALATION_SWEEP_INTERVAL_MS: "3600000", SLA_SWEEP_INTERVAL_MS: "3600000", FRONTEND_ORIGINS: frontendUrl
  });
  await waitReady(`${backendUrl}/api/health`, backend);
  const frontend = startNode(path.join(root, "frontend", "node_modules", "vite", "bin", "vite.js"), ["--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort"], path.join(root, "frontend"), { VITE_BACKEND_PROXY_TARGET: backendUrl });
  await waitReady(frontendUrl, frontend);
  const proxyProbe = await fetch(`${frontendUrl}/api/auth/me`);
  assert.ok([200, 401].includes(proxyProbe.status), `Vite must proxy session checks to the isolated backend (got ${proxyProbe.status})`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  monitor(page);
  try {
    await login(page, "admin@rakshakai.local", adminPassword);
    await page.locator(".nav-item[data-view='sla-monitoring']").click();
    await page.locator("#slaMonitoringContent").waitFor({ state: "visible" });
    await page.locator("#slaMonitoringLoading").waitFor({ state: "hidden" });
    await page.locator("#slaCaseTable").getByText("SLA-QA-BREACHED", { exact: true }).waitFor();
    assert.equal(await page.locator("#slaCasesEmpty").isVisible(), false);
    assert.equal(await page.locator("#slaKpiActive").textContent(), "5");
    assert.equal(await page.locator("#slaKpiBreached").textContent(), "1");
    assert.equal(await page.locator("#slaKpiApproaching").textContent(), "1");
    assert.equal(await page.locator("#slaKpiWithin").textContent(), "2");
    assert.equal(await page.locator("#slaKpiEscalated").textContent(), "2");
    assert.equal(await page.locator("#slaKpiResolution").textContent(), "N/A");
    assert.equal(await page.locator("#slaCaseTable tbody tr").count(), 5);
    assert.ok(await page.locator("#slaCaseTable").getByText("Unassigned", { exact: true }).count() >= 2);
    assert.equal(await page.locator(".nav-item[data-view='sla-monitoring']").getAttribute("aria-current"), "page");
    await page.screenshot({ path: path.join(artifacts, "sla-monitoring-desktop-1440.png"), fullPage: true });

    const sweepResponse = await page.evaluate(async () => {
      const response = await fetch("/api/sla/escalation-sweep", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      return { status: response.status, body: await response.json() };
    });
    assert.equal(sweepResponse.status, 200, "SLA scheduler accepts the authenticated isolated workflow");
    const persistedAuditEvents = await persistedSlaAudits(databaseUrl);
    assert.ok(persistedAuditEvents.some((event) => event.action === "sla_escalation_alert_created" && event.incident_id === "SLA-QA-BREACHED"), "breach alert is durably audited");

    await page.locator("#slaStateFilter").selectOption("BREACHED");
    assert.equal(await page.locator("#slaCaseTable tbody tr").count(), 1);
    await page.locator("#slaSearch").fill("SLA-QA-BREACHED");
    assert.equal(await page.locator("#slaCaseTable tbody tr").count(), 1);
    await page.locator("#slaSearch").fill("");
    await page.locator("#slaStateFilter").selectOption("all");

    const refresh = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/sla/monitoring");
    await page.locator("#refreshSlaMonitoring").click();
    await refresh;
    await page.locator("#slaMonitoringLoading").waitFor({ state: "hidden" });
    await page.locator("#slaCaseTable").getByText("SLA QA Station", { exact: true }).first().waitFor();

    const viewportResults = [];
    for (const width of [1920, 1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 980 });
      await page.waitForTimeout(100);
      const sizes = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll("body *")].filter((element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.right > innerWidth + 2 && getComputedStyle(element).position !== "fixed"; }).slice(0, 8).map((element) => ({ tag: element.tagName, id: element.id, cls: String(element.className).slice(0, 80), left: Math.round(element.getBoundingClientRect().left), right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width) })) }));
      assert.ok(sizes.document <= sizes.viewport, `Horizontal overflow at ${width}px: ${JSON.stringify(sizes)}`);
      viewportResults.push({ width, ...sizes });
      if (width === 390) await page.screenshot({ path: path.join(artifacts, "sla-monitoring-mobile-390.png"), fullPage: true });
    }
    assert.equal(await page.locator("#slaCaseCards .sla-case-row").count(), 5);
    const persisted = await persistedSyntheticRows(databaseUrl);
    assert.equal(persisted.length, 6);
    assert.ok(persisted.find((row) => row.id === "SLA-QA-BREACHED").assignment_deadline);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator(".nav-item[data-view='dashboard']").click();
    await page.goBack();
    await page.locator("[data-panel='sla-monitoring'].active").waitFor();
    await page.goForward();
    await page.locator("[data-panel='dashboard'].active").waitFor();
    await page.goto(`${frontendUrl}/sla-monitoring`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-panel='sla-monitoring'].active").waitFor();
    await page.locator("#slaCaseTable").getByText("SLA-QA-BREACHED", { exact: true }).waitFor();

    const police = await browser.newContext({ viewport: { width: 1280, height: 850 } });
    const policePage = await police.newPage(); monitor(policePage);
    await login(policePage, "police@rakshakai.local", "IsolatedSlaPolice-2026!");
    await policePage.goto(`${frontendUrl}/sla-monitoring`, { waitUntil: "domcontentloaded" });
    await policePage.locator("[data-panel='sla-monitoring'].active").waitFor();
    await policePage.locator("#slaMonitoringContent").waitFor({ state: "visible" });
    assert.equal(await policePage.locator("#slaKpiActive").textContent(), "4");
    assert.equal(await policePage.locator("#slaCaseTable").getByText("SLA-QA-REMOTE", { exact: true }).count(), 0);
    await police.close();

    const citizen = await browser.newContext({ viewport: { width: 1280, height: 850 } });
    const citizenPage = await citizen.newPage(); monitor(citizenPage);
    await login(citizenPage, "citizen@rakshakai.local", citizenPassword);
    await citizenPage.goto(`${frontendUrl}/sla-monitoring`, { waitUntil: "domcontentloaded" });
    await citizenPage.waitForFunction(() => document.body.dataset.view !== "sla-monitoring");
    assert.equal(await citizenPage.locator(".nav-item[data-view='sla-monitoring']").isHidden(), true);
    const unauthorizedStatus = await citizenPage.evaluate(async () => (await fetch("/api/sla/monitoring")).status);
    assert.equal(unauthorizedStatus, 403);
    await citizen.close();
    const allowlistedExpectedResponses = browserEvents.http.filter((entry) => {
      const url = new URL(entry.url);
      return (entry.status === 403 && url.pathname === "/api/sla/monitoring")
        || (entry.status === 409 && url.pathname === "/api/incidents/SLA-QA-APPROACHING/recommend-unit");
    });
    const unexpectedHttp = browserEvents.http.filter((entry) => !allowlistedExpectedResponses.includes(entry));
    const expected409Count = allowlistedExpectedResponses.filter((entry) => entry.status === 409).length;
    const expected403Count = allowlistedExpectedResponses.filter((entry) => entry.status === 403).length;
    const expectedConflictConsole = browserEvents.console.filter((message) => /status of 409 \(Conflict\)/i.test(message));
    const expectedForbiddenConsole = browserEvents.console.filter((message) => /status of 403 \(Forbidden\)/i.test(message));
    assert.equal(expectedConflictConsole.length, expected409Count, "every expected no-capacity response is explicitly observed");
    assert.equal(expectedForbiddenConsole.length, expected403Count, "every expected Citizen denial is explicitly observed");
    const unexpectedConsole = browserEvents.console.filter((message) => !/status of (?:403 \(Forbidden\)|409 \(Conflict\))/i.test(message));
    assert.deepEqual(browserEvents.page, []);
    assert.deepEqual(browserEvents.failedRequests, []);
    assert.deepEqual(unexpectedHttp, []);
    assert.deepEqual(unexpectedConsole, []);
    console.log(JSON.stringify({ result: "PASS", artifacts, viewportResults, databaseRows: persisted.length, persistedSlaAuditEvents: persistedAuditEvents, unauthorizedApiStatus: unauthorizedStatus, allowlistedExpectedResponses, browserEvents }, null, 2));
  } finally {
    await browser.close();
    await context.close();
    for (const child of children.reverse()) if (child.exitCode === null) child.kill("SIGTERM");
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
