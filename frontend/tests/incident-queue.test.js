import test from "node:test";
import assert from "node:assert/strict";
import { prioritizeIncidents, selectedVisibleIncident, criticalQueueFilters } from "../src/incidentQueue.js";

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
