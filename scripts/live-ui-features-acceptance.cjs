const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const baseUrl = process.env.RAKSHAKAI_URL || "http://localhost:3001";
const login = JSON.parse(fs.readFileSync(path.join(root, "login.json"), "utf8"));
const envText = fs.readFileSync(path.join(root, ".env.docker"), "utf8");
const envValue = (key) => envText.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim() || "";
const outputDir = path.join(root, "artifacts", `live-ui-acceptance-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const sessionDir = path.join(os.tmpdir(), "rakshakai-live-ui-sessions");
fs.mkdirSync(sessionDir, { recursive: true });
const sessionPath = (name) => path.join(sessionDir, `${name}.json`);
const events = { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], expectedConflicts: [] };
const screenshots = {};

function watch(page) {
  page.on("console", (message) => { if (message.type() === "error") events.consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => events.pageErrors.push(error.message));
  page.on("requestfailed", (request) => events.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const url = new URL(response.url());
    if (response.status() === 409 && /^\/api\/incidents\/[^/]+\/recommend-unit$/.test(url.pathname)) {
      events.expectedConflicts.push({ status: response.status(), method: response.request().method(), url: response.url(), code: "PRIMARY_UNIT_RECOMMENDATION_UNAVAILABLE" });
      return;
    }
    events.badResponses.push({ status: response.status(), url: response.url() });
  });
}

async function loginOnce(page, username, password, statePath) {
  await page.goto(`${baseUrl}/gis`, { waitUntil: "domcontentloaded" });
  const appShell = page.locator("#appShell:not(.app-hidden)");
  const alreadyAuthenticated = await appShell.waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
  if (!alreadyAuthenticated) {
    const loginFormVisible = await page.locator("#loginForm").isVisible().catch(() => false);
    assert.ok(loginFormVisible, "App session is unavailable and login form is not visible");
    const email = String(username).includes("@") ? username : `${username}@example.test`;
    await page.locator('#loginForm input[name="email"]').fill(email);
    await page.locator('#loginForm input[name="password"]').fill(password);
    const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/login");
    await page.locator('#loginForm button[type="submit"]').click();
    const response = await responsePromise;
    assert.equal(response.status(), 200, `Login failed (${response.status()})`);
    await appShell.waitFor({ state: "visible", timeout: 20000 });
  }
  const session = await page.evaluate(async () => { const response = await fetch("/api/auth/me"); return { status: response.status, user: response.ok ? (await response.json()).user : null }; });
  assert.equal(session.status, 200, "An authenticated browser session is required for this test");
  await page.context().storageState({ path: statePath });
  return session.user;
}

async function searchPlace(page, query, expectedText) {
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/maps/search");
  await page.locator('#gisMap input[aria-label="Search place on map"]').fill(query);
  await page.locator('#gisMap .map-search button[type="submit"]').click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, `Live geocoding failed (${response.status()})`);
  const body = await response.json();
  assert.ok(body.results?.length, `Nominatim returned no results for ${query}`);
  const result = body.results.find((place) => expectedText.test(place.label || place.displayName || place.name)) || body.results[0];
  const resultIndex = body.results.indexOf(result);
  const resultButton = page.locator("#gisMap .map-search-result").nth(resultIndex);
  await resultButton.waitFor({ state: "visible" });
  await resultButton.click();
  await page.locator("#gisMap .selected-location-card:not([hidden])").waitFor({ state: "visible" });
  return { result, provider: body.provider, responseStatus: response.status() };
}

async function waitForPanel(page, view) {
  await page.locator(`[data-panel="${view}"].active`).waitFor({ state: "visible", timeout: 20000 });
}

async function expandNavigationGroup(page, title) {
  const summary = page.locator(".nav-group summary").filter({ hasText: title });
  await summary.waitFor({ state: "visible", timeout: 10000 });
  if (!(await summary.evaluate((element) => element.parentElement?.open))) await summary.click();
}

async function verifyAuthorizedPoliceSession(browser, statePath) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, storageState: statePath });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/gis`, { waitUntil: "domcontentloaded" });
    await page.locator("#appShell:not(.app-hidden)").waitFor({ state: "visible", timeout: 15000 });
    const check = await page.evaluate(async () => {
      const meResponse = await fetch("/api/auth/me");
      const user = meResponse.ok ? (await meResponse.json()).user : null;
      const slaResponse = await fetch("/api/sla/monitoring");
      const sla = slaResponse.ok ? await slaResponse.json() : null;
      return { user, slaStatus: slaResponse.status, activeCases: sla?.summary?.activeCases ?? null };
    });
    assert.equal(check.user?.role, "Police Officer", "The supplied session must belong to Police");
    assert.equal(check.slaStatus, 200, "An authorized station-scoped Police session must be able to read SLA monitoring");
    await page.goto(`${baseUrl}/sla-monitoring`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-panel="sla-monitoring"].active').waitFor({ state: "visible", timeout: 15000 });
    return { status: "PASS", role: check.user.role, slaStatus: check.slaStatus, activeCases: check.activeCases, directRouteVisible: true };
  } finally {
    await context.close();
  }
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const adminState = sessionPath("admin");
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...(fs.existsSync(adminState) ? { storageState: adminState } : {}) });
  const adminPage = await adminContext.newPage();
  watch(adminPage);
  const report = { baseUrl, checks: {}, screenshots, events };
  try {
    await loginOnce(adminPage, login.username, login.password, adminState);
    const systemHealth = await adminPage.evaluate(async () => { const response = await fetch("/api/health"); return { status: response.status, body: await response.json() }; });
    assert.equal(systemHealth.status, 200);
    assert.equal(systemHealth.body.database, "postgres", "live UI acceptance must use the running PostgreSQL backend");
    report.checks.backend = { database: systemHealth.body.database, routing: systemHealth.body.routing, geocoder: systemHealth.body.geocoder };
    await adminPage.goto(`${baseUrl}/gis`, { waitUntil: "domcontentloaded" });
    await waitForPanel(adminPage, "gis");
    await adminPage.locator("#gisMap .leaflet-container").waitFor({ state: "visible" });

    report.checks.sidebarCounts = {
      sla: await adminPage.locator('.nav-item[data-view="sla-monitoring"]').count(),
      audit: await adminPage.locator('.nav-item[data-view="audit-logs"]').count(),
      gis: await adminPage.locator('.nav-item[data-view="gis"]').count()
    };
    assert.deepEqual(report.checks.sidebarCounts, { sla: 1, audit: 1, gis: 1 });
    report.checks.sidebarOrder = await adminPage.evaluate(() => {
      const sla = document.querySelector('.nav-item[data-view="sla-monitoring"]');
      const gis = document.querySelector('.nav-item[data-view="gis"]');
      const audit = document.querySelector('.nav-item[data-view="audit-logs"]');
      const police = document.querySelector('.nav-item[data-view="police-management"]');
      return { slaAfterGis: Boolean(gis && sla && gis.compareDocumentPosition(sla) & Node.DOCUMENT_POSITION_FOLLOWING), auditAfterPolice: Boolean(police && audit && police.compareDocumentPosition(audit) & Node.DOCUMENT_POSITION_FOLLOWING), slaInOperations: Boolean(sla?.closest("details.nav-group")?.querySelector("summary")?.textContent.includes("Operations")), auditInAdministration: Boolean(audit?.closest("details.nav-group")?.querySelector("summary")?.textContent.includes("Administration")) };
    });
    assert.ok(report.checks.sidebarOrder.slaAfterGis && report.checks.sidebarOrder.slaInOperations);
    assert.ok(report.checks.sidebarOrder.auditAfterPolice && report.checks.sidebarOrder.auditInAdministration);

    const destination = await searchPlace(adminPage, "Medak, Telangana", /medak/i);
    const locationCard = adminPage.locator("#gisMap .selected-location-card");
    report.checks.gisSearch = {
      provider: destination.provider,
      status: destination.responseStatus,
      result: destination.result.label || destination.result.displayName,
      cardTitle: await locationCard.locator(".selected-location-title").textContent(),
      actions: await locationCard.locator("button[data-location-action]").allTextContents(),
      pinCount: await adminPage.locator("#gisMap .leaflet-marker-icon").count(),
      legacyPreviewCount: await adminPage.getByText(/Preview shown|Confirm it to set destination/i).count()
    };
    assert.ok(report.checks.gisSearch.cardTitle.includes(destination.result.label || destination.result.displayName || destination.result.name));
    assert.deepEqual(report.checks.gisSearch.actions.map((value) => value.trim()), ["Directions", "Set as Start", "Set as Destination", "Close"]);
    assert.equal(report.checks.gisSearch.legacyPreviewCount, 0);
    await adminPage.screenshot({ path: path.join(outputDir, "gis-place-card-1440.png"), fullPage: true });
    screenshots.gisPlaceCard = path.join(outputDir, "gis-place-card-1440.png");

    await locationCard.locator('button[data-location-action="directions"]').click();
    const liveStart = await searchPlace(adminPage, "Hyderabad, Telangana", /hyderabad/i);
    const routeResponsePromise = adminPage.waitForResponse((response) => new URL(response.url()).pathname === "/api/maps/route", { timeout: 30000 });
    await adminPage.locator('#gisMap button[data-location-action="start"]').click();
    const routeResponse = await routeResponsePromise;
    const routeBody = await routeResponse.json();
    await adminPage.waitForFunction(() => !document.querySelector("#navigateMap")?.disabled, null, { timeout: 20000 }).catch(() => {});
    await adminPage.waitForFunction(() => {
      const distance = document.querySelector("#routeDistance")?.textContent.trim();
      const provider = document.querySelector("#routeProvider")?.textContent.trim();
      return Boolean(distance && distance !== "--" && provider && provider !== "No route");
    }, null, { timeout: 15000 });
    report.checks.gisRoute = {
      status: routeResponse.status(),
      provider: routeBody.provider || routeBody.routes?.[0]?.provider || null,
      fallback: Boolean(routeBody.approximate || routeBody.isApproximate || routeBody.routes?.[0]?.isApproximate),
      routeCount: routeBody.routes?.length || (routeBody.geometry ? 1 : 0),
      distanceKm: routeBody.distanceKm || routeBody.routes?.[0]?.distanceKm || null,
      durationMinutes: routeBody.durationMinutes || routeBody.routes?.[0]?.durationMinutes || null,
      start: liveStart.result.label || liveStart.result.displayName,
      destination: destination.result.label || destination.result.displayName,
      summary: await adminPage.locator("#mapNavigationStatus").textContent(),
      uiDistance: await adminPage.locator("#routeDistance").textContent(),
      uiEta: await adminPage.locator("#routeEta").textContent(),
      uiProvider: await adminPage.locator("#routeProvider").textContent(),
      routeOptions: await adminPage.locator("#routeOptionsPanel .route-option-card").count(),
      routeLineCount: await adminPage.locator("#gisMap path.leaflet-interactive").count(),
      routeCoordinates: routeBody.routes?.[0]?.geometry?.coordinates?.length || routeBody.geometry?.coordinates?.length || 0
    };
    assert.equal(routeResponse.status(), 200);
    if (report.checks.gisRoute.fallback) {
      const health = await adminPage.evaluate(async () => { const response = await fetch("/api/maps/health"); return response.ok ? response.json() : { status: response.status }; });
      report.checks.gisRoute.routingHealth = health.routing || health;
      assert.notEqual(health.routing?.reachable, true, "OSRM is reachable but the application route API fell back to an approximate route");
    }
    if (!report.checks.gisRoute.fallback && report.checks.gisRoute.routeCount > 0) {
      await adminPage.screenshot({ path: path.join(outputDir, "gis-road-route-1440.png"), fullPage: true });
      screenshots.gisRoadRoute = path.join(outputDir, "gis-road-route-1440.png");
    }

    await searchPlace(adminPage, "Medak, Telangana", /medak/i);
    const destinationActionPromise = adminPage.waitForResponse((response) => new URL(response.url()).pathname === "/api/maps/route", { timeout: 30000 });
    await adminPage.locator('#gisMap button[data-location-action="destination"]').click();
    const destinationRoute = await destinationActionPromise;
    assert.equal(destinationRoute.status(), 200);
    report.checks.gisSetDestinationAction = { routeStatus: destinationRoute.status(), destination: await adminPage.locator("#routePoints").textContent() };
    await adminPage.locator('#gisMap button[data-location-action="close"]').click();
    assert.equal(await locationCard.isVisible(), false);

    await adminPage.locator("#resetGisMap").click();
    const map = adminPage.locator("#gisMap .leaflet-container");
    const point = await map.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      for (let y = 0.25; y < 0.82; y += 0.07) for (let x = 0.2; x < 0.82; x += 0.07) {
        const px = rect.left + rect.width * x, py = rect.top + rect.height * y;
        const target = document.elementFromPoint(px, py);
        if (target?.closest(".leaflet-container") === element && !target.closest(".map-search,.map-layer-control,.map-control,.selected-location-card,.operational-marker,.leaflet-marker-icon,.leaflet-interactive")) return { x: px, y: py };
      }
      return null;
    });
    assert.ok(point, "Could not find a normal map tile for the direct map click");
    const reversePromise = adminPage.waitForResponse((response) => new URL(response.url()).pathname === "/api/maps/reverse", { timeout: 20000 }).catch(() => null);
    await adminPage.mouse.click(point.x, point.y);
    await reversePromise;
    await adminPage.waitForFunction(() => {
      const card = document.querySelector("#gisMap .selected-location-card");
      return Boolean(card && !card.hidden && card.querySelector(".selected-location-title")?.textContent?.trim());
    }, null, { timeout: 10000 });
    report.checks.gisMapClick = { title: await locationCard.locator(".selected-location-title").textContent(), cardVisible: await locationCard.isVisible(), reverseGeocodeRequested: Boolean(await reversePromise) };

    await adminPage.locator('.nav-item[data-view="sla-monitoring"]').click();
    await waitForPanel(adminPage, "sla-monitoring");
    await adminPage.locator("#slaMonitoringContent").waitFor({ state: "visible", timeout: 20000 });
    await adminPage.locator("#slaMonitoringLoading").waitFor({ state: "hidden" });
    const slaResponse = await adminPage.evaluate(async () => {
      const response = await fetch("/api/sla/monitoring?e2e=1");
      return { status: response.status, body: await response.json() };
    });
    assert.equal(slaResponse.status, 200);
    report.checks.sla = {
      heading: await adminPage.locator('[data-panel="sla-monitoring"] h2').textContent(),
      activeCases: await adminPage.locator("#slaKpiActive").textContent(),
      breachTrendVisible: await adminPage.locator("#slaBreachTrend").isVisible(),
      filters: await adminPage.locator("#slaMonitoringContent .sla-filters select").count(),
      searchFilterVisible: await adminPage.locator("#slaSearch").isVisible(),
      incidentRows: await adminPage.locator("#slaCaseTable tbody tr").count(),
      apiStatus: slaResponse.status,
      apiKeys: Object.keys(slaResponse.body),
      databaseMode: slaResponse.body.databaseMode || "server-backed",
      sidebarVisible: await adminPage.locator('.nav-item[data-view="sla-monitoring"]').isVisible()
    };
    assert.ok(Number(report.checks.sla.activeCases) > 0, "SLA dashboard must display live active incidents");
    assert.equal(report.checks.sla.filters, 5);
    assert.ok(report.checks.sla.searchFilterVisible, "SLA dashboard must expose case search");
    await adminPage.screenshot({ path: path.join(outputDir, "sla-monitoring-1440.png"), fullPage: true });
    screenshots.slaMonitoring = path.join(outputDir, "sla-monitoring-1440.png");

    await adminPage.setViewportSize({ width: 390, height: 844 });
    await adminPage.locator('.nav-item[data-view="gis"]').click();
    await waitForPanel(adminPage, "gis");
    await searchPlace(adminPage, "Medak, Telangana", /medak/i);
    await adminPage.screenshot({ path: path.join(outputDir, "gis-place-card-390.png"), fullPage: true });
    screenshots.gisPlaceCardMobile = path.join(outputDir, "gis-place-card-390.png");
    await adminPage.locator('.nav-item[data-view="sla-monitoring"]').click();
    await waitForPanel(adminPage, "sla-monitoring");
    await adminPage.locator("#slaMonitoringContent").waitFor({ state: "visible", timeout: 15000 });
    await adminPage.screenshot({ path: path.join(outputDir, "sla-monitoring-390.png"), fullPage: true });
    screenshots.slaMonitoringMobile = path.join(outputDir, "sla-monitoring-390.png");
    report.checks.mobile390 = await adminPage.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, slaNavCount: document.querySelectorAll('.nav-item[data-view="sla-monitoring"]').length }));
    assert.ok(report.checks.mobile390.documentWidth <= report.checks.mobile390.viewport);

    await adminPage.setViewportSize({ width: 1440, height: 900 });
    await expandNavigationGroup(adminPage, "Administration");
    await adminPage.locator('.nav-item[data-view="audit-logs"]').click();
    await waitForPanel(adminPage, "audit-logs");
    await adminPage.locator("#auditPageStatus").waitFor({ state: "visible" });
    await adminPage.waitForFunction(() => document.querySelector("#auditPageStatus")?.textContent.includes("loaded"), null, { timeout: 20000 });
    await adminPage.screenshot({ path: path.join(outputDir, "audit-logs-1440.png"), fullPage: true });
    screenshots.auditLogsDesktop = path.join(outputDir, "audit-logs-1440.png");
    const auditResponse = await adminPage.evaluate(async () => {
      const response = await fetch("/api/audit-logs?limit=25&offset=0&e2e=1");
      return { status: response.status, body: await response.json() };
    });
    assert.equal(auditResponse.status, 200);
    assert.ok(auditResponse.body.total > 0, "Audit page must show persisted records");
    report.checks.audit = {
      heading: await adminPage.locator('[data-panel="audit-logs"] h2').textContent(),
      resultCount: await adminPage.locator("#auditPageResultCount").textContent(),
      visibleRecords: await adminPage.locator("#auditPageList .audit-page-card").count(),
      apiTotal: auditResponse.body.total,
      firstRecordFields: Object.keys(auditResponse.body.auditLogs?.[0] || {}),
      sidebarVisible: await adminPage.locator('.nav-item[data-view="audit-logs"]').isVisible(),
      previousDisabled: await adminPage.locator("#auditPagePrevious").isDisabled()
    };
    const firstAction = String(auditResponse.body.auditLogs?.[0]?.action || "");
    if (firstAction) {
      await adminPage.locator("#auditPageSearch").fill(firstAction);
      await adminPage.locator("#auditPageFilterForm button[type='submit']").click();
      await adminPage.waitForFunction(() => document.querySelector("#auditPageStatus")?.textContent.includes("loaded"), null, { timeout: 15000 });
      report.checks.audit.search = { query: firstAction, resultCount: await adminPage.locator("#auditPageResultCount").textContent(), visible: await adminPage.locator("#auditPageList .audit-page-card").count() };
      await adminPage.locator("#auditPageReset").click();
      await adminPage.waitForFunction(() => document.querySelector("#auditPageStatus")?.textContent.includes("loaded"), null, { timeout: 15000 });
      const nextPagePromise = adminPage.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/audit-logs" && url.searchParams.get("offset") === "25";
      });
      await adminPage.locator("#auditPageNext:not([disabled])").click();
      await nextPagePromise;
      await adminPage.waitForFunction(() => document.querySelector("#auditPageRange")?.textContent.startsWith("26"));
      report.checks.audit.pagination = { nextRange: await adminPage.locator("#auditPageRange").textContent() };
      const firstPagePromise = adminPage.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/audit-logs" && url.searchParams.get("offset") === "0";
      });
      await adminPage.locator("#auditPagePrevious:not([disabled])").click();
      await firstPagePromise;
      await adminPage.waitForFunction(() => document.querySelector("#auditPageRange")?.textContent.startsWith("1"));
      assert.match(await adminPage.locator("#auditPageRange").textContent(), /^1–25 of/);
    }
    await adminPage.setViewportSize({ width: 390, height: 844 });
    await adminPage.screenshot({ path: path.join(outputDir, "audit-logs-390.png"), fullPage: true });
    screenshots.auditLogs = path.join(outputDir, "audit-logs-390.png");
    report.checks.mobile390.auditPageWidth = await adminPage.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(report.checks.mobile390.auditPageWidth <= 390);

    await adminPage.setViewportSize({ width: 1440, height: 900 });
    await adminPage.goto(`${baseUrl}/sla-monitoring`, { waitUntil: "domcontentloaded" });
    await waitForPanel(adminPage, "sla-monitoring");
    await adminPage.reload({ waitUntil: "domcontentloaded" });
    await waitForPanel(adminPage, "sla-monitoring");
    report.checks.directRefresh = { path: new URL(adminPage.url()).pathname, panel: await adminPage.locator('[data-panel="sla-monitoring"]').evaluate((element) => element.classList.contains("active")) };
    await expandNavigationGroup(adminPage, "Administration");
    await adminPage.locator('.nav-item[data-view="audit-logs"]').click();
    await waitForPanel(adminPage, "audit-logs");
    await adminPage.goBack();
    await waitForPanel(adminPage, "sla-monitoring");
    await adminPage.goForward();
    await waitForPanel(adminPage, "audit-logs");
    report.checks.history = { back: "SLA Monitoring", forward: "Audit Logs" };

    const roleAccounts = [
      { role: "Police Officer", accountLabel: "Police Officer (unscoped seed)", username: "police@rakshakai.local", password: envValue("SEED_POLICE_PASSWORD"), path: "sla-monitoring", expectedSlaNav: true, expectedSlaApi: 403, expectedDirectSlaPanel: 1, expectedAudit: false, expectSlaScopeError: true },
      { role: "Citizen", username: "citizen@rakshakai.local", password: envValue("SEED_CITIZEN_PASSWORD"), path: "sla-monitoring", expectedSlaNav: false, expectedSlaApi: 403, expectedDirectSlaPanel: 0, expectedAudit: false }
    ];
    report.checks.roles = {};
    for (const account of roleAccounts) {
      const statePath = sessionPath(account.role.toLowerCase().replace(/\s+/g, "-"));
      const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, ...(fs.existsSync(statePath) ? { storageState: statePath } : {}) });
      const page = await context.newPage();
      watch(page);
      try {
        const sessionUser = await loginOnce(page, account.username, account.password, statePath);
        assert.equal(sessionUser.role, account.role);
        await expandNavigationGroup(page, "Operations");
        const navSla = await page.locator('.nav-item[data-view="sla-monitoring"]').isVisible().catch(() => false);
        const navAudit = await page.locator('.nav-item[data-view="audit-logs"]').isVisible().catch(() => false);
        const apiStatuses = await page.evaluate(async () => {
          const results = {};
          for (const endpoint of ["/api/sla/monitoring", "/api/audit-logs?limit=1&offset=0"]) {
            results[endpoint] = (await fetch(endpoint)).status;
          }
          return results;
        });
        await page.goto(`${baseUrl}/${account.path}`, { waitUntil: "domcontentloaded" });
        const directPanel = await page.locator(`[data-panel="${account.path}"].active`).count();
        if (account.expectSlaScopeError) await page.waitForFunction(() => !document.querySelector("#slaMonitoringError")?.hidden, null, { timeout: 15000 });
        const directSlaError = account.expectSlaScopeError ? await page.locator("#slaMonitoringError").textContent() : null;
        await page.goto(`${baseUrl}/audit-logs`, { waitUntil: "domcontentloaded" });
        const directAuditPanel = await page.locator('[data-panel="audit-logs"].active').count();
        report.checks.roles[account.accountLabel || account.role] = { navSla, navAudit, apiStatuses, directRestrictedPanelCount: directPanel, directSlaError, directAuditPanelCount: directAuditPanel };
        assert.equal(navSla, account.expectedSlaNav, `${account.role} SLA navigation visibility`);
        assert.equal(navAudit, account.expectedAudit, `${account.role} audit navigation restriction`);
        assert.equal(apiStatuses["/api/sla/monitoring"], account.expectedSlaApi);
        assert.equal(apiStatuses["/api/audit-logs?limit=1&offset=0"], 403);
        assert.equal(directPanel, account.expectedDirectSlaPanel, `${account.role} direct SLA route scope`);
        if (account.expectSlaScopeError) assert.match(directSlaError, /registered police station or jurisdiction/i);
        assert.equal(directAuditPanel, 0, `${account.role} direct Audit Logs route must remain restricted`);
      } finally {
        await context.close();
      }
    }

    const authorizedPoliceSession = process.env.RAKSHAKAI_AUTHORIZED_POLICE_SESSION;
    report.checks.authorizedPolice = authorizedPoliceSession && fs.existsSync(authorizedPoliceSession)
      ? await verifyAuthorizedPoliceSession(browser, authorizedPoliceSession)
      : { status: "NOT_VERIFIED", reason: "The configured Police seed account has no station scope; no session for an active station-scoped Police account was available." };

    report.events.consoleErrors = events.consoleErrors.filter((message) => !/status of 403 \(Forbidden\)/i.test(message));
    report.events.expectedConflictConsoleMessages = report.events.expectedConflicts.length
      ? report.events.consoleErrors.filter((message) => /status of 409 \(Conflict\)/i.test(message))
      : [];
    report.events.consoleErrors = report.events.consoleErrors.filter((message) => !/status of 409 \(Conflict\)/i.test(message));
    report.events.badResponses = events.badResponses.filter((event) => !(event.status === 403 && /\/api\/(?:sla\/monitoring|audit-logs)/.test(event.url)));
    assert.deepEqual(events.pageErrors, []);
    assert.deepEqual(events.failedRequests, []);
    assert.deepEqual(report.events.consoleErrors, []);
    assert.deepEqual(report.events.badResponses, []);
    const result = report.checks.authorizedPolice.status === "PASS" ? "PASS" : "PARTIAL";
    report.result = result;
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
    for (const name of ["admin", "police-officer", "citizen"]) fs.rmSync(sessionPath(name), { force: true });
    console.log(JSON.stringify({ result, outputDir, checks: report.checks, screenshots, events: report.events }, null, 2));
  } finally {
    await adminContext.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
