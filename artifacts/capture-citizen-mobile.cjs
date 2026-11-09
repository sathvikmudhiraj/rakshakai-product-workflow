const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const BASE = "http://localhost:3000";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("#loginForm input[name='email']").fill("citizen@rakshakai.local");
  await page.locator("#loginForm input[name='password']").fill("demo123");
  await page.locator("#loginForm button[type='submit']").click();
  await page.locator("#logoutButton").waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction(() => document.body.dataset.view === "missing", null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => {
    const wordSplitAcrossLines = (element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let split = false;
      while (walker.nextNode() && !split) {
        const text = walker.currentNode.textContent;
        for (const word of text.split(/\s+/).filter((w) => w.length > 2)) {
          const range = document.createRange();
          const start = walker.currentNode.textContent.indexOf(word);
          range.setStart(walker.currentNode, start);
          range.setEnd(walker.currentNode, start + word.length);
          const tops = [...range.getClientRects()].filter((r) => r.width > 1).map((r) => Math.round(r.top));
          if (new Set(tops).size > 1) { split = true; break; }
        }
      }
      return split;
    };
    const cards = [...document.querySelectorAll("#caseList .case-card")];
    return {
      cards: cards.length,
      midWordBreaks: cards.filter((card) => [...card.querySelectorAll(".case-name, .case-row-value")].some(wordSplitAcrossLines)).length,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  assert.ok(state.cards > 0, "cards must render on mobile");
  assert.equal(state.midWordBreaks, 0, "report titles must not break mid-word on mobile");
  assert.equal(state.overflowX, false, "no horizontal overflow at 390px");
  await page.screenshot({ path: "artifacts/ui-qa/final-citizen-reports-mobile.png", fullPage: false });
  console.log(`PASS citizen reports mobile: ${state.cards} cards, no mid-word title breaks, no overflow`);
  await browser.close();
})().catch((error) => { console.error("FAIL", error.message); process.exit(1); });
