const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "camera_health_events",
  jsonKey: "cameraHealthEvents",
  appendOnly: true,
  columns: [
    { name: "camera_id", value: (item) => item.cameraId },
    { name: "previous_status", value: (item) => item.previousStatus || null },
    { name: "new_status", value: (item) => item.newStatus },
    { name: "severity", value: (item) => item.severity },
    { name: "reason", value: (item) => item.reason },
    { name: "metrics", value: (item) => JSON.stringify(item.metrics || {}) },
    { name: "started_at", value: (item) => dateValue(item.startedAt) },
    { name: "created_at", value: (item) => dateValue(item.createdAt) }
  ],
  serialize: (record) => record,
  deserialize: (row) => ({ ...row.data, id: row.id, cameraId: row.camera_id, previousStatus: row.previous_status, newStatus: row.new_status, severity: row.severity, reason: row.reason, metrics: row.metrics || {}, startedAt: row.started_at, createdAt: row.created_at })
});
