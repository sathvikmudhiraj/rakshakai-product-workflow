import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

test("Copilot is mounted only for authorized roles by the application shell", () => {
  const source = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /const operator = \["Admin", "Police Officer"\]\.includes\(state\.user\?\.role\)/);
  assert.match(source, /if \(operator\) mountCopilot\(\)/);
  assert.match(source, /function showPortal[\s\S]*?unmountCopilot\(\)/);
});

test("drawer is accessible, page-aware, conversational, and sends no role", async () => {
  const dom = new JSDOM('<body data-view="camera-health"><button class="nav-item" data-view="camera-health">Camera Health</button></body>', { url: "http://localhost:3000" });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ answer: "CAM-C27 is read-only.", readOnly: true, conversationId: "00000000-0000-0000-0000-000000000001", generatedAt: new Date().toISOString(), navigation: { view: "camera-health", entityId: "CAM-C27" } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const module = await import(`../src/components/RakshakCopilot.js?test=${Date.now()}`);
    module.configureCopilot({ context: () => ({ page: "camera-health", entityId: "CAM-C27" }) });
    module.mountCopilot();
    const launcher = document.querySelector(".copilot-launcher");
    assert.ok(launcher.querySelector(".copilot-police-icon"));
    assert.doesNotMatch(launcher.textContent, /^AI$/);
    Object.defineProperty(launcher, "getBoundingClientRect", { value: () => ({ left: 100, top: 100, width: 58, height: 58 }) });
    launcher.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 120, clientY: 120 }));
    launcher.dispatchEvent(new dom.window.MouseEvent("pointermove", { bubbles: true, clientX: 280, clientY: 240 }));
    launcher.dispatchEvent(new dom.window.MouseEvent("pointerup", { bubbles: true, clientX: 280, clientY: 240 }));
    assert.equal(launcher.style.left, "260px");
    assert.equal(launcher.style.top, "220px");
    assert.ok(JSON.parse(dom.window.localStorage.getItem("rakshakai_copilot_launcher_position")));
    assert.equal(launcher.getAttribute("aria-expanded"), "false");
    launcher.click();
    assert.equal(launcher.getAttribute("aria-expanded"), "false", "drag completion must not open the drawer");
    launcher.click();
    assert.equal(document.querySelector(".copilot-drawer").getAttribute("aria-hidden"), "false");
    assert.match(document.querySelector(".copilot-context").textContent, /CAM-C27/);
    assert.match(document.querySelector(".copilot-drawer small").textContent, /READ-ONLY/);
    const input = document.querySelector("#copilotQuestion");
    input.value = "Why is this camera unhealthy?";
    document.querySelector(".copilot-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(requests[0].pageContext, { page: "camera-health", entityId: "CAM-C27" });
    assert.equal("role" in requests[0], false);
    assert.match(document.querySelector(".copilot-messages").textContent, /CAM-C27 is read-only/);
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(document.querySelector(".copilot-drawer").getAttribute("aria-hidden"), "true");
    module.unmountCopilot();
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; dom.window.close();
  }
});

test("Enter sends once, Shift+Enter and IME preserve text, and pending/empty messages do not send", async () => {
  const dom = new JSDOM('<body></body>', { url: "http://localhost:3000" });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  const requests = [];
  let finish;
  globalThis.fetch = (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Promise((resolve) => { finish = () => resolve(new Response(JSON.stringify({ answer: "Read-only answer", readOnly: true }), { status: 200, headers: { "content-type": "application/json" } })); });
  };
  const module = await import(`../src/components/RakshakCopilot.js?keyboard=${Date.now()}`);
  try {
    module.mountCopilot(); module.openCopilot();
    const input = document.querySelector("#copilotQuestion");
    const enter = (options = {}) => {
      const event = new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...options });
      input.dispatchEvent(event); return event;
    };
    input.value = "   ";
    assert.equal(enter().defaultPrevented, true);
    assert.equal(requests.length, 0);
    input.value = "How many units are there?";
    assert.equal(enter({ shiftKey: true }).defaultPrevented, false);
    assert.equal(enter({ isComposing: true }).defaultPrevented, false);
    assert.equal(enter({ keyCode: 229 }).defaultPrevented, false);
    input.dispatchEvent(new dom.window.CompositionEvent("compositionstart"));
    assert.equal(enter().defaultPrevented, false);
    input.dispatchEvent(new dom.window.CompositionEvent("compositionend"));
    assert.equal(requests.length, 0);
    assert.equal(enter().defaultPrevented, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].message, "How many units are there?");
    assert.equal(input.value, "");
    assert.equal(input.disabled, true);
    enter({ repeat: true }); enter();
    assert.equal(requests.length, 1);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(input.disabled, false);
    assert.equal(document.activeElement, input);
    assert.match(document.querySelector(".copilot-messages").textContent, /Read-only answer/);
    input.value = "A new question";
    enter({ repeat: true });
    assert.equal(requests.length, 1);
  } finally {
    module.unmountCopilot();
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch;
    dom.window.close();
  }
});

test("conversation history restores after drawer reopen without duplicates and clears on unmount", async () => {
  const dom = new JSDOM('<body></body>', { url: "http://localhost:3000" });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  const conversationId = "00000000-0000-0000-0000-000000000099";
  dom.window.sessionStorage.setItem("rakshakai_copilot_conversation_id", conversationId);
  const messages = [
    { role: "user", content: "Show INC-1", metadata: {} },
    { role: "assistant", content: "Incident INC-1: VERIFIED", metadata: { responseLanguage: "te" } }
  ];
  globalThis.fetch = async (url) => {
    assert.match(String(url), new RegExp(`conversationId=${conversationId}`));
    return new Response(JSON.stringify({ messages }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const module = await import(`../src/components/RakshakCopilot.js?history=${Date.now()}`);
  try {
    module.mountCopilot();
    document.querySelector(".copilot-launcher").click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(document.querySelectorAll(".copilot-message").length, 2);
    assert.equal(document.querySelector(".copilot-drawer").lang, "te");
    document.querySelector(".copilot-close").click();
    document.querySelector(".copilot-launcher").click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(document.querySelectorAll(".copilot-message").length, 2, "reopening replaces the view with saved history instead of duplicating it");
  } finally {
    module.unmountCopilot();
    assert.equal(dom.window.sessionStorage.getItem("rakshakai_copilot_conversation_id"), null, "unmount clears the session-scoped history pointer");
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch;
    dom.window.close();
  }
});
