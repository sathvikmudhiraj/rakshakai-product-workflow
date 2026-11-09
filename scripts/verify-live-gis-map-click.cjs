const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.RAKSHAKAI_URL || "http://localhost:3001";
const sessionPath = path.join(os.tmpdir(), "rakshakai-live-ui-sessions", "admin.json");
const outputDir = path.join(__dirname, "..", "artifacts", `live-gis-map-click-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const diagnostics = { consoleErrors: [], pageErrors: [], mapApiFailures: [], apiErrorResponses: [] };

async function emptyMapPoint(page) {
  const map = page.locator("#gisMap .leaflet-container");
  await map.scrollIntoViewIfNeeded();
  return map.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const blocked = ".map-control,.map-zoom-slider,.map-search,.map-layer-control,.selected-location-card,.operational-marker,.leaflet-marker-icon,.leaflet-interactive";
    for (const y of [0.82, 0.74, 0.66, 0.58, 0.5, 0.42, 0.34, 0.26]) {
      for (const x of [0.99, 0.95, 0.88, 0.78, 0.68, 0.58, 0.48, 0.38, 0.28]) {
        const px = rect.left + rect.width * x;
        const py = rect.top + rect.height * y;
        const target = document.elementFromPoint(px, py);
        if (target?.closest(".leaflet-container") === element && !target.closest(blocked)) return { x: px, y: py };
      }
    }
    return null;
  });
}

async function clickEmptyMap(page, mobile = false, label = "viewport") {
  const point = await emptyMapPoint(page);
  assert.ok(point, "Could not find an unobstructed location inside the visible GIS map");
  if (mobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await page.locator("#gisMap .selected-location-card:not([hidden])").waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction(() => {
    const address = document.querySelector("#gisMap .selected-location-address")?.textContent || "";
    return address && !/lookup pending/i.test(address);
  }, null, { timeout: 15000 });
  const card = page.locator("#gisMap .selected-location-card");
  const details = await card.evaluate((element) => ({
    title: element.querySelector(".selected-location-title")?.textContent,
    address: element.querySelector(".selected-location-address")?.textContent,
    coordinates: element.querySelector(".selected-location-coordinates")?.textContent,
    actions: [...element.querySelectorAll("[data-location-action]")].map((button) => button.textContent.trim()),
    cardBounds: (() => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }; })(),
    hiddenActions: [...element.querySelectorAll("[data-location-action]")].filter((button) => {
      const rect = button.getBoundingClientRect();
      const hitTarget = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return !hitTarget || (hitTarget !== button && !button.contains(hitTarget));
    }).map((button) => {
      const rect = button.getBoundingClientRect();
      const hitTarget = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { label: button.textContent.trim(), rect: { top: rect.top, bottom: rect.bottom }, hitTarget: String(hitTarget?.className || hitTarget?.tagName || "none") };
    }),
    pinBounds: (() => {
      const pin = document.querySelector("#gisMap .selected-location-marker");
      if (!pin) return null;
      const markerRect = pin.getBoundingClientRect();
      const cardRect = element.getBoundingClientRect();
      return {
        top: markerRect.top,
        bottom: markerRect.bottom,
        left: markerRect.left,
        right: markerRect.right,
        centerCoveredByCard: markerRect.left + markerRect.width / 2 >= cardRect.left
          && markerRect.left + markerRect.width / 2 <= cardRect.right
          && markerRect.top + markerRect.height / 2 >= cardRect.top
          && markerRect.top + markerRect.height / 2 <= cardRect.bottom
      };
    })(),
    mobileNavBounds: (() => { const nav = document.querySelector("#mobileFieldNav:not([hidden])"); if (!nav) return null; const rect = nav.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; })(),
    source: element.querySelector(".selected-location-source")?.textContent
  }));
  assert.match(details.coordinates || "", /^-?\d+\.\d{5}, -?\d+\.\d{5}$/);
  assert.match(details.address || "", /Address unavailable|\S/);
  assert.deepEqual(details.actions, ["Directions", "Set as Start", "Set as Destination", "Close"]);
  await page.screenshot({ path: path.join(outputDir, `gis-map-click-${label}.png`) });
  assert.deepEqual(details.hiddenActions, [], `Every location action must be unobscured and tappable: ${JSON.stringify(details)}`);
  assert.equal(details.pinBounds?.centerCoveredByCard, false, `The clicked pin center must remain visible: ${JSON.stringify(details)}`);
  assert.equal(await page.locator("#gisMap .selected-location-marker").count(), 1, "The clicked location should have one visible pin");
  return { point, details };
}

async function hitTestedMarkerPoint(page, selector) {
  return page.locator(selector).evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hitTarget = document.elementFromPoint(x, y);
    const markerIcon = element.closest(".leaflet-marker-icon");
    const reachable = hitTarget === element || element.contains(hitTarget) || hitTarget === markerIcon;
    return { x, y, className: element.className.baseVal || element.className, reachable };
  }).filter((item) => item.reachable && item.x >= 0 && item.x < innerWidth && item.y >= 0 && item.y < innerHeight)[0] || null);
}

async function clickMarkerPoint(page, point, mobile) {
  if (mobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

async function runViewport(browser, viewport, label) {
  const mobile = viewport.width <= 720;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, storageState: sessionPath });
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") diagnostics.consoleErrors.push(`${label}: ${message.text()}`); });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(`${label}: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (/\/api\/maps\//.test(request.url())) diagnostics.mapApiFailures.push({ viewport: label, url: request.url(), error: request.failure()?.errorText });
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/") && response.status() >= 400) diagnostics.apiErrorResponses.push({ viewport: label, status: response.status(), path: url.pathname });
  });
  try {
    await page.goto(`${baseUrl}/gis`, { waitUntil: "domcontentloaded" });
    await page.locator("#appShell:not(.app-hidden)").waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-panel="gis"].active').waitFor({ state: "visible" });
    const initial = await clickEmptyMap(page, mobile, label);

    await page.locator('#gisMap [data-location-action="close"]').click();
    await page.locator("#gisMap .selected-location-card").waitFor({ state: "hidden" });
    const controlsBefore = await page.locator("#routePoints").textContent();
    await page.locator("#gisMap .map-control.zoom-in").click();
    assert.equal(await page.locator("#gisMap .selected-location-card:not([hidden])").count(), 0, "Map controls must not open location cards");
    assert.equal(await page.locator("#routePoints").textContent(), controlsBefore, "Map zoom must not change route points");

    const unitMarkers = page.locator("#gisMap .unit-marker");
    const unitMarkerCount = await unitMarkers.count();
    let unitMarkerBehavior = "no visible response unit marker";
    if (unitMarkerCount) {
      const unitPoint = await hitTestedMarkerPoint(page, "#gisMap .unit-marker");
      if (unitPoint) {
        const beforeUnitClick = await page.locator("#routePoints").textContent();
        await clickMarkerPoint(page, unitPoint, mobile);
        await page.waitForFunction((before) => document.querySelector("#routePoints")?.textContent !== before, beforeUnitClick, { timeout: 10000 });
        assert.equal(await page.locator("#gisMap .selected-location-card:not([hidden])").count(), 0, "Response unit clicks must retain their existing route behavior");
        unitMarkerBehavior = "route start selected";
      } else unitMarkerBehavior = "markers present but covered by an overlapping marker";
    }

    const incidentMarkers = page.locator("#gisMap .incident-marker");
    const incidentMarkerCount = await incidentMarkers.count();
    let incidentMarkerBehavior = "no individual incident marker visible";
    if (incidentMarkerCount) {
      const incidentPoint = await hitTestedMarkerPoint(page, "#gisMap .incident-marker");
      if (incidentPoint) {
        const beforeIncidentClick = await page.locator("#routePoints").textContent();
        await clickMarkerPoint(page, incidentPoint, mobile);
        await page.waitForFunction((before) => document.querySelector("#routePoints")?.textContent !== before, beforeIncidentClick, { timeout: 10000 });
        assert.equal(await page.locator("#gisMap .selected-location-card:not([hidden])").count(), 0, "Incident marker clicks must retain their existing route behavior");
        incidentMarkerBehavior = "route destination selected";
      } else {
        const clusterPoint = await hitTestedMarkerPoint(page, "#gisMap .marker-cluster");
        if (clusterPoint) {
          await clickMarkerPoint(page, clusterPoint, mobile);
          await page.locator("#gisMap .leaflet-popup").waitFor({ state: "visible", timeout: 5000 });
          incidentMarkerBehavior = "overlapping incident remains grouped; its cluster popup opens";
          await page.keyboard.press("Escape");
        } else incidentMarkerBehavior = "individual markers remain covered by an overlapping marker";
      }
    }

    const dragStart = await emptyMapPoint(page);
    assert.ok(dragStart, "Could not find an unobstructed map area to drag");
    if (mobile) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: dragStart.x, y: dragStart.y }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: dragStart.x + 72, y: dragStart.y + 46 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
    } else {
      await page.mouse.move(dragStart.x, dragStart.y);
      await page.mouse.down();
      await page.mouse.move(dragStart.x + 72, dragStart.y + 46, { steps: 8 });
      await page.mouse.up();
    }
    await page.waitForTimeout(350);
    assert.equal(await page.locator("#gisMap .selected-location-card:not([hidden])").count(), 0, "Panning must not open a location card");

    const second = await clickEmptyMap(page, mobile, label);
    await page.locator('#gisMap [data-location-action="start"]').click();
    const startAndDestinationSelection = await page.locator("#routePoints").textContent();
    await page.locator('#gisMap [data-location-action="close"]').click();
    const third = await clickEmptyMap(page, mobile, label);
    await page.locator('#gisMap [data-location-action="destination"]').click();
    const routePointsBeforeNormalClick = await page.locator("#routePoints").textContent();
    await page.locator('#gisMap [data-location-action="close"]').click();
    const fourth = await clickEmptyMap(page, mobile, label);
    const routePointsAfterNormalClick = await page.locator("#routePoints").textContent();
    assert.equal(routePointsAfterNormalClick, routePointsBeforeNormalClick, "A normal map click must preserve existing route points");
    await page.screenshot({ path: path.join(outputDir, `gis-map-click-route-preserved-${label}.png`) });

    return {
      viewport,
      initial,
      mapControlBehavior: "zoomed without selecting a location",
      unitMarkerCount,
      unitMarkerBehavior,
      incidentMarkerCount,
      incidentMarkerBehavior,
      dragDidNotSelect: true,
      explicitStartDestinationRetained: routePointsAfterNormalClick === routePointsBeforeNormalClick,
      routePointsBeforeNormalClick,
      routePointsAfterNormalClick,
      otherMapClicks: [second.details.coordinates, third.details.coordinates, fourth.details.coordinates],
      intermediateRoutePoints: startAndDestinationSelection
    };
  } finally {
    await context.close();
  }
}

async function main() {
  assert.ok(fs.existsSync(sessionPath), "Reuse the saved authenticated Admin session; this script does not sign in");
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const results = [];
    results.push(await runViewport(browser, { width: 1440, height: 900 }, "1440x900"));
    results.push(await runViewport(browser, { width: 390, height: 844 }, "390x844"));
    const report = { result: "PASS", baseUrl, results, diagnostics, outputDir };
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
