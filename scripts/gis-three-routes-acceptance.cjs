// Read-only browser acceptance with a deterministic map-route API response.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto('http://localhost:3001/', { waitUntil: 'domcontentloaded' });
    await page.locator('#loginForm input[name=email]').fill('admin@rakshakai.local');
    await page.locator('#loginForm input[name=password]').fill(process.env.GIS_ADMIN_PASSWORD);
    await page.locator('#loginForm button[type=submit]').click();
    await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible', timeout: 30000 });
    await page.goto('http://localhost:3001/gis');
    await page.locator('#gisMap .leaflet-container').waitFor({ state: 'visible' });
    await page.route('**/api/maps/route', async (intercept) => {
      const { start, destination } = intercept.request().postDataJSON();
      const routes = [ [8.4,16], [9.1,18], [9.8,20] ].map(([distanceKm,durationMinutes], i) => ({
        id: `route_${i+1}`, label: i ? `Alternate ${i+1}` : 'Fastest', provider: 'osrm',
        distanceKm, durationMinutes, isApproximate: false, calculatedAt: '2026-10-22T00:00:00Z',
        geometry: { type: 'LineString', coordinates: [[start.lng,start.lat],[(start.lng+destination.lng)/2 + i*0.003,(start.lat+destination.lat)/2], [destination.lng,destination.lat]] },
        steps: [`Turn for route ${i+1}`]
      }));
      await intercept.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'osrm', routes }) });
    });
    await page.locator('#resetGisMap').click();
    for (const checkbox of await page.locator('#gisMap [data-map-layer-toggle]').all()) if (await checkbox.isChecked()) await checkbox.uncheck();
    const map = page.locator('#gisMap .leaflet-container');
    for (const [selector,x,y,clear] of [['#setMapStart',.42,.48,'#clearRouteStart'], ['#setMapDestination',.63,.64,'#clearRouteDestination']]) {
      await page.locator(selector).click(); await map.scrollIntoViewIfNeeded(); const box = await map.boundingBox();
      await page.mouse.click(box.x+box.width*x,box.y+box.height*y);
      await page.waitForFunction(s => !document.querySelector(s)?.disabled, clear, { timeout: 25000 });
    }
    await page.locator('#navigateMap').click();
    const options = page.locator('#routeOptionsPanel .route-option-card');
    await options.nth(2).waitFor({ state:'visible', timeout:30000 });
    assert.equal(await options.count(), 3);
    for (const [i, distance, eta] of [[0,'8.40','16'],[1,'9.10','18'],[2,'9.80','20']]) {
      await options.nth(i).click();
      assert.match(await page.locator('#routeDistance').innerText(), new RegExp(distance));
      assert.match(await page.locator('#routeEta').innerText(), new RegExp(eta));
      assert.match(await page.locator('#routeSteps').innerText(), new RegExp(`Turn for route ${i+1}`));
      assert.match(await options.nth(i).getAttribute('class'), /active/);
      assert.equal(await page.locator('#gisMap path.leaflet-route-line').count(), 3);
    }
    console.log('PASS: three mock API routes, selection, distance, ETA, steps and three map geometries');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
