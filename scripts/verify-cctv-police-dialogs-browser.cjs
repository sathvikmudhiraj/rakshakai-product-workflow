const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const artifactDir = path.join(root, "artifacts", `cctv-police-a11y-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-cctv-police-a11y-"));
const dataFile = path.join(dataDir, "db.json");
const backendPort = 53500 + Math.floor(Math.random() * 400);
const frontendPort = 54500 + Math.floor(Math.random() * 400);
const backendUrl = `http://127.0.0.1:${backendPort}`;
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const children = [];
const credentials = { admin: "QaAdminPass1", police: "QaPolicePass1", citizen: "QaCitizenPass1" };

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

function seedIsolatedJsonDatabase() {
  process.env.RAKSHAKAI_DATA_FILE = dataFile;
  process.env.DATABASE_URL = "";
  const { seedDb } = require(path.join(root, "backend", "services", "core.service.js"));
  const bcrypt = require(path.join(root, "backend", "node_modules", "bcryptjs"));
  const db = seedDb();
  db.users = [
    { id: "qa-admin", name: "QA Admin", email: "qa-admin@example.test", role: "Admin", status: "active", active: true, passwordHash: bcrypt.hashSync(credentials.admin, 4), sessions: [] },
    { id: "qa-police", name: "QA Police", email: "qa-police@example.test", role: "Police Officer", status: "active", active: true, passwordHash: bcrypt.hashSync(credentials.police, 4), sessions: [] },
    { id: "qa-citizen", name: "QA Citizen", email: "qa-citizen@example.test", role: "Citizen", status: "active", active: true, passwordHash: bcrypt.hashSync(credentials.citizen, 4), sessions: [] }
  ];
  db.policeStations = [{ id: "qa-station-01", stationId: "PS-QA-01", stationName: "QA Station One", name: "QA Station One", source: "admin_registry", operational: true, jurisdiction: "QA Sector", beat: "North", lat: 17.51, lng: 78.32, address: "QA test only" }];
  db.responseUnits = [{ id: "qa-unit-01", unitId: "UNIT-QA-01", unitCode: "UNIT-QA-01", unitName: "QA Existing Unit", name: "QA Existing Unit", unitType: "police_patrol", linkedStationId: "PS-QA-01", stationId: "PS-QA-01", stationName: "QA Station One", source: "admin_registry", status: "available", operational: true, lat: 17.52, lng: 78.33 }];
  db.responseUnitMembers = [];
  db.policeOfficers = [];
  db.incidents = [];
  db.incidentOfficerAssignments = [];
  db.auditLogs = [];
  db.cameraSources = [
    { id: "qa-camera-online", cameraId: "QA-CAM-ONLINE", name: "QA Online Camera", type: "rtsp", sourceType: "rtsp", location: "QA Gate", healthStatus: "ONLINE", healthSeverity: "NORMAL", status: "online", streamState: "STREAMING", streamUrl: "rtsp://fixture-user:fixture-secret@camera.invalid/live", username: "fixture-user", password: "fixture-secret" },
    { id: "qa-camera-offline", cameraId: "QA-CAM-OFFLINE", name: "QA Offline Camera", type: "rtsp", sourceType: "rtsp", location: "QA Road", healthStatus: "OFFLINE", healthSeverity: "HIGH", status: "offline", streamState: "OFFLINE" },
    { id: "qa-camera-warning", cameraId: "QA-CAM-WARNING", name: "QA Warning Camera", type: "rtsp", sourceType: "rtsp", location: "QA Yard", healthStatus: "LOW_FPS", healthSeverity: "MEDIUM", status: "warning", streamState: "STREAMING" },
    { id: "qa-camera-error", cameraId: "QA-CAM-ERROR", name: "QA Error Camera", type: "rtsp", sourceType: "rtsp", location: "QA Store", healthStatus: "STORAGE_ERROR", healthSeverity: "HIGH", status: "warning", streamState: "STREAMING" }
  ];
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(db, null, 2));
}

async function login(page, email, password) {
  await page.goto(frontendUrl, { waitUntil: "domcontentloaded" });
  await page.locator("#loginForm input[name='email']").fill(email);
  await page.locator("#loginForm input[name='password']").fill(password);
  await page.locator("#loginForm button[type='submit']").click();
  await page.locator("#appShell:not(.app-hidden)").waitFor();
}

