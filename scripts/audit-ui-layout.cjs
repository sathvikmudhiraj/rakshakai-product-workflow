// Render the real page shells in isolation. No login, API calls or data mutations.
// Dynamic data/actions are covered separately by the frontend component tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../frontend');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
async function main() {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html); }
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'image/svg+xml');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'rakshakai-ui-audit-'));
  let browser;
  const failures = [];
  try {
    browser = await chromium.launch({ headless: true });
    for (const [width, height] of [[1920,1080], [1440,900], [1024,768], [768,1024], [390,844]]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const panels = await page.locator('[data-panel]').evaluateAll(nodes => nodes.map(node => node.dataset.panel));
      for (const view of ['login', ...panels]) {
        await page.evaluate(view => {
          document.getElementById('portalLogin').classList.toggle('app-hidden', view !== 'login');
          document.getElementById('appShell').classList.toggle('app-hidden', view === 'login');
          document.body.dataset.view = view;
          document.querySelectorAll('[data-panel]').forEach(node => node.classList.toggle('active', node.dataset.panel === view));
          document.querySelectorAll('.nav-item').forEach(node => node.classList.toggle('active', node.dataset.view === view));
          const title = document.getElementById('viewTitle');
          if (title) title.textContent = document.querySelector(`.nav-item[data-view="${view}"]`)?.textContent.trim() || 'RakshakAI';
          scrollTo(0, 0);
        }, view);
        const report = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          offenders: [...document.querySelectorAll('body *')].filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1) && getComputedStyle(el).position !== 'absolute';
          }).slice(0, 8).map(el => el.id || el.className || el.tagName)
        }));
        if (report.overflow) failures.push({ view, width, ...report });
        if ([1920,390].includes(width) && ['login','dashboard','police-management','erss-field','settings'].includes(view)) {
          await page.screenshot({ path: path.join(output, `${view}-${width}.png`), fullPage: true });
        }
      }
      console.log(`${width}x${height}: inspected login and ${panels.length} page shells`);
      await page.close();
    }
    console.log(`Screenshots: ${output}`);
    assert.deepEqual(failures, [], 'Page shells must not overflow the viewport');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
