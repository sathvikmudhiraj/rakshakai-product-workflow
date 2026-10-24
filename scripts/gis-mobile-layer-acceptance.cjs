// GIS map-layer control acceptance across the required viewport matrix.
// Verifies the compact mobile Layers control (<=620px) with REAL interaction:
// collapsed default, 44px touch target, open/close (toggle, Escape, outside click),
// menu inside map bounds, active layer identified, real upper-right map clicks,
// mobile search, and Street<->Satellite preservation of route/navigation/overlays.
// Logs in once, then switches viewports (gentle on the login rate limiter).
//
// Usage: node scripts/gis-mobile-layer-acceptance.cjs
// Env: GIS_BASE_URL (default http://localhost:3001 — the Compose stack with the local
// Telangana OSRM graph), GIS_ADMIN_PASSWORD (default demo123)

const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const base = process.env.GIS_BASE_URL || "http://localhost:3001";
const password = process.env.GIS_ADMIN_PASSWORD || "demo123";
const VIEWPORTS = [
  [390, 844],
  [430, 932],
  [768, 1024],
  [834, 1112],
  [1024, 768],
  [1440, 900],
];

const results = [];

function boxesIntersect(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

async function box(locator) {
  const b = await locator.boundingBox();
  assert.ok(b, `missing bounding box for ${locator._selector}`);
  return { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: VIEWPORTS[0][0], height: VIEWPORTS[0][1] } });
  const page = await context.newPage();
  try {
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.locator("#loginForm input[name=email]").fill("admin@rakshakai.local");
    await page.locator("#loginForm input[name=password]").fill(password);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/auth/login") && response.status() === 200, { timeout: 30000 }),
      page.locator("#loginForm button[type=submit]").click(),
    ]);
    await page.locator("#appShell:not(.app-hidden)").waitFor({ state: "visible", timeout: 30000 });

    for (const [width, height] of VIEWPORTS) {
      const compact = width <= 620;
      const record = { viewport: `${width}x${height}`, compact, checks: {} };
      const pass = (name, detail) => {
        record.checks[name] = { pass: true, ...(detail ? { detail } : {}) };
      };
      try {
        await page.setViewportSize({ width, height });
        await page.goto(`${base}/gis`, { waitUntil: "domcontentloaded" });
        const map = page.locator("#gisMap .leaflet-container");
        await map.waitFor({ state: "visible", timeout: 30000 });
        await page.locator("#resetGisMap").click();
        await map.scrollIntoViewIfNeeded();

        const toggle = page.locator("#gisMap .map-layer-toggle");
        const menu = page.locator("#gisMap .map-layer-menu");
        const control = page.locator("#gisMap .map-layer-control");
        const mapBox = await box(map);

        if (compact) {
          // Collapsed by default, >=44px touch target.
          assert.equal(await toggle.isVisible(), true, "compact toggle not visible");
          assert.equal(await toggle.getAttribute("aria-expanded"), "false", "not collapsed by default");
          assert.equal(await menu.isHidden(), true, "menu visible before interaction");
          const toggleBox = await box(toggle);
          assert.ok(toggleBox.right - toggleBox.left >= 44 && toggleBox.bottom - toggleBox.top >= 44, `touch target ${toggleBox.right - toggleBox.left}x${toggleBox.bottom - toggleBox.top}`);
          pass("collapsedDefault44px", `${Math.round(toggleBox.right - toggleBox.left)}x${Math.round(toggleBox.bottom - toggleBox.top)}`);

          // Must not overlap search, zoom controls, status strip, or route cards when collapsed.
          const others = {};
          for (const selector of ["#gisMap .map-search", "#gisMap .map-controls", "#gisMap .map-status", "#routeOptionsPanel"]) {
            const otherBox = await box(page.locator(selector).first());
            others[selector] = otherBox;
            assert.equal(boxesIntersect(toggleBox, otherBox), false, `collapsed control overlaps ${selector}`);
          }
          pass("noOverlapCollapsed");

          // Open: menu stays inside map bounds; active layer visibly identified.
          await toggle.click();
          await menu.waitFor({ state: "visible" });
          const menuBox = await box(menu);
          assert.ok(menuBox.left >= mapBox.left - 1 && menuBox.right <= mapBox.right + 1, `menu outside map horizontally (${Math.round(menuBox.left)}..${Math.round(menuBox.right)} vs ${Math.round(mapBox.left)}..${Math.round(mapBox.right)})`);
          assert.ok(menuBox.top >= mapBox.top - 1 && menuBox.bottom <= mapBox.bottom + 1, "menu outside map vertically");
          pass("menuInsideMap", `${Math.round(menuBox.right - menuBox.left)}x${Math.round(menuBox.bottom - menuBox.top)}`);
          const activeBase = page.locator('#gisMap [data-map-base-layer][aria-pressed="true"]');
          assert.equal(await activeBase.count(), 1, "active base layer not identified");
          assert.equal(await activeBase.getAttribute("data-map-base-layer"), "streets");
          pass("activeLayerIdentified", await activeBase.innerText());

          // Escape closes.
          await page.keyboard.press("Escape");
          await page.waitForFunction(() => document.querySelector("#gisMap .map-layer-menu")?.hidden === true);
          pass("escapeCloses");

          // Outside click closes. Click the narrow strip left of the open menu
          // (the menu covers most of the map width at 390px).
          await toggle.click();
          await menu.waitFor({ state: "visible" });
          await map.scrollIntoViewIfNeeded();
          const outsideBox = await box(map);
          await page.mouse.click(outsideBox.left + 12, outsideBox.top + (outsideBox.bottom - outsideBox.top) / 2);
          await page.waitForFunction(() => document.querySelector("#gisMap .map-layer-menu")?.hidden === true);
          pass("outsideClickCloses");
        } else {
          // Desktop/tablet: permanently expanded control, no toggle.
          assert.equal(await control.isVisible(), true, "desktop layer control not visible");
          assert.equal(await menu.isVisible(), true, "desktop menu not visible");
          const menuBox = await box(menu);
          assert.ok(menuBox.left >= mapBox.left - 1 && menuBox.right <= mapBox.right + 1, `menu outside map horizontally (menu ${Math.round(menuBox.left)}..${Math.round(menuBox.right)} vs map ${Math.round(mapBox.left)}..${Math.round(mapBox.right)})`);
          assert.ok(menuBox.top >= mapBox.top - 1 && menuBox.bottom <= mapBox.bottom + 1, "menu outside map vertically");
          pass("desktopMenuInsideMap");
        }

        // Real click safety: map area must accept a Start click. Re-measure the map and
        // control boxes after arming Set Start (clicking the toolbar button may scroll the
        // page), so both boxes share one scroll state. Click the previously obstructed
        // upper-right area below the layer control, clamped to the visible map. If that
        // exact point has no routable road (terrain, not UI), step toward the map centre:
        // a failed snap keeps Set Start armed, so a retry is a plain second click.
        await page.locator("#setMapStart").click();
        await map.scrollIntoViewIfNeeded();
        const startMapBox = await box(map);
        const startControlBox = await box(control);
        const viewportHeight = await page.evaluate(() => window.innerHeight);
        const mapVisibleBottom = Math.min(startMapBox.bottom, viewportHeight) - 10;
        const desiredY = Math.max(startMapBox.top + 160, startControlBox.bottom + 40);
        const clickY = Math.max(startMapBox.top + 40, Math.min(desiredY, mapVisibleBottom));
        const mapWidth = startMapBox.right - startMapBox.left;
        let startClick = null;
        for (const fraction of [0.97, 0.88, 0.79, 0.7, 0.61]) {
          const clickX = Math.round(startMapBox.left + mapWidth * fraction);
          await page.mouse.click(clickX, Math.round(clickY));
          const armed = await page
            .waitForFunction(() => !document.querySelector("#clearRouteStart")?.disabled, null, { timeout: 4000 })
            .then(() => true)
            .catch(() => false);
          if (armed) { startClick = { x: clickX, y: Math.round(clickY), fraction }; break; }
        }
        assert.ok(startClick, "upper-right map area never accepted a Start click");
        assert.ok(
          startClick.x >= startMapBox.left + mapWidth * 0.55,
          `Start click accepted outside the right side of the map (${startClick.x})`
        );
        pass("upperRightClickSetsStart", startClick);
        await page.locator("#clearRouteStart").click();
        await page.waitForFunction(() => document.querySelector("#clearRouteStart")?.disabled);

        // Mobile search flow (compact viewports). The preview panel is dismissed only by
        // its own Cancel/Confirm buttons (Escape does not close it), so exercise both:
        // Cancel removes the preview and keeps the list open for another pick; Confirm
        // selects the destination and closes the results.
        if (compact) {
          const searchInput = page.locator("#gisMap .map-search input");
          await searchInput.fill("Warangal");
          await searchInput.press("Enter");
          const firstResult = page.locator("#gisMap .map-search-results .map-search-result").first();
          await firstResult.waitFor({ state: "visible", timeout: 30000 });
          await firstResult.click();
          await page.locator("#gisMap .map-search-confirm").waitFor({ state: "visible", timeout: 10000 });
          await page.locator('#gisMap [data-action="cancel-search-preview"]').click();
          await page.waitForFunction(() => !document.querySelector("#gisMap .map-search-confirm"));
          await firstResult.click();
          await page.locator("#gisMap .map-search-confirm").waitFor({ state: "visible", timeout: 10000 });
          await page.locator('#gisMap [data-action="confirm-search-destination"]').click();
          await page.waitForFunction(() => document.querySelector("#gisMap .map-search-results")?.hidden === true, null, { timeout: 10000 });
          pass("mobileSearchSelect", { place: "Warangal", previewCancel: true, previewConfirm: true });
          // Clear the search-confirmed destination so the preservation flow below verifies
          // fresh Start/Destination map clicks instead of reusing the search result.
          await page.locator("#clearRouteDestination").click();
          await page.waitForFunction(() => document.querySelector("#clearRouteDestination")?.disabled);
        }

        // Street <-> Satellite preservation with real route + navigation (390 only;
        // desktop preservation is covered by scripts/gis-route-acceptance.cjs).
        if (width === 390) {
          const setPoint = async (button, clearButton, xf, yf) => {
            await page.locator(button).click();
            await map.scrollIntoViewIfNeeded();
            const pointMapBox = await box(map);
            await page.mouse.click(
              pointMapBox.left + (pointMapBox.right - pointMapBox.left) * xf,
              pointMapBox.top + (pointMapBox.bottom - pointMapBox.top) * yf
            );
            await page.waitForFunction((sel) => !document.querySelector(sel)?.disabled, clearButton, { timeout: 30000 });
          };
          await setPoint("#setMapStart", "#clearRouteStart", 0.4, 0.5);
          await setPoint("#setMapDestination", "#clearRouteDestination", 0.6, 0.62);
          await page.locator("#navigateMap").click();
          await page.waitForFunction(() => document.querySelector("#routeDistance")?.textContent !== "--", null, { timeout: 30000 });
          await page.waitForFunction(() => document.querySelectorAll("#gisMap path.leaflet-route-line").length > 0, null, { timeout: 15000 });
          const distance = await page.locator("#routeDistance").innerText();
          assert.match(distance, /km/i, "no road distance");
          pass("roadRouteCalculated", { distance });

          // Toggle an operational overlay off, then switch base layers via the compact menu.
          await toggle.click();
          await menu.waitFor({ state: "visible" });
          await page.locator('#gisMap [data-map-layer-toggle="policeStations"]').uncheck();
          await page.locator('#gisMap [data-map-base-layer="satellite"]').click();
          await page.waitForFunction(() => document.querySelector("#gisMap")?.dataset.baseLayer === "satellite", null, { timeout: 15000 });
          assert.equal(await page.locator('#gisMap [data-map-base-layer="satellite"]').getAttribute("aria-pressed"), "true");
          assert.ok(await page.locator("#gisMap path.leaflet-route-line").count(), "route lost on satellite");
          assert.ok(await page.locator("#gisMap .start-marker").count(), "start marker lost on satellite");
          assert.ok(await page.locator("#gisMap .destination-marker").count(), "destination marker lost on satellite");
          assert.equal(await page.locator("#routeDistance").innerText(), distance, "distance changed on satellite");

          await toggle.click();
          await menu.waitFor({ state: "visible" });
          assert.equal(
            await page.locator('#gisMap [data-map-layer-toggle="policeStations"]').isChecked(),
            false,
            "overlay state lost after base-layer switch"
          );
          await page.locator('#gisMap [data-map-base-layer="streets"]').click();
          await page.waitForFunction(() => document.querySelector("#gisMap")?.dataset.baseLayer === "streets", null, { timeout: 15000 });
          assert.ok(await page.locator("#gisMap path.leaflet-route-line").count(), "route lost on street");
          pass("layerSwitchPreservesRouteOverlays");

          // Start Navigation; the active navigation panel must survive a layer switch.
          await page.locator("#startNavigation").click();
          await page.locator("#activeNavigationPanel").waitFor({ state: "visible", timeout: 15000 });
          const toggleBox2 = await box(toggle);
          const navBox = await box(page.locator("#activeNavigationPanel"));
          assert.equal(boxesIntersect(toggleBox2, navBox), false, "layer control overlaps active navigation panel");
          await toggle.click();
          await menu.waitFor({ state: "visible" });
          await page.locator('#gisMap [data-map-base-layer="satellite"]').click();
          await page.waitForFunction(() => document.querySelector("#gisMap")?.dataset.baseLayer === "satellite", null, { timeout: 15000 });
          assert.equal(await page.locator("#activeNavigationPanel").isVisible(), true, "navigation panel lost on satellite");
          assert.ok(await page.locator("#gisMap path.leaflet-route-line").count(), "navigation route lost on satellite");
          pass("navigationSurvivesLayerSwitch");

          await page.locator("#endNavigation").click();
          await page.waitForFunction(() => document.querySelector("#activeNavigationPanel")?.hidden !== false);
        }

        record.pass = true;
      } catch (error) {
        console.error(`[${width}x${height}]`, error.stack || error.message);
        record.checks.fatal = { pass: false, error: error.message.split("\n").slice(0, 3).join(" | ") };
        record.pass = false;
      }
      results.push(record);
    }
  } catch (error) {
    results.push({ viewport: "session", checks: { fatal: { pass: false, error: error.message.split("\n")[0] } }, pass: false });
  } finally {
    await browser.close();
  }
  for (const record of results) {
    const bad = Object.entries(record.checks).filter(([, check]) => !check.pass);
    console.log(`${record.viewport} compact=${record.compact} ${bad.length ? "FAIL: " + bad.map(([name, check]) => `${name}: ${check.error}`).join(" | ") : "PASS (" + Object.keys(record.checks).length + " checks)"}`);
  }
  if (results.some((record) => record.pass === false)) process.exitCode = 1;
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
