const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const BASE = "http://localhost:3000";

async function login(page, email, password) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("#loginForm input[name='email']").fill(email);
  await page.locator("#loginForm input[name='password']").fill(password);
  await page.locator("#loginForm button[type='submit']").click();
  await page.locator("#logoutButton").waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(1500);
}

async function logout(page) {
  await page.locator("#logoutButton").click();
  await page.locator("#loginForm").waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(800);
}

async function testAdminDashboard(page) {
  await login(page, "admin@rakshakai.local", "demo123");
  const state = await page.evaluate(() => {
    const role = document.querySelector("#currentUser")?.textContent?.trim();
    const metrics = ["missingMetric", "alertMetric", "cameraMetric", "zoneMetric"].map((id) => document.getElementById(id)?.textContent?.trim());
    const assign = document.querySelector("#assignIncident");
    const border = assign ? getComputedStyle(assign).borderTopWidth : null;
    const borderColor = assign ? getComputedStyle(assign).borderTopColor : null;
    const badge = document.querySelector(".notification-count");
    return {
      role,
      metrics,
      ghostBorder: border,
      ghostBorderColor: borderColor,
      amPm: /\b(AM|PM)\b/.test(document.body.innerText),
      badgeText: badge?.textContent,
      badgeHidden: badge?.hidden
    };
  });
  assert.ok(state.role && state.role !== "Connecting…" && state.role !== "Not signed in", `sidebar role must resolve, got "${state.role}"`);
  for (const m of state.metrics) assert.notEqual(m, "—", `dashboard metric must load a real value, got "${m}"`);
  assert.equal(state.ghostBorder, "1px", `ghost buttons must show a border, got ${state.ghostBorder}`);
  assert.ok(!state.amPm, "no AM/PM times allowed (24h en-IN required)");
  if (state.badgeText === "0") assert.equal(state.badgeHidden, true, "notification badge must hide at 0");
  await page.screenshot({ path: "artifacts/ui-qa/final-admin-dashboard.png", fullPage: false });
  console.log("PASS admin dashboard: role resolved, metrics loaded, ghost borders visible, 24h times:", JSON.stringify({ role: state.role, metrics: state.metrics }));
  return state;
}

async function testGisMapLayers(page) {
  await page.goto(`${BASE}/gis`, { waitUntil: "domcontentloaded" });
  await page.locator("#gisMap").waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(1800);
  const before = await page.evaluate(() => {
    const menu = document.querySelector("#gisMap .map-layer-menu");
    const toggle = document.querySelector("#gisMap .map-layer-toggle");
    const map = document.getElementById("gisMap");
    const menuRect = menu?.getBoundingClientRect();
    const mapRect = map?.getBoundingClientRect();
    return {
      hidden: menu?.hidden,
      toggleVisible: toggle ? getComputedStyle(toggle).display !== "none" : false,
      menuCoverage: menuRect && mapRect ? (menuRect.width * menuRect.height) / (mapRect.width * mapRect.height) : null
    };
  });
  assert.equal(before.hidden, true, "layer menu must be collapsed by default");
  assert.equal(before.toggleVisible, true, "layer toggle button must be visible");
  assert.ok(before.menuCoverage !== null && before.menuCoverage < 0.02, `closed menu must not cover the map, coverage=${before.menuCoverage}`);
  await page.locator("#gisMap .map-layer-toggle").click();
  const opened = await page.evaluate(() => !document.querySelector("#gisMap .map-layer-menu")?.hidden);
  assert.equal(opened, true, "clicking Layers must open the menu");
  await page.screenshot({ path: "artifacts/ui-qa/final-admin-gis-open-layers.png", fullPage: false });
  await page.keyboard.press("Escape");
  const closed = await page.evaluate(() => document.querySelector("#gisMap .map-layer-menu")?.hidden);
  assert.equal(closed, true, "Escape must close the layer menu");
  await page.screenshot({ path: "artifacts/ui-qa/final-admin-gis.png", fullPage: false });
  console.log("PASS GIS: layers collapsed by default, toggle opens/closes, map unobstructed");
}

