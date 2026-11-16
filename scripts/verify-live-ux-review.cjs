const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.RAKSHAKAI_URL || "http://localhost:3001";
const sessionPath = path.join(os.tmpdir(), "rakshakai-live-ui-sessions", "admin.json");
const outputDir = path.join(__dirname, "..", "artifacts", `live-ux-review-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const report = { baseUrl, viewports: {}, diagnostics: { pageErrors: [], consoleErrors: [], failedRequests: [], apiErrors: [] } };
let loginAttempted = false;

function watch(page, viewport) {
  page.on("pageerror", (error) => report.diagnostics.pageErrors.push({ viewport, message: error.message }));
  page.on("console", (message) => {
    if (message.type() === "error") report.diagnostics.consoleErrors.push({ viewport, message: message.text() });
  });
  page.on("requestfailed", (request) => report.diagnostics.failedRequests.push({ viewport, url: request.url(), failure: request.failure()?.errorText }));
  page.on("response", (response) => {
    if (response.status() >= 400 && new URL(response.url()).pathname.startsWith("/api/")) {
      report.diagnostics.apiErrors.push({ viewport, status: response.status(), path: new URL(response.url()).pathname });
    }
  });
}

async function openPanel(page, name) {
  await page.goto(`${baseUrl}/${name}`, { waitUntil: "domcontentloaded" });
  const appShell = page.locator("#appShell:not(.app-hidden)");
  const authenticated = await appShell.waitFor({ state: "visible", timeout: 20000 }).then(() => true).catch(() => false);
  if (!authenticated) {
    assert.equal(loginAttempted, false, "The saved session is unavailable after the one allowed login attempt");
    await page.locator("#loginForm:not(.app-hidden)").waitFor({ state: "visible", timeout: 5000 });
    const login = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "login.json"), "utf8"));
    loginAttempted = true;
    const email = String(login.username).includes("@") ? login.username : `${login.username}@example.test`;
    await page.locator('#loginForm input[name="email"]').fill(email);
    await page.locator('#loginForm input[name="password"]').fill(login.password);
    const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/login", { timeout: 15000 });
    await page.locator('#loginForm button[type="submit"]').click();
    const response = await responsePromise;
    assert.equal(response.status(), 200, `Admin login returned ${response.status()}; no retries were attempted`);
    await appShell.waitFor({ state: "visible", timeout: 20000 });
    await page.context().storageState({ path: sessionPath });
  }
  await page.locator(`[data-panel="${name}"].active`).waitFor({ state: "visible", timeout: 20000 });
}

async function clickSidebarView(page, view, mobile) {
  if (mobile) await page.locator("#mobileMoreButton").click();
  const nav = page.locator(`#mobileMorePanel .nav-item[data-view="${view}"]`);
  const group = nav.locator("xpath=ancestor::details[1]");
  if (!(await group.evaluate((element) => element.open))) await group.locator("summary").click();
  await nav.click();
  await page.locator(`[data-panel="${view}"].active`).waitFor({ state: "visible", timeout: 20000 });
  assert.equal(new URL(page.url()).pathname, `/${view}`);
}

