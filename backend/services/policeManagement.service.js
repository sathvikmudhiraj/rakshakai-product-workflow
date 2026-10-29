const { activeOfficerDeployments } = require("./incidentOfficerAssignment.service");
const { officerUnavailableReason } = require("./hybridDispatch.service");

const MEMBERSHIP_ROLES = ["commander", "driver", "member", "deputy", "medic"];
const OPERATIONAL_ROLES = ["DISPATCHER", "SUPERVISOR", "CALL_TAKER", "FIELD_OFFICER"];
const idOf = (item) => item?.userId || item?.user_id || item?.officerUserId || item?.id;
const stationId = (item) => item?.stationId || item?.station_id || item?.linkedStationId;
const rankIdOf = (item) => item?.rankId || item?.rank_id;
const normalize = (value) => String(value || "").trim().toLowerCase();
function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }
function profileFor(db, id) { return (db.policeOfficers || []).find((item) => idOf(item) === id); }
function stationFor(db, reference) {
  return (db.policeStations || []).find((item) => [item.id, item.stationId, item.stationCode, item.station_code, item.name, item.stationName].filter(Boolean).some((value) => normalize(value) === normalize(reference)));
}
function assertVersion(record, expected) {
  if (expected !== undefined && String(expected || "") !== String(record.updatedAt || record.lastUpdated || record.assignedAt || record.createdAt || "")) {
    fail(409, "STALE_RECORD", "This record changed. Refresh before saving again.");
  }
}
function officerCommitted(db, id) {
  const profile = profileFor(db, id);
  return activeOfficerDeployments(db, { officerId: id }).length > 0 || Boolean(profile?.assignedIncidentId || profile?.assigned_incident_id);
}
function unitCommitted(db, unit) {
  return Boolean(unit.assignedIncidentId || unit.currentIncidentId)
    || (db.incidents || []).some((incident) => !["closed", "resolved", "completed", "cancelled", "rejected / false alarm"].includes(normalize(incident.status))
      && (incident.assignedUnitId === unit.id || (incident.supportAllocations || []).some((allocation) => (allocation.unitIds || []).includes(unit.id))))
    || activeOfficerDeployments(db).some((assignment) => assignment.unitId === unit.id);
}
function assertMembershipChange(db, unit, id) {
  if (unitCommitted(db, unit) || officerCommitted(db, id)) fail(409, "ACTIVE_DEPLOYMENT", "Unit membership cannot be changed while the unit or officer has an active deployment.");
}
function validateMember(db, unit, id, role) {
  if (!MEMBERSHIP_ROLES.includes(role)) fail(400, "INVALID_MEMBERSHIP_ROLE", "Select a valid membership role.");
  const user = (db.users || []).find((item) => item.id === id && item.role === "Police Officer");
  const profile = profileFor(db, id);
  if (!user || !profile) fail(404, "OFFICER_NOT_FOUND", "A registered police officer and profile are required.");
  if (user.active === false || profile.active === false || ["inactive", "disabled", "deactivated"].includes(normalize(user.status)) || normalize(profile.dutyStatus || profile.duty_status) === "suspended") {
    fail(409, "OFFICER_INACTIVE", "Inactive or suspended officers cannot be added to a unit.");
  }
  const station = stationFor(db, stationId(unit));
  if (!station || station.id !== stationFor(db, stationId(profile))?.id) fail(409, "STATION_MISMATCH", "Officer and response unit must belong to the same registered station.");
  assertMembershipChange(db, unit, id);
  return { user, profile };
}
function validatePersonnel(db, body, user = null, profile = null) {
  const creating = !user;
  const badgeId = String(body.badgeId ?? profile?.badgeId ?? profile?.badge_id ?? user?.badgeId ?? "").trim();
  if ((creating || body.badgeId !== undefined) && !badgeId) fail(400, "BADGE_REQUIRED", "Badge / staff ID is required.");
  if (badgeId && ((db.users || []).some((item) => item.id !== user?.id && normalize(item.badgeId) === normalize(badgeId))
    || (db.policeOfficers || []).some((item) => idOf(item) !== user?.id && normalize(item.badgeId || item.badge_id) === normalize(badgeId)))) fail(409, "DUPLICATE_BADGE", "Badge / staff ID is already registered.");
  const explicitStationRef = body.stationId ?? (body.station !== undefined ? body.station : undefined);
  const station = stationFor(db, explicitStationRef ?? stationId(profile) ?? user?.station);
  // Free-text station labels stay supported for legacy records; an explicit
  // stationId reference must always resolve to a registered station.
  if (body.stationId !== undefined && !station) fail(400, "INVALID_STATION", "Select a registered police station.");
  if (creating && !station) fail(400, "INVALID_STATION", "Select a registered police station before creating an officer account.");
  let rank = null;
  if (body.rankId !== undefined) {
    rank = body.rankId ? (db.officerRanks || []).find((item) => item.id === body.rankId) : null;
    if (!rank || rank.active === false) fail(400, "INVALID_RANK", "Select an active officer rank.");
  } else {
    const rankId = rankIdOf(profile);
    rank = rankId ? (db.officerRanks || []).find((item) => item.id === rankId && item.active !== false) : null;
    if (!rank && creating) rank = (db.officerRanks || []).find((item) => item.active !== false) || null;
  }
  if (creating && !rank) fail(409, "NO_ACTIVE_RANK", "Create an active officer rank before creating a police account.");
  const beatId = body.beatId ?? profile?.beatId ?? profile?.beat_id ?? null;
  const beat = beatId ? (db.policeBeats || []).find((item) => item.id === beatId) : null;
  if (beatId && (!beat || beat.operational === false || (station && stationId(beat) !== station.id))) fail(400, "INVALID_BEAT", "Select an operational beat belonging to the selected station.");
  const dutyStatus = body.dutyStatus ?? profile?.dutyStatus ?? profile?.duty_status ?? "on_duty";
  const availabilityStatus = body.availabilityStatus ?? profile?.availabilityStatus ?? profile?.availability_status ?? "available";
  if (!["on_duty", "off_duty", "leave", "suspended"].includes(dutyStatus)) fail(400, "INVALID_DUTY_STATUS", "Invalid duty status.");
  if (!["available", "busy", "unavailable"].includes(availabilityStatus)) fail(400, "INVALID_AVAILABILITY", "Invalid availability status.");
  const currentOperationalRole = user?.operationalRole || user?.data?.operationalRole || null;
  let operationalRole = body.operationalRole === undefined ? currentOperationalRole : String(body.operationalRole || "").trim().toUpperCase() || null;
  if (operationalRole && !OPERATIONAL_ROLES.includes(operationalRole)) fail(400, "INVALID_OPERATIONAL_ROLE", "Select a valid operational role.");
  if (user) {
    assertVersion(user, body.expectedUpdatedAt);
    if (officerCommitted(db, user.id) && ((body.dutyStatus !== undefined && dutyStatus !== (profile?.dutyStatus || profile?.duty_status))
      || (body.availabilityStatus !== undefined && availabilityStatus !== (profile?.availabilityStatus || profile?.availability_status))
      || (station && station.id !== stationFor(db, stationId(profile))?.id))) fail(409, "ACTIVE_DEPLOYMENT", "Release the officer's active deployment before changing duty, availability, or station.");
  }
  return { badgeId, station, rank, beatId: beat?.id || null, dutyStatus, availabilityStatus, operationalRole };
}
function crewReadiness(db, unit) {
  const configured = (db.responseUnitMembers || []).filter((member) => (member.unitId || member.unit_id) === unit.id && member.active !== false);
  const eligible = configured.filter((member) => {
    const id = member.officerUserId || member.officer_user_id;
    const user = (db.users || []).find((item) => item.id === id);
    const profile = profileFor(db, id);
    return user?.role === "Police Officer" && profile && !officerUnavailableReason(profile, user, db, new Set(), null);
  });
  const roles = {};
  eligible.forEach((member) => { roles[member.role || "member"] = (roles[member.role || "member"] || 0) + 1; });
  const missing = ["commander", "driver"].filter((role) => !roles[role]);
  const ready = missing.length === 0;
  return { ready, roles, missing, configuredCount: configured.length, eligibleCount: eligible.length,
    reason: !configured.length ? "No configured crew. Admin must add registered officers in Police Management."
      : !eligible.length ? "No eligible officers: check duty, account status and active deployments."
        : ready ? "Crew requirements satisfied" : `Missing eligible crew roles: ${missing.join(", ")}` };
}

module.exports = { MEMBERSHIP_ROLES, OPERATIONAL_ROLES, profileFor, stationFor, assertVersion, officerCommitted, unitCommitted, assertMembershipChange, validateMember, validatePersonnel, crewReadiness };
