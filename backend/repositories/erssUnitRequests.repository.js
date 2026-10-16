const { createRepository, dateValue } = require("./base.repository");

const erssUnitRequestsRepository = createRepository({
  table: "erss_unit_requests",
  jsonKey: "erssUnitRequests",
  columns: [
    { name: "erss_dispatch_request_id", value: (r) => r.erssDispatchRequestId },
    { name: "erss_event_id", value: (r) => r.erssEventId },
    { name: "unit_id", value: (r) => r.unitId },
    { name: "station_id", value: (r) => r.stationId || null },
    { name: "service_type", value: (r) => r.serviceType },
    { name: "status", value: (r) => r.status || "REQUESTED" },
    { name: "requested_at", value: (r) => dateValue(r.requestedAt) },
    { name: "acknowledged_at", value: (r) => r.acknowledgedAt ? dateValue(r.acknowledgedAt) : null },
    { name: "accepted_at", value: (r) => r.acceptedAt ? dateValue(r.acceptedAt) : null },
    { name: "dispatched_at", value: (r) => r.dispatchedAt ? dateValue(r.dispatchedAt) : null },
    { name: "timeout_at", value: (r) => r.timeoutAt ? dateValue(r.timeoutAt) : null },
    { name: "ack_timeout_seconds", value: (r) => r.ackTimeoutSeconds || 60 },
    { name: "fallback_unit_id", value: (r) => r.fallbackUnitId || null },
    { name: "fallback_recommended_at", value: (r) => r.fallbackRecommendedAt ? dateValue(r.fallbackRecommendedAt) : null },
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
    erssDispatchRequestId: row.erss_dispatch_request_id,
    erssEventId: row.erss_event_id,
    unitId: row.unit_id,
    stationId: row.station_id,
    serviceType: row.service_type,
    status: row.status,
    requestedAt: row.requested_at,
    acknowledgedAt: row.acknowledged_at,
    acceptedAt: row.accepted_at,
    dispatchedAt: row.dispatched_at,
    timeoutAt: row.timeout_at,
    ackTimeoutSeconds: row.ack_timeout_seconds,
    fallbackUnitId: row.fallback_unit_id,
    fallbackRecommendedAt: row.fallback_recommended_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.data || {})
  })
});

module.exports = erssUnitRequestsRepository;