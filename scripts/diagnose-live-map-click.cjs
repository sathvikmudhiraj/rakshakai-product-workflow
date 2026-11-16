const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const state = path.join(os.tmpdir(), "rakshakai-live-ui-sessions", "admin.json");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: state });
  const page = await context.newPage();
  await page.goto("http://localhost:3001/gis", { waitUntil: "domcontentloaded" });
  await page.locator("[data-panel='gis'].active").waitFor({ state: "visible", timeout: 15000 });
  const map = page.locator("#gisMap .leaflet-container");
  await map.scrollIntoViewIfNeeded();
  const details = await map.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const result = { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, tiles: element.querySelectorAll(".leaflet-tile").length, tilePanes: element.querySelectorAll(".leaflet-tile-pane").length, samples: [] };
    for (let y = 0.05; y < 0.95; y += 0.1) for (let x = 0.05; x < 0.95; x += 0.1) {
      const px = rect.left + rect.width * x, py = rect.top + rect.height * y;
      const target = document.elementFromPoint(px, py);
      result.samples.push({ x, y, target: target?.tagName, class: String(target?.className || "").slice(0, 120), tile: Boolean(target?.closest?.(".leaflet-tile-pane")), map: Boolean(target?.closest?.(".leaflet-container")), overlay: target?.closest?.(".selected-location-card")?.className || null });
    }
    return { ...result, candidates: result.samples.filter((sample) => sample.map && !sample.overlay && !/map-control|map-search|map-layer-control|leaflet-interactive/.test(sample.class)) };
  });
  const mapPoint = await map.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    for (let y = 0.2; y < 0.82; y += 0.06) for (let x = 0.2; x < 0.82; x += 0.06) {
      const px = rect.left + rect.width * x, py = rect.top + rect.height * y;
      const target = document.elementFromPoint(px, py);
      if (target?.closest(".leaflet-container") === element && !target.closest(".map-search,.map-layer-control,.map-control,.selected-location-card,.operational-marker,.leaflet-marker-icon,.leaflet-interactive")) return { x: px, y: py, target: target.className };
    }
    return null;
  });
  const eventLog = [];
  await map.evaluate((element) => {
    window.__mapClickEvents = [];
    for (const eventName of ["pointerdown", "pointerup", "click"]) element.addEventListener(eventName, (event) => window.__mapClickEvents.push({ event: eventName, target: String(event.target?.className || event.target?.tagName || ""), defaultPrevented: event.defaultPrevented }), true);
  });
  if (mapPoint) await page.mouse.click(mapPoint.x, mapPoint.y);
  await page.waitForTimeout(1500);
  const observed = await map.evaluate((element) => ({ events: window.__mapClickEvents, outerId: element.id, leaflet: Boolean(window.L), leafletId: element.querySelector(".leaflet-host")?._leaflet_id, hostEvents: element.querySelector(".leaflet-host")?._events ? Object.keys(element.querySelector(".leaflet-host")._events) : [], mapEvents: window.L && element.querySelector(".leaflet-host")?._leaflet_id ? Object.keys(window.L.Mixin?.Events || {}) : [] }));
  const after = await page.locator("#gisMap .selected-location-card").evaluate((element) => ({ visible: !element.hidden, title: element.querySelector(".selected-location-title")?.textContent, text: element.innerText }));
  console.log(JSON.stringify({ mapPoint, after, eventLog, observed }, null, 2));
  await browser.close();
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
