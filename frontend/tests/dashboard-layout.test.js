import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const alerts = fs.readFileSync(new URL("../src/components/PersistentAlerts.js", import.meta.url), "utf8");
const dom = new JSDOM(html);
const document = dom.window.document;

test("dashboard lower content uses independent left and right columns", () => {
  const lower = document.querySelector('[data-panel="dashboard"] .dashboard-lower-grid');
  const left = lower?.querySelector(":scope > .dashboard-lower-left");
  const live = lower?.querySelector(":scope > .live-incidents-panel");
  assert.ok(lower);
  assert.ok(left);
  assert.ok(live);
  assert.ok(left.querySelector(":scope > .dispatch-timeline-panel"));
  assert.equal(left.contains(live), false);
  assert.match(css, /\.dashboard-lower-grid \{[^}]*align-items: start/);
  assert.match(css, /\.dashboard-lower-left \{[^}]*flex-direction: column[^}]*align-self: stretch/);
});

test("Requires Attention is inserted directly above Dispatch Timeline", () => {
  assert.match(app, /\[data-panel='dashboard'\] \.dashboard-lower-left/);
  assert.match(app, /host\.prepend\(panel\)/);
  assert.match(css, /\.requires-attention-panel \{[^}]*height: fit-content;[^}]*align-self: start/);
  assert.doesNotMatch(css, /\.requires-attention-panel \{[^}]*(?:min-height|max-height):/);
  assert.match(alerts, /No active escalation alerts\./);
});

test("critical banner drives exact sticky offsets for header and sidebar", () => {
  assert.match(css, /--critical-banner-height: 0px/);
  assert.match(css, /\.topbar \{[\s\S]*?top: var\(--critical-banner-height\)/);
  assert.match(css, /\.sidebar \{[\s\S]*?top: var\(--critical-banner-height\);[\s\S]*?height: calc\(100vh - var\(--critical-banner-height\)\)/);
  assert.match(alerts, /getBoundingClientRect\(\)\.height/);
  assert.match(alerts, /--critical-banner-height/);
  assert.match(alerts, /ResizeObserver/);
});

test("queue navigation marks critical attention seen only after this user's snapshot loads", () => {
  assert.match(app, /resolveViewAccess\([\s\S]*?renderCriticalAttention\(view\)/);
  assert.match(app, /criticalAttentionSnapshotUserId !== state\.user\?\.id/);
  assert.match(app, /state\.incidents = incidents\.incidents;\s*criticalAttentionSnapshotUserId = state\.user\.id/);
  assert.match(app, /clearCriticalAttention\(state\.user\.id\)/);
  assert.equal(document.querySelector('[data-panel="incident-command"] #command-critical-summary')?.tagName, "SECTION");
  assert.match(css, /\.critical-queue-summary \{[^}]*display: flex/);
  assert.match(css, /\.topbar \{ position: sticky; top: var\(--critical-banner-height\); min-height: 68px/);
  assert.match(css, /@media \(max-width: 720px\) \{\s*\.topbar[^}]*\}[\s\S]*?body\[data-view="gis"\] \.topbar \{ position: static; top: auto; \}/);
});

test("responsive dashboard stacks Attention, Live Incidents, then Timeline", () => {
  assert.match(css, /@media \(max-width: 1000px\)[^{]*\{[^}]*[\s\S]*?\.dashboard-lower-left \{ display: contents; \}/);
  assert.match(css, /\.requires-attention-panel \{ order: 1; \}/);
  assert.match(css, /\.live-incidents-panel \{ order: 2; \}/);
  assert.match(css, /\.dispatch-timeline-panel \{ position: static; order: 3; \}/);
});

test("desktop timeline stays visible below the measured banner and topbar stack", () => {
  assert.match(css, /--topbar-height: 79px/);
  assert.match(css, /\.dispatch-timeline-panel \{ position: sticky; top: calc\(var\(--critical-banner-height\) \+ var\(--topbar-height\) \+ 20px\)/);
  assert.match(app, /getBoundingClientRect\(\)\.height/);
  assert.match(app, /--topbar-height/);
  assert.match(app, /topbarResizeObserver\.observe\(topbar\)/);
});

test.after(() => dom.window.close());
