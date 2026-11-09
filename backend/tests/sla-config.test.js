const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeAndValidateSlaPolicy } = require("../services/core.service");

const validPolicy = {
  id: "sla_high",
  severity: "HIGH",
  assignmentSlaMinutes: 3,
  responseSlaMinutes: 10,
  warningBeforeAssignmentMinutes: 1,
  warningBeforeResponseMinutes: 2,
  escalationL1IntervalMinutes: 3,
  escalationL2IntervalMinutes: 5,
  escalationL3IntervalMinutes: 10,
  escalationL4IntervalMinutes: 15,
  investigationInactivityThresholdHours: 24,
  active: true
};

test("SLA policy accepts valid thresholds and a zero warning", () => {
  const result = normalizeAndValidateSlaPolicy({ ...validPolicy, warningBeforeAssignmentMinutes: 0 }, validPolicy);
  assert.equal(result.error, undefined);
  assert.equal(result.policy.warningBeforeAssignmentMinutes, 0);
});

test("SLA warning thresholds must remain below their deadlines", () => {
  assert.match(normalizeAndValidateSlaPolicy({ ...validPolicy, warningBeforeAssignmentMinutes: 3 }, validPolicy).error, /less than the assignment SLA/);
  assert.match(normalizeAndValidateSlaPolicy({ ...validPolicy, warningBeforeResponseMinutes: 10 }, validPolicy).error, /less than the response SLA/);
});

test("SLA escalation levels must be positive and strictly increasing", () => {
  assert.match(normalizeAndValidateSlaPolicy({ ...validPolicy, escalationL2IntervalMinutes: 3 }, validPolicy).error, /increase from L1 through L4/);
  assert.match(normalizeAndValidateSlaPolicy({ ...validPolicy, escalationL1IntervalMinutes: 0 }, validPolicy).error, /greater than 0/);
});

test("SLA deadlines and investigation inactivity must be positive", () => {
  assert.match(normalizeAndValidateSlaPolicy({ ...validPolicy, assignmentSlaMinutes: 0 }, validPolicy).error, /Assignment SLA/);
  assert.match(normalizeAndValidateSlaPolicy({ ...validPolicy, investigationInactivityThresholdHours: 0 }, validPolicy).error, /Investigation inactivity/);
});
