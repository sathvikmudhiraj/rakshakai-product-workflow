const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.RAKSHAKAI_E2E_BASE_URL || "http://127.0.0.1:3002";
const outputDir = process.env.RAKSHAKAI_E2E_OUTPUT
  || path.join(__dirname, "..", "artifacts", `erss-supervisor-${new Date().toISOString().replace(/[:.]/g, "-")}`);
fs.mkdirSync(outputDir, { recursive: true });

const populatedQueue = {
  criticalEvents: [{
    id: "erss-browser-critical-1", externalEventId: "EXT-CRITICAL-112", priority: "CRITICAL",
    emergencyType: "MEDICAL", incidentLocationText: "Sector 7, Gate A", triageStatus: "RECEIVED",
    createdAt: "2026-11-04T08:00:00.000Z"
  }],
  unitTimeouts: [{
    id: "unit-timeout-1", erssEventId: "erss-browser-critical-1", unitId: "UNIT-7",
    status: "TIMEOUT", timeoutAt: "2026-11-04T08:01:00.000Z"
  }],
  assistanceTimeouts: [{
    id: "assistance-timeout-1", erssEventId: "erss-browser-critical-1", requestedStationId: "STATION-2",
    status: "TIMEOUT", requestedAt: "2026-11-04T08:02:00.000Z"
  }],
  jurisdictionDisputes: [{
    id: "jurisdiction-1", erssEventId: "erss-browser-critical-1", oldJurisdictionId: "STATION-1",
    newJurisdictionId: "STATION-2", reason: "Boundary review", changedAt: "2026-11-04T08:03:00.000Z"
  }],
  ownershipTransfers: [{
    id: "transfer-1", erssEventId: "erss-browser-critical-1", fromStationId: "STATION-1",
    toStationId: "STATION-2", status: "TRANSFER_REQUESTED", reason: "Cross-border response",
    requestedAt: "2026-11-04T08:04:00.000Z"
  }]
};
const emptyQueue = {
  criticalEvents: [], unitTimeouts: [], assistanceTimeouts: [], jurisdictionDisputes: [], ownershipTransfers: []
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const failedRequests = [];
  const unexpectedHttpErrors = [];
  let queueRequests = 0;
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
    if (message.type() === "warning") consoleWarnings.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const url = new URL(response.url());
    const expectedSupervisorFailure = url.pathname === "/api/erss/supervisor/queue" && response.status() === 504;
    if (!expectedSupervisorFailure) unexpectedHttpErrors.push({ url: response.url(), status: response.status() });
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    let data = {};
    if (pathname.endsWith("/auth/me") || pathname.endsWith("/me")) {
      data = { user: { id: "e2e-admin", name: "Supervisor Queue E2E", role: "Admin" } };
    } else if (pathname.endsWith("/erss/supervisor/queue")) {
      queueRequests += 1;
      if (queueRequests === 3) {
        await route.fulfill({ status: 504, contentType: "application/json", body: JSON.stringify({ error: "Intentionally simulated queue timeout" }) });
        return;
      }
      data = { queue: queueRequests >= 2 ? populatedQueue : emptyQueue };
    } else if (pathname.endsWith("/dashboard")) data = { summary: {} };
    else if (pathname.endsWith("/reports") || pathname.endsWith("/missing-persons")) data = { reports: [] };
    else if (pathname.endsWith("/zones")) data = { zones: [] };
    else if (pathname.endsWith("/incidents/live") || pathname.endsWith("/incidents/history") || pathname.endsWith("/incidents")) data = { incidents: [] };
    else if (pathname.endsWith("/alerts") || pathname.endsWith("/escalation/alerts")) data = { alerts: [] };
    else if (pathname.endsWith("/response-units")) data = { units: [], summary: {} };
    else if (pathname.endsWith("/police-stations")) data = { stations: [], defaultCenter: { lat: 17.5, lng: 78.3 } };
    else if (pathname.endsWith("/devices/health")) data = { devices: [] };
    else if (pathname.endsWith("/audit-logs")) data = { auditLogs: [] };
    else if (pathname.endsWith("/integrations/status")) data = { integrations: [] };
    else if (pathname.endsWith("/admin/police-users")) data = { users: [] };
    else if (pathname.endsWith("/sla/config")) data = { config: [] };
    else if (pathname.endsWith("/camera-feeds")) data = { cameras: [] };
    else if (pathname.endsWith("/camera-sources")) data = { sources: [] };
    else if (pathname.endsWith("/video-evidence")) data = { evidence: [], observations: [] };
    else if (pathname.endsWith("/ai/health")) data = { configured: false, status: "not_configured" };
    else if (pathname.endsWith("/ai-observations")) data = { observations: [], pendingCount: 0 };
    else if (pathname.endsWith("/erss/events")) data = { events: [], calls: [], triage: [], dispatchRequests: [], unitRequests: [], assistanceRequests: [], jurisdictionHistory: [], ownershipTransfers: [] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });

  try {
    await page.goto(`${baseUrl.replace(/\/$/, "")}/erss-supervisor`, { waitUntil: "domcontentloaded" });
    await page.locator("#supervisorCritical .empty-state").waitFor();
    await page.getByText("No critical events without response.").waitFor();
    await page.getByText("No active timeouts.").waitFor();
    await page.getByText("No recent jurisdiction or ownership disputes.").waitFor();
    await page.screenshot({ path: path.join(outputDir, "after-empty.png"), fullPage: true });

    // Capture a browser reproduction of the previous helper call shape that
    // passed child Elements as the helper's text argument.
    await page.evaluate(() => {
      const node = (tag, className, text) => {
        const element = document.createElement(tag);
        element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
      };
      document.querySelector("#supervisorCritical").replaceChildren(
        node("article", "supervisor-alert critical",
          node("strong", "", "CRITICAL: EXT-CRITICAL-112"),
          node("small", "", "Type: MEDICAL | Location: Sector 7, Gate A"))
      );
    });
    assert.match(await page.locator("#supervisorCritical").innerText(), /\[object HTMLElement\]/);
    await page.screenshot({ path: path.join(outputDir, "before-render-fix.png"), fullPage: true });

    await page.getByRole("button", { name: "Refresh" }).click();
    await page.getByText("CRITICAL: EXT-CRITICAL-112").waitFor();
    await page.getByText("UNIT-7", { exact: false }).waitFor();
    await page.getByText("Boundary review", { exact: false }).waitFor();
    await page.getByText("Cross-border response", { exact: false }).waitFor();
    assert.doesNotMatch(await page.locator("#supervisorCritical").innerText(), /\[object HTMLElement\]/);
    assert.equal(await page.locator("#supervisorCritical article").count(), 1);
    assert.equal(await page.locator("#supervisorTimeouts article").count(), 2);
    assert.equal(await page.locator("#supervisorDisputes article").count(), 2);
    await page.screenshot({ path: path.join(outputDir, "after-populated.png"), fullPage: true });

    await page.getByRole("button", { name: "Refresh" }).click();
    await page.getByRole("alert").filter({ hasText: "Could not load supervisor queue" }).first().waitFor();
    assert.equal(await page.getByRole("button", { name: "Refresh" }).isDisabled(), false);
    await page.screenshot({ path: path.join(outputDir, "after-timeout-error.png"), fullPage: true });

    await page.getByRole("button", { name: "Refresh" }).click();
    await page.getByText("CRITICAL: EXT-CRITICAL-112").waitFor();
    await page.screenshot({ path: path.join(outputDir, "after-refresh-recovery.png"), fullPage: true });

    assert.deepEqual(pageErrors, [], "browser page exceptions");
    const unexpectedConsoleErrors = consoleErrors.filter((message) =>
      !message.includes("Failed to load resource: the server responded with a status of 504")
    );
    const unexpectedConsoleWarnings = consoleWarnings.filter((message) =>
      !message.startsWith("[Real-time] Connection error: Authentication required")
    );
    assert.deepEqual(unexpectedConsoleErrors, [], "unexpected browser console errors");
    assert.deepEqual(unexpectedConsoleWarnings, [], "unexpected browser console warnings");
    assert.deepEqual(unexpectedHttpErrors, [], "unexpected HTTP errors");
    assert.equal(failedRequests.length, 0, `failed requests: ${JSON.stringify(failedRequests)}`);
    assert.equal(queueRequests, 4, "initial load, populated refresh, timeout, recovery");
    process.stdout.write(JSON.stringify({
      result: "PASS",
      mode: "Playwright Chromium with isolated API fixtures; no database writes",
      queueRequests,
      consoleErrors,
      allowlistedConsoleErrors: consoleErrors.length - unexpectedConsoleErrors.length,
      consoleWarnings,
      allowlistedConsoleWarnings: consoleWarnings.length - unexpectedConsoleWarnings.length,
      pageErrors,
      failedRequests,
      unexpectedHttpErrors,
      screenshots: fs.readdirSync(outputDir).map((name) => path.join(outputDir, name))
    }, null, 2) + "\n");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
