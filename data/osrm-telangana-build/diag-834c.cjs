const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 834, height: 1112 } });
  const page = await context.newPage();
  page.on("response", async (r) => {
    if (r.url().includes("/api/maps/snap") || r.url().includes("/api/maps/geocode")) {
      let body = "";
      try { body = (await r.text()).slice(0, 200); } catch {}
      console.log(r.request().method(), r.url().replace("http://localhost:3000", ""), r.status(), body);
    }
  });
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
  await page.locator("#loginForm input[name=email]").fill("admin@rakshakai.local");
  await page.locator("#loginForm input[name=password]").fill("demo123");
  await page.locator("#loginForm button[type=submit]").click();
  await page.locator("#appShell:not(.app-hidden)").waitFor({ state: "visible", timeout: 30000 });
  await page.goto("http://localhost:3000/gis", { waitUntil: "domcontentloaded" });
  const map = page.locator("#gisMap .leaflet-container");
  await map.waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#resetGisMap").click();
  await page.locator("#setMapStart").click();
  await map.scrollIntoViewIfNeeded();
  const mb = await map.boundingBox();
  console.log("status text:", await page.locator("#mapNavigationStatus").innerText().catch(() => "n/a"));
  await page.mouse.click(mb.x + mb.width - 20, mb.y + 338);
  await page.waitForTimeout(9000);
  console.log("status after:", await page.locator("#mapNavigationStatus").innerText().catch(() => "n/a"));
  console.log("clearRouteStart disabled:", await page.locator("#clearRouteStart").evaluate((el) => el.disabled));
  await browser.close();
})();
