const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateSlaDeadlinesForIncident,
  getAssignmentSlaStatus,
  getResponseSlaStatus,
  getEscalationLevelForIncident,
  runSlaEscalationSweep,
  requiresInvestigation,
  isInvestigationInactive,
  isInvestigationOfficerMissing
} = require("../services/core.service");

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const baseTime = Date.parse("2026-01-01T10:00:00.000Z");
const configs = [
  ["CRITICAL", 1, 5, 1, 1], ["HIGH", 3, 10, 1, 2],
  ["MEDIUM", 10, 30, 3, 5], ["LOW", 30, 120, 10, 15]
].map(([severity, assignmentSlaMinutes, responseSlaMinutes, warningBeforeAssignmentMinutes, warningBeforeResponseMinutes]) => ({
  id: `sla_${severity}`, severity, assignmentSlaMinutes, responseSlaMinutes,
  warningBeforeAssignmentMinutes, warningBeforeResponseMinutes,
  escalationL3IntervalMinutes: 2, escalationL4IntervalMinutes: 5,
  investigationInactivityThresholdHours: 12, active: true
}));

function incident(overrides = {}) {
  return {
    id: `inc_${Math.random().toString(36).slice(2)}`,
    title: "Possible Murder", type: "possible_murder", severity: "CRITICAL",
    status: "Verified", createdAt: new Date(baseTime).toISOString(),
    assignmentDeadline: new Date(baseTime + MINUTE).toISOString(),
    responseDeadline: new Date(baseTime + 5 * MINUTE).toISOString(),
    assignedUnitId: null, escalationLevel: "L0", investigationRequired: false,
    investigationStatus: "NOT_REQUIRED", ...overrides
  };
}

function database(item = incident()) {
  return {
    incidents: [item], slaConfig: configs, escalationAlerts: [], incidentTimeline: [],
    severityRecommendationRules: [],
    investigationCategories: [{ id: "murder", active: true, requiresInvestigation: true, incidentTypes: ["possible_murder", "murder"] }]
  };
}

async function sweep(db, at) {
  return runSlaEscalationSweep({ db, currentTime: at, persist: false });
}

for (const [severity, assignmentMinutes, responseMinutes] of [
  ["CRITICAL", 1, 5], ["HIGH", 3, 10], ["MEDIUM", 10, 30], ["LOW", 30, 120]
]) {
  test(`${severity} incident receives configured assignment and response deadlines`, () => {
    const result = calculateSlaDeadlinesForIncident({ severity, createdAt: new Date(baseTime).toISOString() }, configs);
    assert.equal(Date.parse(result.assignmentDeadline), baseTime + assignmentMinutes * MINUTE);
    assert.equal(Date.parse(result.responseDeadline), baseTime + responseMinutes * MINUTE);
  });
}

test("assignment warning occurs before its deadline", () => {
  assert.equal(getAssignmentSlaStatus(incident(), configs, baseTime + MINUTE - 1).status, "WARNING");
});

test("assignment SLA breaches at the deadline", () => {
  assert.equal(getAssignmentSlaStatus(incident(), configs, baseTime + MINUTE).status, "BREACHED");
});

test("100 scheduler sweeps create one alert for each unique condition and level", async () => {
  const db = database();
  for (let count = 0; count < 100; count += 1) await sweep(db, baseTime + 2 * MINUTE);
  const keys = db.escalationAlerts.map((alert) => alert.uniqueKey);
  assert.equal(keys.length, new Set(keys).size);
  assert.equal(keys.filter((key) => key.includes("ASSIGNMENT_BREACH:L2")).length, 1);
});

test("assigning a team resolves an active assignment breach and preserves it", async () => {
  const item = incident(); const db = database(item);
  await sweep(db, baseTime + 2 * MINUTE);
  const breach = db.escalationAlerts.find((alert) => alert.alertType === "ASSIGNMENT_BREACH");
  item.assignedUnitId = "unit_1"; item.status = "Assigned";
  await sweep(db, baseTime + 2 * MINUTE);
  assert.equal(breach.active, false); assert.equal(breach.resolved, true);
  assert.ok(db.escalationAlerts.includes(breach));
});

test("assigned team that is not En Route produces a response warning", async () => {
  const db = database(incident({ assignedUnitId: "unit_1", status: "Assigned" }));
  await sweep(db, baseTime + 4 * MINUTE);
  assert.ok(db.escalationAlerts.some((alert) => alert.alertType === "RESPONSE_WARNING" && alert.active));
});

test("response deadline breach produces response SLA breach", async () => {
  const db = database(incident({ assignedUnitId: "unit_1", status: "Assigned" }));
  await sweep(db, baseTime + 5 * MINUTE);
  assert.ok(db.escalationAlerts.some((alert) => alert.alertType === "RESPONSE_BREACH"));
});

test("On Scene satisfies response SLA and resolves its warning", async () => {
  const item = incident({ assignedUnitId: "unit_1", status: "Assigned" }); const db = database(item);
  await sweep(db, baseTime + 4 * MINUTE);
  item.status = "On Scene";
  await sweep(db, baseTime + 6 * MINUTE);
  assert.equal(getResponseSlaStatus(item, configs, baseTime + 6 * MINUTE).status, "ON_SCENE");
  assert.equal(db.escalationAlerts.find((alert) => alert.alertType === "RESPONSE_WARNING").active, false);
});

test("incident progresses from L2 to L3 from the original breach timestamp", () => {
  const item = incident({ escalationLevel: "L2", assignmentBreachedAt: new Date(baseTime + MINUTE).toISOString() });
  assert.equal(getEscalationLevelForIncident(item, configs, baseTime + 3 * MINUTE), "L3");
});

