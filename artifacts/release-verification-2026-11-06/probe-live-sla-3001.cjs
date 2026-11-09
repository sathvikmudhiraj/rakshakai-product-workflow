const path = require("node:path");
const os = require("node:os");
const { chromium } = require("playwright");

const origin = "http://localhost:3001";
const sessionPath = path.join(os.tmpdir(), "rakshakai-live-ui-sessions", "admin.json");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, storageState: sessionPath });
  const page = await context.newPage();
  const errors = { page: [], failedRequests: [], http: [] };
  page.on("pageerror", (error) => errors.page.push(error.message));
  page.on("requestfailed", (request) => errors.failedRequests.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
  page.on("response", (response) => { if (response.status() >= 400) errors.http.push({ status: response.status(), path: new URL(response.url()).pathname }); });
  try {
    const home = await page.goto(origin, { waitUntil: "domcontentloaded" });
    const identity = await page.evaluate(async () => {
      const response = await fetch("/api/auth/me", { credentials: "include" });
      const data = await response.json().catch(() => ({}));
      return { status: response.status, role: data.user?.role || null };
    });
    const shellState = await page.evaluate(() => ({
      view: document.body.dataset.view || null,
      appShellVisible: Boolean(document.querySelector("#appShell:not(.app-hidden)")),
      loginVisible: Boolean(document.querySelector("#loginForm")?.getClientRects().length),
      loginMessage: document.querySelector("#loginError")?.textContent?.trim() || ""
    }));
    if (identity.status !== 200) {
      await page.screenshot({ path: path.join(__dirname, "live-sla-3001-auth-required.png"), fullPage: true });
    }
    let sla = { status: null, recordCount: null };
    let dashboard = { active: false, tableRows: 0, cards: 0 };
    if (identity.status === 200 && ["Admin", "Police Officer"].includes(identity.role)) {
      const apiResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/sla/monitoring");
      await page.locator('.nav-item[data-view="sla-monitoring"]').click({ noWaitAfter: true });
      await page.waitForFunction(() => document.body.dataset.view === "sla-monitoring");
      const response = await apiResponsePromise;
      const data = await response.json();
      await page.locator("#slaMonitoringContent").waitFor({ state: "visible" });
      sla = { status: response.status(), recordCount: Array.isArray(data.incidents) ? data.incidents.length : Array.isArray(data.cases) ? data.cases.length : null };
      dashboard = await page.evaluate(() => ({
        active: document.querySelector('[data-panel="sla-monitoring"]')?.classList.contains("active"),
        tableRows: document.querySelectorAll("#slaCaseTable tbody tr").length,
        cards: document.querySelectorAll("#slaCaseCards .sla-case-row").length,
        documentWidth: document.documentElement.scrollWidth,
        viewport: innerWidth
      }));
    }
    console.log(JSON.stringify({ origin, homeStatus: home?.status() ?? null, identity, shellState, sla, dashboard, errors }, null, 2));
    if (identity.status !== 200 || sla.status !== 200) process.exitCode = 2;
    else if (errors.page.length || errors.failedRequests.length || errors.http.some(({ status }) => status >= 500)) process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
