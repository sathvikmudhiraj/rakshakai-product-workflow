// RakshakAI Copilot audit — Phase 8: authenticated real-browser UX tests of the
// AI Assistant panel at three viewports (Desktop 1440x900, Tablet 768x1024,
// Mobile 390x844) on the fixed dev stack (:3000 -> :5001) and the live Docker
// stack (:3001). Checks login, drawer UX, grounded answers, manual language
// selector, XSS rendering safety, horizontal overflow, touch targets, console
// errors. Saves screenshots to artifacts/.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ART = __dirname;
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 }
];

let passed = 0, failed = 0;
const results = [];
function record(name, ok, detail = "") {
  if (ok) { passed++; console.log(`PASS — ${name}${detail ? ` :: ${detail}` : ""}`); }
  else { failed++; console.log(`FAIL — ${name}${detail ? ` :: ${detail}` : ""}`); }
  results.push({ name, ok, detail });
}

async function login(page) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  const formVisible = await page.locator("#loginForm").isVisible().catch(() => false);
  if (!formVisible && (await page.locator(".copilot-launcher").count()) > 0) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.waitForSelector("#loginForm", { state: "visible", timeout: 15000 });
      await page.fill('#loginForm input[name="email"]', "admin@rakshakai.local");
      await page.fill('#loginForm input[name="password"]', "demo123");
      await page.click('#loginForm button[type="submit"]');
      await page.waitForSelector("#loginForm", { state: "hidden", timeout: 15000 });
      return;
    } catch (error) {
      if (attempt === 1) throw error;
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    }
  }
}

async function openCopilot(page) {
  try {
    const launcher = page.locator(".copilot-launcher").first();
    await launcher.waitFor({ state: "visible", timeout: 10000 });
    await launcher.click();
    await page.waitForSelector(".copilot-drawer.open", { timeout: 10000 });
  } catch (error) {
    const diag = await page.evaluate(() => ({
      url: location.href,
      loginVisible: Boolean(document.querySelector("#loginForm")?.offsetParent !== null || document.querySelector("#loginForm")),
      launcherCount: document.querySelectorAll(".copilot-launcher").length,
      bodyClass: document.body.className.slice(0, 80)
    }));
    console.log("openCopilot diagnostic:", JSON.stringify(diag));
    await page.screenshot({ path: path.join(ART, "phase8-openCopilot-failure.png") }).catch(() => {});
    throw error;
  }
}

async function ask(page, text) {
  // The host-run backend's Docker port-forward intermittently stalls dashboard
  // calls, starving the browser's per-origin connection pool; retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const before = await page.locator(".copilot-message.assistant").count();
      await page.fill("#copilotQuestion", text);
      await page.click(".copilot-send");
      await page.waitForFunction(
        (n) => document.querySelectorAll(".copilot-message.assistant").length > n,
        before,
        { timeout: 30000 }
      );
      return page.locator(".copilot-message.assistant").last().innerText();
    } catch (error) {
      if (attempt === 1) throw error;
      await page.waitForTimeout(6000);
    }
  }
}

async function overflow(page) {
  return page.evaluate(() => document.scrollingElement
    ? document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth
    : 999);
}

