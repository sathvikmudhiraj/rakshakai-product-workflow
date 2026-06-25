const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "alerts",
  jsonKey: "alerts",
  columns: [
    { name: "incident_id", value: (item) => item.incidentId || null },
    { name: "status", value: (item) => item.status || "New" },
    { name: "acknowledged", value: (item) => Boolean(item.acknowledged) },
    { name: "created_at", value: (item) => dateValue(item.createdAt || item.timestamp) },
    { name: "updated_at", value: (item) => dateValue(item.lastDetectedAt || item.acknowledgedAt || item.createdAt) }
  ]
});
