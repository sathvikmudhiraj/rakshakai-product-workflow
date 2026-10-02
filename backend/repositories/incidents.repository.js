const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "incidents",
  jsonKey: "incidents",
  columns: [
    { name: "status", value: (item) => item.status || "New" },
    { name: "severity", value: (item) => item.severity || null },
    { name: "occurrence_count", value: (item) => Math.max(1, Number(item.occurrenceCount) || 1) },
    { name: "assigned_unit_id", value: (item) => item.assignedUnitId || item.assigned_unit_id || null },
    { name: "required_capabilities", value: (item) => {
      const value = item.requiredCapabilities || item.required_capabilities;
      return Array.isArray(value) ? JSON.stringify(value) : "[]";
    } },
    { name: "escalation_status", value: (item) => item.escalationStatus || item.escalation_status || "none" },
    { name: "escalation_started_at", value: (item) => (item.escalationStartedAt || item.escalation_started_at ? dateValue(item.escalationStartedAt || item.escalation_started_at) : null) },
    { name: "primary_unit_acked_at", value: (item) => (item.primaryUnitAckedAt || item.primary_unit_acked_at ? dateValue(item.primaryUnitAckedAt || item.primary_unit_acked_at) : null) },
    { name: "created_at", value: (item) => dateValue(item.createdAt || item.openedAt) },
    { name: "updated_at", value: (item) => dateValue(item.lastDetectedAt || item.updatedAt || item.createdAt) }
  ],
  serialize: (record) => {
    const { assignedUnitId, requiredCapabilities, escalationStatus, escalationStartedAt, primaryUnitAckedAt, ...rest } = record;
    return rest;
  },
  deserialize: (row) => ({
    ...row.data,
    id: row.id,
    status: row.data?.status || row.status || "New",
    severity: row.data?.severity || row.severity || null,
    occurrenceCount: row.data?.occurrence_count ?? row.occurrence_count ?? 1,
    assignedUnitId: row.data?.assigned_unit_id || row.assigned_unit_id || null,
    assigned_unit_id: row.data?.assigned_unit_id || row.assigned_unit_id || null,
    requiredCapabilities: row.data?.required_capabilities || row.required_capabilities || [],
    required_capabilities: row.data?.required_capabilities || row.required_capabilities || [],
    escalationStatus: row.data?.escalation_status || row.escalation_status || "none",
    escalation_status: row.data?.escalation_status || row.escalation_status || "none",
    escalationStartedAt: row.data?.escalation_started_at || row.escalation_started_at || null,
    escalation_started_at: row.data?.escalation_started_at || row.escalation_started_at || null,
    primaryUnitAckedAt: row.data?.primary_unit_acked_at || row.primary_unit_acked_at || null,
    primary_unit_acked_at: row.data?.primary_unit_acked_at || row.primary_unit_acked_at || null,
    createdAt: row.data?.createdAt || row.created_at || null,
    updatedAt: row.data?.updatedAt || row.updated_at || null,
    lastDetectedAt: row.data?.lastDetectedAt || row.updated_at || null
  })
});
