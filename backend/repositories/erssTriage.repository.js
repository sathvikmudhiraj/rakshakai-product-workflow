const { createRepository, dateValue } = require("./base.repository");

const erssTriageRepository = createRepository({
  table: "erss_triage",
  jsonKey: "erssTriage",
  columns: [
    { name: "erss_event_id", value: (r) => r.erssEventId },
    { name: "call_taker_id", value: (r) => r.callTakerId },
    { name: "emergency_type", value: (r) => r.emergencyType },
    { name: "priority", value: (r) => r.priority },
    { name: "caller_location_verified", value: (r) => r.callerLocationVerified !== false },
    { name: "incident_location_verified", value: (r) => r.incidentLocationVerified !== false },
    { name: "immediate_danger", value: (r) => r.immediateDanger !== false },
    { name: "description", value: (r) => r.description || null },
    { name: "ai_emergency_type_suggestion", value: (r) => r.aiEmergencyTypeSuggestion || null },
    { name: "ai_priority_suggestion", value: (r) => r.aiPrioritySuggestion || null },
    { name: "ai_jurisdiction_suggestion", value: (r) => r.aiJurisdictionSuggestion || null },
    { name: "human_confirmed", value: (r) => r.humanConfirmed !== false },
    { name: "action_taken", value: (r) => r.actionTaken || null },
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
    emergencyType: row.emergency_type,
    priority: row.priority,
    callerLocationVerified: row.caller_location_verified,
    incidentLocationVerified: row.incident_location_verified,
    immediateDanger: row.immediate_danger,
    description: row.description,
    aiEmergencyTypeSuggestion: row.ai_emergency_type_suggestion,
    aiPrioritySuggestion: row.ai_priority_suggestion,
    aiJurisdictionSuggestion: row.ai_jurisdiction_suggestion,
    humanConfirmed: row.human_confirmed,
    actionTaken: row.action_taken,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.data || {})
  })
});

module.exports = erssTriageRepository;