const { chromium } = require("playwright");
const fs = require("node:fs");

const BASE = "http://localhost:3000";
const OUT = "artifacts/ui-qa";

async function login(page, email, password) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("#loginForm input[name='email']").fill(email);
  await page.locator("#loginForm input[name='password']").fill(password);
  await page.locator("#loginForm button[type='submit']").click();
  await page.locator("#logoutButton").waitFor({ state: "visible", timeout: 20000 });
}

async function captureView(page, role, view, viewportName) {
  await page.goto(`${BASE}/${view}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  let resolved = await page.evaluate(() => document.body.dataset.view || "portal");
  if (resolved === "portal") {
    console.log(`  session dropped at ${view}, re-authenticating...`);
    await login(page, "admin@rakshakai.local", "demo123");
    await page.goto(`${BASE}/${view}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    resolved = await page.evaluate(() => document.body.dataset.view || "portal");
  }
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${role}-${view}-${viewportName}.png`, fullPage: true });
  console.log(`captured ${role}-${view}-${viewportName} (resolved: ${resolved})`);
  return resolved;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await login(page, "admin@rakshakai.local", "demo123");

  const DESKTOP_MISSING = ["cctns", "missing", "alerts", "history", "police-management", "audit-logs", "settings", "erss-call-taker", "erss-dispatcher", "erss-assistance", "erss-supervisor", "erss-field"];
  for (const view of DESKTOP_MISSING) {
    await captureView(page, "admin", view, "desktop");
  }

  // dialogs on police-management
  const resolved = await page.evaluate(() => document.body.dataset.view);
  if (resolved !== "police-management") {
    await page.goto(`${BASE}/police-management`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    if ((await page.evaluate(() => document.body.dataset.view)) === "portal") await login(page, "admin@rakshakai.local", "demo123");
    await page.goto(`${BASE}/police-management`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
  }
  const addUnit = page.locator("#addUnitRegistry");
  if (await addUnit.isVisible().catch(() => false)) {
    await addUnit.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/admin-unit-registry-dialog-desktop.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const addStation = page.locator("#addStationRegistry");
    await addStation.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/admin-station-registry-dialog-desktop.png` });
    console.log("captured admin dialogs");
  } else {
    console.log("addUnitRegistry still not visible — skipping dialogs");
  }

  // Admin mobile — recapture all views
  await page.setViewportSize({ width: 390, height: 844 });
  const ALL = ["dashboard", "incident-command", "gis", "cctv", "live-vision", "video-evidence", "cctns", "missing", "alerts", "history", "police-management", "audit-logs", "settings", "erss-call-taker", "erss-dispatcher", "erss-assistance", "erss-supervisor", "erss-field"];
  for (const view of ALL) {
    await captureView(page, "admin", view, "mobile");
  }

  // Citizen
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, "citizen@rakshakai.local", "demo123");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/citizen-missing-desktop.png`, fullPage: true });
  console.log("captured citizen-missing-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/citizen-missing-mobile.png`, fullPage: true });
  console.log("captured citizen-missing-mobile");
  await page.close();

  // Portal
  const portal = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await portal.goto(BASE, { waitUntil: "domcontentloaded" });
  await portal.waitForTimeout(800);
  await portal.screenshot({ path: `${OUT}/portal-login-desktop.png` });
  const registerToggle = portal.locator("button:has-text('Create an account'), button:has-text('Create account'), button:has-text('Register'), a:has-text('Register')").first();
  if (await registerToggle.count()) {
    await registerToggle.click().catch(() => {});
    await portal.waitForTimeout(500);
    await portal.screenshot({ path: `${OUT}/portal-register-desktop.png` });
  }
  await portal.setViewportSize({ width: 390, height: 844 });
  await portal.waitForTimeout(600);
  await portal.screenshot({ path: `${OUT}/portal-login-mobile.png`, fullPage: true });
  await portal.close();
  console.log("captured portal");

  await browser.close();
  console.log("DONE");
})();
