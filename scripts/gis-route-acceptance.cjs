// Live GIS acceptance. Uses an existing Admin session; changes only browser GIS state.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { io } = require('../backend/node_modules/socket.io-client');
const base = process.env.GIS_BASE_URL || 'http://localhost:3001';
const password = process.env.GIS_ADMIN_PASSWORD;
if (!password) throw new Error('Set GIS_ADMIN_PASSWORD in the environment');
const report = { checks: {}, pageErrors: [], http500: [], requestFailures: [] };
async function check(name, fn) {
  try { report.checks[name] = { pass: true, detail: await fn() }; }
  catch (error) { report.checks[name] = { pass: false, error: error.message.split('\n')[0] }; }
  console.log(`${name}: ${report.checks[name].pass ? 'PASS' : report.checks[name].error}`);
}
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('response', response => { if (response.url().startsWith(base) && response.status() === 500) report.http500.push(new URL(response.url()).pathname); });
  page.on('requestfailed', request => { if (!request.failure()?.errorText?.includes('ERR_ABORTED')) report.requestFailures.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }); });
  const countLines = () => page.locator('#gisMap path.leaflet-route-line').count();
  const point = index => page.locator('#routePointCards .route-point-card').nth(index);
  async function mapClick(button, x, y, clearButton) {
    await page.locator(button).click();
    const map = page.locator('#gisMap .leaflet-container');
    await map.scrollIntoViewIfNeeded();
    const box = await map.boundingBox();
    assert.ok(box && box.width > 100 && box.height > 100, 'Map is not visible');
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
    await page.waitForFunction(selector => !document.querySelector(selector)?.disabled, clearButton, { timeout: 25000 });
  }
  async function prepareTwoPointRoute() {
    await page.locator('#resetGisMap').click();
    for (const checkbox of await page.locator('#gisMap [data-map-layer-toggle]').all()) if (await checkbox.isChecked()) await checkbox.uncheck();
    await mapClick('#setMapStart', .42, .48, '#clearRouteStart');
    await mapClick('#setMapDestination', .63, .64, '#clearRouteDestination');
    assert.equal(await point(0).locator('strong').innerText() !== 'Not selected', true, 'Start not selected');
    assert.equal(await point(1).locator('strong').innerText() !== 'Not selected', true, 'Destination not selected');
    assert.equal(await page.locator('#navigateMap').isEnabled(), true, 'Calculate Route disabled');
  }
  async function calculate() {
    await page.locator('#navigateMap').click();
    await page.waitForFunction(() => document.querySelector('#routeDistance')?.textContent !== '--', null, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('#gisMap path.leaflet-route-line').length > 0, null, { timeout: 15000 });
  }
  async function assertCleared() {
    await page.waitForFunction(() => document.querySelectorAll('#gisMap path.leaflet-route-line').length === 0);
    assert.equal(await page.locator('#routeDistance').innerText(), '--');
    assert.equal(await page.locator('#routeEta').innerText(), '--');
    assert.equal(await page.locator('#routeProvider').innerText(), 'No route');
  }
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('#loginForm input[name=email]').fill('admin@rakshakai.local');
    await page.locator('#loginForm input[name=password]').fill(password);
    await page.locator('#loginForm button[type=submit]').click();
    await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible', timeout: 30000 });
    const cookies = (await context.cookies(base)).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    for (const transport of ['websocket', 'polling']) await check(`socket ${transport}`, async () => {
      const socket = io(base, { transports: [transport], extraHeaders: { Cookie: cookies }, reconnection: false, timeout: 10000 });
      try { await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }); return { connected: true, transport: socket.io.engine.transport.name }; }
      finally { socket.close(); }
    });
    await page.goto(base + '/gis', { waitUntil: 'domcontentloaded' });
    await page.locator('#gisMap .leaflet-container').waitFor({ state: 'visible', timeout: 30000 });
    await check('degraded route', async () => {
      await prepareTwoPointRoute(); await calculate();
      const distance = await page.locator('#routeDistance').innerText();
      const eta = await page.locator('#routeEta').innerText();
      assert.match(distance, /straight-line/i); assert.equal(eta, 'Unavailable');
      assert.match(await page.locator('#mapNavigationStatus').innerText(), /road routing unavailable/i);
      const dash = await page.locator('#gisMap path.leaflet-route-line.approximate').first().getAttribute('stroke-dasharray');
      assert.ok(dash, 'Approximate route is not dashed'); return { distance, eta, dash };
    });
    await check('clear destination', async () => { await page.locator('#clearRouteDestination').click(); await assertCleared(); assert.equal(await point(1).locator('strong').innerText(), 'Not selected'); return { lines: await countLines() }; });
    await check('clear start', async () => { await prepareTwoPointRoute(); await calculate(); await page.locator('#clearRouteStart').click(); await assertCleared(); assert.equal(await point(0).locator('strong').innerText(), 'Not selected'); assert.notEqual(await point(1).locator('strong').innerText(), 'Not selected'); });
    await check('clear route', async () => { await prepareTwoPointRoute(); await calculate(); await page.locator('#clearMapRoute').click(); await assertCleared(); assert.notEqual(await point(0).locator('strong').innerText(), 'Not selected'); assert.notEqual(await point(1).locator('strong').innerText(), 'Not selected'); });
    await check('swap', async () => { await prepareTwoPointRoute(); await calculate(); const oldStart = await point(0).locator('small').first().innerText(), oldDestination = await point(1).locator('small').first().innerText(); await page.locator('#swapRoutePoints').click(); await assertCleared(); assert.equal(await point(0).locator('small').first().innerText(), oldDestination); assert.equal(await point(1).locator('small').first().innerText(), oldStart); });
    await check('reset map', async () => { await prepareTwoPointRoute(); await calculate(); await page.locator('#resetGisMap').click(); await assertCleared(); assert.equal(await point(0).locator('strong').innerText(), 'Not selected'); assert.equal(await point(1).locator('strong').innerText(), 'Not selected'); });
    await check('satellite route', async () => { await prepareTwoPointRoute(); await calculate(); const distance = await page.locator('#routeDistance').innerText(), eta = await page.locator('#routeEta').innerText(); await page.locator('#satelliteMapLayer').click(); await page.waitForTimeout(1200); assert.equal(await page.locator('#satelliteMapLayer').getAttribute('aria-pressed'), 'true', 'Satellite did not remain active'); assert.ok(await countLines()); assert.ok(await page.locator('#gisMap .start-marker').count()); assert.ok(await page.locator('#gisMap .destination-marker').count()); assert.equal(await page.locator('#routeDistance').innerText(), distance); assert.equal(await page.locator('#routeEta').innerText(), eta); await page.locator('#streetMapLayer').click(); assert.ok(await countLines()); });
    for (const [name, width, height] of [['desktop',1440,900],['tablet',834,1112],['mobile',390,844]]) await check(`responsive ${name}`, async () => {
      await page.setViewportSize({ width, height });
      for (const selector of ['#streetMapLayer','#satelliteMapLayer','#setMapStart','#setMapDestination','#navigateMap','#clearMapRoute','#routePointCards','#routeDistance','#routeEta']) {
        const element = page.locator(selector); await element.scrollIntoViewIfNeeded(); assert.equal(await element.isVisible(), true, `${selector} hidden`);
        const rect = await element.evaluate(el => { const r=el.getBoundingClientRect(); return {left:r.left,right:r.right,width:r.width,height:r.height}; });
        assert.ok(rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.right <= width + 1, `${selector} clipped`);
      }
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth); assert.ok(documentWidth <= width + 1, `horizontal overflow ${documentWidth}`);
    });
  } catch (error) { report.fatal = error.message.split('\n')[0]; }
  finally { await browser.close(); console.log(JSON.stringify(report, null, 2)); }
  if (report.fatal || Object.values(report.checks).some(item => !item.pass) || report.pageErrors.length || report.http500.length) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
