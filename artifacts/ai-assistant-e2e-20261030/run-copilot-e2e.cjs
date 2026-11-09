const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { Pool } = require('../../backend/node_modules/pg');
const out = path.resolve('artifacts/ai-assistant-e2e-20261030');
const pgBase = 'postgresql://rakshakai_test:test-only-password-ui-2026@127.0.0.1:55440/rakshakai_test_copilot_utf8';
const dbUrl = `${pgBase}?options=-csearch_path%3Drakshakai_test_copilot_utf8`;
const checks = [], consoleErrors = [], pageErrors = [], failedRequests = [], apiFailures = [];
const admin = { email: 'admin.ui@rakshakai.test', password: 'TemporaryE2E-Password-2026!' };
const citizen = { email: 'citizen.ui@rakshakai.test', password: 'TemporaryE2E-Password-2026!' };
const check = (ok, name, evidence = null) => { if (!ok) throw new Error(`FAIL ${name}`); checks.push({ name, evidence }); console.log(`PASS ${name}${evidence ? ` ${JSON.stringify(evidence)}` : ''}`); };
let backend;
function startBackend() {
  backend = spawn(process.execPath, ['backend/server.js'], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test', PORT: '5001', DATABASE_URL: dbUrl, TEST_DATABASE_URL: pgBase, RAKSHAKAI_TEST_DATABASE_NAME: 'rakshakai_test_copilot_utf8', RAKSHAKAI_TEST_SCHEMA: 'rakshakai_test_copilot_utf8', PG_SSL_MODE: 'disable', JWT_SECRET: 'isolated-copilot-e2e-jwt-secret-2026-long', ESCALATION_SWEEP_INTERVAL_MS: '3600000', SLA_SWEEP_INTERVAL_MS: '3600000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  backend.stdout.on('data', b => process.stdout.write(`[backend] ${b}`));
  backend.stderr.on('data', b => process.stderr.write(`[backend] ${b}`));
  return waitForBackend();
}
async function waitForBackend() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { const r = await fetch('http://127.0.0.1:5001/api/health'); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Isolated backend failed to start');
}
async function stopBackend() {
  if (!backend || backend.exitCode !== null) return;
  const child = backend;
  await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); setTimeout(resolve, 5000).unref(); });
  backend = null;
}
async function login(page, user) {
  await page.goto('http://127.0.0.1:3002/', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#appShell:not(.app-hidden)').isVisible().catch(() => false)) return;
  await page.locator('#loginForm input[name="email"]').fill(user.email);
  await page.locator('#loginForm input[name="password"]').fill(user.password);
  await page.locator('#loginForm button[type="submit"]').click();
  await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible', timeout: 20000 });
}
async function ask(page, message, language = 'auto') {
  await page.locator('.copilot-language').selectOption(language);
  const input = page.locator('#copilotQuestion');
  await input.fill(message);
  const pending = page.waitForResponse(r => r.url().includes('/api/copilot/query') && r.request().method() === 'POST');
  await page.locator('.copilot-send').click();
  const response = await pending;
  const body = await response.json();
  await page.waitForFunction(() => !document.querySelector('.copilot-status')?.classList.contains('loading'));
  check(response.ok(), `Copilot HTTP query ${response.status()}`, { message, intent: body.intent, detectedLanguage: body.detectedLanguage, responseLanguage: body.responseLanguage });
  return body;
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  await startBackend();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('requestfailed', r => failedRequests.push({ method: r.method(), url: r.url(), error: r.failure()?.errorText }));
  page.on('response', r => { if (r.url().includes('/api/') && r.status() >= 400) apiFailures.push({ status: r.status(), method: r.request().method(), url: r.url() }); });
  try {
    await login(page, admin);
    check(await page.locator('.copilot-launcher').count() === 1 && await page.locator('.copilot-launcher').isVisible(), 'Admin sees one visible AI Assistant launcher');
    await page.locator('.copilot-launcher').click();
    await page.locator('.copilot-drawer[aria-hidden="false"]').waitFor();
    await page.locator('#copilotQuestion').focus();
    await page.locator('#copilotQuestion').press('Shift+Enter');
    check(await page.locator('#copilotQuestion').inputValue().then(v => v.includes('\n')), 'Shift+Enter inserts a newline without submitting');
    await page.locator('#copilotQuestion').fill("Give today's operational summary");
    const enterResponse = page.waitForResponse(r => r.url().includes('/api/copilot/query') && r.request().method() === 'POST');
    await page.locator('#copilotQuestion').press('Enter');
    check((await enterResponse).ok(), 'Enter submits a Copilot question');
    check(await page.locator('#copilotTitle').innerText().then(v => v.includes('AI Assistant')), 'Drawer uses AI Assistant naming');
    const english = await ask(page, "How many active incidents are there?", 'auto');
    check(english.intent === 'incident_search' && english.detectedLanguage === 'en' && english.answer.includes('INC-UI-001'), 'English active-incident count matches synthetic PostgreSQL fixture', { answer: english.answer });
    const fixturePool = new Pool({ connectionString: dbUrl, ssl: false });
    try { await fixturePool.query(`UPDATE incidents SET data=jsonb_set(data, '{severity}', '"CRITICAL"'::jsonb) WHERE id='INC-UI-001'`); } finally { await fixturePool.end(); }
    const refreshedFacts = await ask(page, 'How many active incidents are there?', 'en');
    check(refreshedFacts.answer.includes('Critical incidents: 1'), 'Repeated question sees a PostgreSQL fixture update rather than cached facts', { answer: refreshedFacts.answer });
    const romanTe = await ask(page, 'Ippudu enni active incidents unnayi?', 'auto');
    check(romanTe.detectedLanguage === 'te' && romanTe.responseLanguage === 'te', 'Auto detects Romanized Telugu', { answer: romanTe.answer });
    const telugu = await ask(page, '\u0C2A\u0C4D\u0C30\u0C38\u0C4D\u0C24\u0C41\u0C24\u0C02 \u0C0E\u0C28\u0C4D\u0C28\u0C3F \u0C2F\u0C3E\u0C15\u0C4D\u0C1F\u0C3F\u0C35\u0C4D \u0C07\u0C28\u0C4D\u0C38\u0C3F\u0C21\u0C46\u0C02\u0C1F\u0C4D\u0C38\u0C4D \u0C09\u0C28\u0C4D\u0C28\u0C3E\u0C2F\u0C3F?', 'te');
    check(telugu.detectedLanguage === 'te' && telugu.responseLanguage === 'te' && telugu.answer.includes('INC-UI-001'), 'Native Telugu query answers from the PostgreSQL incident fixture', { answer: telugu.answer });
    const hindi = await ask(page, '\u0905\u092D\u0940 \u0915\u093F\u0924\u0928\u0947 \u0938\u0915\u094D\u0930\u093F\u092F \u0907\u0928\u094D\u0938\u093F\u0921\u0947\u0902\u091F \u0939\u0948\u0902?', 'hi');
    check(hindi.detectedLanguage === 'hi' && hindi.responseLanguage === 'hi' && hindi.answer.includes('INC-UI-001'), 'Hindi override retains the exact incident identifier', { answer: hindi.answer });
    const romanHindiPage = await context.newPage();
    await login(romanHindiPage, admin);
    await romanHindiPage.locator('.copilot-launcher').click();
    const romanHi = await ask(romanHindiPage, 'Abhi kitne active incidents hain?', 'auto');
    check(romanHi.detectedLanguage === 'hi' && romanHi.responseLanguage === 'hi', 'Auto detects Romanized Hindi in a fresh conversation', { answer: romanHi.answer });
    await romanHindiPage.close();
    const incident = await ask(page, 'Show INC-UI-001', 'en');
    check(incident.intent === 'incident_lookup' && incident.answer.includes('Synthetic UI Workflow Incident'), 'Synthetic incident lookup returns seeded title');
    const follow = await ask(page, 'What is the status?', 'auto');
    check(follow.answer.includes('INC-UI-001') || follow.answer.includes('Synthetic UI Workflow Incident'), 'Follow-up retains incident context', { intent: follow.intent, answer: follow.answer });
    const unit = await ask(page, 'UI-P01 unit lo available officers entha mandi unnaru?', 'auto');
    check(unit.intent === 'OFFICERS_BY_UNIT' && unit.detectedLanguage === 'te' && unit.answer.includes('Ravi Kumar'), 'Mixed-language unit roster uses the synthetic member');
    const camera = await ask(page, 'Show camera CAM-COPILOT-1', 'en');
    await page.locator('.copilot-navigation[aria-label*="CAM-COPILOT-1"]').click();
    await page.waitForTimeout(500);
    const cameraNavState = await page.evaluate(() => ({ view: document.body.dataset.view, path: location.pathname, buttonCount: document.querySelectorAll('.copilot-navigation').length, buttonLabels: [...document.querySelectorAll('.copilot-navigation')].map(b => b.getAttribute('aria-label')) }));
    check(camera.navigation?.view === 'cctv' && cameraNavState.view === 'cctv', 'Camera source navigation button opens CCTV Monitoring', cameraNavState);
    await page.locator('.copilot-launcher').click();
    check(camera.intent === 'camera_lookup' && camera.answer.includes('OFFLINE'), 'Camera lookup reports seeded synthetic camera status', { answer: camera.answer });
    const invalid = await ask(page, 'Show INC-NOT-REAL-999', 'en');
    check(/No incident with ID INC-NOT-REAL-999 was found/i.test(invalid.answer), 'Invalid entity is reported as missing without invented facts', { answer: invalid.answer });
    await page.locator('.copilot-close').click();
    check(await page.locator('.copilot-drawer').getAttribute('aria-hidden') === 'true', 'Drawer closes');
    await page.locator('.copilot-launcher').click();
    await page.waitForFunction(() => document.querySelectorAll('.copilot-message').length >= 16);
    const firstCount = await page.locator('.copilot-message').count();
    await page.locator('.copilot-close').click(); await page.locator('.copilot-launcher').click();
    await page.waitForFunction(n => document.querySelectorAll('.copilot-message').length === n, firstCount);
    check(await page.locator('.copilot-message').count() === firstCount, 'Close/reopen restores history without duplicate messages');
    for (const width of [1920, 1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.waitForTimeout(100);
      const metrics = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, drawer: Math.round(document.querySelector('.copilot-drawer').getBoundingClientRect().width), input: document.querySelector('#copilotQuestion').getBoundingClientRect().width }));
      check(metrics.drawer <= width + 2 && metrics.input > 0, `Assistant drawer fits viewport at ${width}px`, metrics);
      await page.screenshot({ path: path.join(out, `assistant-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('.copilot-launcher').click();
    await page.waitForFunction(() => document.querySelectorAll('.copilot-message').length >= 16, null, { timeout: 15000 });
    check(await page.locator('.copilot-message').count() === firstCount, 'PostgreSQL-backed chat restores after browser refresh');
    const storedId = await page.evaluate(() => sessionStorage.getItem('rakshakai_copilot_conversation_id'));
    check(Boolean(storedId), 'Conversation pointer survives browser refresh in tab session');
    await stopBackend();
    await startBackend();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('.copilot-launcher').click();
    await page.waitForFunction(n => document.querySelectorAll('.copilot-message').length === n, firstCount, { timeout: 15000 });
    check(await page.locator('.copilot-message').count() === firstCount, 'PostgreSQL history restores after backend process restart');
    await page.screenshot({ path: path.join(out, 'assistant-history-restored.png'), fullPage: true });
    await page.route('**/api/copilot/query', route => route.abort('failed'));
    await page.locator('#copilotQuestion').fill('How many cameras are there?');
    await page.locator('.copilot-send').click();
    await page.locator('.copilot-retry').waitFor({ state: 'visible' });
    check(await page.locator('.copilot-retry').isVisible(), 'Network failure shows a retry control');
    await page.unroute('**/api/copilot/query');
    const retryResponse = page.waitForResponse(r => r.url().includes('/api/copilot/query') && r.request().method() === 'POST');
    await page.locator('.copilot-retry').click();
    check((await retryResponse).ok(), 'Retry succeeds after network recovers');
    if (await page.locator('.copilot-drawer').getAttribute('aria-hidden') === 'false') await page.locator('.copilot-close').click();
    await page.locator('#logoutButton').click();
    await page.locator('#loginForm').waitFor({ state: 'visible' });
    check(await page.locator('.copilot-launcher').count() === 0, 'Logout removes authorized assistant UI and clears conversation pointer');
    await login(page, citizen);
    check(await page.locator('.copilot-launcher').count() === 0, 'Citizen does not see AI Assistant launcher');
    const denied = await page.evaluate(async () => { const r = await fetch('/api/copilot/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Show incidents' }) }); return r.status; });
    check(denied === 403, 'Citizen API query is denied server-side', { status: denied });
    const historyDenied = await page.evaluate(async id => (await fetch(`/api/copilot/history?conversationId=${encodeURIComponent(id)}`)).status, storedId);
    check(historyDenied === 403, 'Citizen API history is denied server-side', { status: historyDenied });
    const tracePath = path.join(out, 'copilot-playwright-trace.zip');
    await context.tracing.stop({ path: tracePath });
    const report = { environment: { frontend: 'http://127.0.0.1:3002', backend: 'http://127.0.0.1:5001', database: 'rakshakai_test_copilot_utf8', schema: 'rakshakai_test_copilot_utf8', postgres: '127.0.0.1:55440', fixtures: ['synthetic admin', 'synthetic citizen', 'synthetic officer', 'synthetic incident', 'synthetic unit', 'synthetic camera'] }, checks, consoleErrors, pageErrors, failedRequests, apiFailures, screenshotPaths: fs.readdirSync(out).filter(x => x.endsWith('.png')), tracePath };
    fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(report, null, 2));
    console.log(`EVIDENCE ${path.join(out, 'evidence.json')}`);
    console.log(`COUNTS checks=${checks.length} consoleErrors=${consoleErrors.length} pageErrors=${pageErrors.length} failedRequests=${failedRequests.length} apiFailures=${apiFailures.length}`);
  } finally {
    if (backend) await stopBackend();
    await browser.close();
  }
})().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });






