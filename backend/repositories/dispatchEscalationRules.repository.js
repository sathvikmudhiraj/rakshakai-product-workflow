const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "dispatch_escalation_rules",
  jsonKey: "dispatchEscalationRules",
  columns: [
    { name: "capability_type", value: (item) => item.capabilityType || item.capability_type || "" },
    { name: "unit_subtype", value: (item) => item.unitSubtype || item.unit_subtype || null },
    { name: "escalation_type", value: (item) => item.escalationType || item.escalation_type || "no_ack" },
    { name: "timeout_seconds", value: (item) => Number(item.timeoutSeconds || item.timeout_seconds || 60) },
    { name: "backup_strategy", value: (item) => item.backupStrategy || item.backup_strategy || "hybrid" },
    { name: "backup_count", value: (item) => Number(item.backupCount || item.backup_count || 1) },
    { name: "requires_specialized_backup", value: (item) => Boolean(item.requiresSpecializedBackup || item.requires_specialized_backup || false) },
    { name: "active", value: (item) => Boolean(item.active !== undefined ? item.active : true) }
  ],
  serialize: (record) => record,
  deserialize: (row) => ({
    ...row.data,
    id: row.id,
    capabilityType: row.data?.capability_type || row.capability_type || "",
    capability_type: row.data?.capability_type || row.capability_type || "",
    unitSubtype: row.data?.unit_subtype || row.unit_subtype || null,
    unit_subtype: row.data?.unit_subtype || row.unit_subtype || null,
    escalationType: row.data?.escalation_type || row.escalation_type || "no_ack",
    escalation_type: row.data?.escalation_type || row.escalation_type || "no_ack",
    timeoutSeconds: row.data?.timeout_seconds ?? row.timeout_seconds ?? 60,
    timeout_seconds: row.data?.timeout_seconds ?? row.timeout_seconds ?? 60,
    backupStrategy: row.data?.backup_strategy || row.backup_strategy || "hybrid",
    backup_strategy: row.data?.backup_strategy || row.backup_strategy || "hybrid",
    backupCount: row.data?.backup_count ?? row.backup_count ?? 1,
    backup_count: row.data?.backup_count ?? row.backup_count ?? 1,
    requiresSpecializedBackup: row.data?.requires_specialized_backup ?? row.requires_specialized_backup ?? false,
    requires_specialized_backup: row.data?.requires_specialized_backup ?? row.requires_specialized_backup ?? false,
    active: row.data?.active ?? row.active ?? true
  })
});