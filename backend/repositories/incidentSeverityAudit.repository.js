const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "incident_severity_audit",
  jsonKey: "incidentSeverityAudit",
  appendOnly: true,
  columns: [
    { name: "incident_id", value: (item) => item.incidentId || item.incident_id || "" },
    { name: "previous_severity", value: (item) => item.previousSeverity || item.previous_severity || null },
    { name: "new_severity", value: (item) => item.newSeverity || item.new_severity || "" },
    { name: "overridden_by", value: (item) => item.overriddenBy || item.overridden_by || null },
    { name: "reason", value: (item) => item.reason || null },
    { name: "overridden_at", value: (item) => dateValue(item.overriddenAt || item.createdAt) }
  ],
  serialize: (record) => record,
  deserialize: (row) => ({
    ...row.data,
    id: row.id,
    incidentId: row.data?.incident_id || row.incident_id || "",
    incident_id: row.data?.incident_id || row.incident_id || "",
    previousSeverity: row.data?.previous_severity || row.previous_severity || null,
    previous_severity: row.data?.previous_severity || row.previous_severity || null,
    newSeverity: row.data?.new_severity || row.new_severity || "",
    new_severity: row.data?.new_severity || row.new_severity || "",
    overriddenBy: row.data?.overridden_by || row.overridden_by || null,
    overridden_by: row.data?.overridden_by || row.overridden_by || null,
    reason: row.data?.reason || row.reason || null,
    createdAt: row.data?.overriddenAt || row.data?.createdAt || row.overridden_at || null,
    overriddenAt: row.data?.overriddenAt || row.data?.createdAt || row.overridden_at || null
  })
});
