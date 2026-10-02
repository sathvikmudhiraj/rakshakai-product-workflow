const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "response_units",
  jsonKey: "responseUnits",
  columns: [
    { name: "status", value: (item) => item.status || "offline" },
    { name: "assigned_incident_id", value: (item) => item.assignedIncidentId || null },
    { name: "station_id", value: (item) => item.stationId || item.station_id || null },
    { name: "beat_id", value: (item) => item.beatId || item.beat_id || null },
    { name: "unit_subtype", value: (item) => item.unitSubtype || item.unit_subtype || null },
    { name: "last_ack_at", value: (item) => (item.lastAckAt || item.last_ack_at ? dateValue(item.lastAckAt || item.last_ack_at) : null) },
    { name: "ack_timeout_seconds", value: (item) => Number(item.ackTimeoutSeconds || item.ack_timeout_seconds || 60) },
    { name: "updated_at", value: (item) => dateValue(item.lastUpdated) }
  ],
  serialize: (record) => {
    const { stationId, beatId, unitSubtype, lastAckAt, ackTimeoutSeconds, ...rest } = record;
    return rest;
  },
  deserialize: (row) => ({
    ...row.data,
    id: row.id,
    status: row.data?.status || row.status || "offline",
    assignedIncidentId: row.data?.assigned_incident_id || row.assigned_incident_id || null,
    assigned_incident_id: row.data?.assigned_incident_id || row.assigned_incident_id || null,
    stationId: row.data?.station_id || row.station_id || null,
    station_id: row.data?.station_id || row.station_id || null,
    beatId: row.data?.beat_id || row.beat_id || null,
    beat_id: row.data?.beat_id || row.beat_id || null,
    unitSubtype: row.data?.unit_subtype || row.unit_subtype || null,
    unit_subtype: row.data?.unit_subtype || row.unit_subtype || null,
    lastAckAt: row.data?.last_ack_at || row.last_ack_at || null,
    last_ack_at: row.data?.last_ack_at || row.last_ack_at || null,
    ackTimeoutSeconds: row.data?.ack_timeout_seconds ?? row.ack_timeout_seconds ?? 60,
    ack_timeout_seconds: row.data?.ack_timeout_seconds ?? row.ack_timeout_seconds ?? 60,
    lastUpdated: row.data?.lastUpdated || row.updated_at || null,
    updated_at: row.data?.updatedAt || row.updated_at || null
  })
});
