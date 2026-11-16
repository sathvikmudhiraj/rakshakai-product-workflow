import assert from "node:assert/strict";
import test from "node:test";
import { restoreAuthenticatedView } from "../src/sessionBootstrap.js";

test("restores the signed-in deep link even if startup data refresh fails", async () => {
  const calls = [];
  const refreshError = new Error("temporary API failure");
  const restored = await restoreAuthenticatedView({
    checkSession: async () => { calls.push("session"); return true; },
    requestedView: () => { calls.push("requested-view"); return "incident-command"; },
    setView: view => calls.push(`view:${view}`),
    refresh: async () => { calls.push("refresh"); throw refreshError; },
    onRefreshError: error => calls.push(`refresh-error:${error.message}`)
  });

  assert.equal(restored, true);
  assert.deepEqual(calls, [
    "session",
    "requested-view",
    "view:incident-command",
    "refresh",
    "refresh-error:temporary API failure"
  ]);
});

test("does not restore a view or refresh data when no session exists", async () => {
  const calls = [];
  const restored = await restoreAuthenticatedView({
    checkSession: async () => { calls.push("session"); return false; },
    requestedView: () => { calls.push("requested-view"); return "incident-command"; },
    setView: () => calls.push("view"),
    refresh: async () => calls.push("refresh")
  });

  assert.equal(restored, false);
  assert.deepEqual(calls, ["session"]);
});

test("propagates an unauthorized refresh so session expiry still reaches sign-in", async () => {
  const unauthorized = Object.assign(new Error("session expired"), { status: 401 });
  const calls = [];

  await assert.rejects(restoreAuthenticatedView({
    checkSession: async () => true,
    requestedView: () => "incident-command",
    setView: view => calls.push(`view:${view}`),
    refresh: async () => { throw unauthorized; },
    onRefreshError: () => calls.push("refresh-error")
  }), error => error === unauthorized);

  assert.deepEqual(calls, ["view:incident-command"]);
});