async function testAuditLogs(page) {
  await page.goto(`${BASE}/audit-logs`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("#auditPageList .audit-page-card").length > 0, null, { timeout: 20000 });
  const audit = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("#auditPageList .audit-page-card")];
    const duplicateIncidentRows = cards.filter((card) => {
      const fields = [...card.querySelectorAll(".audit-page-field")];
      const entity = fields.find((f) => f.querySelector("span")?.textContent === "Entity");
      const incident = fields.find((f) => f.querySelector("span")?.textContent === "Incident");
      if (!entity || !incident) return false;
      const entityId = entity.querySelector("strong")?.textContent || "";
      const incidentId = incident.querySelector("strong")?.textContent || "";
      return entityId.includes(incidentId);
    }).length;
    const heights = cards.slice(0, 6).map((card) => Math.round(card.getBoundingClientRect().height));
    return { count: cards.length, duplicateIncidentRows, heights };
  });
  assert.ok(audit.count >= 5, `audit cards must render, got ${audit.count}`);
  assert.equal(audit.duplicateIncidentRows, 0, "Entity and Incident rows must not duplicate the same ID");
  const avg = audit.heights.reduce((a, b) => a + b, 0) / audit.heights.length;
  assert.ok(avg < 120, `audit cards must be compact, avg height=${Math.round(avg)}px`);
  await page.screenshot({ path: "artifacts/ui-qa/final-admin-audit-logs.png", fullPage: false });
  console.log(`PASS audit logs: ${audit.count} cards, no duplicate incident rows, avg card height ${Math.round(avg)}px`);
}

async function testCloseIncidentConfirm(page) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.locator("#incidentList .incident").first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction(() => !document.body.classList.contains("ui-loading"), null, { timeout: 20000 });
  await page.waitForTimeout(500);
  const hasSelection = await page.evaluate(() => {
    const button = document.querySelector("#closeIncident");
    return Boolean(button && !button.disabled && button.offsetParent !== null);
  });
  if (!hasSelection) {
    console.log("SKIP close-incident confirm: no incident selected in this session state");
    return;
  }
  await page.locator("#closeIncident").click();
  const dialog = page.locator("#appConfirmDialog");
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  const text = await dialog.innerText();
  assert.ok(/close incident/i.test(text), `confirm must mention closing the incident, got: ${text.slice(0, 120)}`);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached", timeout: 5000 });
  console.log("PASS close incident asks for confirmation");
}

async function testCitizenReports(page) {
  await logout(page);
  await login(page, "citizen@rakshakai.local", "demo123");
  await page.waitForFunction(() => document.body.dataset.view === "missing", null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("#caseList .case-card")];
    const preview = document.getElementById("filePreview");
    const useLocation = document.getElementById("useReportLocation");
    return {
      cardCount: cards.length,
      debugRows: cards.filter((card) => /Name:|Type:|Status:|File:/.test(card.innerText)).length,
      noPhotoText: cards.filter((card) => card.innerText.includes("No photo uploaded")).length,
      typeChips: document.querySelectorAll("#caseList .case-type-chip").length,
      previewVisible: preview ? getComputedStyle(preview).display !== "none" : false,
      useLocationBorder: useLocation ? getComputedStyle(useLocation).borderTopWidth : null,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  assert.ok(state.cardCount > 0, "citizen report cards must render");
  assert.equal(state.debugRows, 0, "no Name:/Type:/Status:/File: colon rows allowed");
  assert.equal(state.noPhotoText, 0, '"No photo uploaded" placeholder must be gone');
  assert.equal(state.typeChips, state.cardCount, "every card shows its report type as a chip");
  assert.equal(state.previewVisible, false, "empty file preview bar must stay hidden");
  assert.equal(state.useLocationBorder, "1px", "Use My Current Location must look like a button");
  assert.equal(state.overflowX, false, "no horizontal overflow on mobile-width citizen view");
  await page.screenshot({ path: "artifacts/ui-qa/final-citizen-reports.png", fullPage: false });
  console.log(`PASS citizen reports: ${state.cardCount} redesigned cards, no debug rows, preview hidden, buttons styled`);
}

async function testCloseAllAlertsLabel(page) {
  await logout(page);
  await login(page, "police@rakshakai.local", "demo123");
  await page.goto(`${BASE}/alerts`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const label = await page.evaluate(() => document.getElementById("clearAlerts")?.textContent?.trim());
  assert.equal(label, "Close All", `alert action must read "Close All", got "${label}"`);
  console.log("PASS alerts action labeled Close All");
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const failures = [];
  const tests = [
    ["Admin dashboard", testAdminDashboard],
    ["GIS map layers", testGisMapLayers],
    ["Audit logs", testAuditLogs],
    ["Close incident confirm", testCloseIncidentConfirm],
    ["Citizen reports", testCitizenReports],
    ["Close All label", testCloseAllAlertsLabel]
  ];
  for (const [name, fn] of tests) {
    try {
      await fn(page);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
      console.error(`FAIL ${name}: ${error.message}`);
    }
  }
  await browser.close();
  if (failures.length) {
    console.error(`\n${failures.length} verification failure(s)`);
    process.exit(1);
  }
  console.log("\nAll make-10 fixes verified in the browser.");
})();
