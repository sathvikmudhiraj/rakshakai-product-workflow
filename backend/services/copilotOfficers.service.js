// Pure read-only officer roster adapter. Never count response-unit rows as people.
const { activeOfficerDeployments } = require("./incidentOfficerAssignment.service");
const rows = (db, key) => Array.isArray(db?.[key]) ? db[key] : [];
const value = (record, ...keys) => keys.map((key) => record?.[key]).find((item) => item !== undefined && item !== null && item !== "");
const key = (text) => String(text || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
const personId = (record) => value(record, "userId", "user_id", "officerUserId", "id");
const stationId = (record) => value(record, "stationId", "station_id");
const stationRefs = (station) => [station.id, station.stationId, station.stationCode].filter(Boolean).map(String);
const nameOf = (station) => value(station, "stationName", "name", "stationId", "id");
const sameStation = (station, id) => id != null && stationRefs(station).includes(String(id));
const dutyKey = (text) => key(text).replace(/\s/g, "");

function operationalAvailability(db, officerId, recorded) {
  const support = rows(db, "policeOfficers").some((officer) => String(personId(officer)) === String(officerId) && value(officer, "assignedIncidentId", "assigned_incident_id"));
  return activeOfficerDeployments(db, { officerId }).length || support ? "busy" : recorded;
}

function isOfficerCollectionQuery(text) {
  if (/\b(?:PO|OFFICER)[-_][A-Z0-9]+\b/i.test(text) && !/\bofficers\b/i.test(text)) return false;
  if (/\b(?:this|selected|current|that|the) officer\b|\binvestigat\w*\b/i.test(text)) return false;
  if (/\bofficers?\b|\bpolice accounts?\b|\b(?:total|how many) police\b/i.test(text)) return true;
  return !/\b(?:units?|incidents?|cameras?|tracks?)\b/i.test(text) && /\b(?:police station|station)\b/i.test(text) && /\b(?:who|how many|present)\b/i.test(text);
}

function officerIntent(text) {
  if (!isOfficerCollectionQuery(text)) return null;
  const asksForAccounts = /\bpolice accounts?\b|\b(?:total|how many) police\b/i.test(text) && !/\bofficers?\b/i.test(text);
  if (asksForAccounts) {
    const listRequest = /\b(?:list|who|show)\b/i.test(text) && !/\b(?:how many|total|count|number)\b/i.test(text);
    return listRequest ? "POLICE_ACCOUNT_LIST" : "POLICE_ACCOUNT_COUNT";
  }
  if (/\bunits?\b/i.test(text) && !/\band response units\b/i.test(text)) return "OFFICERS_BY_UNIT";
  if (/\bjurisdiction\b/i.test(text)) return "OFFICERS_BY_JURISDICTION";
  if (/\binactive\b/i.test(text)) return "INACTIVE_OFFICERS";
  if (/\bavailable\b/i.test(text)) return "AVAILABLE_OFFICERS";
  if (/\bactive\b|\bon[ -]?duty\b/i.test(text)) return "ACTIVE_OFFICERS";
  return /how many|\btotal\b|\bcounts?\b|\bnumber\b/i.test(text) ? "OFFICER_COUNT_BY_STATION" : "OFFICER_LIST_BY_STATION";
}

function roster(db) {
  const users = new Map(rows(db, "users").map((user) => [String(user.id), user]));
  const records = new Map();
  for (const officer of rows(db, "policeOfficers")) {
    const id = personId(officer);
    if (!id) continue;
    const previous = records.get(String(id));
    // One person, one current assignment; stale duplicate JSON rows must not inflate counts.
    if (!previous || (Date.parse(officer.updatedAt || officer.updated_at) || 0) > (Date.parse(previous.updatedAt || previous.updated_at) || 0)) records.set(String(id), officer);
  }
  for (const user of users.values()) {
    if (user.role === "Police Officer" && !records.has(String(user.id))) records.set(String(user.id), { userId: user.id });
  }
  return [...records.entries()].flatMap(([id, record]) => {
    const user = users.get(id);
    if ((user && user.role !== "Police Officer") || (record.role && record.role !== "Police Officer")) return [];
    const membershipUnits = rows(db, "responseUnitMembers").filter((member) => member.active !== false && String(value(member, "officerUserId", "officer_user_id")) === id)
      .map((member) => rows(db, "responseUnits").find((unit) => String(unit.id) === String(value(member, "unitId", "unit_id")))).filter(Boolean);
    const legacyUnit = rows(db, "responseUnits").find((unit) => [unit.id, unit.unitId, unit.unitCode].filter(Boolean).includes(user?.unitId));
    const units = membershipUnits.length
      ? [...membershipUnits].sort((a, b) => Number(b.id === legacyUnit?.id) - Number(a.id === legacyUnit?.id))
      : legacyUnit ? [legacyUnit] : [];
    const reference = stationId(record) || stationId(user) || user?.data?.stationId || user?.station || stationId(units[0]) || units[0]?.linkedStationId;
    const assignedStation = rows(db, "policeStations").find((station) => sameStation(station, reference) || key(nameOf(station)) === key(reference));
    const station = assignedStation?.id || reference;
    const accountActive = user ? user.active !== false && user.data?.active !== false && user.status !== "inactive" : null;
    const activeValues = [record.active, user?.active, user?.data?.active];
    const active = activeValues.includes(false) || /^(?:inactive|disabled|deactivated)$/.test(key(user?.status)) ? false : activeValues.includes(true) ? true : accountActive;
    const duty = value(record, "dutyStatus", "duty_status") || value(user, "dutyStatus", "duty_status");
    const availability = operationalAvailability(db, id, value(record, "availabilityStatus", "availability_status") || value(user, "availabilityStatus", "availability_status"));
    return [{ id: String(record.id || id), userId: id, badgeId: value(record, "badgeId", "badge_id") || user?.badgeId || user?.staffId || null,
      name: user?.name || record.name || "Name not recorded", stationId: station || null,
      accountActive, hasAccount: Boolean(user), active, dutyStatus: duty || null, availabilityStatus: availability || null,
      stationName: assignedStation ? nameOf(assignedStation) : user?.station || null,
      jurisdiction: record.jurisdiction || user?.jurisdiction || assignedStation?.jurisdiction || null,
      beat: record.beat || user?.beat || null, unitIds: [...new Set(units.map((unit) => unit.id))],
      unitId: units[0]?.unitCode || units[0]?.id || user?.unitId || null,
      updatedAt: value(record, "updatedAt", "updated_at", "lastUpdated") || user?.updatedAt || null }];
  });
}

function scopeStations(db, actor) {
  if (!actor || actor.role === "Admin") return null;
  if (actor.role !== "Police Officer") return new Set();
  const ids = new Set([stationId(actor), actor.data?.stationId].filter(Boolean).map(String));
  for (const officer of roster(db)) if (officer.userId === String(actor.id) && officer.active !== false && officer.stationId) ids.add(String(officer.stationId));
  for (const member of rows(db, "responseUnitMembers")) {
    if (member.active === false) continue;
    if (String(value(member, "officerUserId", "officer_user_id")) !== String(actor.id)) continue;
    const unit = rows(db, "responseUnits").find((item) => String(item.id) === String(value(member, "unitId", "unit_id")));
    if (stationId(unit)) ids.add(String(stationId(unit)));
  }
  const stations = rows(db, "policeStations");
  for (const station of stations) if (stationRefs(station).some((id) => ids.has(id))) stationRefs(station).forEach((id) => ids.add(id));
  return ids;
}

function aliasesFor(station) {
  const values = [...stationRefs(station), nameOf(station), station.jurisdiction, ...(Array.isArray(station.aliases) ? station.aliases : [])].filter((item) => typeof item === "string");
  // Resolve these local aliases only against real station records, never invented stations.
  if (values.some((item) => /\bbhel\b/i.test(item)) && values.some((item) => /ramachandrapuram|(?:^|[-_])rcp(?:$|[-_])/i.test(item))) values.push("BHEL", "Ramachandrapuram");
  return [...new Set(values.map((item) => key(item).replace(/\b(?:police|station|demo|ps)\b/g, " ").trim().replace(/\s+/g, " ")).filter(Boolean))];
}

function resolveStation(db, text, scope) {
  const query = ` ${key(text)} `;
  const matches = rows(db, "policeStations").filter((station) => aliasesFor(station).some((alias) => query.includes(` ${alias} `)));
  if (matches.length > 1) return { error: "More than one station matches. Please use the full station name or station ID.", clarificationRequired: true };
  if (matches.length === 1) {
    const station = matches[0];
    if (scope && !stationRefs(station).some((id) => scope.has(id))) return { error: "This station is outside your authorized scope.", scopeDenied: true };
    return { station };
  }
  const remainder = key(text).replace(/\b(?:how|many|who|officers?|accounts?|police|station|total|count|list|show|tell|me|number|details|available|active|inactive|on|off|duty|responding|assigned|are|is|there|right|now|present|in|at|from|the|a|an|my|our|this|current|lo|o|please|and|all)\b/g, " ").trim();
  if (remainder) return { error: "No matching station was found. Please provide the full station name or station ID.", clarificationRequired: true };
  if (/\b(?:police station|station)\b/i.test(text)) {
    const authorized = rows(db, "policeStations").filter((station) => !scope || stationRefs(station).some((id) => scope.has(id)));
    if (authorized.length !== 1) return { error: "Which police station? Please provide the station name or station ID.", clarificationRequired: true };
    return { station: authorized[0] };
  }
  return { station: null };
}

function listOfficersByStation(db, text, actor, intent = officerIntent(text)) {
  const empty = { entities: [], officers: [], station: null };
  if (actor && !["Admin", "Police Officer"].includes(actor.role)) return { ...empty, answer: "Officer information requires authorized operational access.", scopeDenied: true };
  if (/\band response units?\b/i.test(text)) return { ...empty, answer: "Police officers and response units are different. Please ask about one at a time.", clarificationRequired: true };
  const scope = scopeStations(db, actor);
  let unit = null;
  if (intent === "OFFICERS_BY_UNIT") {
    const query = ` ${key(text)} `;
    const matches = rows(db, "responseUnits").filter((item) => [item.id, item.unitCode, item.unitId, item.name].filter(Boolean).some((id) => query.includes(` ${key(id)} `)));
    if (matches.length !== 1) return { ...empty, answer: "Please specify one valid response unit ID or code to list its police officers.", clarificationRequired: true };
    unit = matches[0];
  }
  const jurisdiction = intent === "OFFICERS_BY_JURISDICTION" ? key(text).match(/\bjurisdiction\s+(.+)$/)?.[1] || key(text).match(/(?:in|from)\s+(.+?)\s+jurisdiction/)?.[1] : null;
  const resolved = unit || intent === "OFFICERS_BY_JURISDICTION" ? { station: null } : resolveStation(db, text, scope);
  if (resolved.error) return { ...empty, answer: resolved.error, ...(resolved.scopeDenied ? { scopeDenied: true } : { clarificationRequired: true }) };
  const station = resolved.station;
  let records = roster(db).filter((officer) => (!scope || scope.has(String(officer.stationId)) || officer.userId === String(actor?.id)) && (!station || sameStation(station, officer.stationId)));
  if (unit) records = records.filter((officer) => officer.unitIds.includes(unit.id));
  if (intent === "OFFICERS_BY_JURISDICTION") {
    if (!jurisdiction) return { ...empty, answer: "Please specify a jurisdiction to list its police officers.", clarificationRequired: true };
    records = records.filter((officer) => key(officer.jurisdiction) === jurisdiction);
  }
  if (["POLICE_ACCOUNT_COUNT", "POLICE_ACCOUNT_LIST"].includes(intent)) {
    records = records.filter((officer) => officer.hasAccount);
    const summary = { total: records.length, active: records.filter((officer) => officer.accountActive).length, inactive: records.filter((officer) => !officer.accountActive).length, assignedUnits: new Set(records.flatMap((officer) => officer.unitIds)).size };
    const lines = [`Total police accounts: ${summary.total}`, `Active: ${summary.active}`, `Inactive: ${summary.inactive}`, `Assigned units: ${summary.assignedUnits}`];
    const shown = intent === "POLICE_ACCOUNT_LIST" ? records.slice(0, 20) : [];
    shown.forEach((officer, index) => lines.push(`${index + 1}. ${officer.name} — ${officer.accountActive ? "Active" : "Inactive"} — ${officer.stationName || "Station not recorded"} — ${officer.unitId || "Unassigned"}`));
    if (records.length > shown.length && shown.length) lines.push(`Showing ${shown.length} of ${records.length}.`);
    return { answer: lines.join("\n"), summary, matchedCount: records.length, station: station ? { id: station.id, name: nameOf(station) } : null, officers: shown, entities: shown.map((officer) => ({ type: "officer", id: officer.id })) };
  }
  const onDuty = (officer) => officer.active !== false && dutyKey(officer.dutyStatus) === "onduty";
  const available = (officer) => officer.active !== false && dutyKey(officer.availabilityStatus) === "available";
  const activeKnown = records.filter((officer) => officer.active !== null).length;
  const dutyKnown = records.filter((officer) => officer.dutyStatus !== null).length;
  const availabilityKnown = records.filter((officer) => officer.availabilityStatus !== null).length;
  const summary = { total: records.length, active: activeKnown ? records.filter((officer) => officer.active === true).length : null,
    onDuty: dutyKnown ? records.filter(onDuty).length : null, available: availabilityKnown ? records.filter(available).length : null,
    activeKnown, dutyKnown, availabilityKnown };
  let matches = records;
  if (/\bavailable\b/i.test(text)) matches = matches.filter(available);
  if (/\bon[ -]?duty\b/i.test(text)) matches = matches.filter(onDuty);
  if (/\bactive\b/i.test(text)) matches = matches.filter((officer) => officer.active === true);
  if (/\binactive\b/i.test(text)) matches = matches.filter((officer) => !officer.accountActive || officer.active === false);
  const stationName = station ? nameOf(station) : "All authorized stations";
  const metric = (count, known) => count === null ? "Not recorded" : `${count} (status recorded for ${known} of ${records.length})`;
  const lines = [`Station: ${stationName}`, `Total officers: ${summary.total}`, `Active officers: ${metric(summary.active, activeKnown)}`, `On-duty officers: ${metric(summary.onDuty, dutyKnown)}`, `Available officers: ${metric(summary.available, availabilityKnown)}`];
  lines.push("Counts reflect recorded assignments only, not physical presence.");
  if (station && !records.length) lines.push("No officers are recorded as assigned to this station. Unassigned accounts are not counted.");
  if (!station) {
    const byStation = new Map();
    for (const officer of records) {
      const found = rows(db, "policeStations").find((item) => sameStation(item, officer.stationId));
      const name = found ? nameOf(found) : officer.stationId || "Station not recorded";
      byStation.set(name, (byStation.get(name) || 0) + 1);
    }
    for (const [name, count] of byStation) lines.push(`${name}: ${count}`);
  }
  lines.push(`Matching officers: ${matches.length}`, "Officer details:");
  const shown = matches.slice(0, 20).map((officer) => {
    const assignedStation = rows(db, "policeStations").find((item) => sameStation(item, officer.stationId));
    return { ...officer, stationName: assignedStation ? nameOf(assignedStation) : null };
  });
  shown.forEach((officer, index) => lines.push(`${index + 1}. ${officer.name} (${officer.badgeId || officer.id}) — ${officer.stationName || "Station not recorded"} — Active: ${officer.active === null ? "Not recorded" : officer.active ? "Yes" : "No"} — Duty: ${officer.dutyStatus || "Not recorded"} — Availability: ${officer.availabilityStatus || "Not recorded"}`));
  if (!matches.length) lines.push("No matching officers in the authorized roster.");
  if (matches.length > shown.length) lines.push(`Showing ${shown.length} of ${matches.length} officers; totals include the complete authorized roster.`);
  return { answer: lines.join("\n"), station: station ? { id: station.id || station.stationId, name: stationName } : null,
    summary, matchedCount: matches.length, officers: shown, entities: shown.map((officer) => ({ type: "officer", id: officer.id })) };
}

function canReadOfficer(db, actor, reference) {
  if (!actor) return true;
  const scope = scopeStations(db, actor);
  return roster(db).some((officer) => [officer.id, officer.userId, officer.badgeId].some((id) => id && String(id).toLowerCase() === String(reference).toLowerCase()) && (!scope || scope.has(String(officer.stationId))));
}

function policeManagementUsers(db) {
  const profiles = new Map(roster(db).map((officer) => [officer.userId, officer]));
  return rows(db, "users").filter((user) => user.role === "Police Officer").map((user) => {
    const profile = profiles.get(String(user.id));
    const officer = rows(db, "policeOfficers").find((item) => String(personId(item)) === String(user.id));
    const rank = rows(db, "officerRanks").find((item) => item.id === value(officer, "rankId", "rank_id"));
    const explicitDeployments = activeOfficerDeployments(db, { officerId: user.id });
    const officerUnitIds = new Set((db.responseUnitMembers || []).filter((m) => String(m.officerUserId || m.officer_user_id) === String(user.id)).map((m) => m.unitId || m.unit_id));
    const unitDeployments = rows(db, "incidents").filter((incident) => !["closed", "resolved", "rejected / false alarm"].includes(String(incident?.status || "").toLowerCase()) && officerUnitIds.has(incident.assignedUnitId || incident.assigned_unit_id)).map((incident) => {
      const unit = rows(db, "responseUnits").find((u) => u.id === incident.assignedUnitId || u.id === incident.assigned_unit_id);
      return { id: incident.id, assignmentId: null, type: incident.type || incident.category || incident.title || null, status: incident.status, responseRole: null, unitId: incident.assignedUnitId || incident.assigned_unit_id, unitCode: unit?.unitCode || unit?.unitId || incident.assignedUnitId || incident.assigned_unit_id };
    });
    const deployments = [...explicitDeployments, ...unitDeployments].map((deployment) => {
      const incident = rows(db, "incidents").find((item) => item.id === deployment.incidentId || item.id === deployment.id);
      const depId = deployment.incidentId || deployment.id;
      return { id: depId, assignmentId: deployment.assignmentId || deployment.id, type: incident?.type || incident?.category || incident?.title || null, status: deployment.status || incident?.status, responseRole: deployment.responseRole, unitId: deployment.unitId, unitCode: deployment.unitCode || rows(db, "responseUnits").find((unit) => unit.id === deployment.unitId)?.unitCode || deployment.unitId };
    });
    const assignedIncidentId = value(officer, "assignedIncidentId", "assigned_incident_id");
    const supportDeployments = rows(db, "incidents").flatMap((incident) => {
      if (!assignedIncidentId || String(incident.id) !== String(assignedIncidentId) || incident.resourcesReleasedAt || ["closed", "resolved", "rejected / false alarm"].includes(String(incident.status || "").toLowerCase())) return [];
      // Support is a distinct commitment; never infer it from permanent membership.
      const allocation = (incident.supportAllocations || []).find((item) => (item.officerIds || []).some((id) => String(id) === String(user.id)));
      if (!allocation) return [];
      return [{ id: incident.id, station: allocation.stationName || allocation.stationCode || allocation.stationId || null, homeStation: profile?.stationName || null, reason: allocation.reason || null, source: "Hybrid Dispatch" }];
    });
    const investigations = rows(db, "incidents").filter((incident) => String(value(incident, "investigatingOfficerId", "investigating_officer_id") || "") === String(user.id)).map((incident) => ({ id: incident.id, type: incident.type || incident.category || incident.title || null, status: value(incident, "investigationStatus", "investigation_status") || null, assignedAt: value(incident, "investigationStartedAt", "investigation_started_at") || null, updatedAt: value(incident, "lastInvestigationUpdateAt", "last_investigation_update_at") || null }));
    return { ...profile, id: user.id, name: user.name, email: user.email, role: user.role,
      rank: rank?.name || rank?.code || null, deployments, supportDeployments, investigations,
      station: profile?.stationName || user.station || "", badgeId: profile?.badgeId || "", unitId: profile?.unitId || "",
      status: profile?.accountActive ? "active" : "inactive", active: profile?.accountActive,
      createdBy: user.createdBy || null, createdAt: user.createdAt || null, updatedAt: profile?.updatedAt || user.updatedAt || null };
  });
}

module.exports = { isOfficerCollectionQuery, officerIntent, listOfficersByStation, canReadOfficer, policeManagementUsers, operationalAvailability };
