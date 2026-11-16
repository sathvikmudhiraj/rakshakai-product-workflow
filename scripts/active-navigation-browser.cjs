// Mock-only browser test: every API request is intercepted; no database access.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[]; page.on('pageerror', error => errors.push(error.message));
  let requestCount=0, lastRouteRequest, degraded=false;
  await page.addInitScript(() => {
    let handler;
    window.testGps = (lat,lng,accuracy=10) => handler?.({coords:{latitude:lat,longitude:lng,accuracy},timestamp:Date.now()});
    Object.defineProperty(navigator,'geolocation',{value:{watchPosition(success){handler=success;return 1;},clearWatch(){handler=null;}}});
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), request = route.request();
    let payload = {user:{id:'admin',name:'Admin',role:'Admin'},summary:{},reports:[],zones:[],incidents:[],alerts:[],units:[],stations:[],devices:[],auditLogs:[],integrations:[],users:[],config:[],cameras:[],sources:[],videoEvidence:[],observations:[],events:[],notifications:[],health:{status:'offline'}};
    if (url.pathname === '/api/maps/snap') payload={available:false};
    if (url.pathname === '/api/maps/reverse') payload={place:null};
    if (url.pathname === '/api/maps/route') {
      lastRouteRequest=request.postDataJSON(); requestCount++;
      const {start,destination}=lastRouteRequest;
      if (degraded) { await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({provider:'haversine',isApproximate:true,routes:[{id:'estimate',provider:'haversine',isApproximate:true,distanceKm:3,durationMinutes:null,geometry:{type:'LineString',coordinates:[[start.lng,start.lat],[destination.lng,destination.lat]]}}]})}); return; }
      const routes=[1,2].map(i => ({id:`route_${i}`,label:`Route ${i}`,provider:'osrm',distanceKm:i===1?8:9,durationMinutes:i===1?16:20,geometry:{type:'LineString',coordinates:[[start.lng,start.lat],[destination.lng,destination.lat]]},steps:[{name:`Road ${i}`,maneuver:{type:'turn',modifier:'right',location:[destination.lng,destination.lat]}}]}));
      payload={provider:'osrm',routes};
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)});
  });
  try {
    await page.goto('http://127.0.0.1:3017/gis');
    await page.locator('#appShell:not(.app-hidden)').waitFor({state:'visible',timeout:25000});
    const map=page.locator('#gisMap .leaflet-container'); await map.waitFor({state:'visible'});
    assert.equal(await page.locator('#startNavigation').isDisabled(),true);
    for(const [selector,x,y,clear] of [['#setMapStart',.4,.45,'#clearRouteStart'],['#setMapDestination',.65,.65,'#clearRouteDestination']]) {
      await page.locator(selector).click(); await map.scrollIntoViewIfNeeded(); const box=await map.boundingBox(); await page.mouse.click(box.x+box.width*x,box.y+box.height*y);
      await page.waitForFunction(s=>!document.querySelector(s)?.disabled,clear);
    }
    await page.locator('#navigateMap').click();
    const cards=page.locator('#routeOptionsPanel .route-option-card'); await cards.nth(1).waitFor();
    await cards.nth(1).click(); assert.equal(await page.locator('#startNavigation').isEnabled(),true);
    const original=lastRouteRequest; await page.locator('#startNavigation').click();
    assert.match(await page.locator('#activeNavigationRoute').innerText(),/Route 2/);
    await page.evaluate(({lat,lng})=>window.testGps(lat,lng),original.start);
    await page.waitForFunction(()=>document.querySelector('#activeNavigationManeuver').textContent.includes('Road 2'));
    const initial=await page.locator('#activeNavigationProgress').innerText();
    const middle={lat:(original.start.lat+original.destination.lat)/2,lng:(original.start.lng+original.destination.lng)/2};
    await page.evaluate(({lat,lng})=>window.testGps(lat,lng),middle);
    await page.waitForFunction(initial=>document.querySelector('#activeNavigationProgress').textContent!==initial,initial);
    assert.match(await page.locator('#activeNavigationProgress').innerText(),/Estimated ETA/);
    for (const [width,height] of [[1440,900],[834,1112],[768,1024],[390,844]]) {
      await page.setViewportSize({width,height}); await page.locator('#activeNavigationPanel').scrollIntoViewIfNeeded();
      for (const selector of ['#activeNavigationManeuver','#activeNavigationProgress','#activeNavigationGps','#endNavigation']) {
        const el=page.locator(selector); assert.ok(await el.isVisible());
        const box=await el.boundingBox(); assert.ok(box.x>=-1 && box.x+box.width<=width+1,`${selector} clipped at ${width}`);
      }
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth)<=width+1, `horizontal overflow at ${width}`);
      if (width===390) await page.screenshot({path:require('node:os').tmpdir()+'/rakshak-active-navigation-mobile.png'});
    }
    await page.setViewportSize({width:1440,height:900});
    await page.locator('#endNavigation').click();
    assert.equal(await page.locator('#activeNavigationPanel').isVisible(),false);
    assert.equal(await page.locator('#toggleFollowLocation').isDisabled(),true);
    await page.locator('#startNavigation').click();
    await page.evaluate(({lat,lng})=>window.testGps(lat,lng),middle);
    await page.evaluate(({lat,lng})=>window.testGps(lat+.005,lng),middle);
    await page.waitForFunction(()=>document.querySelector('#activeNavigationGps').textContent.includes('Off route'));
    await page.locator('#navigationRecalculate').click(); await page.waitForFunction(()=>document.querySelector('#activeNavigationManeuver').textContent.includes('Road'));
    assert.equal(requestCount,2); assert.equal(lastRouteRequest.destination.lat,original.destination.lat);
    await page.evaluate(({lat,lng})=>window.testGps(lat,lng),original.destination);
    await page.locator('#activeNavigationPanel').waitFor({state:'hidden'});
    assert.match(await page.locator('#mapNavigationStatus').innerText(),/Destination reached/);
    degraded=true; await page.locator('#navigateMap').click();
    await page.waitForFunction(()=>document.querySelector('#routeEta').textContent==='Unavailable');
    assert.equal(await page.locator('#startNavigation').isDisabled(),true);
    assert.match(await page.locator('#navigationAvailability').innerText(),/turn-by-turn navigation unavailable/i);
    assert.equal(errors.length,0,errors.join('; '));
    console.log('PASS: mock-only selected Route 2, GPS progress, off-route, recalculation, destination preservation and arrival');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error.stack);process.exitCode=1});
