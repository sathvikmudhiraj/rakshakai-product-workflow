const { createRepository, dateValue } = require("./base.repository");

const erssJurisdictionHistoryRepository = createRepository({
  table: "erss_jurisdiction_history",
  jsonKey: "erssJurisdictionHistory",
  columns: [
    { name: "erss_event_id", value: (r) => r.erssEventId },
    { name: "old_jurisdiction_id", value: (r) => r.oldJurisdictionId || null },
    { name: "new_jurisdiction_id", value: (r) => r.newJurisdictionId },
    { name: "reason", value: (r) => r.reason },
    { name: "changed_by", value: (r) => r.changedBy },
    { name: "changed_at", value: (r) => dateValue(r.changedAt) },
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
    oldJurisdictionId: row.old_jurisdiction_id,
    newJurisdictionId: row.new_jurisdiction_id,
    reason: row.reason,
    changedBy: row.changed_by,
    changedAt: row.changed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.data || {})
  })
});

module.exports = erssJurisdictionHistoryRepository;