const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const page = await context.newPage();
  page.on("response", (r) => { if (r.url().includes("/api/maps/search")) console.log("SEARCH API", r.status(), decodeURIComponent(r.url().split("q=")[1] || "")); });
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
  await page.locator("#loginForm input[name=email]").fill("admin@rakshakai.local");
  await page.locator("#loginForm input[name=password]").fill("demo123");
  await page.locator("#loginForm button[type=submit]").click();
  await page.locator("#appShell:not(.app-hidden)").waitFor({ state: "visible", timeout: 30000 });
  await page.goto("http://localhost:3000/gis", { waitUntil: "domcontentloaded" });
  const map = page.locator("#gisMap .leaflet-container");
  await map.waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#gisMap .map-search input").fill("Warangal");
  console.log("filled, waiting up to 40s for results...");
  try {
    await page.locator("#gisMap .map-search-results .map-search-result").first().waitFor({ state: "visible", timeout: 40000 });
    console.log("RESULTS OK:", await page.locator("#gisMap .map-search-results .map-search-result").count());
  } catch {
    const count = await page.locator("#gisMap .map-search-results").count();
    const html = count ? await page.locator("#gisMap .map-search-results").first().evaluate((el) => el.outerHTML.slice(0, 250)) : "none";
    console.log("NO RESULTS. containers:", count, html);
  }
  await browser.close();
})();
