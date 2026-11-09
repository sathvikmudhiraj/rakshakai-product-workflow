const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const artifactDir = path.join(root, "artifacts", `audit-logs-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-audit-e2e-"));
const seedFile = path.join(dataDir, "seed.json");
const adminPassword = "IsolatedAuditAdmin-73!";
const citizenPassword = "IsolatedAuditCitizen-73!";
const backendPort = 53000 + Math.floor(Math.random() * 500);
const frontendPort = 54000 + Math.floor(Math.random() * 500);
const backendUrl = `http://127.0.0.1:${backendPort}`;
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const databaseUrl = process.env.DATABASE_URL || "";
const children = [];
const browserErrors = { console: [], page: [], failedRequests: [], http: [] };

function assertIsolatedDatabaseUrl(raw) {
  const url = new URL(raw);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(url.hostname), "Audit E2E must use a loopback PostgreSQL host");
  assert.equal(database, "rakshakai_audit_e2e", "Audit E2E must target its dedicated disposable database");
}

function runNode(script, args, env = process.env) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, env, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${path.basename(script)} exited ${result.status}`);
}

function seedIsolatedDatabase() {
  assertIsolatedDatabaseUrl(databaseUrl);
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  runNode(path.join(root, "backend", "scripts", "migrate.js"), [], env);
  process.env.DATABASE_URL = databaseUrl;
  process.env.RAKSHAKAI_DATA_FILE = path.join(dataDir, "core-seed-only.json");
  const { seedDb } = require(path.join(root, "backend", "services", "core.service.js"));
  const db = seedDb();
  db.users = db.users.map((user) => ({
    ...user,
    email: user.role === "Admin" ? "admin.audit@example.test" : user.role === "Citizen" ? "citizen.audit@example.test" : user.email,
    active: true,
    status: "active"
  }));
  const stationId = "station_audit_e2e";
  const beatId = "beat_audit_e2e";
  db.policeStations = [{ id: stationId, stationCode: "AUDIT-01", stationId: "AUDIT-01", name: "Audit E2E Station", stationName: "Audit E2E Station", jurisdiction: "QA", operational: true }];
  db.policeBeats = [{ id: beatId, stationId, beatName: "Audit E2E Beat", name: "Audit E2E Beat", operational: true }];
  db.policeOfficers = [{ id: "u_police", userId: "u_police", stationId, beatId, rankId: "rank_si", badgeId: "QA-AUDIT-01", active: true, dutyStatus: "on_duty", availabilityStatus: "available" }];
  db.responseUnits = [{ id: "unit_audit_e2e", unitCode: "AUD-UNIT-01", name: "Audit E2E Unit", unitName: "Audit E2E Unit", stationId, beatId, status: "available", operational: true, unitType: "patrol" }];
  db.responseUnitMembers = [];
  db.unitCapabilities = [];
  const now = Date.now();
  const fixtures = Array.from({ length: 60 }, (_, index) => ({
    id: `audit_fixture_${String(index).padStart(3, "0")}`,
    actorId: "audit-fixture-actor",
    actorName: "Synthetic Audit Fixture",
    actorRole: "Admin",
    action: index % 3 === 0 ? "unit_assignment_fixture" : index % 3 === 1 ? "incident_status_fixture" : "police_account_fixture",
    incidentId: index % 3 === 1 ? `incident_fixture_${index}` : null,
    details: JSON.stringify({ reason: "Synthetic pagination fixture", fixtureIndex: index }),
    timestamp: new Date(now - index * 60_000).toISOString()
  }));
  fixtures.push({
    id: "audit_fixture_station_change",
    actorId: "audit-fixture-actor",
    actorName: "Synthetic Audit Fixture",
    actorRole: "Admin",
    action: "police_station_changed",
    incidentId: null,
    details: JSON.stringify({ officer: "Inspector Kavya Rao", officerId: "u_police", oldValue: "Station Before", newValue: "Audit E2E Station" }),
    timestamp: new Date(now).toISOString()
  });
  db.auditLogs = fixtures;
  fs.writeFileSync(seedFile, JSON.stringify(db, null, 2));
  const importEnv = {
    ...env,
    DATABASE_URL: databaseUrl,
    RAKSHAKAI_IMPORT_FILE: seedFile,
    SEED_ADMIN_PASSWORD: adminPassword,
    SEED_POLICE_PASSWORD: "IsolatedAuditPolice-73!",
    SEED_CITIZEN_PASSWORD: citizenPassword
  };
  runNode(path.join(root, "backend", "scripts", "import-json-to-postgres.js"), [], importEnv);
}

function start(command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  children.push(child);
  return child;
}

async function waitReady(url, child) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Service exited early with code ${child.exitCode}`);
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Service did not become ready: ${url}`);
}

async function unusedPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(port)));
  });
}

function auditResponse(page, predicate = () => true) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/api/audit-logs") && predicate(url.searchParams);
  });
}

async function stopChildren() {
  for (const child of children.reverse()) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
}

async function queryPersistedEvidence() {
  const { Pool } = require(path.join(root, "backend", "node_modules", "pg"));
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const audit = await pool.query("SELECT data FROM audit_logs WHERE data->>'action' = ANY($1::text[]) AND data->>'actorName' = $2 ORDER BY created_at DESC", [["unit_member_added", "unit_member_updated", "unit_member_removed", "police_station_changed"], "Admin Control Room"]);
    const station = await pool.query("SELECT data FROM audit_logs WHERE data->>'action' = $1 AND data->>'actorName' = $2 ORDER BY created_at DESC", ["police_station_changed", "Admin Control Room"]);
    const membership = await pool.query("SELECT data FROM response_unit_members WHERE unit_id = $1", ["unit_audit_e2e"]);
    return { auditRows: audit.rows.map((row) => row.data), stationRows: station.rows.map((row) => row.data), membershipCount: membership.rowCount };
  } finally { await pool.end(); }
}

async function main() {
  assert.ok(databaseUrl, "DATABASE_URL must point to the disposable audit E2E PostgreSQL container");
  await unusedPort(backendPort);
  await unusedPort(frontendPort);
  fs.mkdirSync(artifactDir, { recursive: true });
  seedIsolatedDatabase();

  const backend = start(process.execPath, [path.join(root, "backend", "server.js")], root, {
    PORT: String(backendPort), NODE_ENV: "development", DATABASE_URL: databaseUrl,
    JWT_SECRET: "isolated-audit-e2e-secret-with-at-least-32-characters", SKIP_STARTUP_DATA_REPAIR: "true",
    ESCALATION_SWEEP_INTERVAL_MS: "3600000", SLA_SWEEP_INTERVAL_MS: "3600000", FRONTEND_ORIGINS: frontendUrl
  });
  await waitReady(`${backendUrl}/api/health`, backend);
  const frontend = start(process.execPath, [path.join(root, "frontend", "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort"], path.join(root, "frontend"), {
    VITE_BACKEND_PROXY_TARGET: backendUrl
  });
  await waitReady(frontendUrl, frontend);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") browserErrors.console.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.page.push(error.message));
  page.on("requestfailed", (request) => browserErrors.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }));
  page.on("response", (response) => { if (response.status() >= 400) browserErrors.http.push({ url: response.url(), status: response.status() }); });

  try {
    await page.goto(frontendUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#loginForm input[name='email']").fill("admin.audit@example.test");
    await page.locator("#loginForm input[name='password']").fill(adminPassword);
    await page.locator("#loginForm button[type='submit']").click();
    await page.locator("#appShell:not(.app-hidden)").waitFor();
    await page.locator(".nav-group summary").filter({ hasText: "Administration" }).click();
    await page.locator(".nav-item[data-view='audit-logs']").click();
    await page.locator("#auditPageRange").filter({ hasText: "of 61" }).waitFor();
    assert.equal(await page.locator(".nav-item[data-view='audit-logs']").getAttribute("aria-current"), "page");
    assert.equal(await page.locator("#auditPageList .audit-page-card").count(), 25);
    assert.equal(await page.locator("#auditPageList").getByText("Officer", { exact: true }).count() > 0, true);
    await page.screenshot({ path: path.join(artifactDir, "audit-logs-desktop.png"), fullPage: true });

    const nextResponse = auditResponse(page, (params) => params.get("offset") === "25");
    await page.locator("#auditPageNext").click();
    await nextResponse;
    await page.locator("#auditPageRange").filter({ hasText: "26–50 of 61" }).waitFor();
    assert.equal(await page.locator("#auditPageList .audit-page-card").count(), 25);
    const previousResponse = auditResponse(page, (params) => params.get("offset") === "0");
    await page.locator("#auditPagePrevious").click();
    await previousResponse;
    await page.locator("#auditPageRange").filter({ hasText: "1–25 of 61" }).waitFor();

    await page.locator("#auditPageSearch").fill("Station Before");
    await page.locator("#auditPageCategory").selectOption("personnel");
    await page.locator("#auditPageActor").fill("Synthetic Audit Fixture");
    const today = new Date().toISOString().slice(0, 10);
    await page.locator("#auditPageFrom").fill(today);
    await page.locator("#auditPageTo").fill(today);
    const stationFilterResponse = auditResponse(page, (params) => params.get("search") === "Station Before" && params.get("category") === "personnel");
    await page.locator("#auditPageFilterForm button[type='submit']").click();
    await stationFilterResponse;
    await page.locator("#auditPageList").getByText("Station Before", { exact: true }).waitFor();
    await page.locator("#auditPageList").getByText("Audit E2E Station", { exact: true }).waitFor();
    assert.equal(await page.locator("#auditPageList .audit-page-card").count(), 1);
    await page.screenshot({ path: path.join(artifactDir, "audit-logs-filtered-station-change.png"), fullPage: true });
    const resetResponse = auditResponse(page, (params) => !params.has("search") && params.get("offset") === "0");
    await page.locator("#auditPageReset").click();
    await resetResponse;
    await page.locator("#auditPageRange").filter({ hasText: "of 61" }).waitFor();
    const refreshResponse = auditResponse(page, (params) => params.get("offset") === "0");
    await page.locator("#auditPageRefresh").click();
    await refreshResponse;
    await page.locator("#auditPageStatus").filter({ hasText: "loaded from the server" }).waitFor();

    const addMember = await page.evaluate(async () => {
      const response = await fetch("/api/admin/response-units/unit_audit_e2e/members", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ officerUserId: "u_police", role: "commander" })
      });
      return { status: response.status, body: await response.json() };
    });
    assert.equal(addMember.status, 201, JSON.stringify(addMember.body));
    const memberId = addMember.body.member.id;
    const postMemberRefresh = auditResponse(page, (params) => params.get("offset") === "0");
    await page.locator("#auditPageRefresh").click();
    await postMemberRefresh;
    await page.locator("#auditPageRange").filter({ hasText: "of 62" }).waitFor();
    await page.locator("#auditPageSearch").fill("AUD-UNIT-01");
    await page.locator("#auditPageCategory").selectOption("units");
    const memberFilterResponse = auditResponse(page, (params) => params.get("search") === "AUD-UNIT-01" && params.get("category") === "units");
    await page.locator("#auditPageFilterForm button[type='submit']").click();
    await memberFilterResponse;
    await page.locator("#auditPageList").getByText("Unit Member Added", { exact: true }).waitFor();
    await page.locator("#auditPageList").getByText("Inspector Kavya Rao", { exact: true }).first().waitFor();
    await page.locator("#auditPageList").getByText("commander", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(artifactDir, "audit-logs-postgres-member-audit.png"), fullPage: true });

    const changeRole = await page.evaluate(async (id) => {
      const response = await fetch(`/api/admin/response-units/unit_audit_e2e/members/${encodeURIComponent(id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "driver" })
      });
      return { status: response.status, body: await response.json() };
    }, memberId);
    assert.equal(changeRole.status, 200, JSON.stringify(changeRole.body));
    const roleChangeRefresh = auditResponse(page, (params) => params.get("offset") === "0");
    await page.locator("#auditPageRefresh").click();
    await roleChangeRefresh;
    await page.locator("#auditPageRange").filter({ hasText: "of 2" }).waitFor();

    const removeMember = await page.evaluate(async (id) => {
      const response = await fetch(`/api/admin/response-units/unit_audit_e2e/members/${encodeURIComponent(id)}`, { method: "DELETE" });
      return { status: response.status, body: await response.json() };
    }, memberId);
    assert.equal(removeMember.status, 200, JSON.stringify(removeMember.body));
    const removalRefresh = auditResponse(page, (params) => params.get("offset") === "0");
    await page.locator("#auditPageRefresh").click();
    await removalRefresh;
    await page.locator("#auditPageRange").filter({ hasText: "of 3" }).waitFor();
    await page.locator("#auditPageSearch").fill("u_police");
    await page.locator("#auditPageCategory").selectOption("units");
    const removalFilter = auditResponse(page, (params) => params.get("search") === "u_police" && params.get("category") === "units");
    await page.locator("#auditPageFilterForm button[type='submit']").click();
    await removalFilter;
    await page.locator("#auditPageList").getByText("Unit Member Updated", { exact: true }).waitFor();
    await page.locator("#auditPageList").getByText("Unit Member Removed", { exact: true }).waitFor();
    await page.locator("#auditPageList").getByText("driver", { exact: true }).first().waitFor();
    await page.screenshot({ path: path.join(artifactDir, "audit-logs-member-role-and-removal.png"), fullPage: true });

    const persisted = await queryPersistedEvidence();
    assert.deepEqual(new Set(persisted.auditRows.map((row) => row.action)), new Set(["unit_member_added", "unit_member_updated", "unit_member_removed"]));
    assert.equal(persisted.membershipCount, 0);
    assert.ok(persisted.auditRows.some((row) => row.action === "unit_member_added" && /AUD-UNIT-01/.test(row.details)));
    assert.equal(persisted.auditRows.find((row) => row.action === "unit_member_updated").details.includes("driver"), true);

    const createStation = await page.evaluate(async () => {
      const response = await fetch("/api/police-stations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stationId: "AUDIT-02", stationName: "Audit E2E Station 2", jurisdiction: "QA", operational: true })
      });
      return { status: response.status, body: await response.json() };
    });
    assert.equal(createStation.status, 201, JSON.stringify(createStation.body));
    const createBeat = await page.evaluate(async () => {
      const response = await fetch("/api/admin/police-beats", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Audit E2E Beat 2", code: "AUD-BEAT-02", stationId: "AUDIT-02", active: true })
      });
      return { status: response.status, body: await response.json() };
    });
    assert.equal(createBeat.status, 201, JSON.stringify(createBeat.body));
    const moveOfficer = await page.evaluate(async (createBeatId) => {
      const response = await fetch("/api/admin/police-users/u_police", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stationId: "AUDIT-02", beatId: createBeatId, rankId: "rank_si", badgeId: "QA-AUDIT-01" })
      });
      return { status: response.status, body: await response.json() };
    }, createBeat.body.record.id);
    assert.equal(moveOfficer.status, 200, JSON.stringify(moveOfficer.body));
    const stationRefresh = auditResponse(page, (params) => params.get("offset") === "0");
    await page.locator("#auditPageSearch").fill("Audit E2E Station 2");
    await page.locator("#auditPageCategory").selectOption("personnel");
    await page.locator("#auditPageActor").fill("Admin Control Room");
    await page.locator("#auditPageFilterForm button[type='submit']").click();
    await stationRefresh;
    await page.locator("#auditPageList").getByText("Audit E2E Station", { exact: true }).waitFor();
    await page.locator("#auditPageList").getByText("Audit E2E Station 2", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(artifactDir, "audit-logs-postgres-station-change.png"), fullPage: true });
    const stationEvidence = await queryPersistedEvidence();
    assert.equal(stationEvidence.stationRows.length, 1);
    assert.match(stationEvidence.stationRows[0].details, /Audit E2E Station/);
    await page.locator("#auditPageSearch").fill("");
    await page.locator("#auditPageCategory").selectOption("all");
    const allFilterResponse = auditResponse(page, (params) => !params.has("search") && params.get("offset") === "0");
    await page.locator("#auditPageFilterForm button[type='submit']").click();
    await allFilterResponse;
    await page.locator(".nav-item[data-view='dashboard']").click();
    await page.goBack();
    await page.locator("[data-panel='audit-logs'].active").waitFor();
    await page.goForward();
    await page.locator("[data-panel='dashboard'].active").waitFor();
    await page.goto(`${frontendUrl}/audit-logs`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-panel='audit-logs'].active").waitFor();
    const finalPage = await page.evaluate(async () => (await (await fetch("/api/audit-logs?limit=1")).json()).total);
    await page.locator("#auditPageRange").filter({ hasText: `of ${finalPage}` }).waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(artifactDir, "audit-logs-mobile.png"), fullPage: true });
    const mobileLayout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, list: document.querySelector("#auditPageList")?.scrollWidth || 0 }));
    assert.ok(mobileLayout.document <= mobileLayout.viewport, `Mobile horizontal overflow: ${JSON.stringify(mobileLayout)}`);

    const citizenContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const citizenPage = await citizenContext.newPage();
    citizenPage.on("console", (message) => { if (message.type() === "error") browserErrors.console.push(message.text()); });
    citizenPage.on("pageerror", (error) => browserErrors.page.push(error.message));
    citizenPage.on("requestfailed", (request) => browserErrors.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }));
    citizenPage.on("response", (response) => { if (response.status() >= 400) browserErrors.http.push({ url: response.url(), status: response.status() }); });
    await citizenPage.goto(frontendUrl, { waitUntil: "domcontentloaded" });
    await citizenPage.locator("#loginForm input[name='email']").fill("citizen.audit@example.test");
    await citizenPage.locator("#loginForm input[name='password']").fill(citizenPassword);
    await citizenPage.locator("#loginForm button[type='submit']").click();
    await citizenPage.locator("#appShell:not(.app-hidden)").waitFor();
    await citizenPage.waitForFunction(() => document.body.dataset.role === "Citizen");
    console.log("citizen_session_identity", await citizenPage.locator("#currentUser").textContent());
    await citizenPage.goto(`${frontendUrl}/audit-logs`, { waitUntil: "domcontentloaded" });
    await citizenPage.waitForFunction(() => document.body.dataset.role === "Citizen" && document.body.dataset.view !== "audit-logs");
    const citizenView = await citizenPage.evaluate(() => document.body.dataset.view);
    console.log("citizen_direct_route_resolved_to", citizenView);
    assert.notEqual(citizenView, "audit-logs");
    assert.equal(await citizenPage.locator(".nav-item[data-view='audit-logs']").isHidden(), true);
    const citizenApi = await citizenPage.evaluate(async () => (await fetch("/api/audit-logs?limit=25")).status);
    assert.equal(citizenApi, 403);
    await citizenContext.close();

    const expectedDeniedAuditResponses = browserErrors.http.filter((entry) => {
      const url = new URL(entry.url);
      return entry.status === 403 && url.pathname.endsWith("/api/audit-logs") && url.search === "?limit=25";
    });
    const unexpectedHttpErrors = browserErrors.http.filter((entry) => !expectedDeniedAuditResponses.includes(entry));
    const unexpectedConsoleErrors = browserErrors.console.filter((message) => !/status of 403 \(Forbidden\)/i.test(message));
    console.log(JSON.stringify({
      result: "PASS",
      storage: "isolated PostgreSQL in disposable tmpfs Docker container",
      intentionalFailureAllowlist: "Citizen's explicit GET /api/audit-logs?limit=25 receives HTTP 403",
      verified: ["admin route + active navigation", "61-row pagination", "search/category/actor/date filters", "refresh", "old/new station display", "member add/change/remove audited transactionally", "officer station change old/new values", "PostgreSQL audit and membership persistence", "Back/Forward", "direct route restoration", "390px no-horizontal-overflow", "Citizen route and API denied"],
      mobileLayout,
      browserErrors,
      screenshots: fs.readdirSync(artifactDir).map((name) => path.join(artifactDir, name))
    }, null, 2));
    assert.deepEqual(browserErrors.page, []);
    assert.deepEqual(browserErrors.failedRequests, []);
    assert.deepEqual(unexpectedHttpErrors.filter((entry) => entry.status >= 400), []);
    assert.deepEqual(unexpectedConsoleErrors, []);
  } finally {
    await browser.close();
    await stopChildren();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
