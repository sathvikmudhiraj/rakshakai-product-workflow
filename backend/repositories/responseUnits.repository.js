const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "response_units",
  jsonKey: "responseUnits",
  columns: [
    { name: "status", value: (item) => item.status || "offline" },
    { name: "assigned_incident_id", value: (item) => item.assignedIncidentId || null },
    { name: "updated_at", value: (item) => dateValue(item.lastUpdated) }
  ]
});
