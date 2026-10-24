const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on("response", (r) => { if (r.url().includes("/api/maps/")) console.log("  API", r.request().method(), r.url().replace("http://localhost:3001", "").slice(0, 80), r.status()); });
  await page.goto("http://localhost:3001", { waitUntil: "domcontentloaded" });
  await page.locator("#loginForm input[name=email]").fill("admin@rakshakai.local");
  await page.locator("#loginForm input[name=password]").fill("demo123");
  await page.locator("#loginForm button[type=submit]").click();
  await page.locator("#appShell:not(.app-hidden)").waitFor({ state: "visible", timeout: 30000 });
  await page.goto("http://localhost:3001/gis", { waitUntil: "domcontentloaded" });
  const map = page.locator("#gisMap .leaflet-container");
  await map.waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#resetGisMap").click();

  const probe = (label, x, y) => page.evaluate(([tag, px, py]) => {
    const el = document.elementFromPoint(px, py);
    return `${tag}: (${Math.round(px)},${Math.round(py)}) -> ${el ? el.tagName + "." + String(el.className.baseVal ?? el.className).slice(0, 50) : "none"}`;
  }, [label, x, y]).then(console.log);

  // matrix compact prefix
  const toggle = page.locator("#gisMap .map-layer-toggle");
  const menu = page.locator("#gisMap .map-layer-menu");
  await toggle.click(); await menu.waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector("#gisMap .map-layer-menu")?.hidden === true);
  console.log("escape close ok");
  await toggle.click(); await menu.waitFor({ state: "visible" });
  await map.scrollIntoViewIfNeeded();
  const ob = await map.boundingBox();
  await probe("outside-click target", ob.x + 12, ob.y + ob.height / 2);
  await page.mouse.click(ob.x + 12, ob.y + ob.height / 2);
  await page.waitForFunction(() => document.querySelector("#gisMap .map-layer-menu")?.hidden === true);
  console.log("outside close ok");

  // click safety
  await page.locator("#setMapStart").click();
  await map.scrollIntoViewIfNeeded();
  const sb = await map.boundingBox();
  await probe("start-click target", sb.x + sb.width - 20, sb.y + 160);
  await page.mouse.click(sb.x + sb.width - 20, sb.y + 160);
  await page.waitForFunction(() => !document.querySelector("#clearRouteStart")?.disabled, null, { timeout: 30000 });
  console.log("start set ok");
  await page.locator("#clearRouteStart").click();
  await page.waitForFunction(() => document.querySelector("#clearRouteStart")?.disabled);
  console.log("start cleared ok");

  // search
  const input = page.locator("#gisMap .map-search input");
  await input.fill("Warangal");
  await input.press("Enter");
  try {
    await page.locator("#gisMap .map-search-results .map-search-result").first().waitFor({ state: "visible", timeout: 20000 });
    console.log("SEARCH OK after matrix prefix");
  } catch { console.log("SEARCH FAILED after matrix prefix"); }
  await browser.close();
})();
