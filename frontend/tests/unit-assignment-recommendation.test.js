import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";
import {
  createUnitAssignmentRecommendationCoordinator,
  hybridSupportVisible,
  unitAssignmentAction
} from "../src/unitAssignmentRecommendation.js";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test("selecting an incident requests the existing recommendation and success clears loading", async () => {
  const pending = deferred();
  const requested = [];
  const states = [];
  const coordinator = createUnitAssignmentRecommendationCoordinator({
    request: (incident) => { requested.push(incident.id); return pending.promise; },
    onChange: (state) => states.push(state.status)
  });

  const completion = coordinator.select({ id: "incident-1" });
  assert.deepEqual(requested, ["incident-1"]);
  assert.equal(coordinator.getSnapshot().status, "loading");
  pending.resolve({ unit: { id: "P-01" } });
  await completion;

  assert.equal(coordinator.getSnapshot().status, "ready");
  assert.deepEqual(states, ["loading", "ready"]);
});

test("recommendation failure always clears loading and exposes a controlled error", async () => {
  const coordinator = createUnitAssignmentRecommendationCoordinator({
    request: async () => { throw new Error("route provider unavailable"); }
  });

  await coordinator.select({ id: "incident-1" });
  assert.equal(coordinator.getSnapshot().status, "error");
  assert.equal(coordinator.getSnapshot().error, "route provider unavailable");
});

test("no automated recommendation becomes unavailable without hiding manual assignment", async () => {
  const coordinator = createUnitAssignmentRecommendationCoordinator({ request: async () => ({ candidates: [] }) });
  await coordinator.select({ id: "incident-1" });

  assert.equal(coordinator.getSnapshot().status, "unavailable");
  assert.deepEqual(unitAssignmentAction({ status: "available", operational: true }), { assignable: true, label: "Assign Unit" });
});

test("eligible units expose Assign Unit independently of recommendation state", () => {
  assert.deepEqual(unitAssignmentAction({ status: "available", operational: true }), { assignable: true, label: "Assign Unit" });
  assert.deepEqual(unitAssignmentAction({ status: "available", operational: true, assignedUnitId: "old-unit" }), { assignable: true, label: "Change Unit" });
  assert.equal(unitAssignmentAction({ status: "busy", operational: true }).assignable, false);
  assert.equal(unitAssignmentAction({ status: "available", operational: false }).assignable, false);
});

test("unassigned incidents never expose hybrid confirmation even when support allocations are returned", () => {
  const recommendation = { status: "recommended", stationSupport: { allocations: [{ stationId: "station-1" }] } };
  assert.equal(hybridSupportVisible({ id: "incident-1", assignedUnitId: null }, recommendation), false);
});

test("hybrid support becomes visible only after a primary unit assignment", () => {
  const recommendation = { status: "recommended", stationSupport: { allocations: [{ stationId: "station-1" }] } };
  assert.equal(hybridSupportVisible({ id: "incident-1", assignedUnitId: "P-01" }, recommendation), true);
  assert.equal(hybridSupportVisible({ id: "incident-1", assignedUnitId: "P-01" }, { ...recommendation, stationSupport: { allocations: [] } }), false);
});

test("assigned incidents request support explicitly instead of entering the primary recommendation flow", async () => {
  const requested = [];
  const coordinator = createUnitAssignmentRecommendationCoordinator({ request: async (incident) => { requested.push(incident.id); return { recommendation: { primary: { unitId: incident.assignedUnitId } } }; } });
  await coordinator.select({ id: "incident-1", assignedUnitId: "P-01" });
  assert.deepEqual(requested, []);
  await coordinator.requestSupport({ id: "incident-1", assignedUnitId: "P-01" });
  assert.deepEqual(requested, ["incident-1"]);
});

test("duplicate rerenders reuse one in-flight recommendation request", async () => {
  const pending = deferred();
  let requestCount = 0;
  const coordinator = createUnitAssignmentRecommendationCoordinator({
    request: () => { requestCount += 1; return pending.promise; }
  });

  const first = coordinator.select({ id: "incident-1" });
  const duplicate = coordinator.select({ id: "incident-1" });
  assert.equal(first, duplicate);
  assert.equal(requestCount, 1);
  pending.resolve({ unit: { id: "P-01" } });
  await first;
  await coordinator.select({ id: "incident-1" });
  assert.equal(requestCount, 1);
});

test("selecting another incident ignores the stale recommendation result", async () => {
  const first = deferred();
  const second = deferred();
  const coordinator = createUnitAssignmentRecommendationCoordinator({
    request: (incident) => incident.id === "incident-1" ? first.promise : second.promise
  });

  const firstCompletion = coordinator.select({ id: "incident-1" });
  const secondCompletion = coordinator.select({ id: "incident-2" });
  second.resolve({ unit: { id: "FX-P-01" } });
  await secondCompletion;
  first.resolve({ unit: { id: "P-01" } });
  await firstCompletion;

  assert.equal(coordinator.getSnapshot().incidentId, "incident-2");
  assert.equal(coordinator.getSnapshot().data.unit.id, "FX-P-01");
  assert.equal(coordinator.getSnapshot().status, "ready");
});

test("Unit Assignment is wired to the existing endpoint and Police Assignment remains present", () => {
  const app = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html);

  assert.match(app, /incidents\/\$\{encodeURIComponent\(incident\.id\)\}\/recommend-unit/);
  assert.match(app, /queueMicrotask[\s\S]*loadAssignmentRecommendation\(selected\)/);
  assert.match(app, /Retry Recommendation/);
  assert.doesNotMatch(app, /"Confirm Hybrid Dispatch"/);
  assert.match(app, /Request Hybrid \/ Emergency Support/);
  assert.match(app, /Manage Police Assignment/);
  assert.ok(dom.window.document.querySelector('[data-panel="police-assignment"]'));
  assert.ok(dom.window.document.querySelector("#assignSelectedOfficers"));
  dom.window.close();
});
