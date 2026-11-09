const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const artifacts = path.join(root, "artifacts", `incident-map-overlay-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const supportGeometry = { type: "LineString", coordinates: [[78.32, 17.51], [78.36, 17.53], [78.39, 17.56]] };
const roadGeometry = { type: "LineString", coordinates: [[78.31, 17.51], [78.35, 17.54], [78.40, 17.58]] };
const incidents = [
  { id: "overlay-incident-a", incidentId: "QA-A", title: "Overlay route fixture A", category: "Emergency", severity: "HIGH", status: "Verified", lat: 17.53, lng: 78.35, locationStatus: "Verified", assignedUnitId: null, timeline: [], dispatchRecommendation: { id: "rec-a", incidentId: "overlay-incident-a", status: "recommended", stationSupport: { allocations: [{ stationName: "Synthetic Station", lat: 17.51, lng: 78.32, route: { id: "support-a", provider: "osrm", isApproximate: true, geometry: supportGeometry } }] } } },
  { id: "overlay-incident-b", incidentId: "QA-B", title: "Overlay route fixture B", category: "Emergency", severity: "MEDIUM", status: "Verified", lat: 17.54, lng: 78.36, locationStatus: "Verified", assignedUnitId: null, timeline: [] }
];
const units = [{ id: "overlay-unit-a", unitCode: "QA-UNIT-A", status: "available", lat: 17.51, lng: 78.32, assignedIncidentId: null }];
const admin = { id: "browser-admin", name: "Overlay Test Admin", role: "Admin", email: "overlay@example.test" };
const browserErrors = { page: [], console: [], failed: [] };
let server;

function listenPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}
function startVite(port) {
  const child = spawn(process.execPath, [path.join(root, "frontend", "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: path.join(root, "frontend"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}
async function waitReady(url, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite exited with code ${child.exitCode}`);
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Vite did not become ready: ${url}`);
}
function payload(pathname, method, body = {}) {
  if (pathname.endsWith("/auth/me")) return { user: admin };
  if (pathname.endsWith("/auth/login")) return { user: admin };
  if (pathname.endsWith("/dashboard")) return { summary: {} };
  if (pathname.endsWith("/missing-persons")) return { reports: [] };
  if (pathname.endsWith("/zones")) return { zones: [] };
  if (pathname.endsWith("/incidents/history")) return { incidents: [] };
  if (pathname.endsWith("/incidents")) return { incidents };
  if (pathname.endsWith("/alerts")) return { alerts: [] };
  if (pathname.endsWith("/response-units")) return { units };
  if (pathname.endsWith("/police-stations")) return { stations: [], defaultCenter: { lat: 17.53, lng: 78.35 } };
  if (pathname.endsWith("/device-health")) return { devices: [] };
  if (pathname.endsWith("/audit-logs")) return { auditLogs: [] };
  if (pathname.endsWith("/integrations/status")) return { integrations: [] };
  if (pathname.endsWith("/police-users")) return { users: [] };
  if (pathname.endsWith("/escalation/alerts")) return { alerts: [] };
  if (pathname.endsWith("/sla/config")) return { config: [] };
  if (pathname.endsWith("/cameras/sources")) return { cameras: [], sources: [], videoEvidence: [] };
  if (pathname.endsWith("/ai/health")) return { status: "not_configured" };
  if (pathname.endsWith("/ai/observations")) return { observations: [] };
  if (pathname.endsWith("/erss/events")) return { events: [] };
  if (pathname.endsWith("/maps/route") && method === "POST") return { provider: "osrm", isApproximate: false, routes: [{ id: "browser-road-route", provider: "osrm", isApproximate: false, distanceKm: 6.2, durationMinutes: 9, geometry: roadGeometry }] };
  if (pathname.endsWith("/maps/reverse")) return { address: "Synthetic map point" };
  if (pathname.endsWith("/maps/snap")) return { snapped: false, lat: Number(body.lat), lng: Number(body.lng) };
  return {};
}
async function attachApiMocks(context) {
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body = {};
    try { body = request.postDataJSON() || {}; } catch {}
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload(url.pathname, request.method(), body)) });
  });
  await context.route(/https?:\/\/[^/]*(openstreetmap|arcgisonline|cartocdn|unpkg\.com).*\.(png|jpg|jpeg|svg)(\?.*)?$/i, async (route) => {
    await route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=", "base64") });
  });
}
async function openApp(browser, baseUrl, { emulatePreviousOverlay = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await attachApiMocks(context);
  if (emulatePreviousOverlay) {
    await context.route("**/src/app.js*", async (route) => {
      const response = await route.fetch();
      const original = await response.text();
      const oldRender = original.replace("const showSupportRoutes = state.mapLayers.responseUnits || state.mapLayers.policeStations;", "const showSupportRoutes = true;");
      assert.notEqual(oldRender, original, "Previous overlay behavior must be present for before screenshot");
      await route.fulfill({ response, body: oldRender });
    });
  }
  const page = await context.newPage();
  page.on("pageerror", (error) => browserErrors.page.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.console.push(message.text()); });
  page.on("requestfailed", (request) => browserErrors.failed.push({ url: request.url(), reason: request.failure()?.errorText }));
  await page.goto(`${baseUrl}/incident-command`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-panel='incident-command'].active").waitFor({ timeout: 30000 });
  await page.locator("#commandMap .leaflet-route-line.station-support").first().waitFor({ timeout: 15000 });
  return { context, page };
}
async function setOverlays(page, enabled) {
  for (const key of ["incidents", "responseUnits"]) {
    const checkbox = page.locator(`#commandMap input[data-map-layer-toggle='${key}']`);
    if (await checkbox.isChecked() !== enabled) await checkbox.setChecked(enabled);
  }
}

