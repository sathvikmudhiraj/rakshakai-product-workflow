const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "tracking_score_config",
  jsonKey: "trackingScoreConfig",
  columns: [
    { name: "track_type", value: (item) => item.trackType },
    { name: "weight_key", value: (item) => item.weightKey },
    { name: "weight_value", value: (item) => item.weightValue },
    { name: "description", value: (item) => item.description || null },
    { name: "is_active", value: (item) => item.isActive ?? true },
    { name: "created_at", value: (item) => dateValue(item.createdAt) },
    { name: "updated_at", value: (item) => dateValue(item.updatedAt || item.createdAt) }
  ],
  deserialize: (row) => ({
    id: row.id,
    trackType: row.track_type,
    weightKey: row.weight_key,
    weightValue: row.weight_value,
    description: row.description,
    isActive: row.is_active,
    data: row.data || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  })
});