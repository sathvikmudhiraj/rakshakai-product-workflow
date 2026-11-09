const { createRepository, dateValue } = require("./base.repository");
const { encryptCameraSecrets } = require("../services/cameraSecrets.service");

module.exports = createRepository({
  table: "camera_sources",
  jsonKey: "cameraSources",
  serialize: (record) => {
    const stored = { ...record };
    encryptCameraSecrets(stored);
    return stored;
  },
  columns: [
    { name: "status", value: (item) => item.status || null },
    { name: "source_type", value: (item) => item.type || null },
    { name: "health_status", value: (item) => String(item.healthStatus || "UNKNOWN").toUpperCase() },
    { name: "health_severity", value: (item) => String(item.healthSeverity || "NORMAL").toUpperCase() },
    { name: "criticality", value: (item) => String(item.criticality || "NORMAL").toUpperCase() },
    { name: "expected_fps", value: (item) => item.expectedFps ?? null },
    { name: "last_heartbeat_at", value: (item) => item.lastHeartbeatAt ? dateValue(item.lastHeartbeatAt) : null },
    { name: "last_stream_received_at", value: (item) => item.lastStreamReceivedAt ? dateValue(item.lastStreamReceivedAt) : null },
    { name: "last_frame_received_at", value: (item) => item.lastFrameReceivedAt ? dateValue(item.lastFrameReceivedAt) : null },
    { name: "last_health_check_at", value: (item) => item.lastHealthCheckAt ? dateValue(item.lastHealthCheckAt) : null },
    { name: "health_issue_started_at", value: (item) => item.healthIssueStartedAt ? dateValue(item.healthIssueStartedAt) : null },
    { name: "last_healthy_at", value: (item) => item.lastHealthyAt ? dateValue(item.lastHealthyAt) : null },
    { name: "maintenance_mode", value: (item) => Boolean(item.maintenanceMode) },
    { name: "maintenance_reason", value: (item) => item.maintenanceReason || null },
    { name: "maintenance_started_by", value: (item) => item.maintenanceStartedBy || null },
    { name: "maintenance_started_at", value: (item) => item.maintenanceStartedAt ? dateValue(item.maintenanceStartedAt) : null },
    { name: "maintenance_expected_return_at", value: (item) => item.maintenanceExpectedReturnAt ? dateValue(item.maintenanceExpectedReturnAt) : null },
    { name: "updated_at", value: (item) => dateValue(item.lastSeenAt || item.lastTestedAt) }
  ]
});
