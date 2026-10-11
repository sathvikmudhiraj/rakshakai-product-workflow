import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const cssSource = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const coreSource = fs.readFileSync(new URL("../../backend/services/core.service.js", import.meta.url), "utf8");
const dom = new JSDOM(indexSource, { url: "http://localhost:3000" });
const document = dom.window.document;

test("Settings remains one Admin-only main navigation item", () => {
  const items = [...document.querySelectorAll('.nav-item[data-view="settings"]')];
  assert.equal(items.length, 1);
  assert.equal(items[0].dataset.roles, "Admin");
  for (const internalView of ["police-units", "police-stations", "device-health", "camera-ai", "sla-escalation"]) {
    assert.equal(document.querySelectorAll(`.nav-item[data-view="${internalView}"]`).length, 0);
  }
});

test("Settings opens with seven internal sections and one focused panel", () => {
  const settings = document.querySelector('.view[data-panel="settings"]');
  assert.ok(settings);
  const buttons = [...settings.querySelectorAll("[data-settings-section]")];
  const panels = [...settings.querySelectorAll("[data-settings-panel]")];
  assert.equal(buttons.length, 7);
  assert.deepEqual(buttons.map((button) => button.dataset.settingsSection), [
    "security", "device-health", "police-units", "police-stations", "camera-ai", "sla-escalation", "system"
  ]);
  assert.equal(panels.filter((panel) => !panel.hidden).length, 1);
  assert.equal(panels.find((panel) => !panel.hidden).dataset.settingsPanel, "security");
});

test("existing settings forms and render targets are placed in their focused sections", () => {
  const cases = [
    ["security", "#changePasswordForm"],
    ["device-health", "#deviceList"],
    ["police-units", "#unitRegistryForm"],
    ["police-units", "#unitRegistryList"],
    ["police-stations", "#stationRegistryForm"],
    ["police-stations", "#stationRegistryList"],
    ["camera-ai", "#cameraAiStatus"],
    ["camera-ai", "#cameraConfigForm"],
    ["sla-escalation", "#slaConfigList"],
    ["system", "#auditList"],
    ["system", "#integrationList"]
  ];
  cases.forEach(([section, selector]) => {
    assert.ok(document.querySelector(`[data-settings-panel="${section}"] ${selector}`), `${selector} must remain in ${section}`);
  });
});

test("unit and station registries are registry-first with on-demand dialogs", () => {
  for (const [dialog, addButton, form] of [
    ["#unitRegistryDialog", "#addUnitRegistry", "#unitRegistryForm"],
    ["#stationRegistryDialog", "#addStationRegistry", "#stationRegistryForm"]
  ]) {
    const element = document.querySelector(dialog);
    assert.ok(element?.hidden, `${dialog} starts closed`);
    assert.ok(document.querySelector(addButton));
    assert.ok(element.querySelector(form));
  }
  assert.match(appSource, /openUnitRegistryForm\(unit\)/);
  assert.match(appSource, /openStationRegistryForm\(station\)/);
  assert.match(cssSource, /\.settings-content \.unit-registry-list,[^}]*max-height: none; overflow: visible/);
});

test("SLA workspace is editable, guarded, validated, and persisted through the API", () => {
  assert.ok(document.querySelector("#slaConfigForm"));
  assert.ok(document.querySelector("#resetSlaChanges"));
  assert.ok(document.querySelector("#restoreSlaDefaults"));
  assert.match(appSource, /input\.type = "number"/);
  assert.match(appSource, /Assignment warning must be at least 0 and less than the assignment SLA/);
  assert.match(appSource, /Escalation intervals must increase from L1 through L4/);
  assert.match(appSource, /beforeunload/);
  assert.match(appSource, /method: "PATCH", body: \{ updates: state\.slaDraft \}/);
  assert.match(coreSource, /sla_policy_updated/);
});

test("section switching is in-app state navigation with URL support", () => {
  const switcher = appSource.match(/function setSettingsSection[\s\S]*?\n}\n/);
  assert.ok(switcher);
  assert.match(switcher[0], /panel\.hidden = panel\.dataset\.settingsPanel !== nextSection/);
  assert.match(switcher[0], /history\.replaceState/);
  assert.doesNotMatch(switcher[0], /location\.reload|location\.assign|location\.href\s*=/);
  assert.match(appSource, /#settings\/\$\{nextSection}/);
  assert.match(appSource, /window\.addEventListener\("hashchange"/);
});

test("existing password, registry, camera, device, and SLA APIs stay wired", () => {
  for (const endpoint of [
    "/api/change-password",
    "/api/devices/health",
    "/api/response-units",
    "/api/police-stations",
    "/api/camera-sources",
    "/api/sla/config"
  ]) assert.ok(appSource.includes(endpoint), `${endpoint} must remain wired`);
  assert.match(appSource, /Camera AI turned off|camera AI turned off/i);
  assert.match(appSource, /label: "Configured"[\s\S]*label: "Connected"[\s\S]*label: "Unavailable"[\s\S]*label: "Disabled"/);
});

test("backend RBAC stays authoritative and the workspace has responsive navigation", () => {
  assert.match(coreSource, /url\.pathname === "\/api\/sla\/config"[\s\S]*?hasRole\(user, \["Police Officer", "Admin"\]\)/);
  assert.match(coreSource, /req\.method === "PATCH" && url\.pathname === "\/api\/sla\/config"[\s\S]*?hasRole\(user, \["Admin"\]\)/);
  assert.match(cssSource, /@media \(max-width: 760px\)[\s\S]*?\.settings-nav \{ display: none; \}[\s\S]*?\.settings-mobile-nav \{ display: grid;/);
  assert.match(cssSource, /@media \(max-width: 520px\)[\s\S]*?\.settings-status-grid, \.sla-config-values \{ grid-template-columns: 1fr; \}/);
  assert.match(cssSource, /top: calc\(var\(--critical-banner-height\) \+ var\(--topbar-height\) \+ 18px\)/);
  assert.equal(document.querySelector("#settingsSectionSelect").options.length, 7);
});

test.after(() => dom.window.close());
