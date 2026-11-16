import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCriticalModal, createGlobalBanner, createRequiresAttentionPanel, syncCriticalAttention, clearCriticalAttention } from "../src/components/PersistentAlerts.js";

function setup() {
  const dom = new JSDOM('<!doctype html><body><main><h1 id="viewTitle">Incident Command</h1><section id="command-critical-summary" hidden><h2>Critical queue</h2><p data-critical-count></p></section></main></body>', { url: "http://localhost:3000" });
  globalThis.document = dom.window.document;
  return dom;
}

const alert = {
  id: "alert_1", incidentId: "INC-1042", alertType: "ASSIGNMENT_BREACH",
  title: "CRITICAL INCIDENT UNASSIGNED", message: "No response team assigned",
  severity: "CRITICAL", escalationLevel: "L2", active: true,
  acknowledged: false, resolved: false
};

test("critical modal displays persisted alert and acknowledge action", () => {
  const dom = setup(); let acknowledged = null;
  createCriticalModal(alert, () => {}, (id) => { acknowledged = id; });
  assert.match(document.body.textContent, /CRITICAL INCIDENT UNASSIGNED/);
  document.querySelector(".btn-acknowledge").click();
  assert.equal(acknowledged, "alert_1");
  dom.window.close();
});

test("global banner uses compact text and preserves its keyboard button on refresh", () => {
  const dom = setup();
  const banner = createGlobalBanner(1, () => {});
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /Critical attention required/);
  assert.match(banner.textContent, /1 incident needs review/);
  const button = banner.querySelector("button");
  button.focus();
  createGlobalBanner(2, () => {});
  assert.equal(document.activeElement, button);
  assert.match(banner.textContent, /2 incidents need review/);
  assert.equal(button.type, "button");
  dom.window.close();
});

const incident = (id) => ({ id, title: id, severity: "critical", status: "Verified" });

test("View queue marks the batch seen, hides the banner and focuses the page heading", () => {
  const dom = setup();
  const incidents = [incident("one"), incident("two")];
  const before = JSON.stringify(incidents);
  const options = { userId: "queue-click", incidents, page: "dashboard" };
  options.onView = () => syncCriticalAttention({ ...options, page: "incident-command" });
  syncCriticalAttention(options);
  const banner = document.getElementById("global-critical-banner");
  banner.getBoundingClientRect = () => ({ height: 48 });
  syncCriticalAttention(options);
  assert.equal(document.documentElement.style.getPropertyValue("--critical-banner-height"), "48px");
  banner.querySelector("button").focus();
  banner.querySelector("button").click();
  assert.equal(banner.hidden, true);
  assert.equal(document.documentElement.style.getPropertyValue("--critical-banner-height"), "0px");
  assert.equal(document.activeElement.id, "viewTitle");
  assert.equal(document.getElementById("command-critical-summary").hidden, false);
  assert.match(document.querySelector("[data-critical-count]").textContent, /2 incidents require attention/);
  syncCriticalAttention(options);
  assert.equal(banner.hidden, true);
  assert.equal(JSON.stringify(incidents), before);
  clearCriticalAttention(options.userId);
  dom.window.close();
});

test("manual queue navigation sees current incidents; new IDs and count increases notify again", () => {
  const dom = setup();
  const options = { userId: "queue-manual", incidents: [incident("one")], onView() {} };
  syncCriticalAttention({ ...options, page: "incident-command" });
  syncCriticalAttention({ ...options, page: "dashboard" });
  assert.ok(!document.getElementById("global-critical-banner") || document.getElementById("global-critical-banner").hidden);
  // A different incident with the same count is still new.
  options.incidents = [incident("replacement")];
  syncCriticalAttention({ ...options, page: "dashboard" });
  assert.equal(document.getElementById("global-critical-banner").hidden, false);
  syncCriticalAttention({ ...options, page: "incident-command" });
  options.incidents.push(incident("additional"));
  syncCriticalAttention({ ...options, page: "dashboard" });
  assert.match(document.getElementById("global-critical-banner").textContent, /2 incidents need review/);
  clearCriticalAttention(options.userId);
  dom.window.close();
});

test("seen state is session/user isolated, survives a module reload and clears on logout", async () => {
  const dom = setup();
  const options = { incidents: [incident("one")], onView() {} };
  syncCriticalAttention({ ...options, userId: "session-a", page: "incident-command" });
  const reloaded = await import("../src/components/PersistentAlerts.js?session-reload");
  reloaded.syncCriticalAttention({ ...options, userId: "session-a", page: "dashboard" });
  assert.ok(!document.getElementById("global-critical-banner") || document.getElementById("global-critical-banner").hidden);
  reloaded.syncCriticalAttention({ ...options, userId: "session-b", page: "dashboard" });
  assert.equal(document.getElementById("global-critical-banner").hidden, false);
  reloaded.clearCriticalAttention("session-a");
  reloaded.syncCriticalAttention({ ...options, userId: "session-a", page: "dashboard" });
  assert.equal(document.getElementById("global-critical-banner").hidden, false);
  clearCriticalAttention("session-a");
  reloaded.clearCriticalAttention("session-b");
  dom.window.close();
});

test("duplicate escalation rows count once and blocked storage falls back safely", () => {
  const dom = setup();
  Object.defineProperty(dom.window, "sessionStorage", { get() { throw new Error("blocked"); } });
  const options = { userId: "storage-blocked", incidents: [], alerts: [alert, { ...alert, id: "duplicate" }], onView() {} };
  syncCriticalAttention({ ...options, page: "dashboard" });
  assert.match(document.getElementById("global-critical-banner").textContent, /1 incident needs review/);
  syncCriticalAttention({ ...options, page: "incident-command" });
  syncCriticalAttention({ ...options, page: "dashboard" });
  assert.equal(document.getElementById("global-critical-banner").hidden, true);
  syncCriticalAttention({ ...options, page: "dashboard", incidents: [{ ...incident(alert.incidentId), status: "Closed" }] });
  assert.equal(document.getElementById("command-critical-summary").hidden, true);
  clearCriticalAttention(options.userId);
  dom.window.close();
});

test("requires attention panel exposes view, assign and acknowledge controls", () => {
  const dom = setup(); const actions = [];
  const panel = createRequiresAttentionPanel([alert], (id) => actions.push(["view", id]), (id) => actions.push(["ack", id]));
  document.body.append(panel);
  assert.match(panel.textContent, /INC-1042/);
  assert.match(panel.textContent, /ASSIGN TEAM/);
  panel.querySelector('[data-action="ack"]').click();
  assert.deepEqual(actions, [["ack", "alert_1"]]);
  assert.equal(alert.active, true);
  assert.equal(alert.resolved, false);
  dom.window.close();
});
