const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "tracking_sessions",
  jsonKey: "trackingSessions",
  columns: [
    { name: "track_type", value: (item) => item.trackType },
    { name: "status", value: (item) => item.status },
    { name: "created_by", value: (item) => item.createdBy || null },
    { name: "reference_detection_id", value: (item) => item.referenceDetectionId },
    { name: "reference_camera_id", value: (item) => item.referenceCameraId },
    { name: "reference_timestamp", value: (item) => dateValue(item.referenceTimestamp) },
    { name: "last_seen_camera_id", value: (item) => item.lastSeenCameraId || null },
    { name: "last_seen_at", value: (item) => item.lastSeenAt ? dateValue(item.lastSeenAt) : null },
    { name: "confidence", value: (item) => item.confidence ?? null },
    { name: "verification_status", value: (item) => item.verificationStatus || null },
    { name: "incident_id", value: (item) => item.incidentId || null },
    { name: "alert_id", value: (item) => item.alertId || null },
    { name: "evidence_id", value: (item) => item.evidenceId || null },
    { name: "created_at", value: (item) => dateValue(item.createdAt) },
    { name: "updated_at", value: (item) => dateValue(item.updatedAt || item.createdAt) }
  ],
  deserialize: (row) => ({
    id: row.id,
    trackType: row.track_type,
    status: row.status,
    createdBy: row.created_by,
    referenceDetectionId: row.reference_detection_id,
    referenceCameraId: row.reference_camera_id,
    referenceTimestamp: row.reference_timestamp,
    lastSeenCameraId: row.last_seen_camera_id,
    lastSeenAt: row.last_seen_at,
    confidence: row.confidence,
    verificationStatus: row.verification_status,
    incidentId: row.incident_id,
    alertId: row.alert_id,
    evidenceId: row.evidence_id,
    data: row.data || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  })
});