const { createRepository, dateValue } = require("./base.repository");

const erssOwnershipTransfersRepository = createRepository({
  table: "erss_ownership_transfers",
  jsonKey: "erssOwnershipTransfers",
  columns: [
    { name: "erss_event_id", value: (r) => r.erssEventId },
    { name: "incident_id", value: (r) => r.incidentId || null },
    { name: "from_station_id", value: (r) => r.fromStationId },
    { name: "to_station_id", value: (r) => r.toStationId },
    { name: "requested_by", value: (r) => r.requestedBy },
    { name: "status", value: (r) => r.status || "TRANSFER_REQUESTED" },
    { name: "requested_at", value: (r) => dateValue(r.requestedAt) },
    { name: "acknowledged_at", value: (r) => r.acknowledgedAt ? dateValue(r.acknowledgedAt) : null },
    { name: "transferred_at", value: (r) => r.transferredAt ? dateValue(r.transferredAt) : null },
    { name: "reason", value: (r) => r.reason || null },
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
    fromStationId: row.from_station_id,
    toStationId: row.to_station_id,
    requestedBy: row.requested_by,
    status: row.status,
    requestedAt: row.requested_at,
    acknowledgedAt: row.acknowledged_at,
    transferredAt: row.transferred_at,
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.data || {})
  })
});

module.exports = erssOwnershipTransfersRepository;