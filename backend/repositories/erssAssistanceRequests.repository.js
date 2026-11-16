const { createRepository, dateValue } = require("./base.repository");

const erssAssistanceRequestsRepository = createRepository({
  table: "erss_assistance_requests",
  jsonKey: "erssAssistanceRequests",
  columns: [
    { name: "erss_event_id", value: (r) => r.erssEventId },
    { name: "requesting_station_id", value: (r) => r.requestingStationId },
    { name: "requested_station_id", value: (r) => r.requestedStationId },
    { name: "incident_id", value: (r) => r.incidentId || null },
    { name: "priority", value: (r) => r.priority },
    { name: "reason", value: (r) => r.reason },
    { name: "suggested_unit_id", value: (r) => r.suggestedUnitId || null },
    { name: "suggested_eta_minutes", value: (r) => r.suggestedEtaMinutes ?? null },
    { name: "status", value: (r) => r.status || "REQUESTED" },
    { name: "requested_at", value: (r) => dateValue(r.requestedAt) },
    { name: "acknowledged_at", value: (r) => r.acknowledgedAt ? dateValue(r.acknowledgedAt) : null },
    { name: "accepted_at", value: (r) => r.acceptedAt ? dateValue(r.acceptedAt) : null },
    { name: "declined_at", value: (r) => r.declinedAt ? dateValue(r.declinedAt) : null },
    { name: "decline_reason", value: (r) => r.declineReason || null },
    { name: "decline_notes", value: (r) => r.declineNotes || null },
    { name: "timeout_at", value: (r) => r.timeoutAt ? dateValue(r.timeoutAt) : null },
    { name: "ack_timeout_seconds", value: (r) => r.ackTimeoutSeconds || 120 },
    { name: "escalated_at", value: (r) => r.escalatedAt ? dateValue(r.escalatedAt) : null },
    { name: "completed_at", value: (r) => r.completedAt ? dateValue(r.completedAt) : null },
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
    requestingStationId: row.requesting_station_id,
    requestedStationId: row.requested_station_id,
    incidentId: row.incident_id,
    priority: row.priority,
    reason: row.reason,
    suggestedUnitId: row.suggested_unit_id,
    suggestedEtaMinutes: row.suggested_eta_minutes,
    status: row.status,
    requestedAt: row.requested_at,
    acknowledgedAt: row.acknowledged_at,
    acceptedAt: row.accepted_at,
    declinedAt: row.declined_at,
    declineReason: row.decline_reason,
    declineNotes: row.decline_notes,
    timeoutAt: row.timeout_at,
    ackTimeoutSeconds: row.ack_timeout_seconds,
    escalatedAt: row.escalated_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.data || {})
  })
});

module.exports = erssAssistanceRequestsRepository;