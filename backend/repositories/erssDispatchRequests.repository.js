const { createRepository, dateValue } = require("./base.repository");

const erssDispatchRequestsRepository = createRepository({
  table: "erss_dispatch_requests",
  jsonKey: "erssDispatchRequests",
  columns: [
    { name: "erss_event_id", value: (r) => r.erssEventId },
    { name: "incident_id", value: (r) => r.incidentId || null },
    { name: "dispatcher_id", value: (r) => r.dispatcherId },
    { name: "recommended_services", value: (r) => r.recommendedServices || [] },
    { name: "primary_recommendation", value: (r) => r.primaryRecommendation || null },
    { name: "fallback_recommendations", value: (r) => r.fallbackRecommendations || [] },
    { name: "status", value: (r) => r.status || "PENDING" },
    { name: "approved_at", value: (r) => r.approvedAt ? dateValue(r.approvedAt) : null },
    { name: "approved_by", value: (r) => r.approvedBy || null },
    { name: "rejection_reason", value: (r) => r.rejectionReason || null },
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
    incidentId: row.incident_id,
    dispatcherId: row.dispatcher_id,
    recommendedServices: row.recommended_services,
    primaryRecommendation: row.primary_recommendation,
    fallbackRecommendations: row.fallback_recommendations,
    status: row.status,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.data || {})
  })
});

module.exports = erssDispatchRequestsRepository;