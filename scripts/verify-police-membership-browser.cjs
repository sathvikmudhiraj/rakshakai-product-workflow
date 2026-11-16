const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const artifactDir = path.join(root, "artifacts", `police-membership-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-police-membership-"));
const dataFile = path.join(dataDir, "db.json");
const backendPort = 53000 + Math.floor(Math.random() * 500);
const frontendPort = 54000 + Math.floor(Math.random() * 500);
const backendUrl = `http://127.0.0.1:${backendPort}`;
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const children = [];

async function unusedPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(port)));
  });
}

async function waitReady(url, child) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Service exited early with code ${child.exitCode}`);
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Service did not become ready: ${url}`);
}

function start(command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  children.push(child);
  return child;
}

async function stopAll() {
  for (const child of children.reverse()) if (child.exitCode === null) child.kill("SIGTERM");
}

async function seedIsolatedJsonDatabase() {
  process.env.RAKSHAKAI_DATA_FILE = dataFile;
  process.env.DATABASE_URL = "";
  const { seedDb } = require(path.join(root, "backend", "services", "core.service.js"));
  const bcrypt = require(path.join(root, "backend", "node_modules", "bcryptjs"));
  const db = seedDb();
  db.users = [
    { id: "admin-e2e", name: "Isolated Admin", email: "admin-membership@example.test", role: "Admin", status: "active", active: true, passwordHash: bcrypt.hashSync("TestAdminPass1", 4), sessions: [] },
    { id: "sathvik-fixture", name: "sathvik", email: "sathvik-fixture@example.test", role: "Police Officer", status: "active", active: true },
    { id: "eligible-fixture", name: "Eligible Test Officer", email: "eligible-fixture@example.test", role: "Police Officer", status: "active", active: true, badgeId: "QA-ELIG-02", unitId: "FX-P-02" }
  ];
  db.policeStations = [{ id: "qa-station-02", name: "QA Station 02", stationCode: "QA-PS-02", operational: true }];
  db.officerRanks = [{ id: "qa-rank-inspector", name: "Inspector", code: "INSP", active: true }];
  db.responseUnits = [{ id: "qa-unit-fx-p-02", unitCode: "FX-P-02", unitName: "FX-P-02 QA Unit", stationId: "qa-station-02", operational: true, status: "available" }];
  db.policeOfficers = [{ id: "eligible-fixture", userId: "eligible-fixture", stationId: "qa-station-02", rankId: "qa-rank-inspector", badgeId: "QA-ELIG-02", active: true, dutyStatus: "on_duty", availabilityStatus: "available" }];
  db.responseUnitMembers = [];
  db.incidents = [];
  db.incidentOfficerAssignments = [];
  db.auditLogs = [];
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(db, null, 2));
}

