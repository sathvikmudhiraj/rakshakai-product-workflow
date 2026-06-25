const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "camera_sources",
  jsonKey: "cameraSources",
  columns: [
    { name: "status", value: (item) => item.status || null },
    { name: "source_type", value: (item) => item.type || null },
    { name: "updated_at", value: (item) => dateValue(item.lastSeenAt || item.lastTestedAt) }
  ]
});
