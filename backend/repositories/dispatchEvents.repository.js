const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "dispatch_events",
  jsonKey: "dispatchEvents",
  columns: [
    { name: "incident_id", value: (item) => item.incidentId },
    { name: "event_type", value: (item) => item.type || null },
    { name: "created_at", value: (item) => dateValue(item.createdAt) }
  ]
});
