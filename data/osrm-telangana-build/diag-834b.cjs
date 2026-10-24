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

  const attempts = [
    ["right-20,+200", (mb) => [mb.x + mb.width - 20, mb.y + 200]],
    ["right-20,+338", (mb) => [mb.x + mb.width - 20, mb.y + 338]],
    ["right-80,+338", (mb) => [mb.x + mb.width - 80, mb.y + 338]],
    ["42%/48%", (mb) => [mb.x + mb.width * 0.42, mb.y + mb.height * 0.48]],
  ];
  for (const [label, calc] of attempts) {
    await page.locator("#resetGisMap").click();
    await page.locator("#setMapStart").click();
    await map.scrollIntoViewIfNeeded();
    const mb = await map.boundingBox();
    const [px, py] = calc(mb);
    await page.mouse.click(px, py);
    let ok = false;
    try {
      await page.waitForFunction(() => !document.querySelector("#clearRouteStart")?.disabled, null, { timeout: 8000 });
      ok = true;
    } catch {}
    console.log(label, "->", ok ? "SET" : "not set");
    if (ok) await page.locator("#clearRouteStart").click();
  }
  await browser.close();
})();
