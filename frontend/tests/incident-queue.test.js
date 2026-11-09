import test from "node:test";
import assert from "node:assert/strict";
import { prioritizeIncidents, selectedVisibleIncident, criticalQueueFilters, isDemoIncident, operatorVisibleIncidents } from "../src/incidentQueue.js";

test("critical incidents appear first without changing the original queue", () => {
  const incidents = [{ id: "m", severity: "medium" }, { id: "c1", severity: "CRITICAL" }, { id: "c2", severity: "critical" }, { id: "h", severity: "high" }];
  assert.deepEqual(prioritizeIncidents(incidents).map(item => item.id), ["c1", "c2", "h", "m"]);
  assert.equal(incidents[0].id, "m");
});

test("selected details remain within the visible queue", () => {
  const visible = [{ id: "critical" }];
  assert.equal(selectedVisibleIncident(visible, "hidden").id, "critical");
  assert.equal(selectedVisibleIncident([], "hidden"), null);
});

test("critical shortcut clears unrelated filters", () => {
  assert.deepEqual(criticalQueueFilters(), { search: "", severity: "critical", status: "all", source: "all", assignment: "all" });
});

test("demo and fixture incidents are hidden from operator queues by default", () => {
  const demo = { id: "demo", isDemo: true, severity: "critical" };
  const fixture = { id: "fix", sourceType: "command_center_demo", severity: "high" };
  const seeded = { id: "seed", source: "Fixture Seed", severity: "medium" };
  const real = { id: "real", isDemo: false, source: "Citizen Report", severity: "critical" };
  assert.equal(isDemoIncident(demo), true);
  assert.equal(isDemoIncident(fixture), true);
  assert.equal(isDemoIncident(seeded), true);
  assert.equal(isDemoIncident(real), false);
  assert.deepEqual(operatorVisibleIncidents([demo, fixture, seeded, real]).map((item) => item.id), ["real"]);
  assert.equal(operatorVisibleIncidents([demo, real], { includeDemo: true }).length, 2);
});
