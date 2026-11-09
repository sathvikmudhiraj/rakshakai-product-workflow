const { chromium } = require("playwright");
const fs = require("node:fs");

const BASE = "http://localhost:3000";
const OUT = "artifacts/ui-qa";
const VIEWS = [
  "dashboard", "incident-command", "gis", "cctv", "live-vision", "video-evidence",
  "cctns", "missing", "alerts", "history", "police-management", "audit-logs",
  "settings", "erss-call-taker", "erss-dispatcher", "erss-assistance", "erss-supervisor", "erss-field"
];

async function login(page, email, password) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("#loginForm input[name='email']").fill(email);
  await page.locator("#loginForm input[name='password']").fill(password);
  await page.locator("#loginForm button[type='submit']").click();
  await page.locator("#logoutButton").waitFor({ state: "visible", timeout: 20000 });
}

async function captureViews(page, role, viewportName) {
  for (const view of VIEWS) {
    await page.goto(`${BASE}/${view}`, { waitUntil: "domcontentloaded" });
    try {
      await page.locator("#appShell").waitFor({ state: "visible", timeout: 10000 });
    } catch { /* view may redirect to portal */ }
    await page.waitForTimeout(1400);
    const resolved = await page.evaluate(() => document.body.dataset.view || "portal");
    await page.screenshot({ path: `${OUT}/${role}-${view}-${viewportName}.png`, fullPage: true });
    console.log(`captured ${role}-${view}-${viewportName} (resolved view: ${resolved})`);
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // Admin desktop
  const adminDesktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await login(adminDesktop, "admin@rakshakai.local", "demo123");
  await captureViews(adminDesktop, "admin", "desktop");

  // Admin dialogs (desktop)
  await adminDesktop.goto(`${BASE}/police-management`, { waitUntil: "domcontentloaded" });
  await adminDesktop.waitForTimeout(1000);
  const addUnit = adminDesktop.locator("#addUnitRegistry");
  if (await addUnit.count()) {
    await addUnit.click();
    await adminDesktop.waitForTimeout(600);
    await adminDesktop.screenshot({ path: `${OUT}/admin-unit-registry-dialog-desktop.png` });
    await adminDesktop.keyboard.press("Escape");
  }
  const addStation = adminDesktop.locator("#addStationRegistry");
  if (await addStation.count()) {
    await addStation.click();
    await adminDesktop.waitForTimeout(600);
    await adminDesktop.screenshot({ path: `${OUT}/admin-station-registry-dialog-desktop.png` });
  }
  console.log("captured admin dialogs");

  // Admin mobile
  await adminDesktop.setViewportSize({ width: 390, height: 844 });
  await captureViews(adminDesktop, "admin", "mobile");
  await adminDesktop.close();

  // Citizen desktop + mobile (missing view)
  const citizen = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await login(citizen, "citizen@rakshakai.local", "demo123");
  await citizen.waitForTimeout(1200);
  await citizen.screenshot({ path: `${OUT}/citizen-missing-desktop.png`, fullPage: true });
  await citizen.setViewportSize({ width: 390, height: 844 });
  await citizen.waitForTimeout(800);
  await citizen.screenshot({ path: `${OUT}/citizen-missing-mobile.png`, fullPage: true });
  await citizen.close();
  console.log("captured citizen views");

  // Portal (logged out)
  const portal = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await portal.goto(BASE, { waitUntil: "domcontentloaded" });
  await portal.waitForTimeout(800);
  await portal.screenshot({ path: `${OUT}/portal-login-desktop.png` });
  const registerToggle = portal.locator("[data-auth-panel='login'] button:has-text('Create'), #showRegister, button:has-text('Register')").first();
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
