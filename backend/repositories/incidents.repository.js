const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "incidents",
  jsonKey: "incidents",
  columns: [
    { name: "status", value: (item) => item.status || "New" },
    { name: "severity", value: (item) => item.severity || null },
    { name: "occurrence_count", value: (item) => Math.max(1, Number(item.occurrenceCount) || 1) },
    { name: "created_at", value: (item) => dateValue(item.createdAt || item.openedAt) },
    { name: "updated_at", value: (item) => dateValue(item.lastDetectedAt || item.updatedAt || item.createdAt) }
  ]
});
