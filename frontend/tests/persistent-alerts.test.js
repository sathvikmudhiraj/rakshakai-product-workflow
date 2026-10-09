import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCriticalModal, createGlobalBanner, createRequiresAttentionPanel } from "../src/components/PersistentAlerts.js";

function setup() {
  const dom = new JSDOM("<!doctype html><body><main></main></body>");
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

test("global banner remains visible while a critical alert is active", () => {
  const dom = setup();
  const banner = createGlobalBanner(1, () => {});
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /1 CRITICAL INCIDENT REQUIRE ACTION/);
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
