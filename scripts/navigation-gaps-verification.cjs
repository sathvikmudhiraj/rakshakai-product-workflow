const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.NAV_BASE_URL || 'http://localhost:3000';
const output = process.env.NAV_REPORT_PATH || path.join(process.env.TEMP || '.', 'rakshak-navigation-gaps.json');
const users = [ ['admin','admin@rakshakai.local'], ['police','police@rakshakai.local'], ['citizen','citizen@rakshakai.local'] ].filter(([role]) => !process.env.NAV_ROLE || process.env.NAV_ROLE === role);
const report = {};
let until = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitWindow() { const ms = until - Date.now(); if (ms > 0) { console.log(`Waiting ${Math.ceil(ms/1000)}s for API quota reset`); await delay(ms+1000); } }
async function test(out, name, action) {
  if (process.env.NAV_CHECK && !process.env.NAV_CHECK.split(',').includes(name)) return;
  await waitWindow();
  try { out.checks[name] = { pass: true, detail: await action() }; }
  catch (e) { out.checks[name] = { pass: false, error: e.message.split('\n')[0] }; }
  fs.writeFileSync(output, JSON.stringify(report,null,2));
  console.log(`${out.role} ${name}: ${out.checks[name].pass ? 'PASS' : out.checks[name].error}`);
}
async function view(page, name) {
  await page.waitForFunction(v => document.body.dataset.view === v, name, {timeout:20000});
  if (!await page.locator(`.view.active[data-panel="${name}"]`).isVisible()) throw Error(`${name} panel not visible`);
}
async function clickView(page, name) {
  const item=page.locator(`.nav-item[data-view="${name}"]`);
  const group=item.locator('xpath=ancestor::details[1]');
  if (!await group.evaluate(el=>el.open)) await group.locator('summary').click();
  await item.click(); await view(page,name);
}
async function request(page, endpoint, options) {
  const response=await page.request.fetch(base+endpoint, options || {});
  if (response.status()===429) { const sec=Number(response.headers()['retry-after']); if (Number.isFinite(sec)) until=Math.max(until,Date.now()+(sec+1)*1000); throw Error('API quota reached'); }
  return response;
}
async function notification(page, entityId, expectedView, notificationId) {
  const response=await request(page,'/api/notifications');
  if (!response.ok()) throw Error(`notifications ${response.status()}`);
  const n=(await response.json()).notifications.find(x=>x.entityId===entityId && (!notificationId || x.id===notificationId));
  if (!n) throw Error('fixture notification not available to this role');
  const details=await request(page,`/api/notifications/${encodeURIComponent(n.id)}/details`);
  if (!details.ok()) throw Error(`notification details ${details.status()}`);
  const record=(await details.json()).detail.record;
  await page.locator('.notification-launcher').click();
  const drawer=page.locator('.notification-drawer[aria-hidden="false"]');
  await drawer.waitFor({state:'visible'});
  const back=drawer.locator('.notification-back');
  if(await back.isVisible()) await back.click();
  const item=drawer.locator(`[data-notification-id="${n.id}"]`);
  await item.waitFor({state:'visible',timeout:20000});
  await item.locator('.notification-view').click();
  await drawer.locator('.notification-open-related').waitFor({state:'visible',timeout:20000});
  await drawer.locator('.notification-open-related').click();
  await drawer.waitFor({state:'hidden',timeout:20000});
  await view(page,expectedView);
  return { type:n.entityType, notificationType:n.type, entityId:n.entityId, destination:expectedView, sourceType:record.sourceType, cameraId:record.cameraId };
}
(async()=>{
  const preflight=await fetch(base+'/api/auth/me');
  if(preflight.status===429){const seconds=Number(preflight.headers.get('retry-after')); if(!Number.isFinite(seconds)||seconds<0)throw Error('Rate limit did not provide a usable reset'); until=Date.now()+(seconds+1)*1000;}
  const browser=await chromium.launch({headless:true});
  try { for (const [role,email] of users) {
    await waitWindow();
    const context=await browser.newContext({viewport:{width:1440,height:900}}), page=await context.newPage();
    const out=report[role]={role, checks:{}, errors:[], network:[]};
    page.on('pageerror',e=>out.errors.push(e.message));
    page.on('response',r=>{ if (r.url().includes('/api/') && r.status()>=400) { out.network.push({status:r.status(),path:new URL(r.url()).pathname}); if(r.status()===429){const n=Number(r.headers()['retry-after']); if(Number.isFinite(n))until=Math.max(until,Date.now()+(n+1)*1000);} } });
    try {
      await page.goto(base,{waitUntil:'domcontentloaded'});
      await page.locator('#loginForm input[name=email]').fill(email);
      await page.locator('#loginForm input[name=password]').fill(process.env.NAV_DEMO_PASSWORD||'demo123');
      await page.locator('#loginForm button[type=submit]').click();
      await page.locator('#appShell:not(.app-hidden)').waitFor({state:'visible',timeout:20000});
      console.log(`${role}: authenticated once`);
      if(role==='admin') {
        await test(out,'erss-call-taker-ui',async()=>{ await clickView(page,'erss-call-taker'); await page.goto(base+'/erss-call-taker',{waitUntil:'domcontentloaded'}); await view(page,'erss-call-taker'); await page.reload({waitUntil:'domcontentloaded'}); await view(page,'erss-call-taker'); return {view:await page.evaluate(()=>document.body.dataset.view),path:new URL(page.url()).pathname}; });
        await test(out,'erss-call-taker-api',async()=>{ const r=await request(page,'/api/erss/calls/nonexistent_navigation_fixture',{method:'PATCH',data:{}}); if(r.status()!==404) throw Error(`Expected missing call 404 after authorization, got ${r.status()}`); return {status:r.status()}; });
        await test(out,'missing-notification-target',async()=>{ const r=await request(page,'/api/notifications/ntf_nav_missing_20261022/details'); if(r.status()!==404)throw Error(`Expected 404, got ${r.status()}`); await page.locator('.notification-launcher').click(); const drawer=page.locator('.notification-drawer[aria-hidden="false"]'); const item=drawer.locator('[data-notification-id="ntf_nav_missing_20261022"]'); await item.waitFor({state:'visible',timeout:20000}); await item.locator('.notification-view').click(); const error=drawer.locator('.notification-detail-loading'); await error.waitFor({state:'visible',timeout:20000}); await page.waitForFunction(()=>document.querySelector('.notification-detail-loading')?.textContent?.toLowerCase().includes('not found'),null,{timeout:20000}); const message=await error.innerText(); await drawer.locator('.notification-close').click(); return {status:r.status(),message}; });
        if(await page.locator('.notification-drawer[aria-hidden="false"]').isVisible())await page.locator('.notification-close').click();
      }
      if(role==='police') await test(out,'gis-refresh',async()=>{
        await clickView(page,'gis'); await page.reload({waitUntil:'domcontentloaded'}); await view(page,'gis');
        await page.locator('#gisMap .leaflet-container, #gisMap.leaflet-container').first().waitFor({state:'visible',timeout:30000});
        const map=await page.locator('#gisMap').boundingBox(); if(!map||map.width<100||map.height<100)throw Error('GIS map has no usable dimensions');
        return {path:new URL(page.url()).pathname,width:map.width,height:map.height,tiles:await page.locator('#gisMap img.leaflet-tile-loaded').count()};
      });
      if(role!=='citizen') {
        await test(out,'evidence-notification',async()=>{
          const info=await notification(page,'obs_nav_fixture_20261022','video-evidence');
          if(info.sourceType!=='evidence_image'||info.cameraId!==null)throw Error('unexpected evidence source');
          const button=page.getByRole('button',{name:'Review AI observation obs_nav_fixture_20261022'});
          await button.waitFor({state:'visible',timeout:20000}); await button.click(); await view(page,'cctv');
          await page.locator('[data-observation-id="obs_nav_fixture_20261022"]').waitFor({state:'visible',timeout:20000});
          return {...info,review:'cctv observation queue'};
        });
        if(await page.locator('.notification-drawer[aria-hidden="false"]').isVisible())await page.locator('.notification-close').click();
        await test(out,'other-notification-destinations',async()=>{
          const r=await request(page,'/api/notifications'); if(!r.ok())throw Error(`notifications ${r.status()}`);
          const items=(await r.json()).notifications, checked=[];
          for(const [type,destination] of [['incident','incident-command'],['camera','cctv'],['evidence','video-evidence'],['report','missing']]) {
            let selected;
            for(const item of items.filter(x=>x.entityType===type && x.id!=='ntf_nav_missing_20261022').slice(0,3)) {
              const detail=await request(page,`/api/notifications/${encodeURIComponent(item.id)}/details`);
              if(detail.ok()){selected=item;break;}
            }
            if(!selected){checked.push({type,available:false});continue;}
            checked.push(await notification(page,selected.entityId,destination,selected.id));
          }
          const escalation=items.find(x=>x.entityType==='incident' && /escalation|breach/.test(x.type));
          if(escalation) checked.push(await notification(page,escalation.entityId,'incident-command',escalation.id));
          return checked;
        });
        if(await page.locator('.notification-drawer[aria-hidden="false"]').isVisible())await page.locator('.notification-close').click();
      }
      if(role==='citizen') await test(out,'report-notification',()=>notification(page,'report_nav_fixture_20261022','missing'));
      if(role==='police') await test(out,'unauthorized-evidence',async()=>{ const r=await request(page,'/api/video-evidence/evd_13d792b2/analyses'); if(![403,404].includes(r.status()))throw Error(`Expected 403/404, got ${r.status()}`); const body=await r.text(); if(body.includes('storageKey')||body.includes('detections'))throw Error('Unauthorized response exposed evidence metadata'); const detail=await request(page,'/api/notifications/ntf_616b7b9a52ab0d1cf84b/details'); if(![403,404].includes(detail.status()))throw Error(`Expected notification denial, got ${detail.status()}`); const list=await request(page,'/api/notifications'); if(!list.ok())throw Error(`Notification list returned ${list.status()}`); if((await list.json()).notifications.some(n=>n.id==='ntf_616b7b9a52ab0d1cf84b'))throw Error('Unauthorized notification was listed'); return {status:r.status(),notificationStatus:detail.status(),listed:false}; });
      if(await page.locator('.notification-drawer[aria-hidden="false"]').isVisible())await page.locator('.notification-close').click();
      for(const [width,height] of [[1440,900],[768,1024],[390,844]]) await test(out,`responsive-${width}`,async()=>{
        await page.setViewportSize({width,height});
        const target=role==='citizen'?'missing':'dashboard'; await clickView(page,target);
        const group=page.locator('.nav-group:visible').first(), summary=group.locator('summary');
        await summary.click(); await summary.click();
        if(role==='citizen') { await page.goto(base+'/random-invalid-route',{waitUntil:'domcontentloaded'}); await view(page,'missing'); await page.goBack({waitUntil:'domcontentloaded'}); await view(page,'missing'); await page.goForward({waitUntil:'domcontentloaded'}); await view(page,'missing'); }
        else { await clickView(page,'incident-command'); await page.goBack({waitUntil:'domcontentloaded'}); await view(page,'dashboard'); await page.goForward({waitUntil:'domcontentloaded'}); await view(page,'incident-command'); }
        await page.reload({waitUntil:'domcontentloaded'}); await view(page,role==='citizen'?'missing':'incident-command');
        const nav=await page.locator('.sidebar').boundingBox(); const body=await page.locator('body').boundingBox();
        if(!nav||!body)throw Error('Navigation not visible');
        const documentWidth=await page.evaluate(()=>document.documentElement.scrollWidth); if(documentWidth>width+1)throw Error(`Page overflows horizontally: ${documentWidth}px`);
        return {view:role==='citizen'?'missing':'incident-command',sidebarWidth:nav.width,documentWidth,viewportWidth:width,historyAndRefresh:true};
      });
      await page.setViewportSize({width:1440,height:900});
      await test(out,'logout-back',async()=>{ if(role!=='citizen')await clickView(page,'cctv'); await page.locator('#logoutButton').click(); await page.locator('#loginForm').waitFor({state:'visible',timeout:20000}); await page.goBack({waitUntil:'domcontentloaded'}); await page.waitForTimeout(500); if(!await page.locator('#loginForm').isVisible()||await page.locator('#appShell:not(.app-hidden)').isVisible())throw Error('Protected shell usable after logout/back'); const r=await request(page,'/api/me'); const body=await r.json(); if(!r.ok() || body.user)throw Error('Session remained authenticated after logout'); return {loginVisible:true,sessionStatus:r.status(),user:body.user}; });
    } catch(e) { out.fatal=e.message.split('\n')[0]; console.log(`${role}: ${out.fatal}`); }
    finally { await context.close(); fs.writeFileSync(output,JSON.stringify(report,null,2)); }
  } } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
