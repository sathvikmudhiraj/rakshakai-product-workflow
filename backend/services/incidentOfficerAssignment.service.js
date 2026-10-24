const crypto = require("node:crypto");

const RESPONSE_ROLES = new Set(["TEAM_LEAD", "RESPONSE_OFFICER", "DRIVER", "FIELD_OFFICER", "SUPPORT_OFFICER"]);
const ACTIVE_STATUSES = new Set(["ASSIGNED", "EN_ROUTE", "ON_SCENE"]);
function deploymentAllowed(incident) {
  return ["assigned", "en route", "on scene"].includes(String(incident.status || "").toLowerCase().replace(/[_-]/g, " "));
}
function assertDeployable(incident) {
  if (!deploymentAllowed(incident)) fail(409, "INCIDENT_NOT_DEPLOYABLE", "Officer deployment is only available for an active assigned incident. Existing officers may still be released.");
}

function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }
function officerId(profile) { return profile?.userId || profile?.user_id || profile?.officerUserId || profile?.id; }
function assignedIncidentId(profile) { return profile?.assignedIncidentId || profile?.assigned_incident_id || null; }
function active(assignment) { return ACTIVE_STATUSES.has(String(assignment.status || "ASSIGNED").toUpperCase()); }
function activeOfficerDeployments(db, { incidentId, officerId: selectedOfficerId } = {}) {
  return (db.incidentOfficerAssignments || []).filter((item) => active(item)
    && (!incidentId || item.incidentId === incidentId)
    && (!selectedOfficerId || item.officerId === selectedOfficerId));
}
function operationalRole(user) { return user?.operationalRole || user?.data?.operationalRole || null; }
function assertAssignmentActor(user) {
  if (user?.role === "Admin") return;
  if (user?.role === "Police Officer" && ["DISPATCHER", "SUPERVISOR"].includes(operationalRole(user))) return;
  fail(403, "OFFICER_ASSIGNMENT_FORBIDDEN", "Dispatcher or Admin authorization is required");
}
function context(db, incidentId) {
  const incident = (db.incidents || []).find((item) => item.id === incidentId || item.incidentId === incidentId);
  if (!incident) fail(404, "INCIDENT_NOT_FOUND", "Incident not found");
  const unitId = incident.assignedUnitId || incident.assigned_unit_id;
  if (!unitId) fail(409, "PRIMARY_UNIT_REQUIRED", "Assign a primary response unit before deploying officers");
  const unit = (db.responseUnits || []).find((item) => item.id === unitId);
  if (!unit) fail(409, "PRIMARY_UNIT_NOT_FOUND", "Assigned primary response unit was not found");
  return { incident, unit, unitId };
}
function memberRecords(db, incidentId) {
  const { incident, unit, unitId } = context(db, incidentId);
  const deployments = (db.incidentOfficerAssignments || []).filter((item) => item.incidentId === incident.id);
  const members = (db.responseUnitMembers || []).filter((item) => item.unitId === unitId && item.active !== false).map((membership) => {
    const id = membership.officerUserId || membership.officer_user_id;
    const user = (db.users || []).find((item) => item.id === id);
    const profile = (db.policeOfficers || []).find((item) => officerId(item) === id);
    const rank = (db.officerRanks || []).find((item) => item.id === (profile?.rankId || profile?.rank_id));
    const primaryDeployment = activeOfficerDeployments(db, { officerId: id })[0] || null;
    const deployment = deployments.find((item) => item.officerId === id && active(item)) || null;
    const supportIncidentId = assignedIncidentId(profile);
    const isDemo = [user, profile, membership].some((record) => record?.isDemo === true || record?.isTest === true || /^(demo_seed|demo|fixture|test|synthetic)$/.test(record?.source || ""));
    return { officerId: id, name: user?.name || null, rank: rank?.name || rank?.rankName || null, badgeId: profile?.badgeId || profile?.badge_id || user?.badgeId || null, availability: primaryDeployment || supportIncidentId ? "busy" : profile?.availabilityStatus || profile?.availability_status || "unknown", dutyStatus: profile?.dutyStatus || profile?.duty_status || null, active: Boolean(profile && user?.role === "Police Officer" && profile.active !== false && user.active !== false && user.status !== "inactive"), currentIncidentId: primaryDeployment?.incidentId || supportIncidentId, membershipRole: membership.role || null, isDemo, deployment };
  });
  return { incident, unit, members, assignments: deployments, deploymentAllowed: deploymentAllowed(incident),
    deploymentUnavailableReason: deploymentAllowed(incident) ? null : "This incident is not active for officer deployment. Existing officers may still be released." };
}
function listAssignments(db, incidentId) {
  const incident = (db.incidents || []).find((item) => item.id === incidentId || item.incidentId === incidentId);
  if (!incident) fail(404, "INCIDENT_NOT_FOUND", "Incident not found");
  return (db.incidentOfficerAssignments || []).filter((item) => item.incidentId === incident.id);
}
function assign(db, incidentId, requested, actor, at = new Date().toISOString()) {
  assertAssignmentActor(actor);
  const { incident, unitId, members } = memberRecords(db, incidentId);
  assertDeployable(incident);
  if (!Array.isArray(requested) || !requested.length) fail(400, "ASSIGNMENTS_REQUIRED", "Select at least one officer");
  const seen = new Set();
  const prepared = requested.map((item) => {
    const id = String(item.officerId || ""); const role = String(item.responseRole || "").toUpperCase();
    if (!RESPONSE_ROLES.has(role)) fail(400, "INVALID_RESPONSE_ROLE", "A valid incident response role is required");
    if (seen.has(id)) fail(409, "DUPLICATE_OFFICER", "An officer cannot appear twice in one request"); seen.add(id);
    const member = members.find((entry) => entry.officerId === id);
    if (!member) fail(409, "OFFICER_NOT_UNIT_MEMBER", "Officer is not an active member of the assigned primary unit");
    if (!member.active || ["off_duty", "leave", "suspended"].includes(String(member.dutyStatus || "").toLowerCase())) fail(409, "OFFICER_UNAVAILABLE", "Officer is not active and operational");
    const prior = (db.incidentOfficerAssignments || []).find((entry) => entry.officerId === id && active(entry));
    if (prior) fail(409, prior.incidentId === incident.id ? "DUPLICATE_DEPLOYMENT" : "OFFICER_BUSY", prior.incidentId === incident.id ? "Officer is already deployed to this incident" : `Officer is already deployed to ${prior.incidentId}`);
    if (member.currentIncidentId && member.currentIncidentId !== incident.id) fail(409, "OFFICER_BUSY", `Officer is committed to ${member.currentIncidentId} through emergency support`);
    if (String(member.availability).toLowerCase() !== "available") fail(409, "OFFICER_BUSY", "Officer is not currently available");
    return { id: `ioa_${crypto.randomBytes(8).toString("hex")}`, incidentId: incident.id, unitId, officerId: id, responseRole: role, status: "ASSIGNED", assignedBy: actor.id, assignedAt: at, releasedBy: null, releasedAt: null, releaseReason: null, createdAt: at, updatedAt: at };
  });
  db.incidentOfficerAssignments ||= []; db.incidentOfficerAssignments.push(...prepared); return prepared;
}
function updateRole(db, incidentId, assignmentId, role, actor, reason, at = new Date().toISOString()) {
  assertAssignmentActor(actor); assertDeployable(context(db, incidentId).incident); role = String(role || "").toUpperCase();
  if (!RESPONSE_ROLES.has(role)) fail(400, "INVALID_RESPONSE_ROLE", "A valid incident response role is required");
  const assignment = (db.incidentOfficerAssignments || []).find((item) => item.id === assignmentId && item.incidentId === incidentId);
  if (!assignment || !active(assignment)) fail(404, "ACTIVE_ASSIGNMENT_NOT_FOUND", "Active officer assignment not found");
  const previousRole = assignment.responseRole; assignment.responseRole = role; assignment.updatedAt = at; assignment.roleChangeReason = String(reason || "").trim() || null;
  return { assignment, previousRole };
}
function release(db, incidentId, assignmentId, reason, actor, at = new Date().toISOString()) {
  assertAssignmentActor(actor);
  // Release historical commitments even if an earlier primary release left an orphan.
  if (!(db.incidents || []).some((item) => item.id === incidentId)) fail(404, "INCIDENT_NOT_FOUND", "Incident not found");
  const cleanReason = String(reason || "").trim();
  if (!cleanReason) fail(400, "RELEASE_REASON_REQUIRED", "Release reason is required");
  const assignment = (db.incidentOfficerAssignments || []).find((item) => item.id === assignmentId && item.incidentId === incidentId);
  if (!assignment || !active(assignment)) fail(404, "ACTIVE_ASSIGNMENT_NOT_FOUND", "Active officer assignment not found");
  Object.assign(assignment, { status: "RELEASED", releasedBy: actor.id, releasedAt: at, releaseReason: cleanReason, updatedAt: at }); return assignment;
}

module.exports = { RESPONSE_ROLES, ACTIVE_STATUSES, activeOfficerDeployments, assertAssignmentActor, getUnitMembersForIncident: memberRecords, listIncidentOfficerAssignments: listAssignments, assignIncidentOfficers: assign, updateIncidentOfficerRole: updateRole, releaseIncidentOfficer: release };