async function main() {
  await unusedPort(backendPort);
  await unusedPort(frontendPort);
  fs.mkdirSync(artifactDir, { recursive: true });
  await seedIsolatedJsonDatabase();

  const backend = start(process.execPath, [path.join(root, "backend", "server.js")], root, {
    PORT: String(backendPort), NODE_ENV: "development", DATABASE_URL: "", RAKSHAKAI_DATA_FILE: dataFile,
    JWT_SECRET: "isolated-police-membership-e2e-secret", SKIP_STARTUP_DATA_REPAIR: "true", ESCALATION_SWEEP_INTERVAL_MS: "3600000"
  });
  await waitReady(`${backendUrl}/api/health`, backend);
  const viteCli = path.join(root, "frontend", "node_modules", "vite", "bin", "vite.js");
  const frontendCwd = path.join(root, "frontend");
  const build = spawnSync(process.execPath, [viteCli, "build"], {
    cwd: frontendCwd,
    env: { ...process.env, VITE_BACKEND_PROXY_TARGET: backendUrl },
    stdio: "inherit"
  });
  if (build.status !== 0) throw new Error(`Frontend build failed with status ${build.status}`);
  const frontend = start(process.execPath, [viteCli, "preview", "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort"], frontendCwd, {
    VITE_BACKEND_PROXY_TARGET: backendUrl
  });
  await waitReady(frontendUrl, frontend);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = { console: [], page: [], failedRequests: [], http: [] };
  page.on("console", (message) => { if (message.type() === "error") errors.console.push(message.text()); });
  page.on("pageerror", (error) => errors.page.push(error.message));
  page.on("requestfailed", (request) => errors.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }));
  page.on("response", (response) => { if (response.status() >= 400) errors.http.push({ url: response.url(), status: response.status() }); });
  page.on("dialog", (dialog) => dialog.accept());

  try {
    await page.goto(frontendUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#loginForm input[name='email']").fill("admin-membership@example.test");
    await page.locator("#loginForm input[name='password']").fill("TestAdminPass1");
    await page.locator("#loginForm button[type='submit']").click();
    await page.locator("#appShell:not(.app-hidden)").waitFor();
    await page.locator(".nav-group summary").filter({ hasText: "Administration" }).click();
    await page.locator(".nav-item[data-view='police-management']").click();
    const unitSelect = page.locator("#unitMembershipUnitSelect");
    await page.waitForFunction(() => [...document.querySelector("#unitMembershipUnitSelect").options].some((option) => option.value === "qa-unit-fx-p-02"));
    await unitSelect.selectOption("qa-unit-fx-p-02");
    await page.getByText("No members assigned to this unit.").waitFor();
    await page.locator("#unitMembershipPanel").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifactDir, "before-add-member.png") });

    await page.locator("#openUnitMembershipAdd").click();
    const officerSelect = page.locator("#unitMembershipAddForm select[name='officerUserId']");
    const missingProfileOption = officerSelect.locator("option[value='sathvik-fixture']");
    await page.waitForFunction(() => document.querySelector("#unitMembershipAddForm select[name='officerUserId'] option[value='sathvik-fixture']"));
    assert.match(await missingProfileOption.textContent(), /Ineligible/i);
    await officerSelect.selectOption("sathvik-fixture");
    await page.getByText("Cannot add sathvik: Police officer profile is missing; registered station and rank cannot be verified.").waitFor();
    assert.equal(await page.locator("#unitMembershipAddForm button[type='submit']").isDisabled(), true);
    await page.screenshot({ path: path.join(artifactDir, "ineligible-sathvik-reason.png") });
    const eligibleOption = officerSelect.locator("option[value='eligible-fixture']");
    await page.waitForFunction(() => document.querySelector("#unitMembershipAddForm select[name='officerUserId'] option[value='eligible-fixture']"));
    await officerSelect.selectOption("eligible-fixture");
    assert.equal(await page.locator("#unitMembershipAddForm button[type='submit']").isDisabled(), false);
    await page.locator("#unitMembershipAddForm select[name='role']").selectOption("commander");
    await page.screenshot({ path: path.join(artifactDir, "eligible-selection.png") });
    await page.locator("#unitMembershipAddForm button[type='submit']").click();
    await page.getByText("Member added successfully.").waitFor();
    await page.getByText("Role: commander").waitFor();
    await page.locator("#unitMembershipList [data-member-role]").selectOption("driver");
    await page.getByText("Role: driver").waitFor();
    await page.locator("#retryUnitMembership").click();
    await page.getByText("Role: driver").waitFor();
    await page.screenshot({ path: path.join(artifactDir, "after-role-change-refresh.png") });

    const memberId = await page.locator("#unitMembershipList [data-member-remove]").getAttribute("data-member-id");
    await page.locator("#unitMembershipList [data-member-remove]").click();
    await page.locator("#appConfirmDialog").waitFor();
    const removedResponse = page.waitForResponse((response) => response.url().includes(`/api/admin/response-units/qa-unit-fx-p-02/members/${memberId}`) && response.request().method() === "DELETE");
    await page.locator('#appConfirmDialog [data-confirm="yes"]').click();
    assert.equal((await removedResponse).status(), 200, "removal API must succeed after explicit confirmation");
    await page.getByText("No members assigned to this unit.").waitFor();
    const refreshResponse = page.waitForResponse((response) => response.url().endsWith("/api/admin/response-units/qa-unit-fx-p-02/members") && response.request().method() === "GET");
    await page.locator("#retryUnitMembership").click();
    const refreshed = await refreshResponse;
    assert.equal(refreshed.status(), 200);
    assert.deepEqual((await refreshed.json()).members, []);
    await page.getByText("No members assigned to this unit.").waitFor();
    await page.screenshot({ path: path.join(artifactDir, "after-remove-refresh.png") });

    const persisted = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    const actions = persisted.auditLogs.map((entry) => entry.action);
    assert.equal(persisted.responseUnitMembers.length, 0);
    assert.ok(actions.includes("unit_member_added"));
    assert.ok(actions.includes("unit_member_updated"));
    assert.ok(actions.includes("unit_member_removed"));
    assert.deepEqual(errors.page, []);
    assert.deepEqual(errors.failedRequests, []);
    assert.deepEqual(errors.http, []);
    console.log(JSON.stringify({ result: "BROWSER_E2E_PASS_JSON_FIXTURE_ONLY", steps: ["Admin login", "sathvik missing-profile reason shown and Add Member blocked", "eligible officer added", "role changed", "Refresh persisted role", "member removed", "Refresh confirmed removal", "isolated JSON persistence and three audit actions"], errors, artifactDir, databaseMode: "isolated JSON; PostgreSQL unavailable" }, null, 2));
  } finally {
    await browser.close();
    await stopAll();
  }
}

main().catch(async (error) => { console.error(error); await stopAll(); process.exitCode = 1; });
