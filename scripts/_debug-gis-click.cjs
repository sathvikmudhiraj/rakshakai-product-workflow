// Temporary debug probe #2 for GIS map click failures. DELETE AFTER USE.
const { chromium } = require("playwright");
const base = process.env.GIS_BASE_URL || "http://localhost:3001";
const password = process.env.GIS_ADMIN_PASSWORD || "demo123";
setTimeout(() => { console.error("HARD EXIT"); process.exit(2); }, 150000).unref?.();

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 834, height: 1112 } });
  const page = await context.newPage();
  const apiLog = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("/api/maps/") || url.includes("/api/geocode")) {
      let body = "";
      try { body = (await response.text()).slice(0, 240); } catch {}
      apiLog.push({ u: url.replace(base, ""), s: response.status(), b: body });
    }
  });

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator("#loginForm input[name=email]").fill("admin@rakshakai.local");
  await page.locator("#loginForm input[name=password]").fill(password);
  await page.locator("#loginForm button[type=submit]").click();
  await page.locator("#appShell:not(.app-hidden)").waitFor({ state: "visible", timeout: 30000 });
  console.log("logged in");

  // --- A) 834x1112 upper-right: scroll-state hypothesis ---
  await page.setViewportSize({ width: 834, height: 1112 });
  await page.goto(`${base}/gis`, { waitUntil: "domcontentloaded" });
  await page.locator("#gisMap .leaflet-container").waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#resetGisMap").click();
  const map = page.locator("#gisMap .leaflet-container");
  await map.scrollIntoViewIfNeeded();
  const toBox = (b) => ({ left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height });
  const mapBoxBefore = toBox(await map.boundingBox());
  const controlBoxBefore = toBox(await page.locator("#gisMap .map-layer-control").boundingBox());
  console.log("A: mapBox(before arm)", JSON.stringify(mapBoxBefore));
  console.log("A: controlBox(before arm)", JSON.stringify(controlBoxBefore));
  await page.locator("#setMapStart").click();
  await map.scrollIntoViewIfNeeded();
  const mapBoxAfter = toBox(await map.boundingBox());
  const controlBoxAfter = toBox(await page.locator("#gisMap .map-layer-control").boundingBox());
  console.log("A: mapBox(after arm)", JSON.stringify(mapBoxAfter));
  console.log("A: controlBox(after arm)", JSON.stringify(controlBoxAfter));
  const scrollYBefore = await page.evaluate(() => window.scrollY);
  console.log("A: scrollY(after arm)", scrollYBefore, "viewportH", await page.evaluate(() => window.innerHeight));
  const clickYOff = Math.max(160, controlBoxAfter.bottom - mapBoxAfter.top + 40);
  const vh = await page.evaluate(() => window.innerHeight);
  const clickY = Math.min(vh - 10, clickYOff);
  const cx = mapBoxAfter.right - 20, cy = mapBoxAfter.top + clickY;
  const at = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    const chain = []; let cur = el;
    while (cur && chain.length < 5) { chain.push(cur.tagName.toLowerCase() + (cur.className ? "." + String(cur.className).split(" ").slice(0, 3).join(".") : "")); cur = cur.parentElement; }
    return chain;
  }, [cx, cy]);
  console.log("A: click", Math.round(cx), Math.round(cy), "elementFromPoint:", JSON.stringify(at));
  apiLog.length = 0;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(3500);
  console.log("A: clearStart.disabled =", await page.evaluate(() => document.querySelector("#clearRouteStart")?.disabled));
  console.log("A: navStatus =", JSON.stringify(await page.evaluate(() => document.querySelector("#mapNavigationStatus")?.innerText)));
  console.log("A: api:", JSON.stringify(apiLog));

  // --- B) 390x844 exact acceptance sequence: compact flow + search, then fraction click ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/gis`, { waitUntil: "domcontentloaded" });
  await page.locator("#gisMap .leaflet-container").waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#resetGisMap").click();
  await map.scrollIntoViewIfNeeded();
  const toggle = page.locator("#gisMap .map-layer-toggle");
  const menu = page.locator("#gisMap .map-layer-menu");
  await toggle.click();
  await menu.waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await toggle.click();
  await menu.waitFor({ state: "visible" });
  const m390 = toBox(await map.boundingBox());
  await page.mouse.click(m390.left + 12, m390.top + (m390.bottom - m390.top) / 2);
  await page.waitForFunction(() => document.querySelector("#gisMap .map-layer-menu")?.hidden === true);
  console.log("B: compact flow done");

  const searchInput = page.locator("#gisMap .map-search input");
  await searchInput.fill("Warangal");
  await searchInput.press("Enter");
  await page.locator("#gisMap .map-search-results .map-search-result").first().waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#gisMap .map-search-results .map-search-result").first().click();
  await page.locator("#gisMap .map-search-confirm").waitFor({ state: "visible", timeout: 10000 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  console.log("B: search flow done");

  // State of overlays/search UI after Escape
  const postSearch = await page.evaluate(() => {
    const vis = (sel) => { const el = document.querySelector(sel); if (!el) return "absent"; const r = el.getBoundingClientRect(); const hidden = el.hidden || getComputedStyle(el).display === "none"; return `${hidden ? "hidden" : "visible"} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`; };
    return {
      searchResults: vis("#gisMap .map-search-results"),
      searchConfirm: vis("#gisMap .map-search-confirm"),
      layerMenu: vis("#gisMap .map-layer-menu"),
      scrollY: window.scrollY,
      docScrollW: document.documentElement.scrollWidth,
    };
  });
  console.log("B: post-search UI:", JSON.stringify(postSearch));

  await page.locator("#setMapStart").click();
  await map.scrollIntoViewIfNeeded();
  const mb = toBox(await map.boundingBox());
  const fx = mb.left + (mb.right - mb.left) * 0.4, fy = mb.top + (mb.bottom - mb.top) * 0.5;
  const at390 = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    const chain = []; let cur = el;
    while (cur && chain.length < 5) { chain.push(cur.tagName.toLowerCase() + (cur.className ? "." + String(cur.className).split(" ").slice(0, 3).join(".") : "")); cur = cur.parentElement; }
    return chain;
  }, [fx, fy]);
  console.log("B: mapBox", JSON.stringify(mb), "click", Math.round(fx), Math.round(fy), "elementFromPoint:", JSON.stringify(at390));
  apiLog.length = 0;
  await page.mouse.click(fx, fy);
  await page.waitForTimeout(3500);
  console.log("B: clearStart.disabled =", await page.evaluate(() => document.querySelector("#clearRouteStart")?.disabled));
  console.log("B: navStatus =", JSON.stringify(await page.evaluate(() => document.querySelector("#mapNavigationStatus")?.innerText)));
  console.log("B: api:", JSON.stringify(apiLog));
  await page.screenshot({ path: "C:/Users/Admin/AppData/Local/Temp/opencode/debug-390-final.png" });

  await browser.close();
  console.log("DONE");
  process.exit(0);
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
