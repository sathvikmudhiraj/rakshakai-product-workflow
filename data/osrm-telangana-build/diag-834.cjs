const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 834, height: 1112 } });
  const page = await context.newPage();
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
  await page.locator("#loginForm input[name=email]").fill("admin@rakshakai.local");
  await page.locator("#loginForm input[name=password]").fill("demo123");
  await page.locator("#loginForm button[type=submit]").click();
  await page.locator("#appShell:not(.app-hidden)").waitFor({ state: "visible", timeout: 30000 });
  await page.goto("http://localhost:3000/gis", { waitUntil: "domcontentloaded" });
  const map = page.locator("#gisMap .leaflet-container");
  await map.waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#resetGisMap").click();
  await map.scrollIntoViewIfNeeded();
  const mapBox = await map.boundingBox();
  const controlBox = await page.locator("#gisMap .map-layer-control").boundingBox();
  const clickY = Math.min(1102, Math.max(160, controlBox.y + controlBox.height - mapBox.y + 40));
  await page.locator("#setMapStart").click();
  await map.scrollIntoViewIfNeeded();
  const mb2 = await map.boundingBox();
  const px = mb2.x + mb2.width - 20, py = mb2.y + clickY;
  const probe = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el ? el.tagName + "." + (el.className.baseVal !== undefined ? el.className.baseVal : el.className) : "none"; }, [px, py]);
  console.log("834 click", Math.round(px), Math.round(py), "->", probe, "| map", JSON.stringify(mb2), "| clickY", Math.round(clickY));
  await page.mouse.click(px, py);
  try {
    await page.waitForFunction(() => !document.querySelector("#clearRouteStart")?.disabled, null, { timeout: 15000 });
    console.log("834 START SET OK");
  } catch { console.log("834 START FAILED"); }
  await browser.close();
})();
