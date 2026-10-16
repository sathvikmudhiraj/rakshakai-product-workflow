function normalized(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function boundedCount(value, fallback, maximum = 50) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? Math.min(number, maximum) : fallback;
}

function responseRequirementsForIncident(incident = {}) {
  const explicit = incident.responseRequirements || incident.response_requirements || {};
  const severity = normalized(incident.severity);
  const defaults = {
    critical: { supportingOfficers: 4, responseUnits: 2 },
    high: { supportingOfficers: 3, responseUnits: 1 },
    medium: { supportingOfficers: 2, responseUnits: 1 },
    low: { supportingOfficers: 1, responseUnits: 1 }
  }[severity] || { supportingOfficers: 2, responseUnits: 1 };
  return {
    primaryResponderRequired: explicit.primaryResponderRequired !== false,
    supportingOfficers: boundedCount(explicit.supportingOfficers, defaults.supportingOfficers),
    responseUnits: boundedCount(explicit.responseUnits, defaults.responseUnits),
    requiredCapabilities: Array.isArray(explicit.requiredCapabilities)
      ? explicit.requiredCapabilities
      : Array.isArray(incident.requiredCapabilities || incident.required_capabilities)
        ? incident.requiredCapabilities || incident.required_capabilities
        : []
  };
}

function stationIdentifiers(station = {}) {
  return new Set([station.id, station.stationId, station.stationCode].filter(Boolean).map((value) => String(value).toLowerCase()));
}

function belongsToStation(record = {}, station = {}) {
  const identifiers = stationIdentifiers(station);
  return [record.stationId, record.station_id, record.linkedStationId]
    .filter(Boolean)
    .some((value) => identifiers.has(String(value).toLowerCase()));
}

function officerUserId(officer = {}) {
  return officer.userId || officer.user_id || officer.id || null;
}

function officerUnavailableReason(officer, user, db, reservedOfficerIds, incidentId) {
  const id = officerUserId(officer);
  if (!id || reservedOfficerIds.has(id)) return "ALREADY ASSIGNED";
  if (!user || user.role !== "Police Officer" || user.status === "inactive" || officer.active === false) return "OFF DUTY";
  if (["off_duty", "leave", "suspended"].includes(normalized(officer.dutyStatus || officer.duty_status))) return "OFF DUTY";
  if (["busy", "unavailable"].includes(normalized(officer.availabilityStatus || officer.availability_status))) return "BUSY";
  const assignedIncidentId = officer.assignedIncidentId || officer.assigned_incident_id;
  if (assignedIncidentId && assignedIncidentId !== incidentId) return "ALREADY ASSIGNED";
  const memberships = (db.responseUnitMembers || []).filter((member) => (member.officerUserId || member.officer_user_id) === id);
  const occupied = memberships.some((member) => {
    const unitId = member.unitId || member.unit_id;
    const unit = (db.responseUnits || []).find((candidate) => candidate.id === unitId);
    const linkedIncident = unit?.assignedIncidentId || unit?.currentIncidentId;
    return unit && (["busy", "assigned", "maintenance", "decommissioned", "offline"].includes(normalized(unit.status))
      || (linkedIncident && linkedIncident !== incidentId));
  });
  return occupied ? "BUSY" : "";
}

function unitUnavailableReason(unit, reservedUnitIds, incidentId) {
  if (!unit?.id || reservedUnitIds.has(unit.id)) return "ALREADY ASSIGNED";
  const status = normalized(unit.status);
  if (["maintenance", "decommissioned", "offline", "busy", "assigned"].includes(status)) return status.toUpperCase();
  if (status !== "available" || unit.operational === false) return "OFFLINE";
  const linkedIncident = unit.assignedIncidentId || unit.currentIncidentId;
  return linkedIncident && linkedIncident !== incidentId ? "ALREADY ASSIGNED" : "";
}

function unitSupportsCapabilities(unit, db, requiredCapabilities = []) {
  if (!requiredCapabilities.length) return true;
  const capabilities = (db.unitCapabilities || []).filter((capability) => (capability.unitId || capability.unit_id) === unit.id);
  return requiredCapabilities.every((required) => capabilities.some((capability) => {
    const type = capability.capabilityType || capability.capability_type;
    return type === (required.type || required.capabilityType || required.capability_type)
      && (!required.subtype || capability.subtype === required.subtype)
      && Number(capability.level || 1) >= Number(required.level || 1);
  }));
}

