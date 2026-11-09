import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

test("language preference localizes captions, suggestions, requests, sources, freshness, and safe navigation", async () => {
  const dom = new JSDOM('<body><div class="topbar-actions"></div><button class="nav-item" data-view="incident-command">Incident Command</button></body>', { url: "http://localhost:3000" });
  dom.window.document.querySelector(".nav-item").addEventListener("click", () => { dom.window.document.body.dataset.view = "incident-command"; });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  dom.window.localStorage.setItem("rakshakai_copilot_language", "te");
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ answer: "INC-1 ప్రస్తుతం VERIFIED స్థితిలో ఉంది.", responseLanguage: "te", detectedLanguage: "en", sources: [{ type: "incident", id: "INC-1", updatedAt: new Date().toISOString() }], navigation: { view: "incident-command", entityId: "INC-1" }, readOnly: true }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const module = await import(`../src/components/RakshakCopilot.js?locale-test=${Date.now()}`);
    module.configureCopilot({ context: () => ({ page: "incident-command", entityId: "INC-1" }) }); module.mountCopilot();
    document.querySelector(".copilot-launcher").click();
    assert.equal(document.querySelector(".copilot-language").value, "te");
    assert.match(document.querySelector("#copilotQuestion").placeholder, /ఘటనలు/);
    assert.match(document.querySelector(".copilot-suggestions").textContent, /ఘటన/);
    assert.match(document.querySelector(".copilot-context").textContent, /సందర్భం/);
    const input = document.querySelector("#copilotQuestion"); input.value = "Show INC-1"; document.querySelector(".copilot-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(requests[0].selectedLanguage, "te");
    assert.match(document.querySelector(".copilot-messages").textContent, /ప్రస్తుతం VERIFIED/);
    assert.match(document.querySelector(".copilot-source-box").textContent, /Incident INC-1/);
    assert.match(document.querySelector(".copilot-source-box").textContent, /నవీకరణ/);
    assert.match(document.querySelector(".copilot-navigation").textContent, /వివరాలు/);
    document.querySelector(".copilot-navigation").click();
    assert.equal(document.body.dataset.view, "incident-command");
    assert.equal(document.querySelector(".copilot-drawer").getAttribute("aria-hidden"), "true");
    const select = document.querySelector(".copilot-language"); select.value = "hi"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    assert.match(input.placeholder, /घटनाओं/);
    assert.equal(dom.window.localStorage.getItem("rakshakai_copilot_language"), "hi");
    module.unmountCopilot();
  } finally { globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; dom.window.close(); }
});

test("localized assistant errors are generic and retryable", async () => {
  const dom = new JSDOM("<body></body>", { url: "http://localhost:3000" });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = dom.window; globalThis.document = dom.window.document; dom.window.localStorage.setItem("rakshakai_copilot_language", "hi");
  globalThis.fetch = async () => { throw new Error("database password leaked in raw error"); };
  try {
    const module = await import(`../src/components/RakshakCopilot.js?error-test=${Date.now()}`); module.mountCopilot(); document.querySelector(".copilot-launcher").click();
    const input = document.querySelector("#copilotQuestion"); input.value = "Show incidents"; document.querySelector(".copilot-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(document.querySelector(".system-error").textContent, /प्राप्त नहीं हो सका/);
    assert.match(document.querySelector(".copilot-retry").textContent, /फिर प्रयास/);
    assert.doesNotMatch(document.querySelector(".copilot-messages").textContent, /password leaked/);
    module.unmountCopilot();
  } finally { globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; dom.window.close(); }
});

test("Copilot CSS provides a deliberate launcher rail, compact docking, and mobile full-height sheet", () => {
  const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /body\.notification-center-mounted \.copilot-launcher \{ display: grid; \}/);
  assert.match(css, /@media \(max-width: 1120px\)[\s\S]*\.copilot-launcher\.docked/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.copilot-drawer \{ width: 100vw; height: 100dvh; \}/);
  assert.match(css, /"Nirmala UI"/);
});
