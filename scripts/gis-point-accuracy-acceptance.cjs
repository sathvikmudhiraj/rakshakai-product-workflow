// Read-only GIS point selection against the local app; records raw snap requests.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let errors = 0, http500 = 0;
  page.on('pageerror', () => errors++);
  page.on('response', response => { if (response.url().startsWith('http://localhost:3001') && response.status() === 500) http500++; });
  try {
    await page.goto('http://localhost:3001/');
    await page.locator('#loginForm input[name=email]').fill('admin@rakshakai.local');
    await page.locator('#loginForm input[name=password]').fill(process.env.GIS_ADMIN_PASSWORD);
    await page.locator('#loginForm button[type=submit]').click();
    await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible', timeout: 30000 });
    await page.goto('http://localhost:3001/gis');
    const map = page.locator('#gisMap .leaflet-container'); await map.waitFor({state:'visible'});
    await page.locator('#resetGisMap').click();
    for (const checkbox of await page.locator('#gisMap [data-map-layer-toggle]').all()) if (await checkbox.isChecked()) await checkbox.uncheck();
    const cards = page.locator('#routePointCards .route-point-card');
    assert.equal(await cards.nth(0).locator('strong').innerText(), 'Not selected');
    assert.equal(await cards.nth(1).locator('strong').innerText(), 'Not selected');
    for (const [index,selector,marker] of [[0,'#setMapStart','.start-marker'],[1,'#setMapDestination','.destination-marker']]) {
      for (const [x,y] of [[.3,.35],[.55,.45],[.7,.7]]) {
        await page.locator(selector).click(); assert.equal(await page.locator(selector).getAttribute('aria-pressed'),'true');
        const requestPromise = page.waitForRequest(r => r.url().includes('/api/maps/snap') && r.method() === 'POST');
        await map.scrollIntoViewIfNeeded(); const box=await map.boundingBox(); await page.mouse.click(box.x+box.width*x,box.y+box.height*y);
        const request=await requestPromise; const raw=request.postDataJSON();
        const snap = await (await request.response()).json();
        assert.equal(snap.available, false, 'This accuracy check expects OSRM to be unavailable');
        await page.waitForFunction(({index,lat,lng}) => document.querySelectorAll('#routePointCards .route-point-card')[index]?.querySelector('small')?.textContent.includes(`${lat.toFixed(5)}, ${lng.toFixed(5)}`), {index,lat:raw.lat,lng:raw.lng}, {timeout:25000});
        assert.equal(await page.locator(`#gisMap ${marker}`).count(),1);
        assert.match(await page.locator('#mapNavigationStatus').innerText(), /snap.*unavailable.*clicked location/i);
        console.log(`${index ? 'destination' : 'start'} raw ${raw.lat.toFixed(5)},${raw.lng.toFixed(5)}; displayed raw; snap unavailable`);
      }
    }
    const coordinates = () => cards.locator('small:first-of-type').allTextContents();
    const before = await coordinates();
    await map.scrollIntoViewIfNeeded(); const box=await map.boundingBox(); await page.mouse.click(box.x+box.width*.4,box.y+box.height*.8);
    assert.deepEqual(await coordinates(), before);
    for (const selector of ['#setMapStart','#setMapDestination']) { await page.locator(selector).click(); await page.keyboard.press('Escape'); assert.equal(await page.locator(selector).getAttribute('aria-pressed'),'false'); assert.deepEqual(await coordinates(),before); }
    assert.equal(errors,0); assert.equal(http500,0);
    console.log('PASS: three start and destination raw-coordinate selections, normal click safety, both Escape cancellations');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode=1; });
