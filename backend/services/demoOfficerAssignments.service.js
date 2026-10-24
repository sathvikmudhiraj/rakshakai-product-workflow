const crypto = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");

function isKnownDemoOfficer(user) {
  if (user.role !== "Police Officer") return false;
  if (/^socket_police_\d+_[a-z0-9]+$/.test(user.id) && user.name === "Socket Police" && user.email === `${user.id}@example.test`) return true;
  return [["u_police_test", "Test Officer", "test_officer@rakshakai.local"], ["u_police", "Inspector Kavya Rao", "police@rakshakai.local"], ["u_field", "Field Officer Rajesh", "field@rakshakai.local"], ["u_calltaker", "Call Taker Priya", "calltaker@rakshakai.local"]]
    .some(([id, name, email]) => user.id === id && user.name === name && user.email === email);
}

function planDemoOfficerAssignments(db, env = process.env) {
  if (!["development", "test"].includes(env.NODE_ENV)) throw new Error("Demo officer setup is restricted to explicit development/test environments");
  const users = [], officers = [], memberships = [];
  const candidates = (db.users || []).filter(isKnownDemoOfficer).sort((a, b) => a.id.localeCompare(b.id));
  const stations = (db.policeStations || []).filter((station) => ["PS-PATANCHERU", "PS-BHEL-RCP"].includes(station.stationId));
  const rank = (db.officerRanks || []).find((item) => item.active !== false && item.code === "SI") || (db.officerRanks || []).find((item) => item.active !== false);
  if (candidates.length && (!stations.length || !rank)) throw new Error("Existing demo stations and an active officer rank are required");
  const changed = (before, after) => !isDeepStrictEqual(before, after);
  candidates.forEach((user, index) => {
    const old = (db.policeOfficers || []).find((officer) => (officer.userId || officer.user_id || officer.id) === user.id);
    const explicitStation = old?.stationId || user.stationId || user.station;
    const existingStation = (db.policeStations || []).find((item) => [item.id, item.stationId, item.stationName].includes(explicitStation));
    if (explicitStation && !existingStation) return; // Never overwrite an unrecognized pre-existing assignment.
    const station = existingStation || stations[index % stations.length];
    const badge = old?.badgeId || user.badgeId || `D112-${crypto.createHash("sha256").update(user.id).digest("hex").slice(0, 10).toUpperCase()}`;
    if ((db.policeOfficers || []).some((officer) => (officer.userId || officer.user_id || officer.id) !== user.id && officer.badgeId === badge)) throw new Error("Demo staff ID conflicts with an existing officer");
    const active = user.status !== "inactive" && user.active !== false;
    const duty = old?.dutyStatus || user.dutyStatus || (active && index % 4 !== 3 ? "on_duty" : "off_duty");
    const availability = old?.availabilityStatus || user.availabilityStatus || (active && duty === "on_duty" ? "available" : "unavailable");
    const unit = (db.responseUnits || []).find((item) => item.isDemo === true && /police|patrol/i.test(`${item.unitType || ""} ${item.unitSubtype || ""}`) && [station.id, station.stationId].includes(item.stationId || item.linkedStationId));
    const hasMembership = (db.responseUnitMembers || []).some((member) => (member.officerUserId || member.officer_user_id) === user.id);
    const profile = { ...(old || {}), id: old?.id || user.id, userId: user.id, badgeId: badge, stationId: old?.stationId || station.id, rankId: old?.rankId || rank.id,
      jurisdiction: old?.jurisdiction || user.jurisdiction || station.jurisdiction, beat: old?.beat || user.beat || station.beat || "",
      active: old?.active ?? active, dutyStatus: duty, availabilityStatus: availability, assignedIncidentId: old?.assignedIncidentId || null,
      isDemo: true, source: "demo_officer_setup", createdAt: old?.createdAt || user.createdAt || new Date().toISOString() };
    const account = { ...user, badgeId: user.badgeId || badge, stationId: user.stationId || station.id, station: user.station || station.stationName,
      jurisdiction: user.jurisdiction || station.jurisdiction, dutyStatus: user.dutyStatus || duty, availabilityStatus: user.availabilityStatus || availability,
      status: user.status || "active", isDemo: true, source: "demo_officer_setup" };
    if (unit && !hasMembership) {
      account.unitId = account.unitId || unit.unitCode || unit.id;
      memberships.push({ id: `demo_member_${crypto.createHash("sha256").update(user.id).digest("hex").slice(0, 16)}`, unitId: unit.id, officerUserId: user.id, role: "member", isDemo: true, assignedAt: new Date().toISOString() });
    }
    if (changed(old, profile)) officers.push(profile);
    if (changed(user, account)) users.push(account);
  });
  return { users, officers, memberships, matched: candidates.length, retainedTestAccounts: candidates.filter((user) => user.id.startsWith("socket_police_")).length };
}

module.exports = { isKnownDemoOfficer, planDemoOfficerAssignments };
