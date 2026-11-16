const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const baseUrl = process.env.RAKSHAKAI_URL || "http://localhost:3001";
const sessionPath = path.join(os.tmpdir(), "rakshakai-live-ui-sessions", "admin.json");
const outputDir = path.join(root, "artifacts", `live-gis-route-error-${new Date().toISOString().replace(/[:.]/g, "-")}`);

async function searchPlace(page, query, matcher) {
  const searchResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/maps/search");
  await page.locator('#gisMap input[aria-label="Search place on map"]').fill(query);
  await page.locator('#gisMap .map-search button[type="submit"]').click();
  const response = await searchResponse;
  assert.equal(response.status(), 200);
  const body = await response.json();
  const index = body.results.findIndex((place) => matcher.test(place.label || place.displayName || place.name));
  assert.notEqual(index, -1, `Live geocoder did not return a matching result for ${query}`);
  await page.locator("#gisMap .map-search-result").nth(index).click();
  await page.locator("#gisMap .selected-location-card:not([hidden])").waitFor({ state: "visible" });
}

async function main() {
  assert.ok(fs.existsSync(sessionPath), "Existing Admin session is required; this check will not log in again");
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: sessionPath });
  const page = await context.newPage();
  let routeRequest = null;
  try {
    await page.route("**/api/maps/route", async (route) => {
      routeRequest = { method: route.request().method(), postData: route.request().postDataJSON() };
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Simulated routing provider outage" }) });
    });
    await page.goto(`${baseUrl}/gis`, { waitUntil: "domcontentloaded" });
    await page.locator("#appShell:not(.app-hidden)").waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-panel="gis"].active').waitFor({ state: "visible" });
    await searchPlace(page, "Medak, Telangana", /medak/i);
    await page.locator('#gisMap button[data-location-action="directions"]').click();
    await searchPlace(page, "Hyderabad, Telangana", /hyderabad/i);
    await page.locator('#gisMap button[data-location-action="start"]').click();
    await page.waitForFunction(() => document.querySelector("#mapNavigationStatus")?.textContent.includes("Road routing unavailable - route could not be calculated"), null, { timeout: 15000 });
    assert.equal(routeRequest?.method, "POST", "The app should issue the real route API request before displaying its failure state");
    const status = await page.locator("#mapNavigationStatus").textContent();
    assert.match(status, /Road routing unavailable - route could not be calculated/i);
    assert.equal(await page.locator("#routeDistance").textContent(), "--", "A failed request must not leave stale route distance visible");
    await page.screenshot({ path: path.join(outputDir, "gis-route-error-1440.png"), fullPage: true });
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify({ result: "PASS", baseUrl, injectedStatus: 503, routeRequest, visibleError: status, screenshot: path.join(outputDir, "gis-route-error-1440.png") }, null, 2));
    console.log(JSON.stringify({ result: "PASS", outputDir, injectedStatus: 503, routeRequest, visibleError: status }, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
