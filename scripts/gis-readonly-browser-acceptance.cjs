// Browser-only GIS checks. Every API request is intercepted; no database is used.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const address = process.env.GIS_TEST_FRONTEND || 'http://127.0.0.1:3119';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    let watch;
    window.gisTestFix = (latitude, longitude, accuracy) => watch?.({ coords: { latitude, longitude, accuracy }, timestamp: Date.now() });
    Object.defineProperty(navigator, 'geolocation', { value: { watchPosition(success) { watch = success; return 1; }, clearWatch() { watch = null; } } });
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body = {};
    if (path === '/api/maps/route') {
      const {start,destination} = route.request().postDataJSON();
      body = {provider:'osrm', routes:[[8.4,16],[9.1,18],[9.8,20]].map(([distanceKm,durationMinutes],i) => ({
        id:`route_${i+1}`,label:`Route ${i+1}`,provider:'osrm',distanceKm,durationMinutes,isApproximate:false,
        geometry:{type:'LineString',coordinates:[[start.lng,start.lat],[(start.lng+destination.lng)/2+i*0.003,(start.lat+destination.lat)/2],[destination.lng,destination.lat]]},
        steps:[{name:`Mock road ${i+1}`,maneuver:{type:'turn',modifier:'right',location:[destination.lng,destination.lat]}}]
      }))};
    } else if (path === '/api/maps/snap') body = {available:false};
    else if (path.includes('/auth/') || path === '/api/me') body = { user: { id: 'mock-admin', name: 'Test Operator', role: 'Admin' } };
    else if (path === '/api/reports' || path === '/api/missing-persons') body = { reports: [] };
    else if (path === '/api/zones') body = { zones: [] };
    else if (path.includes('/incidents')) body = { incidents: [] };
    else if (path === '/api/alerts') body = { alerts: [] };
    else if (path === '/api/response-units') body = { units: [], summary: {} };
    else if (path === '/api/police-stations') body = { stations: [] };
    else if (path.includes('feeds')) body = { cameras: [] };
    else if (path.includes('sources')) body = { sources: [] };
    else if (path.includes('evidence')) body = { evidence: [], videoEvidence: [] };
    else if (path.includes('observations')) body = { observations: [] };
    else if (path.includes('device')) body = { devices: [] };
    else if (path.includes('audit')) body = { auditLogs: [] };
    else if (path.includes('integration')) body = { integrations: [] };
    else if (path.includes('police-users')) body = { users: [] };
    else if (path.includes('escalation')) body = { alerts: [] };
    else if (path.includes('sla')) body = { config: [] };
    else if (path.includes('erss')) body = { events: [], calls: [], triage: [], dispatchRequests: [], unitRequests: [], assistanceRequests: [], jurisdictionHistory: [], ownershipTransfers: [] };
    else if (path.includes('health')) body = { status: 'offline' };
    else if (path.includes('dashboard')) body = { summary: {} };
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('**/socket.io/**', (route) => route.abort());
  try {
    await page.goto(address, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    if (await page.locator('#loginForm input[name=email]').isVisible()) {
      await page.locator('#loginForm input[name=email]').fill('test@example.test');
      await page.locator('#loginForm input[name=password]').fill('test-password');
      await page.locator('#loginForm button[type=submit]').click();
    }
    await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible', timeout: 15000 });
    const nav = page.locator('.nav-item[data-view="gis"]');
    const group = nav.locator('xpath=ancestor::details[1]');
    if (!await group.evaluate((el) => el.open)) await group.locator('summary').click();
    await nav.click();
    await page.locator('#gisMap .leaflet-container').waitFor({ state: 'visible' });
    const sizes = [[1440,900],[1024,768],[834,1112],[768,1024],[390,844]];
    const measurements = [];
    for (const [width,height] of sizes) {
      await page.setViewportSize({width,height});
      await page.waitForTimeout(250);
      const measurement = await page.locator('#gisMap .map-search').evaluate((element) => {
        const search = element.getBoundingClientRect(), map = element.closest('#gisMap').getBoundingClientRect();
        return { left: search.left, right: search.right, mapLeft: map.left, mapRight: map.right, width: search.width, inputWidth: element.querySelector('input').getBoundingClientRect().width };
      });
      assert.ok(measurement.left >= Math.max(0,measurement.mapLeft) - 1 && measurement.right <= Math.min(width,measurement.mapRight) + 1, JSON.stringify({width,measurement}));
      assert.ok(measurement.inputWidth >= 90, JSON.stringify({width,measurement}));
      measurements.push({viewportWidth:width,viewportHeight:height,...measurement});
    }
    await page.setViewportSize({width:1440,height:900});
    await page.locator('#toggleLocationTracking').click();
    await page.evaluate(() => window.gisTestFix(17.53,78.26,25));
    await page.locator('#toggleFollowLocation').click();
    await page.waitForTimeout(1700);
    await page.evaluate(() => window.gisTestFix(17.531,78.261,25));
    await page.waitForTimeout(400);
    const center = await page.evaluate(() => {
      const map = document.querySelector('#gisMap .leaflet-container').getBoundingClientRect();
      const circle = document.querySelector('#gisMap .location-accuracy-circle').getBoundingClientRect();
      return { x: circle.left + circle.width/2 - map.left - map.width/2, y: circle.top + circle.height/2 - map.top - map.height/2 };
    });
    assert.ok(Math.abs(center.x) < 5 && Math.abs(center.y) < 5, JSON.stringify(center));
    const box = await page.locator('#gisMap .leaflet-container').boundingBox();
    await page.mouse.move(box.x + box.width/2,box.y + box.height/2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width/2 + 80,box.y + box.height/2 + 30,{steps:8}); await page.mouse.up();
    assert.equal(await page.locator('#toggleFollowLocation').getAttribute('aria-pressed'),'false');
    await page.locator('#toggleFollowLocation').click();
    assert.equal(await page.locator('#toggleFollowLocation').getAttribute('aria-pressed'),'true');
    await page.locator('#toggleLocationTracking').click();
    await page.locator('#resetGisMap').click();
    const map = page.locator('#gisMap .leaflet-container');
    for (const [selector,x,y,clear] of [['#setMapStart',.42,.48,'#clearRouteStart'],['#setMapDestination',.63,.64,'#clearRouteDestination']]) {
      await page.locator(selector).click();
      await map.scrollIntoViewIfNeeded();
      const bounds = await map.boundingBox();
      await page.mouse.click(bounds.x+bounds.width*x,Math.min(bounds.y+bounds.height*y, bounds.y+bounds.height-10));
      await page.waitForFunction((id) => !document.querySelector(id)?.disabled, clear);
    }
    await page.locator('#navigateMap').click();
    const options = page.locator('#routeOptionsPanel .route-option-card');
    await options.nth(2).waitFor({state:'visible'});
    assert.equal(await options.count(),3);
    for (const [index,distance,minutes] of [[0,'8.40','16'],[1,'9.10','18'],[2,'9.80','20']]) {
      await options.nth(index).click();
      assert.match(await page.locator('#routeDistance').innerText(),new RegExp(distance));
      assert.match(await page.locator('#routeEta').innerText(),new RegExp(minutes));
      assert.match(await page.locator('#routeSteps').innerText(),new RegExp(`Mock road ${index+1}`));
      assert.equal(await page.locator('#gisMap path.leaflet-route-line').count(),3);
    }
    console.log(JSON.stringify({ responsive: measurements, followCenterOffset: center, manualPanDisabledFollow: true, followReenabled: true, mockRoutesDisplayed: 3, pageErrors }));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