function stationCapacitySnapshot(db, station, { reservedOfficerIds = new Set(), reservedUnitIds = new Set(), incidentId = null, requiredCapabilities = [] } = {}) {
  const officers = (db.policeOfficers || []).filter((officer) => belongsToStation(officer, station));
  const deployableOfficers = officers.filter((officer) => {
    const user = (db.users || []).find((candidate) => candidate.id === officerUserId(officer));
    return !officerUnavailableReason(officer, user, db, reservedOfficerIds, incidentId);
  });
  const units = (db.responseUnits || []).filter((unit) => belongsToStation(unit, station));
  const deployableUnits = units.filter((unit) => !unitUnavailableReason(unit, reservedUnitIds, incidentId)
    && unitSupportsCapabilities(unit, db, requiredCapabilities));
  const activeIncidentIds = new Set(
    (db.incidents || [])
      .filter((incident) => !["closed", "rejected_/_false_alarm"].includes(normalized(incident.status)))
      .flatMap((incident) => [incident.assignedUnitId, ...(incident.supportAllocations || []).flatMap((allocation) => allocation.unitIds || [])])
      .filter(Boolean)
  );
  const workload = units.filter((unit) => activeIncidentIds.has(unit.id)).length;
  return {
    officerIds: deployableOfficers.map(officerUserId),
    unitIds: deployableUnits.map((unit) => unit.id),
    totalOfficers: officers.length,
    availableOfficers: deployableOfficers.length,
    totalUnits: units.length,
    availableUnits: deployableUnits.length,
    workload
  };
}

function stationJurisdictionRank(station, incident) {
  const stationJurisdiction = normalized(station.jurisdiction);
  const incidentJurisdiction = normalized(incident.jurisdiction || incident.zone);
  const stationBeats = [station.beat, ...(station.sectorCoverage || [])].map(normalized).filter(Boolean);
  const incidentBeat = normalized(incident.beat || incident.zone);
  if (stationBeats.includes(incidentBeat)) return 0;
  if (stationJurisdiction && incidentJurisdiction && stationJurisdiction === incidentJurisdiction) return 1;
  return 2;
}

function primaryJurisdictionRank(candidate = {}) {
  const eligibility = candidate.stationEligibility || {};
  return eligibility.stationMatch ? 0 : eligibility.beatMatch ? 1 : eligibility.jurisdictionMatch ? 2 : 3;
}

function comparePrimaryDispatchCandidates(left, right) {
  return left.etaSeconds - right.etaSeconds
    || left.route.distanceMeters - right.route.distanceMeters
    || primaryJurisdictionRank(left) - primaryJurisdictionRank(right)
    || Number(Boolean(right.capabilityMatch?.matches)) - Number(Boolean(left.capabilityMatch?.matches))
    || left.loadScore - right.loadScore
    || left.sourcePriority - right.sourcePriority
    || String(left.unit?.unitCode || left.unit?.id || "").localeCompare(String(right.unit?.unitCode || right.unit?.id || ""));
}

