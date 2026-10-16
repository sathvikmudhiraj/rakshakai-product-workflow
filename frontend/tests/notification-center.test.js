import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

test("shield launcher opens a filterable Notification Center with unread badge and authoritative details", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost:3000" });
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch, innerWidth: globalThis.innerWidth, innerHeight: globalThis.innerHeight };
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.localStorage = dom.window.localStorage; globalThis.innerWidth = 1200; globalThis.innerHeight = 800;
  const requests = [];
  const item = { id: "ntf_1", type: "critical_incident", title: "Critical Incident", message: "Possible Murder", severity: "CRITICAL", entityType: "incident", entityId: "INC-1", createdAt: new Date().toISOString(), read: false, readAt: null };
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || "GET" });
    if (String(url).endsWith("/read")) return new Response(JSON.stringify({ notification: { ...item, read: true, readAt: new Date().toISOString() } }), { status: 200, headers: { "content-type": "application/json" } });
    if (String(url).endsWith("/details")) return new Response(JSON.stringify({ notification: item, fetchedAt: new Date().toISOString(), detail: { kind: "Incident", record: { id: "INC-1", title: "Latest authoritative title", status: "Verified" }, timeline: [] } }), { status: 200, headers: { "content-type": "application/json" } });
    if (String(url).includes("mark-all-read")) return new Response(JSON.stringify({ updated: 1 }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ notifications: [item], unreadCount: 1 }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const module = await import(`../src/components/NotificationCenter.js?test=${Date.now()}`);
    module.mountNotificationCenter({ navigate: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const launcher = document.querySelector(".notification-launcher");
    assert.ok(launcher.querySelector(".notification-shield"));
    assert.equal(document.querySelector(".notification-count").textContent, "1");
    launcher.click();
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(document.querySelector(".notification-drawer").getAttribute("aria-hidden"), "false");
    assert.match(document.querySelector(".notification-list").textContent, /Possible Murder/);
    assert.equal(document.querySelectorAll(".notification-filter-bar [role=tab]").length, 9);
    document.querySelector(".notification-view").click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(document.querySelector(".notification-detail").textContent, /Latest authoritative title/);
    assert.ok(requests.some((request) => request.url.endsWith("/details")));
    module.unmountNotificationCenter();
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.localStorage = previous.localStorage; globalThis.fetch = previous.fetch; globalThis.innerWidth = previous.innerWidth; globalThis.innerHeight = previous.innerHeight; dom.window.close();
  }
});

test("notification UI includes compact responsive drawer and does not expose operational action controls", () => {
  const source = fs.readFileSync(new URL("../src/components/NotificationCenter.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(source, /Mark all read/);
  assert.match(source, /Open Related Module/);
  assert.doesNotMatch(source, /Assign unit|Resolve incident|Confirm tracking|Delete evidence/);
  assert.match(css, /\.notification-drawer/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.notification-drawer/);
});
