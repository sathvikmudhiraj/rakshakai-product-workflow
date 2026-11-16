const { createRepository, dateValue } = require("./base.repository");

const erssEventsRepository = createRepository({
  table: "erss_events",
  jsonKey: "erssEvents",
  columns: [
    { name: "external_event_id", value: (r) => r.externalEventId || null },
    { name: "channel", value: (r) => r.channel },
    { name: "simulated", value: (r) => r.simulated !== false },
    { name: "caller_reference", value: (r) => r.callerReference || null },
    { name: "caller_latitude", value: (r) => r.callerLatitude ?? null },
    { name: "caller_longitude", value: (r) => r.callerLongitude ?? null },
    { name: "caller_location_text", value: (r) => r.callerLocationText || null },
    { name: "incident_latitude", value: (r) => r.incidentLatitude ?? null },
    { name: "incident_longitude", value: (r) => r.incidentLongitude ?? null },
    { name: "incident_location_text", value: (r) => r.incidentLocationText || null },
    { name: "location_source", value: (r) => r.locationSource || "UNKNOWN" },
    { name: "location_confidence", value: (r) => r.locationConfidence || null },
    { name: "jurisdiction_id", value: (r) => r.jurisdictionId || null },
    { name: "emergency_type", value: (r) => r.emergencyType || "ASSESSING" },
    { name: "priority", value: (r) => r.priority || "ASSESSING" },
    { name: "call_status", value: (r) => r.callStatus || "IN_PROGRESS" },
    { name: "triage_status", value: (r) => r.triageStatus || "RECEIVED" },
    { name: "dispatcher_id", value: (r) => r.dispatcherId || null },
    { name: "incident_id", value: (r) => r.incidentId || null },
    { name: "call_taker_id", value: (r) => r.callTakerId || null },
    { name: "created_at", value: (r) => dateValue(r.createdAt) },
    { name: "updated_at", value: (r) => dateValue(r.updatedAt) },
    { name: "closed_at", value: (r) => r.closedAt ? dateValue(r.closedAt) : null }
  ],
  serialize: (record) => ({
    ...record,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    closedAt: record.closed_at
  }),
  deserialize: (row) => ({
    id: row.id,
    externalEventId: row.external_event_id,
    channel: row.channel,
    simulated: row.simulated,
    callerReference: row.caller_reference,
    callerLatitude: row.caller_latitude,
    callerLongitude: row.caller_longitude,
    callerLocationText: row.caller_location_text,
    incidentLatitude: row.incident_latitude,
    incidentLongitude: row.incident_longitude,
    incidentLocationText: row.incident_location_text,
    locationSource: row.location_source,
    locationConfidence: row.location_confidence,
    jurisdictionId: row.jurisdiction_id,
    emergencyType: row.emergency_type,
    priority: row.priority,
    callStatus: row.call_status,
    triageStatus: row.triage_status,
    dispatcherId: row.dispatcher_id,
    incidentId: row.incident_id,
    callTakerId: row.call_taker_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    ...(row.data || {})
  })
});

module.exports = erssEventsRepository;