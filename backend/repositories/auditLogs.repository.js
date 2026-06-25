const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "audit_logs",
  jsonKey: "auditLogs",
  columns: [
    { name: "incident_id", value: (item) => item.incidentId || null },
    { name: "actor_id", value: (item) => item.actorId || null },
    { name: "action", value: (item) => item.action || "unknown" },
    { name: "created_at", value: (item) => dateValue(item.timestamp || item.createdAt) }
  ]
});
