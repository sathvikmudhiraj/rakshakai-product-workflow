import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";

test("direct view paths and unknown paths resolve to the requested page or role landing", () => {
  const source = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const start = source.indexOf("function requestedPortalView() {");
  const end = source.indexOf("function applyRoleAccess()", start);
  const context = vm.createContext({ location: { pathname: "/gis", hash: "" }, state: { user: { role: "Admin" } }, VIEW_TITLES: { gis: "GIS", settings: "Settings", cctns: "CCTNS" }, landingForRole: (role) => role === "Citizen" ? "missing" : "dashboard" });
  vm.runInContext(source.slice(start, end), context);
  assert.equal(context.requestedPortalView(), "gis");
  context.location.pathname = "/rakshak/live-vision";
  assert.equal(context.requestedPortalView(), "live-vision");
  context.location.pathname = "/unknown";
  assert.equal(context.requestedPortalView(), "dashboard");
  context.state.user.role = "Citizen";
  assert.equal(context.requestedPortalView(), "missing");
});

test("login refresh cannot overwrite navigation or allow duplicate login submissions", async () => {
  const source = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const begin = source.indexOf('$("#loginForm").addEventListener("submit"');
  const end = source.indexOf('$("#registerForm").addEventListener("submit"', begin);
  assert.ok(begin >= 0 && end > begin);
  const dom = new JSDOM('<form id="loginForm"><button type="submit">Sign in</button></form><p id="loginError"></p>');
  let submit;
  let releaseRefresh;
  const pending = new Promise((resolve) => { releaseRefresh = resolve; });
  let enteredRefresh;
  const entered = new Promise((resolve) => { enteredRefresh = resolve; });
  let requests = 0;
  let view;
  let landingCalls = 0;
  let rolesApplied = false;
  const form = dom.window.document.querySelector("form");
  const context = vm.createContext({
    loginSubmissionInFlight: false, state: {}, FormData: dom.window.FormData,
    location: { pathname: "/", hash: "" }, VIEW_TITLES: { dashboard: "Dashboard", cctns: "CCTNS", settings: "Settings" },
    $: (selector) => selector === "#loginForm"
      ? { addEventListener: (_event, handler) => { submit = handler; } }
      : dom.window.document.querySelector(selector),
    api: async () => { requests++; return { user: { role: "Police Officer" } }; },
    resetGisNavigationState() {}, applyRoleAccess() { rolesApplied = true; },
    showApp() { assert.equal(rolesApplied, true); },
    landingForRole: () => "dashboard",
    setView(next) { landingCalls++; view = next; },
    refresh: () => { enteredRefresh(); return pending; },
    showPortal(message) { assert.fail(message); }
  });
  const routeBegin = source.indexOf("function requestedPortalView() {");
  const routeEnd = source.indexOf("function applyRoleAccess()", routeBegin);
  assert.ok(routeBegin >= 0 && routeEnd > routeBegin);
  vm.runInContext(source.slice(routeBegin, routeEnd), context);
  vm.runInContext(source.slice(begin, end), context);
  try {
    const event = { preventDefault() {}, currentTarget: form };
    const first = submit(event);
    await entered;
    assert.equal(view, "dashboard");
    assert.equal(form.querySelector("button").disabled, true);
    view = "gis";
    await submit(event);
    releaseRefresh();
    await first;
    assert.equal(view, "gis");
    assert.equal(requests, 1);
    assert.equal(landingCalls, 1);
    assert.equal(context.loginSubmissionInFlight, false);
    assert.equal(form.querySelector("button").disabled, false);
  } finally { dom.window.close(); }
});
