const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "ai_observations",
  jsonKey: "aiObservations",
  columns: [
    { name: "camera_id", value: (item) => item.cameraId },
    { name: "status", value: (item) => item.status || "PENDING_REVIEW" },
    { name: "captured_at", value: (item) => dateValue(item.capturedAt) },
    { name: "processed_at", value: (item) => dateValue(item.processedAt) },
    { name: "reviewed_at", value: (item) => item.reviewedAt ? dateValue(item.reviewedAt) : null },
    { name: "created_at", value: (item) => dateValue(item.createdAt || item.capturedAt) }
  ]
});
