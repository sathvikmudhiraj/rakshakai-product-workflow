const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "camera_health_alerts",
  jsonKey: "cameraHealthAlerts",
  columns: [
    { name: "camera_id", value: (item) => item.cameraId },
    { name: "alert_type", value: (item) => item.alertType },
    { name: "severity", value: (item) => item.severity },
    { name: "status", value: (item) => item.status || "ACTIVE" },
    { name: "unique_key", value: (item) => item.uniqueKey },
    { name: "title", value: (item) => item.title },
    { name: "message", value: (item) => item.message },
    { name: "started_at", value: (item) => dateValue(item.startedAt) },
    { name: "acknowledged_at", value: (item) => item.acknowledgedAt ? dateValue(item.acknowledgedAt) : null },
    { name: "acknowledged_by", value: (item) => item.acknowledgedBy || null },
    { name: "resolved_at", value: (item) => item.resolvedAt ? dateValue(item.resolvedAt) : null },
    { name: "resolved_by", value: (item) => item.resolvedBy || null },
    { name: "active", value: (item) => item.active !== false },
    { name: "metadata", value: (item) => JSON.stringify(item.metadata || {}) },
    { name: "created_at", value: (item) => dateValue(item.createdAt) },
    { name: "updated_at", value: (item) => dateValue(item.updatedAt) }
  ],
  serialize: (record) => record,
  deserialize: (row) => ({ ...row.data, id: row.id, cameraId: row.camera_id, alertType: row.alert_type, severity: row.severity, status: row.status, uniqueKey: row.unique_key, title: row.title, message: row.message, startedAt: row.started_at, acknowledgedAt: row.acknowledged_at, acknowledgedBy: row.acknowledged_by, resolvedAt: row.resolved_at, resolvedBy: row.resolved_by, active: row.active, metadata: row.metadata || {}, createdAt: row.created_at, updatedAt: row.updated_at })
});
