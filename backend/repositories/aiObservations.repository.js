const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "ai_observations",
  jsonKey: "aiObservations",
  columns: [
    { name: "camera_id", value: (item) => item.cameraId || null },
    { name: "source_type", value: (item) => item.sourceType || "camera" },
    { name: "source_id", value: (item) => item.sourceId || item.cameraId },
    { name: "evidence_id", value: (item) => item.evidenceId || null },
    { name: "analysis_id", value: (item) => item.analysisId || null },
    { name: "status", value: (item) => item.status || "PENDING_REVIEW" },
    { name: "captured_at", value: (item) => dateValue(item.capturedAt) },
    { name: "processed_at", value: (item) => dateValue(item.processedAt) },
    { name: "reviewed_at", value: (item) => item.reviewedAt ? dateValue(item.reviewedAt) : null },
    { name: "created_at", value: (item) => dateValue(item.createdAt || item.capturedAt) }
  ]
});
