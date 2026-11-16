import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");

test("SLA monitoring is an Operations route for authorized operational roles", () => {
  assert.match(html, /data-view="sla-monitoring" data-roles="Police Officer,Admin"/);
  assert.match(html, /<section class="view" data-panel="sla-monitoring">/);
  assert.match(app, /"sla-monitoring": "SLA Monitoring"/);
  assert.match(app, /if \(view === "sla-monitoring"\) void refreshSlaMonitoring\(\)/);
  assert.match(app, /location\.pathname === "\/incident-command" && requestedIncident/);
});

test("SLA dashboard reads authoritative monitoring data and keeps configuration in Settings", () => {
  assert.match(app, /api\("\/api\/sla\/monitoring"\)/);
  assert.match(app, /state\.slaMonitoringClock = \{ serverMs: Date\.parse\(data\.asOf\)/);
  assert.match(app, /setInterval\(\(\) => \{[\s\S]*?renderSlaCountdowns\(\)/);
  assert.match(html, /On-time resolution/);
  assert.match(app, /No resolution target is configured/);
  assert.match(html, /data-settings-section="sla-escalation"/);
  assert.doesNotMatch(html.match(/data-panel="sla-monitoring"[\s\S]*?<section class="view" data-panel="gis"/)?.[0] || "", /Delete|Clear History|Edit Audit/);
});

test("SLA monitoring exposes operational filters, attention links, and responsive layouts", () => {
  for (const id of ["slaSearch", "slaStatusFilter", "slaSeverityFilter", "slaStationFilter", "slaStateFilter", "slaPeriodFilter", "refreshSlaMonitoring", "slaAttentionList"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /data-sla-incident/);
  assert.match(app, /slaMonitoringError/);
  assert.match(styles, /\.sla-case-cards \{ display: none; \}/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.sla-case-cards \{ display: grid;/);
  assert.match(styles, /\.sla-case-table-wrap \{ width: 100%; overflow-x: auto; \}/);
});
