const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.NAV_BASE_URL || 'http://localhost:3000';
const users = [
  { key: 'admin', role: 'Admin', email: 'admin@rakshakai.local' },
  { key: 'police', role: 'Police Officer', email: 'police@rakshakai.local' },
  { key: 'citizen', role: 'Citizen', email: 'citizen@rakshakai.local' }
];
const report = { startedAt: new Date().toISOString(), base, roles: {}, warnings: [], complete: false };
const reportPath = process.env.NAV_REPORT_PATH || path.join(process.env.TEMP || '.', 'rakshak-live-navigation-report.json');
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
const route = (view) => view === 'live-vision' ? '/rakshak/live-vision' : `/${view}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let rateLimitUntil = 0;
async function waitForRateWindow() {
  const remaining = rateLimitUntil - Date.now();
  if (remaining > 0) {
    console.log(`API rate limit reached; waiting ${Math.ceil(remaining / 1000)}s for its natural reset.`);
    await delay(remaining + 1000);
  }
}
async function waitForLimit() {
  const response = await fetch(`${base}/api/auth/me`);
  if (response.status !== 429) return;
  const seconds = Number(response.headers.get('retry-after'));
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 1000) throw new Error('Rate limit returned no usable Retry-After');
  console.log(`General API limit active; waiting ${seconds + 2}s for its natural reset.`);
  await delay((seconds + 2) * 1000);
}
async function openGroups(page) {
  for (const group of await page.locator('.nav-group').all()) {
    if (await group.isVisible() && !(await group.evaluate((el) => el.open))) await group.locator('summary').click();
  }
}
async function check(page, view) {
  await page.waitForFunction((v) => document.body.dataset.view === v, view, { timeout: 12000 });
  const active = await page.locator(`.nav-item[data-view="${view}"].active`).count();
  const panel = await page.locator(`.view.active[data-panel="${view}"]`).isVisible();
  if (!active || !panel) throw new Error(`View ${view} does not have an active sidebar item and visible panel`);
  return { view, path: new URL(page.url()).pathname, active: Boolean(active), panel };
}
async function clickView(page, view) {
  const item = page.locator(`.nav-item[data-view="${view}"]`);
  const group = item.locator('xpath=ancestor::details[1]');
  if (!(await group.evaluate((el) => el.open))) await group.locator('summary').click();
  await item.click();
  return check(page, view);
}
async function attempt(list, name, action) {
  await waitForRateWindow();
  try {
    let detail;
    try { detail = await action(); }
    catch (error) {
      if (rateLimitUntil <= Date.now()) throw error;
      await waitForRateWindow();
      detail = await action();
    }
    list.push({ name, pass: true, detail });
  } catch (error) { list.push({ name, pass: false, error: error.message.split('\n')[0] }); }
}
async function runRole(browser, user) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const result = report.roles[user.key] = { loginAttempts: 0, sidebar: [], direct: [], refresh: [], history: [], restricted: [], apiRoles: [], shortcuts: [], notifications: [], evidenceImage: [], responsive: [], unknown: [], errors: [], network: [] };
  page.on('pageerror', (error) => result.errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 400) {
      const p = new URL(response.url()).pathname;
      result.network.push({ status: response.status(), path: p });
      if (response.status() === 429) {
        const seconds = Number(response.headers()['retry-after']);
        if (Number.isFinite(seconds) && seconds >= 0) rateLimitUntil = Math.max(rateLimitUntil, Date.now() + (seconds + 1) * 1000);
      }
    }
  });
  page.on('requestfailed', (request) => { if (!request.failure()?.errorText?.includes('ERR_ABORTED')) result.errors.push(`Request failed: ${new URL(request.url()).origin}${new URL(request.url()).pathname}: ${request.failure()?.errorText}`); });
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('#loginForm input[name=email]').fill(user.email);
    await page.locator('#loginForm input[name=password]').fill(process.env.NAV_DEMO_PASSWORD || 'demo123');
    result.loginAttempts++;
    await page.locator('#loginForm button[type=submit]').click();
    await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible', timeout: 20000 });
    result.login = { pass: true, role: await page.evaluate(() => document.body.dataset.role), landing: await page.evaluate(() => document.body.dataset.view) };
    if (result.login.role !== user.role) throw new Error(`Authenticated as ${result.login.role}, expected ${user.role}`);
    console.log(`[${user.role}] logged in once; discovering visible routes`);
    await openGroups(page);
    const views = await page.locator('.nav-item:visible').evaluateAll((els) => els.map((el) => el.dataset.view));
    result.visibleViews = views;
    for (const view of views) {
      await attempt(result.sidebar, view, () => clickView(page, view));
    }
    for (const view of views) {
      await attempt(result.direct, view, async () => {
        await page.goto(base + route(view), { waitUntil: 'domcontentloaded' });
        await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible', timeout: 12000 });
        return check(page, view);
      });
      await attempt(result.refresh, view, async () => {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible', timeout: 12000 });
        return check(page, view);
      });
    }
    if (user.key !== 'citizen') {
      await attempt(result.history, 'back/back/forward', async () => {
        for (const view of ['dashboard', 'incident-command', 'cctv', 'video-evidence']) await clickView(page, view);
        await page.goBack({ waitUntil: 'domcontentloaded' }); const one = await check(page, 'cctv');
        await page.goBack({ waitUntil: 'domcontentloaded' }); const two = await check(page, 'incident-command');
        await page.goForward({ waitUntil: 'domcontentloaded' }); const three = await check(page, 'cctv');
        return [one, two, three];
      });
      for (const target of ['incident-command', 'gis', 'cctv', 'unit-assignment']) await attempt(result.shortcuts, target, async () => {
        await clickView(page, 'dashboard');
        const control = page.locator(`[data-panel="dashboard"] [data-view-jump="${target}"]`).first();
        if (!(await control.isVisible())) throw new Error('Shortcut is not visible');
        await control.click(); return check(page, target);
      });
    } else {
      await attempt(result.history, 'citizen back/forward', async () => { await page.goto(base + '/missing'); await page.goto(base + '/random-invalid-route'); await page.goBack(); await check(page, 'missing'); await page.goForward(); return check(page, 'missing'); });
    }
    const forbidden = user.key === 'police' ? ['police-management', 'settings', 'erss-supervisor'] : user.key === 'citizen' ? ['cctv', 'unit-assignment', 'video-evidence', 'settings', 'history', 'erss-call-taker', 'erss-supervisor'] : [];
    for (const view of forbidden) await attempt(result.restricted, view, async () => {
      await page.goto(base + route(view), { waitUntil: 'domcontentloaded' });
      await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible', timeout: 12000 });
      return check(page, user.key === 'citizen' ? 'missing' : 'dashboard');
    });
    for (const [endpoint, expected] of [
      ['/api/admin/police-users', user.key === 'admin' ? 200 : 403],
      ['/api/erss/events', user.key === 'citizen' ? 403 : 200],
      ['/api/erss/supervisor/queue', user.key === 'admin' ? 200 : 403]
    ]) await attempt(result.apiRoles, endpoint, async () => {
      const response = await page.request.get(base + endpoint);
      if (response.status() !== expected) throw new Error(`Expected ${expected}, got ${response.status()}`);
      return { status: response.status() };
    });
    for (const pathname of ['/random-invalid-route', '/not-a-real-admin-page']) await attempt(result.unknown, pathname, async () => {
      await page.goto(base + pathname, { waitUntil: 'domcontentloaded' });
      await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible', timeout: 12000 });
      return check(page, user.key === 'citizen' ? 'missing' : 'dashboard');
    });
    await attempt(result.notifications, 'open available notification', async () => {
      const launcher = page.locator('.notification-launcher');
      if (!(await launcher.isVisible())) throw new Error('Notification launcher is not visible');
      await launcher.click();
      const drawer = page.locator('.notification-drawer[aria-hidden="false"]');
      await drawer.waitFor({ state: 'visible', timeout: 8000 });
      const items = drawer.locator('.notification-item');
      const count = await items.count();
      if (!count) { await drawer.locator('.notification-close').click(); throw new Error('No notification was available to test'); }
      const item = items.first(); const type = await item.locator('.notification-type').innerText();
      await item.locator('.notification-view').click();
      await drawer.locator('.notification-open-related').waitFor({ state: 'visible', timeout: 10000 });
      await drawer.locator('.notification-open-related').click();
      await drawer.waitFor({ state: 'hidden', timeout: 10000 });
      const resultingView = await page.evaluate(() => document.body.dataset.view);
      if (resultingView === 'dashboard' || resultingView === 'missing') throw new Error('Notification destination was not verified');
      return { available: count, type, resultingView };
    });
    if (await page.locator('.notification-drawer[aria-hidden="false"]').isVisible()) await page.locator('.notification-close').click();
    if (user.key !== 'citizen') await attempt(result.evidenceImage, 'evidence-image notification and review', async () => {
      const list = await page.request.get(base + '/api/notifications');
      if (!list.ok()) throw new Error(`Notification list returned ${list.status()}`);
      const notifications = (await list.json()).notifications || [];
      let found;
      for (const item of notifications.filter((n) => n.entityType === 'ai_observation')) {
        const response = await page.request.get(`${base}/api/notifications/${encodeURIComponent(item.id)}/details`);
        if (!response.ok()) continue;
        const detail = (await response.json()).detail?.record;
        if (detail?.sourceType === 'evidence_image' && detail.cameraId == null) { found = { item, detail }; break; }
      }
      if (!found) throw new Error('No authorized evidence-image notification with null camera is available');
      await page.locator('.notification-launcher').click();
      const drawer = page.locator('.notification-drawer[aria-hidden="false"]');
      await drawer.waitFor({ state: 'visible' });
      const selected = drawer.locator(`[data-notification-id="${found.item.id}"]`);
      if (!(await selected.count())) throw new Error('Evidence notification not visible in drawer');
      await selected.locator('.notification-view').click();
      await drawer.locator('.notification-open-related').click();
      await check(page, 'video-evidence');
      const button = page.getByRole('button', { name: `Review AI observation ${found.item.entityId}` });
      await button.waitFor({ state: 'visible', timeout: 10000 });
      await button.click();
      await check(page, 'cctv');
      return { notificationId: found.item.id, evidenceId: found.detail.evidenceId, observationId: found.item.entityId, cameraId: null, reviewView: 'cctv' };
    });
    if (await page.locator('.notification-drawer[aria-hidden="false"]').isVisible()) await page.locator('.notification-close').click();
    for (const [width, height] of [[1440,900], [768,1024], [390,844]]) await attempt(result.responsive, `${width}x${height}`, async () => {
      await page.setViewportSize({ width, height });
      await clickView(page, user.key === 'citizen' ? 'missing' : 'dashboard');
      return { sidebarVisible: await page.locator('.sidebar').isVisible(), selected: await page.evaluate(() => document.body.dataset.view) };
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await attempt(result.history, 'logout/back', async () => {
      await page.locator('#logoutButton').click();
      await page.locator('#loginForm').waitFor({ state: 'visible', timeout: 10000 });
      await page.goBack({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);
      const loginVisible = await page.locator('#loginForm').isVisible();
      const shellVisible = await page.locator('#appShell:not(.app-hidden)').isVisible();
      if (!loginVisible || shellVisible) throw new Error('Protected shell visible after logout and Back');
      return { loginVisible, shellVisible };
    });
    result.complete = true;
  } catch (error) {
    result.errors.push(error.message.split('\n')[0]);
    result.complete = false;
  } finally { await context.close(); save(); }
  return result;
}
(async () => {
  await waitForLimit();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const user of users) {
      const result = await runRole(browser, user);
      console.log(`[${user.role}] sidebar ${result.sidebar.filter((x) => x.pass).length}/${result.sidebar.length}; complete=${result.complete}`);
      if (!result.complete) break;
    }
    report.complete = users.every((u) => report.roles[u.key]?.complete);
  } finally { await browser.close(); report.finishedAt = new Date().toISOString(); save(); console.log(`Report: ${reportPath}`); }
  if (!report.complete) process.exitCode = 1;
})().catch((error) => { report.warnings.push(error.message); save(); console.error(error.message); process.exitCode = 1; });
