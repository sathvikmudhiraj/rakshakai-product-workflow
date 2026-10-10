const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "sla_config",
  jsonKey: "slaConfig",
  columns: [
    { name: "severity", value: (item) => item.severity || "" },
    { name: "assignment_sla_minutes", value: (item) => Number(item.assignmentSlaMinutes || item.assignment_sla_minutes || 30) },
    { name: "response_sla_minutes", value: (item) => Number(item.responseSlaMinutes || item.response_sla_minutes || 120) },
    { name: "warning_before_assignment_minutes", value: (item) => Number(item.warningBeforeAssignmentMinutes || item.warning_before_assignment_minutes || 1) },
    { name: "warning_before_response_minutes", value: (item) => Number(item.warningBeforeResponseMinutes || item.warning_before_response_minutes || 5) },
    { name: "escalation_l1_interval_minutes", value: (item) => Number(item.escalationL1IntervalMinutes || item.escalation_l1_interval_minutes || 5) },
    { name: "escalation_l2_interval_minutes", value: (item) => Number(item.escalationL2IntervalMinutes || item.escalation_l2_interval_minutes || 5) },
    { name: "escalation_l3_interval_minutes", value: (item) => Number(item.escalationL3IntervalMinutes || item.escalation_l3_interval_minutes || 10) },
    { name: "escalation_l4_interval_minutes", value: (item) => Number(item.escalationL4IntervalMinutes || item.escalation_l4_interval_minutes || 15) },
    { name: "investigation_inactivity_threshold_hours", value: (item) => Number(item.investigationInactivityThresholdHours || item.investigation_inactivity_threshold_hours || 24) },
    { name: "active", value: (item) => Boolean(item.active !== undefined ? item.active : true) }
  ],
  serialize: (record) => record,
  deserialize: (row) => ({
    ...row.data,
    id: row.id,
    severity: row.data?.severity || row.severity || "",
    assignmentSlaMinutes: row.data?.assignment_sla_minutes ?? row.assignment_sla_minutes ?? 30,
    assignment_sla_minutes: row.data?.assignment_sla_minutes ?? row.assignment_sla_minutes ?? 30,
    responseSlaMinutes: row.data?.response_sla_minutes ?? row.response_sla_minutes ?? 120,
    response_sla_minutes: row.data?.response_sla_minutes ?? row.response_sla_minutes ?? 120,
    warningBeforeAssignmentMinutes: row.data?.warning_before_assignment_minutes ?? row.warning_before_assignment_minutes ?? 1,
    warning_before_assignment_minutes: row.data?.warning_before_assignment_minutes ?? row.warning_before_assignment_minutes ?? 1,
    warningBeforeResponseMinutes: row.data?.warning_before_response_minutes ?? row.warning_before_response_minutes ?? 5,
    warning_before_response_minutes: row.data?.warning_before_response_minutes ?? row.warning_before_response_minutes ?? 5,
    escalationL1IntervalMinutes: row.data?.escalation_l1_interval_minutes ?? row.escalation_l1_interval_minutes ?? 5,
    escalation_l1_interval_minutes: row.data?.escalation_l1_interval_minutes ?? row.escalation_l1_interval_minutes ?? 5,
    escalationL2IntervalMinutes: row.data?.escalation_l2_interval_minutes ?? row.escalation_l2_interval_minutes ?? 5,
    escalation_l2_interval_minutes: row.data?.escalation_l2_interval_minutes ?? row.escalation_l2_interval_minutes ?? 5,
    escalationL3IntervalMinutes: row.data?.escalation_l3_interval_minutes ?? row.escalation_l3_interval_minutes ?? 10,
    escalation_l3_interval_minutes: row.data?.escalation_l3_interval_minutes ?? row.escalation_l3_interval_minutes ?? 10,
    escalationL4IntervalMinutes: row.data?.escalation_l4_interval_minutes ?? row.escalation_l4_interval_minutes ?? 15,
    escalation_l4_interval_minutes: row.data?.escalation_l4_interval_minutes ?? row.escalation_l4_interval_minutes ?? 15,
    investigationInactivityThresholdHours: row.data?.investigation_inactivity_threshold_hours ?? row.investigation_inactivity_threshold_hours ?? 24,
    investigation_inactivity_threshold_hours: row.data?.investigation_inactivity_threshold_hours ?? row.investigation_inactivity_threshold_hours ?? 24,
    active: row.data?.active ?? row.active ?? true
  })
});