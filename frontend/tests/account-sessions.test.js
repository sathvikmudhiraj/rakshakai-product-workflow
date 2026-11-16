import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { openAccountSessions, closeAccountSessions } from "../src/components/AccountSessions.js";

test("account sessions render safe device text, revoke another session, rotate and restore focus", async () => {
  const dom = new JSDOM('<button id="trigger">Sessions</button>', { url: "http://localhost" });
  const previous = globalThis.document; globalThis.document = dom.window.document;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event("close")); };
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  let sessions = [
    { id: "current", current: true, issuedAt: 100, expiresAt: 10000, authMethod: "google_workspace", deviceLabel: "Current browser" },
    { id: "remote", current: false, issuedAt: 100, expiresAt: 10000, authMethod: "password", deviceLabel: '<img src=x onerror="alert(1)">' }
  ];
  const requests = []; let rotated = 0;
  try {
    document.querySelector("#trigger").focus();
    const dialog = openAccountSessions({ api: async (path, options = {}) => {
      requests.push([path, options.method || "GET"]);
      if (options.method === "DELETE" || options.method === "POST") sessions = sessions.filter((session) => session.current);
      return { sessions };
    }, onSessionRotated: () => { rotated++; } });
    await tick();
    assert.equal(dialog.open, true);
    assert.equal(dialog.querySelectorAll("img").length, 0);
    assert.match(dialog.textContent, /Google Workspace/);
    assert.equal(dialog.querySelectorAll(".account-session-card button").length, 1);
    dialog.querySelector(".account-session-card button").click(); await tick();
    assert.ok(requests.some(([path, method]) => path === "/api/auth/sessions/remote" && method === "DELETE"));
    [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Sign out other sessions").click(); await tick();
    assert.equal(rotated, 1);
    assert.match(dialog.textContent, /Other sessions signed out/);
    closeAccountSessions();
    assert.equal(document.activeElement.id, "trigger");
    assert.equal(document.querySelector("dialog"), null);
  } finally { globalThis.document = previous; dom.window.close(); }
});

test("closing the account dialog prevents a late response from rendering private session data", async () => {
  const dom = new JSDOM("<body></body>"); const previous = globalThis.document; globalThis.document = dom.window.document;
  let resolve;
  try {
    openAccountSessions({ api: () => new Promise((finish) => { resolve = finish; }) });
    closeAccountSessions();
    resolve({ sessions: [{ deviceLabel: "Private device" }] });
    await new Promise((finish) => setImmediate(finish));
    assert.equal(document.body.textContent, "");
  } finally { globalThis.document = previous; dom.window.close(); }
});
