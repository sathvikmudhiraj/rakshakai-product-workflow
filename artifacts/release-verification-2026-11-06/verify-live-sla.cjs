const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const baseUrl = process.env.SLA_PREVIEW_URL || 'http://localhost:3001';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const sessionPath = path.join(require('node:os').tmpdir(), 'rakshakai-live-ui-sessions', 'admin.json');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, storageState: sessionPath });
  const page = await context.newPage();
  const errors = { console: [], page: [], failedRequests: [], http: [] };
  page.on('console', m => { if (m.type() === 'error') errors.console.push(m.text()); });
  page.on('pageerror', e => errors.page.push(e.message));
  page.on('requestfailed', r => errors.failedRequests.push({ path: new URL(r.url()).pathname, error: r.failure()?.errorText }));
  page.on('response', r => { if (r.status() >= 400) errors.http.push({ status: r.status(), method: r.request().method(), path: new URL(r.url()).pathname }); });
  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.locator('#appShell:not(.app-hidden)').waitFor({ state: 'visible' });
    const identity = await page.evaluate(async () => { const r = await fetch('/api/auth/me'); const j = await r.json(); return { status: r.status, role: j.user?.role }; });
    if (identity.status !== 200 || !['Admin', 'Police Officer'].includes(identity.role)) throw new Error(`Live SLA dashboard requires an authorized account; session status=${identity.status}, role=${identity.role || 'unknown'}`);
    const apiPromise = page.waitForResponse(r => new URL(r.url()).pathname === '/api/sla/monitoring');
    await page.locator('.nav-item[data-view="sla-monitoring"]').click();
    const apiResponse = await apiPromise;
    const api = await apiResponse.json();
    await page.locator('#slaMonitoringContent').waitFor({ state: 'visible' });
    await page.locator('#slaMonitoringLoading').waitFor({ state: 'hidden' });
    await page.locator('#slaCaseTable tbody tr').first().waitFor({ state: 'visible' }).catch(() => {});
    const desktop = await page.evaluate(() => ({
      activePanel: document.querySelector('[data-panel="sla-monitoring"]')?.classList.contains('active'),
      heading: document.querySelector('[data-panel="sla-monitoring"] h2')?.textContent?.trim(),
      kpis: Object.fromEntries(['slaKpiActive','slaKpiBreached','slaKpiApproaching','slaKpiWithin','slaKpiEscalated','slaKpiResolution'].map(id => [id, document.getElementById(id)?.textContent?.trim()])),
      tableRows: document.querySelectorAll('#slaCaseTable tbody tr').length,
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth
    }));
    if (apiResponse.status() !== 200) throw new Error(`Live SLA API returned HTTP ${apiResponse.status()}`);
    if (!desktop.activePanel || desktop.tableRows < 1) throw new Error(`Live SLA dashboard did not render populated data: ${JSON.stringify(desktop)}`);
    const out = path.join(__dirname, 'live-sla-monitoring-desktop-1440.png');
    await page.screenshot({ path: out, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const mobile = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, rows: document.querySelectorAll('#slaCaseCards .sla-case-row').length }));
    const mobileOut = path.join(__dirname, 'live-sla-monitoring-mobile-390.png');
    await page.screenshot({ path: mobileOut, fullPage: true });
    const report = { result: 'PASS', origin: baseUrl, session: identity, api: { status: apiResponse.status(), keys: Object.keys(api), recordCount: Array.isArray(api.cases) ? api.cases.length : Array.isArray(api.incidents) ? api.incidents.length : undefined }, desktop, mobile, errors, screenshots: [out, mobileOut] };
    console.log(JSON.stringify(report, null, 2));
    if (errors.page.length || errors.failedRequests.length) process.exitCode = 1;
  } finally { await context.close(); await browser.close(); }
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