async function openView(page, view) {
  const nav = page.locator(`.nav-item[data-view='${view}']`).first();
  if (!(await nav.isVisible()) && await page.locator("#mobileMoreButton").isVisible()) await page.locator("#mobileMoreButton").click();
  const group = nav.locator("xpath=ancestor::details[1]");
  if (await group.count() && !(await group.evaluate((element) => element.open))) await group.locator("summary").click();
  await nav.click();
}

async function assertNoHorizontalOverflow(page, label) {
  const sizes = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(sizes.document <= sizes.width + 1, `${label} horizontal overflow: ${JSON.stringify(sizes)}`);
}

async function main() {
  await unusedPort(backendPort);
  await unusedPort(frontendPort);
  fs.mkdirSync(artifactDir, { recursive: true });
  seedIsolatedJsonDatabase();

  const backend = start(process.execPath, [path.join(root, "backend", "server.js")], root, {
    PORT: String(backendPort), NODE_ENV: "development", DATABASE_URL: "", RAKSHAKAI_DATA_FILE: dataFile,
    JWT_SECRET: "isolated-cctv-police-a11y-e2e-secret", CAMERA_CREDENTIAL_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    SKIP_STARTUP_DATA_REPAIR: "true", ESCALATION_SWEEP_INTERVAL_MS: "3600000"
  });
  await waitReady(`${backendUrl}/api/health`, backend);
  const frontend = start(process.execPath, [path.join(root, "frontend", "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort"], path.join(root, "frontend"), { VITE_BACKEND_PROXY_TARGET: backendUrl });
  await waitReady(frontendUrl, frontend);

  const browser = await chromium.launch({ headless: true });
  const errors = { console: [], expectedConsole: [], page: [], failedRequests: [], http: [] };
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text() === "Failed to load resource: the server responded with a status of 400 (Bad Request)") errors.expectedConsole.push(message.text());
    else errors.console.push(message.text());
  });
  page.on("pageerror", (error) => errors.page.push(error.message));
  page.on("requestfailed", (request) => { if (new URL(request.url()).hostname === "127.0.0.1") errors.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }); });
  page.on("response", (response) => {
    const url = new URL(response.url());
    const expectedValidation = [400, 403, 409].includes(response.status()) && ["/api/response-units", "/api/police-stations"].includes(url.pathname);
    if (response.status() >= 400 && url.hostname === "127.0.0.1" && !expectedValidation) errors.http.push({ url: response.url(), status: response.status() });
  });

  try {
    await page.goto(frontendUrl, { waitUntil: "domcontentloaded" });
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.className), "skip-link");
    assert.equal(await page.locator(".skip-link").isVisible(), true);
    await login(page, "qa-admin@example.test", credentials.admin);
    await page.locator(".skip-link").focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => document.activeElement.id), "workspace");
    const healthResponse = await page.evaluate(async () => {
      const response = await fetch("/api/camera-health");
      return { status: response.status, body: await response.json() };
    });
    assert.equal(healthResponse.status, 200);
    assert.ok(healthResponse.body.cameras.length >= 4);
    for (const id of ["qa-camera-online", "qa-camera-offline", "qa-camera-warning", "qa-camera-error"]) {
      assert.ok(healthResponse.body.cameras.some((camera) => camera.id === id), `${id} must come from the health API`);
    }
    assert.ok(!JSON.stringify(healthResponse.body).includes("fixture-secret"));
    assert.ok(!JSON.stringify(healthResponse.body).includes("rtsp://"));

    await openView(page, "cctv");
    assert.equal(await page.locator(".nav-item[aria-current='page']:visible").count(), 1, "only one visible main-navigation item may be current");
    const tabIds = await page.locator("[data-cctv-tab]").evaluateAll((tabs) => tabs.map((tab) => ({ id: tab.id, controls: tab.getAttribute("aria-controls") })));
    const panelIds = await page.locator("[role='tabpanel']").evaluateAll((panels) => panels.map((panel) => ({ id: panel.id, label: panel.getAttribute("aria-labelledby") })));
    assert.equal(new Set(tabIds.map((item) => item.id)).size, tabIds.length);
    assert.equal(new Set(tabIds.map((item) => item.controls)).size, tabIds.length);
    assert.equal(new Set(panelIds.map((item) => item.id)).size, panelIds.length);
    assert.ok(tabIds.every((tab) => panelIds.some((panel) => panel.id === tab.controls && panel.label === tab.id)));
    await page.locator("#cctvTabHealth").click();
    assert.equal(await page.locator("#cctvTabHealth").getAttribute("aria-selected"), "true");
    assert.equal(await page.locator("#cctvHealthPanel").isVisible(), true);
    assert.equal(await page.locator("#cctvCameraPanel").isVisible(), false);
    assert.equal(await page.locator("#cctvReviewPanel").isVisible(), false);
    const healthRowCount = await page.locator("#cameraHealthGrid [data-camera-id]").count();
    assert.ok(healthRowCount >= 4);
    for (const [id, state] of [["qa-camera-online", "HEALTH ONLINE"], ["qa-camera-offline", "HEALTH OFFLINE"], ["qa-camera-warning", "HEALTH WARNING"], ["qa-camera-error", "HEALTH ERROR"]]) {
      assert.equal(await page.locator(`#cameraHealthGrid [data-camera-id='${id}']`).getByText(state).count(), 1);
    }
    await page.locator("#cameraHealthFilters [data-camera-filter='status']").selectOption("warning");
    assert.deepEqual(await page.locator("#cameraHealthGrid [data-camera-id]").evaluateAll((rows) => rows.map((row) => row.dataset.cameraId)), ["qa-camera-warning"]);
    await page.locator("#cameraHealthFilters [data-camera-filter='status']").selectOption("all");
    await page.locator("#cctvTabReview").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#cctvTabHealth").getAttribute("aria-selected"), "true");
    await page.keyboard.press("Home");
    assert.equal(await page.locator("#cctvTabCameras").getAttribute("aria-selected"), "true");
    await page.locator("#cctvTabHealth").click();
    assert.equal(await page.locator("#cameraHealthGrid [data-camera-id]").count(), healthRowCount, "tab switching must not duplicate camera rows");
    await page.screenshot({ path: path.join(artifactDir, "cctv-health-desktop.png"), fullPage: true });

    await openView(page, "settings");
    await page.locator("[data-settings-section='police-units']").click();
    const addUnit = page.locator("#addUnitRegistry");
    await addUnit.click();
    const unitDialog = page.locator("#unitRegistryDialog");
    assert.equal(await unitDialog.evaluate((dialog) => dialog.open), true);
    assert.equal(await unitDialog.evaluate((dialog) => dialog.matches(":modal")), true);
    assert.ok(await page.locator("#unitRegistryForm input[name='unitId']").evaluate((input) => input === document.activeElement));
    await page.locator("#unitRegistryForm input[name='unitId']").focus();
    await page.keyboard.press("Shift+Tab");
    assert.ok(await unitDialog.evaluate((dialog) => dialog.contains(document.activeElement)), "Shift+Tab must remain in the modal");
    await page.locator("#addStationRegistry").focus();
    assert.ok(await unitDialog.evaluate((dialog) => dialog.contains(document.activeElement)), "focus cannot escape an open modal");
    await page.screenshot({ path: path.join(artifactDir, "unit-add-desktop.png"), fullPage: true });
    assert.equal(await page.locator("#unitRegistryForm").evaluate((form) => form.checkValidity()), false, "required unit fields must validate");
    await page.keyboard.press("Escape");
    assert.equal(await unitDialog.evaluate((dialog) => dialog.open), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), "addUnitRegistry", "Escape must restore focus to the opener");

    await addUnit.click();
    await page.locator("#unitRegistryForm input[name='unitId']").fill("UNIT-QA-NEW");
    await page.locator("#unitRegistryForm input[name='unitName']").fill("QA Added Patrol");
    await page.locator("#unitRegistryForm input[name='lat']").fill("999");
    await page.locator("#unitRegistryForm input[name='lng']").fill("999");
    await page.locator("#unitRegistryForm button[type='submit']").click();
    await page.getByText("Valid unit latitude and longitude are required").waitFor();
    await page.locator("#resetUnitRegistryForm").click();
    assert.equal(await page.evaluate(() => document.activeElement.id), "addUnitRegistry");

    await addUnit.click();
    const unitForm = page.locator("#unitRegistryForm");
    await unitForm.locator("input[name='unitId']").fill("UNIT-QA-NEW");
    await unitForm.locator("input[name='unitName']").fill("QA Added Patrol");
    await unitForm.locator("select[name='linkedStationId']").selectOption("PS-QA-01");
    await unitForm.locator("input[name='lat']").fill("17.53");
    await unitForm.locator("input[name='lng']").fill("78.34");
    await unitForm.locator("input[name='address']").fill("QA-only address");
    await page.screenshot({ path: path.join(artifactDir, "unit-add-filled-desktop.png"), fullPage: true });
    await unitForm.locator("button[type='submit']").click();
    await page.getByText("Unit created.").waitFor();
    const newUnitCard = page.locator("#unitRegistryList .unit-registry-card").filter({ hasText: "UNIT-QA-NEW" });
    await newUnitCard.waitFor();
    await newUnitCard.getByRole("button", { name: "Edit" }).click();
    assert.equal(await unitDialog.evaluate((dialog) => dialog.open), true);
    assert.equal(await unitForm.locator("input[name='unitName']").inputValue(), "QA Added Patrol");
    await page.screenshot({ path: path.join(artifactDir, "unit-edit-desktop.png"), fullPage: true });
    await unitForm.locator("input[name='unitName']").fill("QA Edited Patrol");
    await unitForm.locator("button[type='submit']").click();
    await page.getByText("Unit updated.").waitFor();
    await page.locator("#unitRegistryList").getByText("UNIT-QA-NEW - QA Edited Patrol").waitFor();

    await page.locator("[data-settings-section='police-stations']").click();
    const addStation = page.locator("#addStationRegistry");
    const stationDialog = page.locator("#stationRegistryDialog");
    await addStation.click();
    assert.equal(await stationDialog.evaluate((dialog) => dialog.open), true);
    assert.ok(await page.locator("#stationRegistryForm input[name='stationId']").evaluate((input) => input === document.activeElement));
    await page.screenshot({ path: path.join(artifactDir, "station-add-desktop.png"), fullPage: true });
    await page.keyboard.press("Escape");
    assert.equal(await stationDialog.evaluate((dialog) => dialog.open), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), "addStationRegistry");

    await addStation.click();
    const stationForm = page.locator("#stationRegistryForm");
    await stationForm.locator("input[name='stationId']").fill("PS-QA-NEW");
    await stationForm.locator("input[name='stationName']").fill("QA Added Station");
    await stationForm.locator("input[name='lat']").fill("17.54");
    await stationForm.locator("input[name='lng']").fill("78.35");
    await stationForm.locator("input[name='address']").fill("QA-only station address");
    await page.screenshot({ path: path.join(artifactDir, "station-add-filled-desktop.png"), fullPage: true });
    await stationForm.locator("button[type='submit']").click();
    await page.getByText("Station created.").waitFor();
    const newStationCard = page.locator("#stationRegistryList .unit-registry-card").filter({ hasText: "PS-QA-NEW" });
    await newStationCard.waitFor();
    await newStationCard.getByRole("button", { name: "Edit" }).click();
    assert.equal(await stationDialog.evaluate((dialog) => dialog.open), true);
    assert.equal(await stationForm.locator("input[name='stationName']").inputValue(), "QA Added Station");
    await page.screenshot({ path: path.join(artifactDir, "station-edit-desktop.png"), fullPage: true });
    await stationForm.locator("input[name='stationName']").fill("QA Edited Station");
    await stationForm.locator("button[type='submit']").click();
    await page.getByText("Station updated.").waitFor();
    await page.locator("#stationRegistryList").getByText("PS-QA-NEW - QA Edited Station").waitFor();

    const persistedAfterRefresh = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    assert.equal(persistedAfterRefresh.responseUnits.find((item) => item.unitId === "UNIT-QA-NEW").unitName, "QA Edited Patrol");
    assert.equal(persistedAfterRefresh.responseUnits.find((item) => item.id === "qa-unit-01").linkedStationId, "PS-QA-01");
    assert.equal(persistedAfterRefresh.policeStations.find((item) => item.stationId === "PS-QA-NEW").stationName, "QA Edited Station");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appShell:not(.app-hidden)").waitFor();
    await openView(page, "settings");
    await page.locator("[data-settings-section='police-stations']").click();
    await page.locator("#stationRegistryList").getByText("PS-QA-NEW - QA Edited Station").waitFor();
    await page.locator("[data-settings-section='police-units']").click();
    await page.locator("#unitRegistryList").getByText("UNIT-QA-NEW - QA Edited Patrol").waitFor();

    for (const viewport of [{ width: 768, height: 1024, name: "tablet" }, { width: 390, height: 844, name: "mobile" }]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openView(page, "cctv");
      await page.locator("#cctvTabHealth").click();
      await assertNoHorizontalOverflow(page, `CCTV ${viewport.name}`);
      await page.screenshot({ path: path.join(artifactDir, `cctv-health-${viewport.name}.png`), fullPage: true });
      await openView(page, "settings");
      if (viewport.width <= 760) await page.locator("#settingsSectionSelect").selectOption("police-units");
      else await page.locator("[data-settings-section='police-units']").click();
      await page.locator("#addUnitRegistry").click();
      await assertNoHorizontalOverflow(page, `unit dialog ${viewport.name}`);
      const modalBounds = await page.locator("#unitRegistryForm").evaluate((form) => {
        const modal = form.closest(".settings-form-modal");
        return { height: modal.clientHeight, scrollHeight: modal.scrollHeight, saveVisible: form.querySelector("button[type=submit]").getBoundingClientRect().width > 0 };
      });
      assert.ok(modalBounds.saveVisible);
      await page.locator("#unitRegistryForm button[type='submit']").scrollIntoViewIfNeeded();
      await page.locator("#resetUnitRegistryForm").scrollIntoViewIfNeeded();
      if (viewport.name === "mobile") await page.screenshot({ path: path.join(artifactDir, "unit-dialog-mobile.png"), fullPage: true });
      await page.locator("#resetUnitRegistryForm").click();
      if (viewport.width <= 760) await page.locator("#settingsSectionSelect").selectOption("police-stations");
      else await page.locator("[data-settings-section='police-stations']").click();
      await page.locator("#addStationRegistry").click();
      await assertNoHorizontalOverflow(page, `station dialog ${viewport.name}`);
      if (viewport.name === "mobile") await page.screenshot({ path: path.join(artifactDir, "station-dialog-mobile.png"), fullPage: true });
      await page.locator("#resetStationRegistryForm").click();
    }

    const isolatedDb = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    const unauthorizedResults = {};
    for (const role of ["police", "citizen"]) {
      const rolePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const email = `qa-${role}@example.test`;
      await login(rolePage, email, credentials[role]);
      unauthorizedResults[role] = await rolePage.evaluate(async () => {
        const post = async (path, body) => (await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).status;
        const get = async (path) => (await fetch(path)).status;
        return {
          cameraHealth: await get("/api/camera-health"),
          createUnit: await post("/api/response-units", { unitId: "UNAUTHORIZED-QA", unitName: "Must Not Persist" }),
          createStation: await post("/api/police-stations", { stationId: "PS-UNAUTHORIZED-QA", stationName: "Must Not Persist" }),
          unitEdit: await fetch("/api/response-units/qa-unit-01", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unitName: "Must Not Persist" }) }).then((response) => response.status),
          stationEdit: await fetch("/api/police-stations/qa-station-01", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stationName: "Must Not Persist" }) }).then((response) => response.status),
          adminNavigationVisible: !document.querySelector(".nav-item[data-view='police-management']")?.hidden
        };
      });
      assert.equal(unauthorizedResults[role].createUnit, 403);
      assert.equal(unauthorizedResults[role].createStation, 403);
      assert.equal(unauthorizedResults[role].unitEdit, 403);
      assert.equal(unauthorizedResults[role].stationEdit, 403);
      assert.equal(unauthorizedResults[role].cameraHealth, role === "police" ? 200 : 403);
      assert.equal(unauthorizedResults[role].adminNavigationVisible, false);
      await rolePage.close();
    }
    const finalDb = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    assert.deepEqual(finalDb.responseUnits.map((item) => item.unitName).sort(), isolatedDb.responseUnits.map((item) => item.unitName).sort());
    assert.deepEqual(finalDb.policeStations.map((item) => item.stationName).sort(), isolatedDb.policeStations.map((item) => item.stationName).sort());
    assert.deepEqual(errors.console, []);
    assert.deepEqual(errors.page, []);
    assert.deepEqual(errors.failedRequests, []);
    assert.deepEqual(errors.http, []);

    console.log(JSON.stringify({ result: "BROWSER_E2E_PASS_ISOLATED_JSON_FIXTURE", checks: ["CCTV health API and safe response", "unique tab/panel relationships and keyboard navigation", "online/offline/warning/error labels and filters", "unit create/edit/validation/escape/focus/persistence", "station create/edit/escape/focus/persistence", "responsive desktop/tablet/mobile layouts", "police and citizen API role denial"], unauthorizedResults, errors, artifactDir, databaseMode: "isolated JSON only; PostgreSQL not used" }, null, 2));
  } finally {
    await browser.close();
    await stopAll();
  }
}

main().catch(async (error) => { console.error(error); await stopAll(); process.exitCode = 1; });
