const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.RAKSHAKAI_URL || "http://localhost:3001";
const root = path.join(__dirname, "..");
const envText = fs.readFileSync(path.join(root, ".env.docker"), "utf8");
const password = envText.match(/^SEED_CITIZEN_PASSWORD=(.*)$/m)?.[1]?.trim();
const sessionPath = path.join(os.tmpdir(), "rakshakai-live-ui-sessions", "citizen.json");
const outputPath = path.join(root, "artifacts", `live-citizen-access-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

async function main() {
  assert.ok(password, "Citizen test login is configured");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, ...(fs.existsSync(sessionPath) ? { storageState: sessionPath } : {}) });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(`${baseUrl}/gis`, { waitUntil: "domcontentloaded" });
    const shell = page.locator("#appShell:not(.app-hidden)");
    const authenticated = await shell.waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
    if (!authenticated) {
      await page.locator('#loginForm input[name="email"]').fill("citizen@rakshakai.local");
      await page.locator('#loginForm input[name="password"]').fill(password);
      const loginResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/login");
      await page.locator('#loginForm button[type="submit"]').click();
      const loginResponse = await loginResponsePromise;
      assert.equal(loginResponse.status(), 200, `Citizen sign-in failed (${loginResponse.status()})`);
      await shell.waitFor({ state: "visible", timeout: 20000 });
    }
    await page.context().storageState({ path: sessionPath });
    const result = await page.evaluate(async () => {
      const meResponse = await fetch("/api/auth/me");
      const session = meResponse.ok ? (await meResponse.json()).user : null;
      const endpoints = {};
      for (const endpoint of ["/api/sla/monitoring", "/api/audit-logs?limit=1&offset=0"]) endpoints[endpoint] = (await fetch(endpoint)).status;
      return {
        role: session?.role || null,
        sidebar: {
          slaVisible: [...document.querySelectorAll('.nav-item[data-view="sla-monitoring"]')].some((item) => item.getClientRects().length > 0),
          auditVisible: [...document.querySelectorAll('.nav-item[data-view="audit-logs"]')].some((item) => item.getClientRects().length > 0)
        },
        endpoints
      };
    });
    assert.equal(result.role, "Citizen");
    assert.equal(result.sidebar.slaVisible, false);
    assert.equal(result.sidebar.auditVisible, false);
    assert.equal(result.endpoints["/api/sla/monitoring"], 403);
    assert.equal(result.endpoints["/api/audit-logs?limit=1&offset=0"], 403);
    await page.goto(`${baseUrl}/sla-monitoring`, { waitUntil: "domcontentloaded" });
    await shell.waitFor({ state: "visible", timeout: 15000 });
    result.directSlaPanelCount = await page.locator('[data-panel="sla-monitoring"].active').count();
    await page.goto(`${baseUrl}/audit-logs`, { waitUntil: "domcontentloaded" });
    await shell.waitFor({ state: "visible", timeout: 15000 });
    result.directAuditPanelCount = await page.locator('[data-panel="audit-logs"].active').count();
    assert.equal(result.directSlaPanelCount, 0);
    assert.equal(result.directAuditPanelCount, 0);
    assert.deepEqual(pageErrors, []);
    result.pageErrors = pageErrors;
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ result: "PASS", outputPath, checks: result }, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
