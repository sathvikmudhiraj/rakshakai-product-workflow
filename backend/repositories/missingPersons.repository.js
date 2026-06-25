const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "missing_persons",
  jsonKey: "reports",
  columns: [
    { name: "status", value: (item) => item.status || "active" },
    { name: "created_by", value: (item) => item.createdBy || null },
    { name: "created_at", value: (item) => dateValue(item.createdAt) },
    { name: "updated_at", value: (item) => dateValue(item.updatedAt || item.createdAt) }
  ]
});
