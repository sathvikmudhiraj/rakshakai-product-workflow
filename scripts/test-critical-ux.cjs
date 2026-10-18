// Isolated rendered-component regression: actual CSS/modules, synthetic incidents, no database writes.
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../frontend");
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head>
<body data-view="dashboard"><div class="app-shell"><aside class="sidebar"><div class="brand">RakshakAI</div><nav class="navigation"><button class="nav-item" id="dashboard">Dashboard</button><button class="nav-item" id="queue">Incident Command</button></nav></aside>
<main class="workspace"><header class="topbar"><h1 id="viewTitle">Dashboard</h1></header><section style="padding:20px"><section id="command-critical-summary" class="critical-queue-summary" hidden><h2>Critical queue</h2><p data-critical-count></p></section><h2>Operational incidents</h2><p>CRITICAL — Verified — Unassigned</p><div style="height:1400px">Queue content</div></section></main></div>
<script type="module">
import {syncCriticalAttention} from '/src/components/PersistentAlerts.js';
import {mountCopilot,configureCopilot} from '/src/components/RakshakCopilot.js';
const incidents=Array.from({length:6},(_,i)=>({id:'INC-'+i,severity:'critical',status:'Verified'}));
function sync(){syncCriticalAttention({userId:'isolated-browser-user',incidents,page:document.body.dataset.view,onView:()=>activate('incident-command')});}
function activate(page){document.body.dataset.view=page;document.getElementById('viewTitle').textContent=page==='dashboard'?'Dashboard':'Incident Command';sync();}
document.getElementById('queue').onclick=()=>activate('incident-command');
document.getElementById('dashboard').onclick=()=>activate('dashboard');
window.criticalTest={activate,add:()=>{incidents.push({id:'INC-'+incidents.length,severity:'critical',status:'Verified'});sync();}};
configureCopilot({context:()=>({page:document.body.dataset.view,entityId:'INC-0'})});mountCopilot();sync();window.fixtureReady=true;
</script></body></html>`;

async function main() {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/api/copilot/query" && req.method === "POST") {
      req.resume();
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ answer: "Keyboard send verified.", readOnly: true }));
    }
    if (pathname === "/") { res.setHeader("Content-Type", "text/html"); return res.end(fixture); }
    const target = path.resolve(root, `.${pathname}`);
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404); return res.end(); }
    res.setHeader("Content-Type", target.endsWith(".css") ? "text/css" : "text/javascript");
    fs.createReadStream(target).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const [width, height] of [[1920,1080],[1440,900],[1024,768],[768,1024],[390,844]]) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.waitForFunction(() => window.fixtureReady);
        const banner = page.locator("#global-critical-banner");
        await banner.waitFor({ state: "visible" });
        async function checkLayout() {
          const layout = await page.evaluate(() => {
            const banner = document.getElementById("global-critical-banner");
            return { overflow: document.documentElement.scrollWidth > innerWidth, bannerBottom: banner.hidden ? 0 : banner.getBoundingClientRect().bottom, headerTop: document.querySelector(".topbar").getBoundingClientRect().top };
          });
          assert.equal(layout.overflow, false, `${width}: horizontal overflow`);
          assert.ok(layout.headerTop + 1 >= layout.bannerBottom, `${width}: header covered by banner`);
        }
        await checkLayout();
        await page.evaluate(() => scrollTo(0, 400));
        await checkLayout();
        const queueButton = banner.getByRole("button", { name: "View critical incidents" });
        await queueButton.focus();
        await queueButton.press("Enter");
        await banner.waitFor({ state: "hidden" });
        assert.equal(await page.locator("#viewTitle").evaluate((node) => document.activeElement === node), true);
        assert.match(await page.locator("#command-critical-summary").innerText(), /6 incidents require attention/);
        await page.evaluate(() => window.criticalTest.activate("dashboard"));
        assert.equal(await banner.isVisible(), false);
        await page.evaluate(() => window.criticalTest.add());
        await banner.waitFor({ state: "visible" });
        assert.match(await banner.innerText(), /7 incidents need review/);
        await page.evaluate(() => window.criticalTest.activate("incident-command"));
        assert.equal(await banner.isVisible(), false);
        await checkLayout();
        const launcher = page.locator(".copilot-launcher");
        await launcher.click();
        const drawer = page.locator(".copilot-drawer");
        await drawer.waitFor({ state: "visible" });
        const bounds = await drawer.boundingBox();
        assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1 && bounds.height <= height + 1, `${width}: drawer outside viewport`);
        await page.locator("#copilotQuestion").fill("how many critical incidents?");
        await page.locator("#copilotQuestion").press("Shift+Enter");
        assert.match(await page.locator("#copilotQuestion").inputValue(), /\n/);
        const sent = page.waitForResponse((response) => response.url().endsWith("/api/copilot/query") && response.request().method() === "POST");
        await page.locator("#copilotQuestion").press("Enter");
        assert.equal((await sent).status(), 200);
        await page.getByText("Keyboard send verified.", { exact: true }).waitFor();
        assert.equal(await page.locator("#copilotQuestion").inputValue(), "");
        await page.keyboard.press("Escape");
        assert.equal(await drawer.getAttribute("aria-hidden"), "true");
        assert.equal(await launcher.evaluate((node) => document.activeElement === node), true);
        await checkLayout();
        assert.deepEqual(errors, []);
        console.log(`Critical banner / Copilot layout PASS: ${width}x${height}`);
      } finally { await context.close(); }
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