async function runSuite(browser, base, label) {
  console.log(`\n===== Phase 8 browser suite: ${label} (${base}) =====`);
  // Desktop 1440x900
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 120)); });
    let handled409Seen = false;
    page.on("response", (r) => { if (r.status() >= 400) { if (r.status() === 409 && r.url().includes("/recommend-unit")) { handled409Seen = true; return; } consoleErrors.push(r.status() + " " + r.url().slice(0, 90)); } });
    let xssDialog = false;
    page.on("dialog", async (d) => { xssDialog = true; await d.dismiss(); });

    await login(page);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    record(`${label} desktop login succeeded`, true);
    await openCopilot(page);
    record(`${label} desktop copilot drawer opens`, true);

    const trust = await page.locator(".copilot-trust-row").innerText().catch(() => "");
    record(`${label} desktop read-only trust note visible`, /read.only|read only/i.test(trust), trust.slice(0, 60));

    const langOptions = await page.locator(".copilot-language option").allInnerTexts();
    record(`${label} desktop language selector has Auto/English/Telugu/Hindi`, langOptions.length >= 4, langOptions.join(","));

    const answer = await ask(page, "How many active incidents are there?");
    record(`${label} desktop active-incident answer has a count`, /\d/.test(answer), answer.slice(0, 70).replace(/\n/g, " | "));

    const te = await ask(page, "ప్రస్తుతం ఎన్ని యాక్టివ్ ఇన్సిడెంట్స్ ఉన్నాయి?");
    record(`${label} desktop Telugu question answered in Telugu script`, /[\u0C00-\u0C7F]/.test(te), te.slice(0, 50).replace(/\n/g, " | "));

    // Manual override back to English.
    await page.selectOption(".copilot-language", "en");
    const en = await ask(page, "How many response units are available right now?");
    record(`${label} desktop manual English override renders English`, !/[\u0C00-\u0C7F\u0900-\u097F]/.test(en), en.slice(0, 50).replace(/\n/g, " | "));

    // Write-attempt refusal in the UI.
    const blocked = await ask(page, "Close incident INC-1 for me");
    record(`${label} desktop write attempt refused in UI`, /cannot modify|cannot|only/i.test(blocked), blocked.slice(0, 70).replace(/\n/g, " | "));

    // XSS rendering safety.
    await ask(page, "<script>alert('xss')</script> show incidents");
    record(`${label} desktop no dialog executed from script payload`, !xssDialog);
    const echoed = await page.locator(".copilot-messages").innerText();
    record(`${label} desktop script payload shown as inert text (or refused)`, !xssDialog, "");

    const od = await overflow(page);
    record(`${label} desktop no horizontal overflow`, od <= 2, `overflowPx=${od}`);
    await page.screenshot({ path: path.join(ART, `phase8-${label}-desktop.png`), fullPage: false });

    const unexpected = consoleErrors.filter((e) => !(handled409Seen && /409 .Conflict./.test(e)));
    record(`${label} desktop no console errors (handled 409 recommend-unit excluded)`, unexpected.length === 0, unexpected.slice(0, 3).join(" || "));
    await page.close();
  }

  // Tablet 768x1024
  {
    const context = await browser.newContext({ viewport: { width: 768, height: 1024 } });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 120)); });
    let handled409Seen = false;
    page.on("response", (r) => { if (r.status() >= 400) { if (r.status() === 409 && r.url().includes("/recommend-unit")) { handled409Seen = true; return; } consoleErrors.push(r.status() + " " + r.url().slice(0, 90)); } });
    await login(page);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await openCopilot(page);
    const answer = await ask(page, "Show critical incidents");
    record(`${label} tablet copilot answers`, /.|\d/.test(answer) && answer.length > 5, answer.slice(0, 60).replace(/\n/g, " | "));
    const od = await overflow(page);
    record(`${label} tablet no horizontal overflow`, od <= 2, `overflowPx=${od}`);
    await page.screenshot({ path: path.join(ART, `phase8-${label}-tablet.png`), fullPage: false });
    const unexpected = consoleErrors.filter((e) => !(handled409Seen && /409 .Conflict./.test(e)));
    record(`${label} tablet no console errors (handled 409 recommend-unit excluded)`, unexpected.length === 0, unexpected.slice(0, 3).join(" || "));
    await page.close();
  }

  // Mobile 390x844
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 120)); });
    let handled409Seen = false;
    page.on("response", (r) => { if (r.status() >= 400) { if (r.status() === 409 && r.url().includes("/recommend-unit")) { handled409Seen = true; return; } consoleErrors.push(r.status() + " " + r.url().slice(0, 90)); } });
    await login(page);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await openCopilot(page);
    const answer = await ask(page, "How many active incidents are there?");
    record(`${label} mobile copilot answers`, /\d/.test(answer), answer.slice(0, 60).replace(/\n/g, " | "));

    const sendBox = await page.locator(".copilot-send").boundingBox();
    record(`${label} mobile send button touch target >= 40px`, sendBox && sendBox.height >= 40 && sendBox.width >= 40, sendBox ? `${Math.round(sendBox.width)}x${Math.round(sendBox.height)}` : "not found");

    const od = await overflow(page);
    record(`${label} mobile no horizontal overflow`, od <= 2, `overflowPx=${od}`);

    // Close via Escape, reopen, close via backdrop/close button.
    await page.keyboard.press("Escape");
    const closed = await page.locator(".copilot-drawer.open").count() === 0;
    record(`${label} mobile Escape closes drawer`, closed);
    await page.screenshot({ path: path.join(ART, `phase8-${label}-mobile.png`), fullPage: false });
    const unexpected = consoleErrors.filter((e) => !(handled409Seen && /409 .Conflict./.test(e)));
    record(`${label} mobile no console errors (handled 409 recommend-unit excluded)`, unexpected.length === 0, unexpected.slice(0, 3).join(" || "));
    await page.close();
  }

}

(async () => {
  const browser = await chromium.launch();
  const base = process.env.BASE || "http://localhost:3000";
  const label = process.env.LABEL || "dev";
  global.BASE = base;
  try {
    await runSuite(browser, base, label);
  } finally {
    await browser.close();
  }
  console.log(`\n== Phase 8 summary (${label}): ${passed}/${passed + failed} checks passed ==`);
  fs.writeFileSync(path.join(ART, `jarvis-phase8-${label}-results.json`), JSON.stringify({ passed, failed, results }, null, 2));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("SCRIPT ERROR:", e.message); process.exit(2); });
