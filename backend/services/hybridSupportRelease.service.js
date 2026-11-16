// Mutates only support allocations for a single incident. Primary responders
// and resources referenced by another active incident are never released.
function releaseHybridSupportResources(db, incident, releasedAt) {
  const allocations = incident.supportAllocations || incident.support_allocations || [];
  if (!allocations.length) return { units: [], officers: [], allocations: [] };
  const primaryUnitId = incident.assignedUnitId || incident.assigned_unit_id;
  const activeOthers = (db.incidents || []).filter((other) => other.id !== incident.id && !['closed', 'resolved', 'rejected / false alarm'].includes(String(other.status || '').toLowerCase()));
  const otherUnits = new Set(activeOthers.flatMap((other) => [other.assignedUnitId || other.assigned_unit_id, ...(other.supportAllocations || other.support_allocations || []).flatMap((allocation) => allocation.unitIds || [])]));
  const otherOfficers = new Set(activeOthers.flatMap((other) => [...(other.dispatchRecommendation?.primary?.officerIds || []), ...(other.supportAllocations || other.support_allocations || []).flatMap((allocation) => allocation.officerIds || [])]));
  for (const member of db.responseUnitMembers || []) if (member.active !== false && otherUnits.has(member.unitId || member.unit_id)) otherOfficers.add(member.officerUserId || member.officer_user_id);
  const unitIds = new Set(allocations.flatMap((allocation) => allocation.unitIds || []));
  const officerIds = new Set(allocations.flatMap((allocation) => allocation.officerIds || []));
  if ([...unitIds].some((id) => id !== primaryUnitId && otherUnits.has(id)) || [...officerIds].some((id) => otherOfficers.has(id))) {
    return { units: [], officers: [], allocations: [], conflict: true };
  }
  if ((db.responseUnits || []).some((unit) => unitIds.has(unit.id) && unit.id !== primaryUnitId && (unit.assignedIncidentId || unit.assigned_incident_id || unit.currentIncidentId) && (unit.assignedIncidentId || unit.assigned_incident_id || unit.currentIncidentId) !== incident.id)
    || (db.policeOfficers || []).some((officer) => { const id = officer.userId || officer.user_id || officer.id; const assigned = officer.assignedIncidentId || officer.assigned_incident_id; return officerIds.has(id) && assigned && assigned !== incident.id; })) {
    return { units: [], officers: [], allocations: [], conflict: true };
  }
  const units = (db.responseUnits || []).filter((unit) => unitIds.has(unit.id) && unit.id !== primaryUnitId && !otherUnits.has(unit.id) && (unit.assignedIncidentId || unit.assigned_incident_id || unit.currentIncidentId) === incident.id);
  const officers = (db.policeOfficers || []).filter((officer) => {
    const id = officer.userId || officer.user_id || officer.id;
    return officerIds.has(id) && !otherOfficers.has(id) && (officer.assignedIncidentId || officer.assigned_incident_id) === incident.id;
  });
  for (const unit of units) Object.assign(unit, { status: 'available', assignedIncidentId: null, assigned_incident_id: null, currentIncidentId: null, lastUpdated: releasedAt });
  for (const officer of officers) {
    const duty = String(officer.dutyStatus || officer.duty_status || '').toLowerCase().replace(/[ -]/g, '_');
    const availability = officer.active === false || ['off_duty', 'leave', 'suspended'].includes(duty) ? 'unavailable' : 'available';
    Object.assign(officer, { availabilityStatus: availability, availability_status: availability, assignedIncidentId: null, assigned_incident_id: null, updatedAt: releasedAt, lastUpdated: releasedAt });
  }
  incident.supportAllocations = [];
  incident.support_allocations = [];
  if (incident.dispatchRecommendation?.stationSupport) incident.dispatchRecommendation = { ...incident.dispatchRecommendation, stationSupport: { ...incident.dispatchRecommendation.stationSupport, allocations: [] } };
  if (incident.dispatch_recommendation?.stationSupport) incident.dispatch_recommendation = { ...incident.dispatch_recommendation, stationSupport: { ...incident.dispatch_recommendation.stationSupport, allocations: [] } };
  incident.supportReleaseHistory = [...(incident.supportReleaseHistory || []), { releasedAt, allocations }];
  incident.updatedAt = releasedAt;
  return { units, officers, allocations };
}
module.exports = { releaseHybridSupportResources };
