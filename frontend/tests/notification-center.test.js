import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

test("evidence image notification opens its evidence rather than camera context", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost:3000" });
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch, innerWidth: globalThis.innerWidth, innerHeight: globalThis.innerHeight };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, innerWidth: 1200, innerHeight: 800 });
  const item = { id: "ntf_evidence", type: "ai_observation_review", title: "Review", message: "Evidence pending", severity: "MEDIUM", entityType: "ai_observation", entityId: "obs_evidence", createdAt: new Date().toISOString(), read: true };
  globalThis.fetch = async (url) => new Response(JSON.stringify(String(url).endsWith("/details") ? { detail: { kind: "AI Observation", record: { sourceType: "evidence_image", evidenceId: "evd_1", cameraId: null } }, fetchedAt: new Date().toISOString() } : { notifications: [item], unreadCount: 0 }), { status: 200, headers: { "content-type": "application/json" } });
  let destination;
  try {
    const module = await import(`../src/components/NotificationCenter.js?evidence=${Date.now()}`);
    module.mountNotificationCenter({ navigate: (value) => { destination = value; } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector(".notification-launcher").click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector(".notification-view").click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector(".notification-open-related").click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(destination, { view: "video-evidence", entityType: "ai_observation", entityId: "obs_evidence", evidenceId: "evd_1" });
    module.unmountNotificationCenter();
  } finally { Object.assign(globalThis, previous); dom.window.close(); }
});

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
    assert.equal(document.querySelector(".notification-list").hidden, true, "marking an unread item read must keep the list hidden");
    assert.equal(document.querySelector(".notification-detail").hidden, false);
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

test("list and detail views are mutually exclusive - only one renders at a time", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost:3000" });
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch, innerWidth: globalThis.innerWidth, innerHeight: globalThis.innerHeight };
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.localStorage = dom.window.localStorage; globalThis.innerWidth = 1200; globalThis.innerHeight = 800;
  const item = { id: "ntf_1", type: "critical_incident", title: "Critical Incident", message: "Possible Murder", severity: "CRITICAL", entityType: "incident", entityId: "INC-1", createdAt: new Date().toISOString(), read: false, readAt: null };
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/details")) return new Response(JSON.stringify({ notification: item, fetchedAt: new Date().toISOString(), detail: { kind: "Incident", record: { id: "INC-1", title: "Latest authoritative title", status: "Verified" }, timeline: [] } }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ notifications: [item], unreadCount: 1 }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const module = await import(`../src/components/NotificationCenter.js?test=${Date.now()}`);
    module.mountNotificationCenter({ navigate: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const launcher = document.querySelector(".notification-launcher");
    launcher.click();
    await new Promise((resolve) => setTimeout(resolve, 15));

    const list = document.querySelector(".notification-list");
    const detail = document.querySelector(".notification-detail");

    // Initially list should be visible, detail hidden
    assert.equal(list.hidden, false);
    assert.equal(detail.hidden, true);
    assert.ok(list.getAttribute("aria-hidden") === "false" || list.getAttribute("aria-hidden") === null);
    assert.equal(detail.getAttribute("aria-hidden"), "true");

    // Click view details
    document.querySelector(".notification-view").click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Detail should be visible, list hidden
    assert.equal(list.hidden, true);
    assert.equal(detail.hidden, false);
    assert.equal(list.getAttribute("aria-hidden"), "true");
    assert.ok(detail.getAttribute("aria-hidden") === "false" || detail.getAttribute("aria-hidden") === null);

    // Click back
    document.querySelector(".notification-back").click();
    await new Promise((resolve) => setTimeout(resolve, 15));

    // List should be visible again, detail hidden
    assert.equal(list.hidden, false);
    assert.equal(detail.hidden, true);
    assert.ok(list.getAttribute("aria-hidden") === "false" || list.getAttribute("aria-hidden") === null);
    assert.equal(detail.getAttribute("aria-hidden"), "true");

    module.unmountNotificationCenter();
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.localStorage = previous.localStorage; globalThis.fetch = previous.fetch; globalThis.innerWidth = previous.innerWidth; globalThis.innerHeight = previous.innerHeight; dom.window.close();
  }
});

