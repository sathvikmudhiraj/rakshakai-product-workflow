const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.RAKSHAKAI_URL || "http://localhost:3001";
const sessionPath = path.join(os.tmpdir(), "rakshakai-live-ui-sessions", "admin.json");

async function main() {
  if (!fs.existsSync(sessionPath)) throw new Error("No saved Admin browser session is available");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: sessionPath });
  const page = await context.newPage();
  const report = { badResponses: [], consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on("response", async (response) => {
    if (response.status() >= 400) report.badResponses.push({ status: response.status(), method: response.request().method(), url: response.url(), body: (await response.text().catch(() => "")).slice(0, 350) });
  });
  page.on("console", (message) => { if (message.type() === "error") report.consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("requestfailed", (request) => report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  try {
    await page.goto(`${baseUrl}/gis`, { waitUntil: "domcontentloaded" });
    await page.locator("#appShell:not(.app-hidden)").waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(2000);
    await page.locator('.nav-item[data-view="sla-monitoring"]').click();
    await page.locator("#slaMonitoringContent").waitFor({ state: "visible", timeout: 20000 });
    await page.locator("#slaMonitoringLoading").waitFor({ state: "hidden" });
    await page.locator(".nav-group summary").filter({ hasText: "Administration" }).click();
    await page.locator('.nav-item[data-view="audit-logs"]').click();
    await page.waitForFunction(() => document.querySelector("#auditPageStatus")?.textContent.includes("loaded"), null, { timeout: 20000 });
    report.activePanel = await page.locator(".view.active").evaluate((element) => element.dataset.panel);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
