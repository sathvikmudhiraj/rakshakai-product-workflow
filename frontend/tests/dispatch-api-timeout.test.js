import test from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/services/api.js";
import { canDispatchUnits, createUnitAssignmentRecommendationCoordinator, memberUnavailable } from "../src/unitAssignmentRecommendation.js";

function transport(t, fetchImpl) {
  const previous = { window: globalThis.window, fetch: globalThis.fetch };
  let expire, cleared = false;
  globalThis.window = { setTimeout: (callback) => { expire = callback; return 1; }, clearTimeout: () => { cleared = true; } };
  globalThis.fetch = fetchImpl;
  t.after(() => Object.assign(globalThis, previous));
  return { expire: () => expire(), cleared: () => cleared };
}

test("stalled recommendation body times out, aborts transport and clears coordinator loading", async (t) => {
  let signal;
  const timer = transport(t, async (_url, options) => {
    signal = options.signal;
    return { ok: true, headers: { get: () => "application/json" }, json: () => new Promise(() => {}) };
  });
  const coordinator = createUnitAssignmentRecommendationCoordinator({ request: () => api("/api/incidents/a/recommend-unit", { method: "POST" }) });
  const pending = coordinator.select({ id: "a" });
  await new Promise(setImmediate);
  assert.equal(coordinator.getSnapshot().status, "loading");
  timer.expire();
  await pending;
  assert.equal(coordinator.getSnapshot().status, "error");
  assert.match(coordinator.getSnapshot().error, /timed out/i);
  assert.equal(signal.aborted, true);
  assert.equal(timer.cleared(), true);
});

test("API success reads body before clearing timeout", async (t) => {
  const timer = transport(t, async () => ({ ok: true, headers: { get: () => "application/json" }, json: async () => {
    assert.equal(timer.cleared(), false); return { unit: { id: "p" } };
  } }));
  assert.deepEqual(await api("/api/incidents/a/recommend-unit"), { unit: { id: "p" } });
  assert.equal(timer.cleared(), true);
});

test("API errors preserve backend status and code; network errors clear timeout", async (t) => {
  const timer = transport(t, async () => ({ ok: false, status: 409, headers: { get: () => "application/json" }, json: async () => ({ code: "PRIMARY_UNIT_REQUIRED", error: "Assign primary first" }) }));
  await assert.rejects(api("/api/incidents/a/assign-unit"), (error) => error.status === 409 && error.data.code === "PRIMARY_UNIT_REQUIRED");
  assert.equal(timer.cleared(), true);
  globalThis.fetch = async () => { throw new Error("offline"); };
  await assert.rejects(api("/api/incidents/a/recommend-unit"), (error) => error.code === "API_UNAVAILABLE");
});

test("dispatcher UI policy denies call taker, field officer, Citizen and missing operational role", () => {
  assert.equal(canDispatchUnits({ role: "Admin" }), true);
  for (const role of ["DISPATCHER", "SUPERVISOR"]) assert.equal(canDispatchUnits({ role: "Police Officer", data: { operationalRole: role } }), true);
  for (const role of ["CALL_TAKER", "FIELD_OFFICER", undefined]) assert.equal(canDispatchUnits({ role: "Police Officer", operationalRole: role }), false);
  assert.equal(canDispatchUnits({ role: "Citizen" }), false);
});

test("member selection excludes off duty, leave, suspended, inactive and other-incident deployments", () => {
  const member = { active: true, dutyStatus: "on_duty", availability: "available" };
  assert.equal(memberUnavailable(member, "a"), false);
  for (const dutyStatus of ["off_duty", "leave", "suspended"]) assert.equal(memberUnavailable({ ...member, dutyStatus }, "a"), true);
  assert.equal(memberUnavailable({ ...member, active: false }, "a"), true);
  assert.equal(memberUnavailable({ ...member, currentIncidentId: "b" }, "a"), true);
});