async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  const port = await listenPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  server = startVite(port);
  await waitReady(baseUrl, server);
  const browser = await chromium.launch({ headless: true });
  try {
    const before = await openApp(browser, baseUrl, { emulatePreviousOverlay: true });
    await setOverlays(before.page, false);
    const originalLines = before.page.locator("#commandMap .leaflet-route-line.station-support");
    await originalLines.first().waitFor();
    await before.page.screenshot({ path: path.join(artifacts, "before-unwanted-dotted-line.png"), fullPage: true });
    assert.equal(await before.page.locator("#commandMap input[data-map-layer-toggle='incidents']").isChecked(), false);
    assert.equal(await before.page.locator("#commandMap input[data-map-layer-toggle='responseUnits']").isChecked(), false);
    assert.equal(incidents.filter((incident) => incident.assignedUnitId).length, 0);
    console.log("BEFORE reproduction: unwanted station-support line visible with no selection, zero assignments and both overlays disabled");
    await before.context.close();

    const { context, page } = await openApp(browser, baseUrl);
    await setOverlays(page, false);
    await page.waitForTimeout(500);
    assert.equal(await page.locator("#commandMap .leaflet-route-line.station-support").count(), 0, "No support line with both overlays disabled");
    await page.screenshot({ path: path.join(artifacts, "after-no-stale-command-route.png"), fullPage: true });

    await setOverlays(page, true);
    await page.locator("#commandMap .leaflet-route-line.station-support").first().waitFor();
    assert.equal(await page.locator("#commandMap .leaflet-route-line.station-support").count(), 1, "Active support route remains available when operational overlays are visible");
    await page.locator("#commandIncidentQueue .command-incident-row").filter({ hasText: "Overlay route fixture B" }).click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#commandMap .leaflet-route-line.station-support").count(), 0, "Switching to an incident without support data removes the previous incident route");
    await page.locator("#commandIncidentQueue .command-incident-row").filter({ hasText: "Overlay route fixture A" }).click();
    await page.locator("#commandMap .leaflet-route-line.station-support").first().waitFor();

    await page.locator(".nav-item[data-view='gis']").click();
    await page.locator("[data-panel='gis'].active").waitFor();
    await page.locator("#gisMap .leaflet-route-line.station-support").first().waitFor();
    await page.locator("#setMapStart").click();
    await page.locator("#gisMap .leaflet-host").click({ position: { x: 130, y: 170 } });
    await page.locator("#setMapDestination").click();
    await page.locator("#gisMap .leaflet-host").click({ position: { x: 310, y: 230 } });
    await page.locator("#navigateMap").waitFor({ state: "visible" });
    await page.locator("#navigateMap").click();
    await page.locator("#gisMap .leaflet-route-line.selected").waitFor({ timeout: 10000 });
    await page.screenshot({ path: path.join(artifacts, "valid-gis-route-visible.png"), fullPage: true });
    assert.equal(await page.locator("#gisMap .leaflet-route-line.selected").count(), 1, "Valid GIS route geometry is rendered");

    await page.locator(".nav-item[data-view='incident-command']").click();
    await page.locator("[data-panel='incident-command'].active").waitFor();
    await page.locator(".nav-item[data-view='dashboard']").click();
    await page.locator("[data-panel='dashboard'].active").waitFor();
    await page.locator(".nav-item[data-view='incident-command']").click();
    await page.locator("[data-panel='incident-command'].active").waitFor();
    await setOverlays(page, false);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("[data-panel='incident-command'].active").waitFor();
    await setOverlays(page, false);
    await page.waitForTimeout(500);
    assert.equal(await page.locator("#commandMap .leaflet-route-line.station-support").count(), 0, "Refresh with overlays disabled has no stale support route");
    assert.equal(await page.locator("#commandMap .leaflet-route-line.selected").count(), 0, "Navigation route does not leak into an unassigned Incident Command view");
    await page.screenshot({ path: path.join(artifacts, "after-return-refresh-no-stale-line.png"), fullPage: true });
    await context.close();

    console.log(JSON.stringify({
      result: "PASS",
      isolation: "Vite + Playwright API fixtures; no backend or database connection",
      checked: ["before reproduction", "empty incident/unit overlays", "support route overlay visibility", "incident switching", "independent GIS route geometry", "navigate away and back", "refresh cleanup"],
      browserErrors,
      screenshots: fs.readdirSync(artifacts).map((name) => path.join(artifacts, name))
    }, null, 2));
    assert.deepEqual(browserErrors.page, []);
    assert.deepEqual(browserErrors.failed.filter((entry) => !entry.url.includes("socket.io")), []);
  } finally {
    await browser.close();
    if (server && server.exitCode === null) server.kill();
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