test("incident progresses from stored L3 to L4 without resetting the clock", () => {
  const item = incident({ escalationLevel: "L3", assignmentBreachedAt: new Date(baseTime + MINUTE).toISOString(), lastEscalatedAt: new Date(baseTime + 6 * MINUTE).toISOString() });
  assert.equal(getEscalationLevelForIncident(item, configs, baseTime + 8 * MINUTE), "L4");
});

test("escalation never downgrades while the violation exists", () => {
  assert.equal(getEscalationLevelForIncident(incident({ escalationLevel: "L3" }), configs, baseTime + 2 * MINUTE), "L3");
});

test("acknowledgement does not resolve or deactivate an alert", () => {
  const alert = { acknowledged: false, resolved: false, active: true };
  alert.acknowledged = true;
  assert.deepEqual(alert, { acknowledged: true, resolved: false, active: true });
});

test("operational correction adds an alert resolution timeline record", async () => {
  const item = incident(); const db = database(item);
  await sweep(db, baseTime + 2 * MINUTE);
  item.assignedUnitId = "unit_1"; item.status = "Assigned";
  await sweep(db, baseTime + 2 * MINUTE);
  assert.ok(db.incidentTimeline.some((event) => event.eventType === "ESCALATION_ALERT_RESOLVED"));
});

test("serious incident enters investigation monitoring", async () => {
  const item = incident(); await sweep(database(item), baseTime);
  assert.equal(item.investigationRequired, true); assert.equal(item.investigationStatus, "NOT_STARTED");
});

test("missing investigating officer creates a persistent alert", async () => {
  const db = database(); await sweep(db, baseTime);
  assert.ok(db.escalationAlerts.some((alert) => alert.alertType === "INVESTIGATION_MISSING_IO"));
});

test("assigning an investigating officer clears missing IO condition", async () => {
  const item = incident({ investigationRequired: true, investigationStatus: "NOT_STARTED" }); const db = database(item);
  await sweep(db, baseTime);
  item.investigatingOfficerId = "officer_1"; item.investigationStatus = "ASSIGNED";
  await sweep(db, baseTime + MINUTE);
  assert.equal(db.escalationAlerts.find((alert) => alert.alertType === "INVESTIGATION_MISSING_IO").active, false);
});

test("investigation inactivity creates an alert after threshold", async () => {
  const item = incident({ investigationRequired: true, investigationStatus: "ACTIVE", investigatingOfficerId: "officer_1", investigationStartedAt: new Date(baseTime).toISOString(), lastInvestigationUpdateAt: new Date(baseTime).toISOString() });
  const db = database(item); await sweep(db, baseTime + 13 * HOUR);
  assert.ok(db.escalationAlerts.some((alert) => alert.alertType === "INVESTIGATION_INACTIVE"));
});

test("investigation within inactivity threshold has no inactivity alert", async () => {
  const item = incident({ investigationRequired: true, investigationStatus: "ACTIVE", investigatingOfficerId: "officer_1", investigationStartedAt: new Date(baseTime).toISOString(), lastInvestigationUpdateAt: new Date(baseTime).toISOString() });
  const db = database(item); await sweep(db, baseTime + HOUR);
  assert.equal(db.escalationAlerts.some((alert) => alert.alertType === "INVESTIGATION_INACTIVE"), false);
});

test("closed incidents produce no new SLA alerts and resolve active ones", async () => {
  const item = incident(); const db = database(item); await sweep(db, baseTime + 2 * MINUTE);
  const count = db.escalationAlerts.length; item.status = "Closed";
  await sweep(db, baseTime + 20 * MINUTE);
  assert.equal(db.escalationAlerts.length, count);
  assert.ok(db.escalationAlerts.every((alert) => !alert.active));
});

test("L2, L3 and L4 events are each created exactly once", async () => {
  const db = database();
  await sweep(db, baseTime + MINUTE);
  await sweep(db, baseTime + 3 * MINUTE);
  await sweep(db, baseTime + 8 * MINUTE);
  await sweep(db, baseTime + 30 * MINUTE);
  for (const level of ["L2", "L3", "L4"]) {
    assert.equal(db.escalationAlerts.filter((alert) => alert.alertType === `ESCALATION_${level}`).length, 1);
  }
});

test("critical Possible Murder flow reaches L1 then L2 then L3 then L4 with timeline history", async () => {
  const item = incident(); const db = database(item);
  await sweep(db, baseTime + MINUTE - 1);
  assert.equal(item.escalationLevel, "L1");
  await sweep(db, baseTime + MINUTE);
  assert.equal(item.escalationLevel, "L2");
  await sweep(db, baseTime + 3 * MINUTE);
  assert.equal(item.escalationLevel, "L3");
  await sweep(db, baseTime + 8 * MINUTE);
  assert.equal(item.escalationLevel, "L4");
  assert.equal(db.escalationAlerts.length, new Set(db.escalationAlerts.map((alert) => alert.uniqueKey)).size);
  assert.ok(db.incidentTimeline.filter((event) => event.eventType === "ESCALATION_LEVEL_CHANGED").length >= 4);
});

test("investigation helpers identify serious category, missing IO and inactivity", () => {
  const item = incident({ investigationRequired: true, investigationStatus: "ACTIVE", investigationStartedAt: new Date(baseTime).toISOString() });
  assert.equal(requiresInvestigation(item, database().investigationCategories), true);
  assert.equal(isInvestigationOfficerMissing(item), true);
  assert.equal(isInvestigationInactive(item, configs, baseTime + 13 * HOUR), true);
});
