function primaryUnitRequired(incident = {}) {
  if (incident.assignedUnitId || incident.assigned_unit_id) return null;
  return {
    status: 409,
    payload: {
      error: "Assign a primary response unit before requesting hybrid support",
      code: "PRIMARY_UNIT_REQUIRED"
    }
  };
}

function canCreateHybridSupport(incident = {}) {
  return primaryUnitRequired(incident) === null;
}

module.exports = { canCreateHybridSupport, primaryUnitRequired };