async function verifyViewport(browser, viewport) {
  const label = `${viewport.width}x${viewport.height}`;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, storageState: sessionPath });
  const page = await context.newPage();
  watch(page, label);
  try {
    await openPanel(page, "incident-command");
    const identity = await page.evaluate(async () => {
      const response = await fetch("/api/auth/me");
      return { status: response.status, role: response.ok ? (await response.json()).user?.role : null };
    });
    assert.deepEqual(identity, { status: 200, role: "Admin" }, "Saved Admin session must remain authenticated");
    const health = await page.evaluate(async () => {
      const response = await fetch("/api/health");
      return { status: response.status, database: (await response.json()).database };
    });
    assert.equal(health.status, 200);
    assert.equal(health.database, "postgres");
    await page.waitForFunction(() => !document.querySelector("#queueCount")?.textContent?.includes("--"), null, { timeout: 20000 });
    const incidents = page.locator("#incidentList .incident-select");
    const defaultCount = await incidents.count();
    const demoToggle = page.locator("#showDemoIncidents");
    assert.equal(await demoToggle.isChecked(), false);
    await demoToggle.check();
    const includingDemo = await incidents.count();
    assert.ok(includingDemo >= defaultCount);
    await demoToggle.uncheck();
    assert.equal(await incidents.count(), defaultCount);
    const queueLayout = await page.locator(".command-queue-panel").evaluate((panel) => {
      const filters = panel.querySelector(".command-filter-bar");
      const row = panel.querySelector(".command-incident-row");
      const search = panel.querySelector("#commandIncidentSearch");
      const panelBounds = panel.getBoundingClientRect();
      const searchBounds = search.getBoundingClientRect();
      return {
        panelOverflow: panel.scrollWidth - panel.clientWidth,
        filterOverflow: filters.scrollWidth - filters.clientWidth,
        rowOverflow: row ? row.scrollWidth - row.clientWidth : 0,
        searchClippedLeft: searchBounds.left < panelBounds.left,
        viewScrollLeft: panel.closest('[data-panel="incident-command"]').scrollLeft
      };
    });
    assert.ok(queueLayout.panelOverflow <= 2 && queueLayout.filterOverflow <= 2 && queueLayout.rowOverflow <= 2 && !queueLayout.searchClippedLeft && queueLayout.viewScrollLeft === 0,
      `Incident queue must fit without horizontal clipping: ${JSON.stringify(queueLayout)}`);
    const detail = await page.locator("#commandIncidentDetail .command-detail-grid").evaluateAll((grids) => {
      const grid = grids[0];
      if (!grid) return {};
      return Object.fromEntries([...grid.children].map((row) => [row.querySelector("span")?.textContent, row.querySelector("strong")?.textContent]));
    });
    if (detail.Location) assert.doesNotMatch(detail.Location, /^(Ready for dispatch|Not dispatchable)$/i);
    const inactiveCurrentCount = await page.locator('.nav-item:not(.active)[aria-current]').count();
    assert.equal(inactiveCurrentCount, 0);
    const accountLabels = await page.locator("#accountSessionsButton, #logoutButton").allTextContents();
    assert.deepEqual(accountLabels.map((item) => item.trim()), ["Sessions", "Sign out"]);
    const accountButtons = await page.locator("#accountSessionsButton, #logoutButton").evaluateAll((buttons) => buttons.map((button) => ({
      visible: button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0,
      after: getComputedStyle(button, "::after").content
    })));
    assert.ok(accountButtons.every((button) => button.visible && ["none", "normal"].includes(button.after)));
    await page.screenshot({ path: path.join(outputDir, `incident-command-${label}.png`) });

    await openPanel(page, "alerts");
    const sendAlert = page.locator("#sendAlert");
    assert.equal(await sendAlert.isVisible(), true);
    assert.equal(await sendAlert.evaluate((button) => button.closest("details") === null), true);
    await page.screenshot({ path: path.join(outputDir, `alerts-${label}.png`) });

    await openPanel(page, "gis");
    await clickSidebarView(page, "sla-monitoring", viewport.width <= 720);
    await page.waitForFunction(() => !document.querySelector("#slaMonitoringContent")?.hidden, null, { timeout: 20000 });
    const sla = await page.evaluate(async () => {
      const response = await fetch("/api/sla/monitoring");
      const body = response.ok ? await response.json() : null;
      return { status: response.status, activeCases: body?.summary?.activeCases ?? null, renderedActive: document.querySelector("#slaKpiActive")?.textContent?.trim() };
    });
    assert.equal(sla.status, 200);
    assert.equal(Number(sla.renderedActive), sla.activeCases);
    assert.equal(await page.locator('.sidebar .nav-item[data-view="sla-monitoring"]').count(), 1);
    await page.screenshot({ path: path.join(outputDir, `sla-monitoring-${label}.png`) });

    await clickSidebarView(page, "audit-logs", viewport.width <= 720);
    await page.waitForFunction(() => {
      const status = document.querySelector("#auditPageStatus")?.textContent?.trim() || "";
      const list = document.querySelector("#auditPageList");
      return Boolean(list?.children.length || /no .*record|unable|failed/i.test(status));
    }, null, { timeout: 20000 });
    const audit = await page.evaluate(async () => {
      const response = await fetch("/api/audit-logs?limit=1&offset=0");
      const body = response.ok ? await response.json() : null;
      return { status: response.status, renderedRows: document.querySelector("#auditPageList")?.children.length ?? 0, total: body?.total ?? body?.pagination?.total ?? null };
    });
    assert.equal(audit.status, 200);
    assert.ok(audit.renderedRows > 0);
    assert.equal(await page.locator('.sidebar .nav-item[data-view="audit-logs"]').count(), 1);
    audit.filterLayout = await page.evaluate(() => {
      const panel = document.querySelector('.audit-search-panel');
      const form = document.querySelector('#auditPageFilterForm');
      const reset = document.querySelector('#auditPageReset');
      const panelRect = panel.getBoundingClientRect();
      const resetRect = reset.getBoundingClientRect();
      return {
        formOverflow: form.scrollWidth - form.clientWidth,
        resetWithinPanel: resetRect.left >= panelRect.left && resetRect.right <= panelRect.right,
        resetWidth: resetRect.width
      };
    });
    assert.ok(audit.filterLayout.formOverflow <= 2 && audit.filterLayout.resetWithinPanel && audit.filterLayout.resetWidth > 0,
      `Audit filter actions overflow at ${label}: ${JSON.stringify(audit.filterLayout)}`);
    await page.screenshot({ path: path.join(outputDir, `audit-logs-${label}.png`) });

    return { identity, health, incidentQueue: { defaultCount, includingDemo, location: detail.Location || null, inactiveCurrentCount, layout: queueLayout }, accountLabels, alerts: { sendButtonVisible: true, outsideAdvanced: true }, sla, audit };
  } finally {
    await context.close();
  }
}

async function main() {
  assert.ok(fs.existsSync(sessionPath), "Saved Admin session is required; this check does not sign in");
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      report.viewports[`${viewport.width}x${viewport.height}`] = await verifyViewport(browser, viewport);
    }
    assert.deepEqual(report.diagnostics.pageErrors, []);
    assert.deepEqual(report.diagnostics.failedRequests, []);
    report.result = "PASS";
  } catch (error) {
    report.result = "FAIL";
    report.error = error.stack || String(error);
    throw error;
  } finally {
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
    await browser.close();
    console.log(JSON.stringify({ result: report.result, outputDir, viewports: report.viewports, diagnostics: report.diagnostics, error: report.error }, null, 2));
  }
}

main().catch(() => { process.exitCode = 1; });
