const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "incident_timeline",
  jsonKey: "incidentTimeline",
  appendOnly: true,
  columns: [
    { name: "incident_id", value: (item) => item.incidentId || item.incident_id || "" },
    { name: "event_type", value: (item) => item.eventType || item.event_type || "" },
    { name: "actor_id", value: (item) => item.actorId || item.actor_id || null },
    { name: "actor_name", value: (item) => item.actorName || item.actor_name || null },
    { name: "actor_role", value: (item) => item.actorRole || item.actor_role || null },
    { name: "description", value: (item) => item.description || "" },
    { name: "metadata", value: (item) => JSON.stringify(item.metadata || {}) },
    { name: "created_at", value: (item) => dateValue(item.createdAt || item.timestamp) }
  ],
  serialize: (record) => record,
  deserialize: (row) => ({
    ...row.data,
    id: row.id,
    incidentId: row.data?.incident_id || row.incident_id || "",
    incident_id: row.data?.incident_id || row.incident_id || "",
    eventType: row.data?.event_type || row.event_type || "",
    event_type: row.data?.event_type || row.event_type || "",
    actorId: row.data?.actor_id || row.actor_id || null,
    actor_id: row.data?.actor_id || row.actor_id || null,
    actorName: row.data?.actor_name || row.actor_name || null,
    actor_name: row.data?.actor_name || row.actor_name || null,
    actorRole: row.data?.actor_role || row.actor_role || null,
    actor_role: row.data?.actor_role || row.actor_role || null,
    description: row.data?.description || row.description || "",
    metadata: row.data?.metadata || row.metadata || {},
    createdAt: row.data?.created_at || row.created_at || null,
    timestamp: row.data?.created_at || row.created_at || null
  })
});
