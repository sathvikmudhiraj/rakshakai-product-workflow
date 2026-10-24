const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "copilot_conversations",
  jsonKey: "copilotConversations",
  columns: [
    { name: "user_id", value: (item) => item.userId },
    { name: "entities", value: (item) => JSON.stringify(item.entities || []) },
    { name: "language", value: (item) => item.language || "en" },
    { name: "updated_at", value: (item) => dateValue(item.updatedAt) }
  ],
  serialize: (record) => ({
    entities: record.entities || [],
    language: record.language || "en",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  }),
  deserialize: (row) => ({
    id: row.id,
    userId: row.user_id,
    entities: row.entities || [],
    language: row.language || "en",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  })
});