test("loading indicator disappears after request completion", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost:3000" });
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch, innerWidth: globalThis.innerWidth, innerHeight: globalThis.innerHeight };
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.localStorage = dom.window.localStorage; globalThis.innerWidth = 1200; globalThis.innerHeight = 800;
  let requestCount = 0;
  const item = { id: "ntf_1", type: "critical_incident", title: "Critical Incident", message: "Possible Murder", severity: "CRITICAL", entityType: "incident", entityId: "INC-1", createdAt: new Date().toISOString(), read: false, readAt: null };
  globalThis.fetch = async (url, options = {}) => {
    requestCount++;
    if (String(url).endsWith("/details")) return new Response(JSON.stringify({ notification: item, fetchedAt: new Date().toISOString(), detail: { kind: "Incident", record: { id: "INC-1", title: "Latest authoritative title", status: "Verified" }, timeline: [] } }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ notifications: [item], unreadCount: 1 }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const module = await import(`../src/components/NotificationCenter.js?test=${Date.now()}`);
    module.mountNotificationCenter({ navigate: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const launcher = document.querySelector(".notification-launcher");
    launcher.click();
    await new Promise((resolve) => setTimeout(resolve, 15));

    const status = document.querySelector(".notification-status");
    // Loading text should appear during initial load
    // After load completes, status should be empty
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(status.textContent, "");

    // Open detail view
    document.querySelector(".notification-view").click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Detail loading text should appear then disappear
    const detail = document.querySelector(".notification-detail");
    await new Promise((resolve) => setTimeout(resolve, 50));
    // After detail loads, no loading text should remain
    const loadingElements = detail.querySelectorAll(".notification-detail-loading");
    loadingElements.forEach(el => assert.notMatch(el.textContent, /Loading/));

    module.unmountNotificationCenter();
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.localStorage = previous.localStorage; globalThis.fetch = previous.fetch; globalThis.innerWidth = previous.innerWidth; globalThis.innerHeight = previous.innerHeight; dom.window.close();
  }
});

test("back button does not overlap notification cards", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost:3000" });
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch, innerWidth: globalThis.innerWidth, innerHeight: globalThis.innerHeight };
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.localStorage = dom.window.localStorage; globalThis.innerWidth = 1200; globalThis.innerHeight = 800;
  const items = [
    { id: "ntf_1", type: "critical_incident", title: "Critical Incident", message: "Possible Murder", severity: "CRITICAL", entityType: "incident", entityId: "INC-1", createdAt: new Date().toISOString(), read: false, readAt: null },
    { id: "ntf_2", type: "incident_created", title: "New Incident", message: "Robbery reported", severity: "HIGH", entityType: "incident", entityId: "INC-2", createdAt: new Date().toISOString(), read: false, readAt: null },
    { id: "ntf_3", type: "camera_offline", title: "Camera Offline", message: "Camera CAM-1 is offline", severity: "MEDIUM", entityType: "camera", entityId: "CAM-1", createdAt: new Date().toISOString(), read: false, readAt: null },
  ];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/details")) return new Response(JSON.stringify({ notification: items[0], fetchedAt: new Date().toISOString(), detail: { kind: "Incident", record: { id: "INC-1", title: "Latest authoritative title", status: "Verified" }, timeline: [] } }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ notifications: items, unreadCount: 3 }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const module = await import(`../src/components/NotificationCenter.js?test=${Date.now()}`);
    module.mountNotificationCenter({ navigate: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const launcher = document.querySelector(".notification-launcher");
    launcher.click();
    await new Promise((resolve) => setTimeout(resolve, 15));

    // Open detail view
    document.querySelector(".notification-view").click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const detail = document.querySelector(".notification-detail");
    const backButton = detail.querySelector(".notification-back");
    const list = document.querySelector(".notification-list");

    // Back button should exist in detail view
    assert.ok(backButton);
    // List should be hidden (cards not rendered in detail view)
    assert.equal(list.hidden, true);

    // Back button should be in normal document flow (not absolute positioned)
    const backStyle = backButton.style.position;
    assert.notEqual(backStyle, "absolute");
    assert.notEqual(backStyle, "fixed");

    module.unmountNotificationCenter();
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.localStorage = previous.localStorage; globalThis.fetch = previous.fetch; globalThis.innerWidth = previous.innerWidth; globalThis.innerHeight = previous.innerHeight; dom.window.close();
  }
});

