const crypto = require("node:crypto");

function isExplicitDemoIncident(incident) {
  return incident?.recordClassification === "demo"
    || incident?.isDemo === true
    || incident?.demo === true
    || ["command_center_demo", "demo_seed"].includes(String(incident?.sourceType || "").toLowerCase())
    || String(incident?.source || "").toLowerCase() === "demo_seed";
}

function needsFixtureReview(incident) {
  if (incident?.recordClassification === "operational" || isExplicitDemoIncident(incident)) return false;
  return /^(fixture|test)[_-]/i.test(String(incident?.id || ""))
    || /\b(synthetic|fixture|demo)\b/i.test(String(incident?.title || ""));
}

function hasValidDate(value) {
  return Boolean(value) && Number.isFinite(Date.parse(value));
}

function activePolicyFor(incident, slaConfig = []) {
  const severity = String(incident?.severity || "").toUpperCase();
  const policy = slaConfig.find((item) => item.severity === severity && item.active !== false);
  if (!policy || !Number.isFinite(Number(policy.assignmentSlaMinutes)) || Number(policy.assignmentSlaMinutes) <= 0
    || !Number.isFinite(Number(policy.responseSlaMinutes)) || Number(policy.responseSlaMinutes) <= 0) return null;
  return policy;
}

function buildSlaDeadlinePlan(activeIncidents = [], slaConfig = [], atMs = Date.now()) {
  const entries = [];
  let explicitDemoCases = 0;
  let suspectedFixtureCases = 0;
  for (const incident of activeIncidents) {
    const demo = isExplicitDemoIncident(incident);
    const suspectedFixture = needsFixtureReview(incident);
    if (demo) explicitDemoCases += 1;
    if (suspectedFixture) suspectedFixtureCases += 1;
    const missingAssignment = !incident.assignmentDeadline;
    const missingResponse = !incident.responseDeadline;
    const invalidDeadline = (incident.assignmentDeadline && !hasValidDate(incident.assignmentDeadline))
      || (incident.responseDeadline && !hasValidDate(incident.responseDeadline));
    if (!missingAssignment && !missingResponse && !invalidDeadline) continue;
    const policy = activePolicyFor(incident, slaConfig);
    const createdAtMs = Date.parse(incident.createdAt || "");
    const assignmentMs = policy && Number.isFinite(createdAtMs) ? createdAtMs + Number(policy.assignmentSlaMinutes) * 60_000 : NaN;
    const responseMs = policy && Number.isFinite(createdAtMs) ? createdAtMs + Number(policy.responseSlaMinutes) * 60_000 : NaN;
    const validProposedDates = (!missingAssignment || Number.isFinite(assignmentMs) && Math.abs(assignmentMs) <= 8.64e15)
      && (!missingResponse || Number.isFinite(responseMs) && Math.abs(responseMs) <= 8.64e15);
    const status = demo ? "demo"
      : suspectedFixture ? "needs_classification"
        : invalidDeadline ? "invalid_deadline"
          : !policy ? "policy_unavailable"
            : !Number.isFinite(createdAtMs) ? "invalid_created_at"
              : !validProposedDates ? "invalid_policy_dates" : "ready";
    const assignmentDeadline = missingAssignment && status === "ready"
      ? new Date(assignmentMs).toISOString() : null;
    const responseDeadline = missingResponse && status === "ready"
      ? new Date(responseMs).toISOString() : null;
    entries.push({ id: incident.id, incidentId: incident.incidentId || incident.id, title: incident.title || "Incident",
      severity: incident.severity || null, status, missingAssignment, missingResponse,
      currentAssignmentDeadline: incident.assignmentDeadline || null,
      currentResponseDeadline: incident.responseDeadline || null,
      proposedAssignmentDeadline: assignmentDeadline, proposedResponseDeadline: responseDeadline,
      historicalOverdue: [assignmentDeadline, responseDeadline].some((value) => value && Date.parse(value) <= atMs) });
  }
  entries.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const summary = {
    activeCases: activeIncidents.length,
    explicitDemoCases,
    suspectedFixtureCases,
    missingDeadlineCases: entries.filter((item) => item.status !== "demo").length,
    readyForReview: entries.filter((item) => item.status === "ready").length,
    blockedByPolicy: entries.filter((item) => item.status === "policy_unavailable").length
  };
  const digest = crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  return { asOf: new Date(atMs).toISOString(), summary, entries, digest };
}

module.exports = { activePolicyFor, buildSlaDeadlinePlan, isExplicitDemoIncident, needsFixtureReview };
