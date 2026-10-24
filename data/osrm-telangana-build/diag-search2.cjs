const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on("response", (r) => { if (r.url().includes("/api/maps/")) console.log("API", r.request().method(), r.url().replace("http://localhost:3001", "").slice(0, 90), r.status()); });
  await page.goto("http://localhost:3001", { waitUntil: "domcontentloaded" });
  await page.locator("#loginForm input[name=email]").fill("admin@rakshakai.local");
  await page.locator("#loginForm input[name=password]").fill("demo123");
  await page.locator("#loginForm button[type=submit]").click();
  await page.locator("#appShell:not(.app-hidden)").waitFor({ state: "visible", timeout: 30000 });
  await page.goto("http://localhost:3001/gis", { waitUntil: "domcontentloaded" });
  await page.locator("#gisMap .leaflet-container").waitFor({ state: "visible", timeout: 30000 });

  const input = page.locator("#gisMap .map-search input");
  await input.fill("Warangal");
  await input.press("Enter");
  try {
    await page.locator("#gisMap .map-search-results .map-search-result").first().waitFor({ state: "visible", timeout: 20000 });
    console.log("PLAIN SEARCH OK");
  } catch { console.log("PLAIN SEARCH FAILED"); }

  // Now the route/nav sequence, then search again.
  await page.keyboard.press("Escape");
  await page.locator("#resetGisMap").click();
  const map = page.locator("#gisMap .leaflet-container");
  const setPoint = async (button, clearButton, xf, yf) => {
    await page.locator(button).click();
    await map.scrollIntoViewIfNeeded();
    const mb = await map.boundingBox();
    await page.mouse.click(mb.x + mb.width * xf, mb.y + mb.height * yf);
    await page.waitForFunction((sel) => !document.querySelector(sel)?.disabled, clearButton, { timeout: 30000 });
  };
  await setPoint("#setMapStart", "#clearRouteStart", 0.4, 0.5);
  await setPoint("#setMapDestination", "#clearRouteDestination", 0.6, 0.62);
  await page.locator("#navigateMap").click();
  await page.waitForFunction(() => document.querySelector("#routeDistance")?.textContent !== "--", null, { timeout: 30000 });
  console.log("ROUTE OK:", await page.locator("#routeDistance").innerText());
  await page.locator("#startNavigation").click();
  await page.locator("#activeNavigationPanel").waitFor({ state: "visible", timeout: 15000 });
  await page.locator("#endNavigation").click();
  await page.waitForTimeout(500);

  await input.fill("Warangal");
  await input.press("Enter");
  try {
    await page.locator("#gisMap .map-search-results .map-search-result").first().waitFor({ state: "visible", timeout: 20000 });
    console.log("POST-NAV SEARCH OK");
  } catch {
    console.log("POST-NAV SEARCH FAILED; results hidden =", await page.locator("#gisMap .map-search-results").evaluate((el) => el.hidden).catch(() => "n/a"), "; input value =", await input.inputValue());
  }
  await browser.close();
})();
