import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const notifications = fs.readFileSync(new URL("../src/components/NotificationCenter.js", import.meta.url), "utf8");
const dom = new JSDOM(html);
const document = dom.window.document;

test("citizen reporting is blank by default and communicates the review workflow", () => {
  const panel = document.querySelector('[data-panel="missing"]');
  const form = panel.querySelector("#missingForm");
  assert.equal(form.querySelector('[name="personName"]').value, "");
  assert.equal(form.querySelector('[name="lastSeen"]').value, "");
  assert.equal(form.querySelector('[name="description"]').value, "");
  assert.equal(panel.querySelectorAll(".report-process li").length, 3);
  assert.ok(panel.querySelector("#reportQueueCount"));
  assert.match(app, /My Submitted Reports/);
  assert.match(app, /Police review and linked-incident updates/);
});

test("police management is registry-first with create and edit controls disclosed on demand", () => {
  const panel = document.querySelector('[data-panel="police-management"]');
  const dialog = panel.querySelector("#policeCreateDialog");
  assert.ok(panel.querySelector("#addPoliceUserBtn"));
  assert.ok(dialog.hidden);
  assert.equal(dialog.getAttribute("role"), "dialog");
  assert.match(app, /node\("form", "police-user-edit"\)/);
  assert.match(app, /form\.hidden = true/);
  assert.match(app, /Edit Officer/);
  assert.match(app, /Cancel/);
  assert.match(css, /\.police-create-dialog \{[^}]*position: fixed/);
});

test("alert queue provides operational source, status, type, and time filters", () => {
  for (const filter of ["source", "status", "type", "time"]) {
    assert.match(app, new RegExp(`\\["${filter}",`));
  }
  assert.match(app, /select\.dataset\.alertQueueFilter = key/);
  assert.match(app, /alertQueueFilters/);
  assert.match(css, /\.alert-advanced-filters/);
  assert.equal(document.querySelector('#manualAlertForm [name="message"]').value, "");
});

test("notification assistant docks on compact layouts and traps keyboard focus in its dialog", () => {
  assert.match(notifications, /max-width: 1120px/);
  assert.match(notifications, /root\.classList\.toggle\("docked"/);
  assert.match(notifications, /event\.key !== "Tab"/);
  assert.match(notifications, /focusable\[focusable\.length - 1\]/);
  assert.match(css, /\.notification-center\.docked \.notification-launcher \{[^}]*position: relative/);
  assert.match(css, /\.notification-drawer\[aria-hidden="true"\] \{ display: none; \}/);
});

test("evidence intake controls use a full-width responsive form layout", () => {
  assert.match(css, /\.video-evidence-form \{ display: grid; gap:/);
  assert.match(css, /\.video-evidence-form select,[\s\S]*?width: 100%/);
});

test.after(() => dom.window.close());
