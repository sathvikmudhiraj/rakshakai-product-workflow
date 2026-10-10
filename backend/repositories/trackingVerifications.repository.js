const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "tracking_verifications",
  jsonKey: "trackingVerifications",
  appendOnly: true,
  columns: [
    { name: "session_id", value: (item) => item.sessionId },
    { name: "candidate_id", value: (item) => item.candidateId },
    { name: "actor_id", value: (item) => item.actorId },
    { name: "decision", value: (item) => item.decision },
    { name: "ai_confidence", value: (item) => item.aiConfidence },
    { name: "reason", value: (item) => item.reason || null },
    { name: "created_at", value: (item) => dateValue(item.createdAt) }
  ],
  deserialize: (row) => ({
    id: row.id,
    sessionId: row.session_id,
    candidateId: row.candidate_id,
    actorId: row.actor_id,
    decision: row.decision,
    aiConfidence: row.ai_confidence,
    reason: row.reason,
    data: row.data || {},
    createdAt: row.created_at
  })
});