const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "copilot_messages",
  jsonKey: "copilotMessages",
  columns: [
    { name: "conversation_id", value: (item) => item.conversationId },
    { name: "role", value: (item) => item.role },
    { name: "content", value: (item) => item.content },
    { name: "metadata", value: (item) => JSON.stringify(item.metadata || {}) },
    { name: "created_at", value: (item) => dateValue(item.createdAt) }
  ],
  serialize: (record) => ({
    role: record.role,
    content: record.content,
    metadata: record.metadata || {},
    createdAt: record.createdAt
  }),
  deserialize: (row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    metadata: row.metadata || {},
    createdAt: row.created_at
  })
});