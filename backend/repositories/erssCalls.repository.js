const { createRepository, dateValue } = require("./base.repository");

const erssCallsRepository = createRepository({
  table: "erss_calls",
  jsonKey: "erssCalls",
  columns: [
    { name: "erss_event_id", value: (r) => r.erssEventId },
    { name: "call_taker_id", value: (r) => r.callTakerId || null },
    { name: "status", value: (r) => r.status || "ACTIVE" },
    { name: "started_at", value: (r) => dateValue(r.startedAt) },
    { name: "ended_at", value: (r) => r.endedAt ? dateValue(r.endedAt) : null },
    { name: "duration_seconds", value: (r) => r.durationSeconds ?? null },
    { name: "transcript", value: (r) => r.transcript || null },
    { name: "ai_summary", value: (r) => r.aiSummary || null },
    { name: "ai_suggestions", value: (r) => r.aiSuggestions || null },
    { name: "notes", value: (r) => r.notes || null },
    { name: "created_at", value: (r) => dateValue(r.createdAt) },
    { name: "updated_at", value: (r) => dateValue(r.updatedAt) }
  ],
  serialize: (record) => ({
    ...record,
    createdAt: record.created_at,
    updatedAt: record.updated_at
  }),
  deserialize: (row) => ({
    id: row.id,
    erssEventId: row.erss_event_id,
    callTakerId: row.call_taker_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    transcript: row.transcript,
    aiSummary: row.ai_summary,
    aiSuggestions: row.ai_suggestions,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.data || {})
  })
});

module.exports = erssCallsRepository;