async function recommendStationSupport({ db, incident, primaryUnitId = null, requirements, routeForStation }) {
  const reservedUnitIds = new Set(primaryUnitId ? [primaryUnitId] : []);
  const reservedOfficerIds = new Set(
    (db.responseUnitMembers || [])
      .filter((member) => (member.unitId || member.unit_id) === primaryUnitId)
      .map((member) => member.officerUserId || member.officer_user_id)
      .filter(Boolean)
  );
  const candidates = [];
  for (const station of db.policeStations || []) {
    if (station.operational === false) {
      candidates.push({ stationId: station.id, stationName: station.stationName || station.name, eligible: false, rejectionReason: "OFFLINE" });
      continue;
    }
    const pointAvailable = Number.isFinite(Number(station.lat ?? station.latitude)) && Number.isFinite(Number(station.lng ?? station.longitude));
    if (!pointAvailable) {
      candidates.push({ stationId: station.id, stationName: station.stationName || station.name, eligible: false, rejectionReason: "INVALID GPS" });
      continue;
    }
    const capacity = stationCapacitySnapshot(db, station, {
      reservedOfficerIds,
      reservedUnitIds,
      incidentId: incident.id,
      requiredCapabilities: requirements.requiredCapabilities
    });
    const route = await routeForStation(station);
    const etaSeconds = Number(route?.durationSeconds) || null;
    const distanceMeters = Number(route?.distanceMeters) || null;
    const candidate = {
      stationId: station.id,
      stationCode: station.stationId || station.stationCode || station.id,
      stationName: station.stationName || station.name || "Police Station",
      lat: Number(station.lat ?? station.latitude),
      lng: Number(station.lng ?? station.longitude),
      jurisdiction: station.jurisdiction || "",
      ...capacity,
      eligible: capacity.availableOfficers > 0 || capacity.availableUnits > 0,
      rejectionReason: capacity.availableOfficers <= 0 && requirements.supportingOfficers > 0
        ? "INSUFFICIENT CAPACITY"
        : capacity.availableUnits <= 0 && requirements.responseUnits > 0
          ? "NO AVAILABLE UNIT"
          : "",
      jurisdictionRank: stationJurisdictionRank(station, incident),
      etaSeconds,
      etaMinutes: etaSeconds ? Math.max(1, Math.round(etaSeconds / 60)) : null,
      distanceMeters,
      distanceKm: distanceMeters ? Number((distanceMeters / 1000).toFixed(2)) : null,
      route,
      approximate: Boolean(route?.approximate)
    };
    candidates.push(candidate);
  }
  const eligible = candidates.filter((candidate) => candidate.eligible && candidate.etaSeconds && candidate.distanceMeters).sort((left, right) =>
    left.etaSeconds - right.etaSeconds
      || left.distanceMeters - right.distanceMeters
      || left.jurisdictionRank - right.jurisdictionRank
      || left.workload - right.workload
      || String(left.stationCode).localeCompare(String(right.stationCode))
  );
  let officersRemaining = requirements.supportingOfficers;
  let unitsRemaining = requirements.responseUnits;
  const allocations = [];
  for (const candidate of eligible) {
    if (officersRemaining <= 0 && unitsRemaining <= 0) break;
    const officerCount = Math.min(officersRemaining, candidate.availableOfficers);
    const unitCount = Math.min(unitsRemaining, candidate.availableUnits);
    if (officerCount <= 0 && unitCount <= 0) continue;
    const officerIds = candidate.officerIds.slice(0, officerCount);
    const unitIds = candidate.unitIds.slice(0, unitCount);
    officerIds.forEach((id) => reservedOfficerIds.add(id));
    unitIds.forEach((id) => reservedUnitIds.add(id));
    allocations.push({
      stationId: candidate.stationId,
      stationCode: candidate.stationCode,
      stationName: candidate.stationName,
      lat: candidate.lat,
      lng: candidate.lng,
      availableOfficers: candidate.availableOfficers,
      availableUnits: candidate.availableUnits,
      recommendedOfficers: officerCount,
      recommendedUnits: unitCount,
      officerIds,
      unitIds,
      etaMinutes: candidate.etaMinutes,
      distanceKm: candidate.distanceKm,
      approximate: candidate.approximate,
      route: candidate.route,
      reason: allocations.length ? "Additional capacity required after nearer stations" : "Nearest station with deployable capacity"
    });
    officersRemaining -= officerCount;
    unitsRemaining -= unitCount;
  }
  return {
    allocations,
    candidates: candidates.map(({ officerIds, unitIds, route, ...candidate }) => candidate),
    officersRemaining,
    unitsRemaining,
    complete: officersRemaining === 0 && unitsRemaining === 0,
    reason: allocations.length
      ? officersRemaining || unitsRemaining ? "Available stations provide partial support only" : allocations.length > 1 ? "Multiple stations required to satisfy capacity" : "Nearest capable station selected"
      : "No capable station resources available"
  };
}

module.exports = {
  belongsToStation,
  comparePrimaryDispatchCandidates,
  officerUnavailableReason,
  recommendStationSupport,
  responseRequirementsForIncident,
  stationCapacitySnapshot,
  unitUnavailableReason
};
