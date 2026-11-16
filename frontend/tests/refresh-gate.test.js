import assert from "node:assert/strict";
import test from "node:test";
import { createRefreshGate } from "../src/refreshGate.js";

test("overlapping refresh requests schedule one follow-up pass", () => {
  const gate = createRefreshGate();
  assert.equal(gate.begin(), true, "the first refresh starts");
  assert.equal(gate.begin(), false, "a concurrent refresh is coalesced");
  assert.equal(gate.begin(), false, "additional concurrent refreshes share the same follow-up");
  assert.equal(gate.finish(), true, "the in-flight refresh reports pending work");
  assert.equal(gate.begin(), true, "the queued follow-up can start");
  assert.equal(gate.finish(), false, "a completed follow-up leaves no stale pending request");
});
