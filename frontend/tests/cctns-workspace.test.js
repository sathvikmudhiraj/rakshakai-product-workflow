import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(directory, "..", file), "utf8");

test("CCTNS workspace is routed, role-gated, and uses the authenticated adapter API", () => {
  const html = read("index.html");
  const app = read("src/app.js");
  const api = read("src/services/api.js");
  assert.match(html, /data-view="cctns" data-roles="Police Officer,Admin"/);
  assert.match(html, /data-panel="cctns"/);
  assert.match(app, /renderCctnsWorkspace/);
  assert.match(app, /location\.pathname === "\/cctns"/);
  assert.match(api, /export const cctnsApi/);
  assert.match(api, /\/api\/cctns\/search/);
});

test("CCTNS workspace carries simulator disclosures, accessible filters, and confirmed incident linking", () => {
  const source = read("src/components/CctnsWorkspace.js");
  const css = read("src/styles.css");
  for (const text of ["SIMULATED CCTNS RECORDS", "CCTNS Adapter / Simulator for project demonstration", "Search FIR, case, vehicle, person, property, offence...", "I confirm this link is based on human verification.", "LINK TO INCIDENT"]) assert.match(source, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, /showModal/);
  assert.match(source, /aria-live/);
  assert.match(css, /cctns-workspace-grid/);
  assert.match(css, /@media \(max-width: 1200px\)/);
});

test("a pending search cannot discard a linked record selected while it is loading", async () => {
  const dom = new JSDOM('<div id="cctnsWorkspace"></div>', { url: "http://localhost/cctns" });
  const previous = { window: global.window, document: global.document, location: global.location, Option: global.Option };
  Object.assign(global, { window: dom.window, document: dom.window.document, location: dom.window.location, Option: dom.window.Option });
  let finishSearch;
  let finishLinkedDetail;
  let searches = 0;
  const vehicle = { id: "vehicle-1", type: "vehicle", title: "TS09", status: "STOLEN" };
  const linked = { id: "case-1", type: "case", title: "CASE-1", status: "ACTIVE", subtitle: "Theft" };
  try {
    const { configureCctns, renderCctnsWorkspace } = await import("../src/components/CctnsWorkspace.js");
    configureCctns({
      getContext: () => ({ user: { role: "Admin" }, incidents: [], stations: [] }),
      api: {
        search: () => ++searches === 1
          ? Promise.resolve({ records: [vehicle], total: 1, state: "EXACT_RECORD_MATCH" })
          : new Promise((resolve) => { finishSearch = resolve; }),
        getRecord: (id) => id === vehicle.id
          ? Promise.resolve({ record: vehicle, linkedCases: [linked] })
          : new Promise((resolve) => { finishLinkedDetail = resolve; })
      }
    });
    renderCctnsWorkspace();
    await new Promise((resolve) => setImmediate(resolve));
    dom.window.document.querySelector('[data-cctns-record="vehicle-1"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    dom.window.document.querySelector('[data-cctns-category="crime"]').click();
    dom.window.document.querySelector('[data-cctns-record="case-1"]').click();
    const toggle = document.querySelector('[data-cctns-toggle-filters]');
    const crimeFilter = document.querySelector('[data-cctns-filter="crimeType"]');
    toggle.focus();
    toggle.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true }));
    finishSearch({ records: [vehicle], total: 1, state: "EXACT_RECORD_MATCH" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(document.querySelector('[data-cctns-toggle-filters]'), toggle, "Search completion must preserve the pressed control");
    assert.equal(document.activeElement, toggle, "Search completion must retain keyboard focus");
    toggle.click();
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    finishLinkedDetail({ record: linked });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(document.querySelector('[data-cctns-filter="crimeType"]'), crimeFilter);
    assert.equal(document.querySelector("#cctnsFilters").classList.contains("open"), true);
    assert.equal(dom.window.document.querySelector(".cctns-detail-title")?.textContent, "CASE-1");
    const search = document.querySelector('[data-cctns-search]');
    search.value = "New query";
    search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    assert.equal(document.querySelector(".cctns-results-list [data-cctns-record]"), null, "Stale search cards must disappear immediately, before debounce completes");
    assert.ok(document.querySelector(".cctns-loading"));
    assert.equal(document.querySelector('[data-cctns-search]'), search);
  } finally {
    Object.assign(global, previous);
    dom.window.close();
  }
});

test("late record failures and another operator's pending requests cannot replace current details", async () => {
  const dom = new JSDOM('<div id="cctnsWorkspace"></div>', { url: "http://localhost/cctns" });
  const previous = { window: global.window, document: global.document, location: global.location, Option: global.Option };
  Object.assign(global, { window: dom.window, document: dom.window.document, location: dom.window.location, Option: dom.window.Option });
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const records = [{ id: "a", type: "case", title: "Record A" }, { id: "b", type: "case", title: "Record B" }];
  let user = { id: "admin-a", role: "Admin" };
  let rejectFirst; let resolveOther;
  try {
    const { configureCctns, renderCctnsWorkspace, resetCctnsWorkspace } = await import("../src/components/CctnsWorkspace.js");
    configureCctns({ getContext: () => ({ user }), api: {
      search: async () => ({ records, total: 2 }),
      getRecord: (id) => id === "a" ? new Promise((resolve, reject) => { rejectFirst = reject; resolveOther = resolve; }) : Promise.resolve({ record: records[1] })
    } });
    renderCctnsWorkspace(); await tick();
    document.querySelector('[data-cctns-record="a"]').click();
    document.querySelector('[data-cctns-record="b"]').click(); await tick();
    rejectFirst(new Error("Stale failure")); await tick();
    assert.equal(document.querySelector(".cctns-detail-title").textContent, "Record B");
    assert.doesNotMatch(document.querySelector(".cctns-results-list").textContent, /Stale failure/);
    document.querySelector('[data-cctns-record="a"]').click();
    user = { id: "officer-b", role: "Police Officer" };
    renderCctnsWorkspace(); await tick();
    resolveOther({ record: records[0] }); await tick();
    assert.equal(document.querySelector(".cctns-detail-title"), null);
    resetCctnsWorkspace();
    assert.equal(document.querySelector("#cctnsWorkspace").textContent, "");
  } finally { Object.assign(global, previous); dom.window.close(); }
});


test("category tabs support keyboard navigation and retain focus after search", async () => {
  const dom = new JSDOM('<div id="cctnsWorkspace"></div>', { url: "http://localhost/cctns" });
  const previous = { window: global.window, document: global.document, location: global.location, Option: global.Option };
  Object.assign(global, { window: dom.window, document: dom.window.document, location: dom.window.location, Option: dom.window.Option });
  try {
    const { configureCctns, renderCctnsWorkspace, resetCctnsWorkspace } = await import("../src/components/CctnsWorkspace.js");
    resetCctnsWorkspace();
    configureCctns({ getContext: () => ({ user: { id: "keyboard-test", role: "Admin" }, stations: [], incidents: [] }), api: { search: async () => ({ records: [], total: 0 }) } });
    renderCctnsWorkspace();
    await new Promise(resolve => setImmediate(resolve));
    const first = document.querySelector('[data-cctns-category="all"]');
    first.focus();
    first.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.activeElement.dataset.cctnsCategory, "case");
    assert.equal(document.activeElement.getAttribute("aria-selected"), "true");
    assert.equal(document.querySelector('[data-cctns-category="all"]').tabIndex, -1);
    resetCctnsWorkspace();
  } finally { Object.assign(global, previous); dom.window.close(); }
});
