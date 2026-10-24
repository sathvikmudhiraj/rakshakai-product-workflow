const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.addInitScript(() => {
      let callback;
      window.sendTestFix = (latitude, longitude, accuracy) => callback?.({ coords: { latitude, longitude, accuracy }, timestamp: Date.now() });
      Object.defineProperty(navigator, 'geolocation', { value: {
        watchPosition(success) { callback = success; setTimeout(() => window.sendTestFix(17.53, 78.26, 40), 0); return 1; },
        clearWatch() { callback = null; }
      } });
    });
    await page.goto('http://127.0.0.1:3001/', { waitUntil: 'domcontentloaded' });
    await page.locator('#loginForm input[name=email]').fill('admin@rakshakai.local');
    await page.locator('#loginForm input[name=password]').fill(process.env.NAV_DEMO_PASSWORD || 'demo123');
    await page.locator('#loginForm button[type=submit]').click();
    await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible', timeout: 25000 });
    const nav = page.locator('.nav-item[data-view="gis"]');
    const group = nav.locator('xpath=ancestor::details[1]');
    if (!await group.evaluate(el => el.open)) await group.locator('summary').click();
    await nav.click();
    await page.locator('#toggleLocationTracking').click();
    const circle = page.locator('#gisMap .location-accuracy-circle');
    await circle.waitFor({ state: 'visible', timeout: 15000 });
    const firstWidth = (await circle.boundingBox()).width;
    await page.locator('#toggleFollowLocation').click();
    // shouldRecenterFollow throttles camera pans to one per 1.5s; wait it out before the next fix.
    await page.waitForTimeout(1600);
    await page.evaluate(() => window.sendTestFix(17.531, 78.261, 25));
    await page.waitForFunction(width => {
      const circle = document.querySelector('#gisMap .location-accuracy-circle');
      return circle && circle.getBoundingClientRect().width < width * 0.8;
    }, firstWidth, { timeout: 15000 });
    const geometry = await page.evaluate(() => {
      const map = document.querySelector('#gisMap .leaflet-container').getBoundingClientRect();
      const circle = document.querySelector('#gisMap .location-accuracy-circle').getBoundingClientRect();
      return { offsetX: (circle.left + circle.width / 2) - (map.left + map.width / 2), offsetY: (circle.top + circle.height / 2) - (map.top + map.height / 2), width: circle.width };
    });
    if (Math.abs(geometry.offsetX) > 5 || Math.abs(geometry.offsetY) > 5 || geometry.width <= 0) throw Error(`Follow center/circle mismatch: ${JSON.stringify(geometry)}`);
    const map = page.locator('#gisMap .leaflet-container');
    await map.scrollIntoViewIfNeeded();
    const box = await map.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 30, { steps: 8 }); await page.mouse.up();
    if (await page.locator('#toggleFollowLocation').getAttribute('aria-pressed') !== 'false') throw Error('Manual pan did not stop follow mode');
    await page.locator('#toggleLocationTracking[aria-pressed="true"]').click();
    await page.locator('#toggleFollowLocation:disabled').waitFor({ state: 'visible', timeout: 5000 });
    console.log(JSON.stringify({ pass: true, source: 'Playwright simulated geolocation', accuracyMetres: 25, geometry, manualPanStopsFollow: true, stopDisablesFollow: true }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
