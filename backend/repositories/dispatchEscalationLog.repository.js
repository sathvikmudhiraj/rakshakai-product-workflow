const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "dispatch_escalation_log",
  jsonKey: "dispatchEscalationLogs",
  columns: [
    { name: "incident_id", value: (item) => item.incidentId || item.incident_id || "" },
    { name: "primary_unit_id", value: (item) => item.primaryUnitId || item.primary_unit_id || "" },
    { name: "escalation_rule_id", value: (item) => item.escalationRuleId || item.escalation_rule_id || null },
    { name: "trigger_type", value: (item) => item.triggerType || item.trigger_type || "" },
    { name: "escalated_at", value: (item) => dateValue(item.escalatedAt) },
    { name: "backup_units_dispatched", value: (item) => item.backupUnitsDispatched || item.backup_units_dispatched || [] },
    { name: "primary_unit_responded", value: (item) => Boolean(item.primaryUnitResponded || item.primary_unit_responded || false) },
    { name: "resolved_at", value: (item) => dateValue(item.resolvedAt) }
  ],
  serialize: (record) => record,
  deserialize: (row) => ({
    ...row.data,
    id: row.id,
    incidentId: row.data?.incident_id || row.incident_id || "",
    incident_id: row.data?.incident_id || row.incident_id || "",
    primaryUnitId: row.data?.primary_unit_id || row.primary_unit_id || "",
    primary_unit_id: row.data?.primary_unit_id || row.primary_unit_id || "",
    escalationRuleId: row.data?.escalation_rule_id || row.escalation_rule_id || null,
    escalation_rule_id: row.data?.escalation_rule_id || row.escalation_rule_id || null,
    triggerType: row.data?.trigger_type || row.trigger_type || "",
    trigger_type: row.data?.trigger_type || row.trigger_type || "",
    escalatedAt: row.data?.escalatedAt || row.escalated_at || null,
    escalated_at: row.data?.escalatedAt || row.escalated_at || null,
    backupUnitsDispatched: row.data?.backup_units_dispatched || row.backup_units_dispatched || [],
    backup_units_dispatched: row.data?.backup_units_dispatched || row.backup_units_dispatched || [],
    primaryUnitResponded: row.data?.primary_unit_responded ?? row.primary_unit_responded ?? false,
    primary_unit_responded: row.data?.primary_unit_responded ?? row.primary_unit_responded ?? false,
    resolvedAt: row.data?.resolvedAt || row.resolved_at || null,
    resolved_at: row.data?.resolvedAt || row.resolved_at || null
  })
});