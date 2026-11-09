const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const base = 'http://localhost:3001';
const existingState = path.join(os.tmpdir(), 'rakshakai-live-ui-sessions', 'admin.json');
const report = { origin: base, browser: 'Chromium', checks: {}, screenshots: {}, errors: [] };

async function api(page, endpoint) {
  return page.evaluate(async (path) => {
    const response = await fetch(path, { credentials: 'same-origin' });
    const body = await response.json().catch(() => null);
    return {
      status: response.status,
      rateLimit: response.headers.get('ratelimit'),
      retryAfter: response.headers.get('retry-after'),
      body
    };
  }, endpoint);
}

async function ready(page, view) {
  await page.waitForFunction((name) => document.body.dataset.view === name &&
    document.querySelector(`[data-panel="${name}"].active`), view);
}

async function main() {
  fs.mkdirSync(__dirname, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
    ...(fs.existsSync(existingState) ? { storageState: existingState } : {})
  });
  const page = await desktopContext.newPage();
  page.on('pageerror', error => report.errors.push({ type: 'page', message: error.message }));
  page.on('response', response => {
    if (response.status() >= 500 || response.status() === 429)
      report.errors.push({ type: 'http', status: response.status(), path: new URL(response.url()).pathname });
  });
  try {
    await page.goto(`${base}/sla-monitoring`, { waitUntil: 'domcontentloaded' });
    let identity = await api(page, '/api/auth/me');
    if (identity.body?.user?.role !== 'Admin') {
      assert.equal(identity.status, 200, 'Initial /api/auth/me must be reachable');
      const login = JSON.parse(fs.readFileSync(path.join(root, 'login.json'), 'utf8'));
      assert.ok(login.username && login.password, 'Existing login credentials are required');
      await page.locator('#loginForm').waitFor({ state: 'visible' });
      const email = String(login.username).includes('@') ? login.username : `${login.username}@example.test`;
      await page.locator('#loginForm input[name="email"]').fill(email);
      await page.locator('#loginForm input[name="password"]').fill(login.password);
      const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login');
      await page.locator('#loginForm button[type="submit"]').click();
      const loginResponse = await responsePromise;
      report.checks.login = { status: loginResponse.status(), method: 'existing local credentials, one attempt' };
      assert.equal(loginResponse.status(), 200, 'Existing Admin login failed');
      await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible' });
      identity = await api(page, '/api/auth/me');
    } else {
      report.checks.login = { method: 'reused existing Admin session' };
    }
    report.checks.authMe = { status: identity.status, role: identity.body?.user?.role || null,
      rateLimit: identity.rateLimit, retryAfter: identity.retryAfter };
    assert.equal(identity.status, 200);
    assert.equal(identity.body?.user?.role, 'Admin');
    fs.mkdirSync(path.dirname(existingState), { recursive: true });
    await desktopContext.storageState({ path: existingState });

    await ready(page, 'sla-monitoring');
    await page.locator('#slaMonitoringContent').waitFor({ state: 'visible' });
    const sla = await api(page, '/api/sla/monitoring');
    const incidents = sla.body?.incidents || [];
    report.checks.slaApi = { status: sla.status, activeCases: sla.body?.summary?.activeCases,
      records: incidents.length, asOf: sla.body?.asOf, rateLimit: sla.rateLimit, retryAfter: sla.retryAfter };
    assert.equal(sla.status, 200);
    assert.ok(incidents.length > 0, 'Live SLA API has no incident records');
    const initialRows = await page.locator('#slaCaseTable tbody tr').count();
    const primaryAttention = await page.locator('#slaAttentionList > .sla-attention-card').count();
    const overflowAttention = await page.locator('#slaAttentionList .sla-attention-overflow .sla-attention-card').count();
    const attentionExpected = incidents.filter(item => item.slaState === 'BREACHED' ||
      item.slaState === 'APPROACHING' || item.escalationLevel !== 'L0' ||
      (!item.assignedUnitId && item.slaState !== 'WITHIN_SLA')).length;
    report.checks.slaLayout = { heading: await page.locator('[data-panel="sla-monitoring"] h2').first().innerText(),
      initialRows, kpiActive: await page.locator('#slaKpiActive').innerText(),
      primaryAttention, overflowAttention, attentionExpected,
      filters: await page.locator('#slaSearch, #slaStatusFilter, #slaSeverityFilter, #slaStationFilter, #slaStateFilter, #slaPeriodFilter').count() };
    assert.equal(initialRows, incidents.length);
    assert.equal(Number(report.checks.slaLayout.kpiActive), sla.body.summary.activeCases);
    assert.equal(primaryAttention + overflowAttention, attentionExpected);
    assert.equal(report.checks.slaLayout.filters, 6);

    const severity = String(incidents[0].severity).toUpperCase();
    await page.locator('#slaSeverityFilter').selectOption(severity);
    const filteredRows = await page.locator('#slaCaseTable tbody tr').count();
    report.checks.filters = { selectedSeverity: severity, actualRows: filteredRows,
      expectedRows: incidents.filter(item => String(item.severity).toUpperCase() === String(severity).toUpperCase()).length };
    assert.equal(filteredRows, report.checks.filters.expectedRows);
    await page.locator('#slaSeverityFilter').selectOption('all');
    await page.locator('body.ui-loading').waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.join(__dirname, 'sla-desktop-1440x900.png') });
    report.screenshots.desktop = 'sla-desktop-1440x900.png';
    await page.locator('#slaAttentionList').scrollIntoViewIfNeeded();
    await page.locator('body.ui-loading').waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.join(__dirname, 'sla-attention-1440x900.png') });
    report.screenshots.attention = 'sla-attention-1440x900.png';

    const adminGroup = page.locator('.sidebar .nav-group').filter({ has: page.locator('summary', { hasText: 'Administration' }) });
    if (!(await adminGroup.evaluate(element => element.open))) await adminGroup.locator('summary').click();
    const auditResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/audit-logs');
    await page.locator('.sidebar .nav-item[data-view="audit-logs"]').click();
    await ready(page, 'audit-logs');
    const auditResponse = await auditResponsePromise;
    await page.locator('#auditPageStatus').filter({ hasText: /loaded/i }).waitFor();
    report.checks.auditLogs = { status: auditResponse.status(), path: new URL(page.url()).pathname,
      cards: await page.locator('#auditPageList .audit-page-card').count(),
      statusText: await page.locator('#auditPageStatus').innerText() };
    assert.equal(auditResponse.status(), 200);
    assert.ok(report.checks.auditLogs.cards > 0);

    const operations = page.locator('.sidebar .nav-group').filter({ has: page.locator('summary', { hasText: 'Operations' }) });
    if (!(await operations.evaluate(element => element.open))) await operations.locator('summary').click();
    await page.locator('.sidebar .nav-item[data-view="gis"]').click();
    await ready(page, 'gis');
    await page.locator('#gisMap .leaflet-container').waitFor({ state: 'visible' });
    await page.locator('#gisMap .leaflet-tile-loaded').first().waitFor({ state: 'visible', timeout: 15000 });
    report.checks.gis = { path: new URL(page.url()).pathname, view: await page.locator('body').getAttribute('data-view'),
      loadedTiles: await page.locator('#gisMap .leaflet-tile-loaded').count() };
    assert.equal(report.checks.gis.path, '/gis');
    assert.ok(report.checks.gis.loadedTiles > 0);

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1, storageState: await desktopContext.storageState() });
    try {
      const mobile = await mobileContext.newPage();
      mobile.on('pageerror', error => report.errors.push({ type: 'mobile-page', message: error.message }));
      await mobile.goto(`${base}/sla-monitoring`, { waitUntil: 'domcontentloaded' });
      await ready(mobile, 'sla-monitoring');
      await mobile.locator('#slaMonitoringContent').waitFor({ state: 'visible' });
      const cards = await mobile.locator('#slaCaseCards .sla-case-row').count();
      report.checks.mobile = { cards, visible: await mobile.locator('#slaCaseCards').isVisible(),
        detailDisclosures: await mobile.locator('#slaCaseCards .sla-mobile-disclosure').count(),
        viewportWidth: await mobile.evaluate(() => innerWidth),
        documentWidth: await mobile.evaluate(() => document.documentElement.scrollWidth) };
      assert.equal(cards, incidents.length);
      assert.ok(report.checks.mobile.visible);
      assert.equal(report.checks.mobile.detailDisclosures, cards);
      assert.ok(report.checks.mobile.documentWidth <= 390, 'Mobile layout overflows horizontally');
      await mobile.locator('body.ui-loading').waitFor({ state: 'hidden' });
      await mobile.screenshot({ path: path.join(__dirname, 'sla-mobile-390x844.png') });
      report.screenshots.mobile = 'sla-mobile-390x844.png';
      await mobile.locator('#slaCaseCards .sla-case-row').first().scrollIntoViewIfNeeded();
      await mobile.locator('body.ui-loading').waitFor({ state: 'hidden' });
      await mobile.screenshot({ path: path.join(__dirname, 'sla-mobile-cards-390x844.png') });
      report.screenshots.mobileCards = 'sla-mobile-cards-390x844.png';
    } finally { await mobileContext.close(); }
    assert.equal(report.errors.length, 0, 'Browser reported server/rate-limit or script errors');
    report.result = 'PASS';
  } catch (error) {
    report.result = 'FAIL';
    report.failure = error.stack || error.message;
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(__dirname, 'acceptance.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    await desktopContext.close();
    await browser.close();
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
