const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.RAKSHAKAI_URL || "http://localhost:3001";
const root = path.join(__dirname, "..");
const sessionPath = path.join(os.tmpdir(), "rakshakai-live-ui-sessions", "admin.json");
const outputDir = path.join(root, "artifacts", `live-gis-route-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const events = { consoleErrors: [], pageErrors: [], failedRequests: [] };

async function searchPlace(page, query, expected) {
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/maps/search");
  await page.locator('#gisMap input[aria-label="Search place on map"]').fill(query);
  await page.locator('#gisMap .map-search button[type="submit"]').click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, `Place search failed (${response.status()})`);
  const body = await response.json();
  assert.ok(body.results?.length, `No live geocoder results for ${query}`);
  const result = body.results.find((place) => expected.test(place.label || place.displayName || place.name)) || body.results[0];
  await page.locator("#gisMap .map-search-result").nth(body.results.indexOf(result)).click();
  await page.locator("#gisMap .selected-location-card:not([hidden])").waitFor({ state: "visible" });
  return { result, provider: body.provider };
}

async function main() {
  assert.ok(fs.existsSync(sessionPath), "Reuse the existing Admin browser session; do not sign in again");
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, storageState: sessionPath });
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") events.consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => events.pageErrors.push(error.message));
  page.on("requestfailed", (request) => events.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  try {
    await page.goto(`${baseUrl}/gis`, { waitUntil: "domcontentloaded" });
    await page.locator("#appShell:not(.app-hidden)").waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-panel="gis"].active').waitFor({ state: "visible" });
    const destination = await searchPlace(page, "Medak, Telangana", /medak/i);
    const destinationActions = await page.locator("#gisMap .selected-location-card button[data-location-action]").allTextContents();
    await page.locator('#gisMap button[data-location-action="directions"]').click();
    const start = await searchPlace(page, "Hyderabad, Telangana", /hyderabad/i);
    const routeResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/maps/route", { timeout: 30000 });
    await page.locator('#gisMap button[data-location-action="start"]').click();
    const routeResponse = await routeResponsePromise;
    const routeBody = await routeResponse.json();
    await page.waitForFunction(() => {
      const distance = document.querySelector("#routeDistance")?.textContent.trim();
      const provider = document.querySelector("#routeProvider")?.textContent.trim();
      return Boolean(distance && distance !== "--" && provider && provider !== "No route");
    }, null, { timeout: 20000 });
    const route = {
      status: routeResponse.status(),
      provider: routeBody.provider || routeBody.routes?.[0]?.provider || null,
      approximate: Boolean(routeBody.approximate || routeBody.isApproximate || routeBody.routes?.[0]?.isApproximate),
      routeCount: routeBody.routes?.length || (routeBody.geometry ? 1 : 0),
      distanceKm: routeBody.distanceKm || routeBody.routes?.[0]?.distanceKm || null,
      durationMinutes: routeBody.durationMinutes || routeBody.routes?.[0]?.durationMinutes || null,
      pointLabels: await page.locator("#routePoints").innerText(),
      uiDistance: await page.locator("#routeDistance").textContent(),
      uiEta: await page.locator("#routeEta").textContent(),
      uiProvider: await page.locator("#routeProvider").textContent(),
      alternatives: await page.locator("#routeOptionsPanel .route-option-card").count(),
      renderedRouteLines: await page.locator("#gisMap path.leaflet-interactive").count()
    };
    assert.equal(route.status, 200);
    assert.match(route.pointLabels, /Hyderabad/i);
    assert.match(route.pointLabels, /Medak/i);
    const realOsrmRoute = route.provider === "osrm" && !route.approximate && route.routeCount > 0;
    if (realOsrmRoute) await page.screenshot({ path: path.join(outputDir, "gis-osrm-route-1440.png"), fullPage: true });
    const report = {
      result: realOsrmRoute ? "PASS" : "DEGRADED",
      baseUrl,
      destination: destination.result.label || destination.result.displayName,
      start: start.result.label || start.result.displayName,
      destinationActions: destinationActions.map((item) => item.trim()),
      route,
      realOsrmRoute,
      events
    };
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, outputDir }, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