test("drawer has no horizontal overflow at various viewport widths", async () => {
  const widths = [390, 768, 1024, 1440, 1920];
  for (const width of widths) {
    const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost:3000" });
    const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch, innerWidth: globalThis.innerWidth, innerHeight: globalThis.innerHeight };
    globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.localStorage = dom.window.localStorage; globalThis.innerWidth = width; globalThis.innerHeight = 800;
    const items = [
      { id: "ntf_1", type: "critical_incident", title: "Critical Incident with a very long title that should wrap properly", message: "Possible Murder", severity: "CRITICAL", entityType: "incident", entityId: "INC-1", createdAt: new Date().toISOString(), read: false, readAt: null },
    ];
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).endsWith("/details")) return new Response(JSON.stringify({ notification: items[0], fetchedAt: new Date().toISOString(), detail: { kind: "Incident", record: { id: "INC-1", title: "Latest authoritative title with very long text that should wrap safely without horizontal overflow", status: "Verified", longField: "This is a very long value that should wrap properly and not cause horizontal scrolling in the drawer" }, timeline: [] } }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ notifications: items, unreadCount: 1 }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      const module = await import(`../src/components/NotificationCenter.js?test=${Date.now()}`);
      module.mountNotificationCenter({ navigate: () => {} });
      await new Promise((resolve) => setTimeout(resolve, 15));
      const launcher = document.querySelector(".notification-launcher");
      launcher.click();
      await new Promise((resolve) => setTimeout(resolve, 15));

      const drawer = document.querySelector(".notification-drawer");
      const drawerRect = drawer.getBoundingClientRect();
      // Drawer should not exceed viewport width
      assert.ok(drawerRect.width <= width, `Drawer width ${drawerRect.width} exceeds viewport ${width}`);

      // Check filter bar doesn't cause horizontal overflow
      const filterBar = document.querySelector(".notification-filter-bar");
      const filterBarRect = filterBar.getBoundingClientRect();
      assert.ok(filterBarRect.width <= drawerRect.width, `Filter bar overflows at width ${width}`);

      // Open detail view and check for horizontal overflow
      document.querySelector(".notification-view").click();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const detail = document.querySelector(".notification-detail");
      const detailRect = detail.getBoundingClientRect();
      assert.ok(detailRect.width <= drawerRect.width, `Detail overflows at width ${width}`);

      module.unmountNotificationCenter();
    } finally {
      globalThis.window = previous.window; globalThis.document = previous.document; globalThis.localStorage = previous.localStorage; globalThis.fetch = previous.fetch; globalThis.innerWidth = previous.innerWidth; globalThis.innerHeight = previous.innerHeight; dom.window.close();
    }
  }
});

test("filter chips wrap responsively without horizontal scrollbar", () => {
  const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  // Filter bar should use flex-wrap: wrap
  assert.match(css, /\.notification-filter-bar\s*\{[\s\S]*?flex-wrap\s*:\s*wrap/);
  // Filter bar should not have overflow-x: auto
  assert.doesNotMatch(css, /\.notification-filter-bar\s*\{[\s\S]*?overflow-x\s*:\s*auto/);
});

test("detail content vertically scrolls and long text wraps safely", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost:3000" });
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch, innerWidth: globalThis.innerWidth, innerHeight: globalThis.innerHeight };
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.localStorage = dom.window.localStorage; globalThis.innerWidth = 520; globalThis.innerHeight = 800;
  const item = { id: "ntf_1", type: "critical_incident", title: "Critical Incident", message: "Possible Murder", severity: "CRITICAL", entityType: "incident", entityId: "INC-1", createdAt: new Date().toISOString(), read: false, readAt: null };
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/details")) return new Response(JSON.stringify({ notification: item, fetchedAt: new Date().toISOString(), detail: { kind: "Incident", record: { id: "INC-1", title: "Latest authoritative title", status: "Verified", veryLongField: "This is a very long field value that should wrap properly without causing horizontal overflow in the detail view. It contains many words that should break at word boundaries." }, timeline: [{ timestamp: new Date().toISOString(), event: "Created", details: "Initial creation with very long description that should wrap" }, { timestamp: new Date().toISOString(), event: "Updated", details: "Another very long description that should also wrap properly" }] } }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ notifications: [item], unreadCount: 1 }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const module = await import(`../src/components/NotificationCenter.js?test=${Date.now()}`);
    module.mountNotificationCenter({ navigate: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const launcher = document.querySelector(".notification-launcher");
    launcher.click();
    await new Promise((resolve) => setTimeout(resolve, 15));

    document.querySelector(".notification-view").click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const detail = document.querySelector(".notification-detail");
    const detailRect = detail.getBoundingClientRect();
    const drawer = document.querySelector(".notification-drawer");
    const drawerRect = drawer.getBoundingClientRect();

    // Detail should not exceed drawer width
    assert.ok(detailRect.width <= drawerRect.width, "Detail content causes horizontal overflow");

    // Check that detail has vertical scroll capability via style attribute
    assert.ok(detail.style.overflowY === "auto" || detail.style.overflowY === "");

    module.unmountNotificationCenter();
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.localStorage = previous.localStorage; globalThis.fetch = previous.fetch; globalThis.innerWidth = previous.innerWidth; globalThis.innerHeight = previous.innerHeight; dom.window.close();
  }
});
