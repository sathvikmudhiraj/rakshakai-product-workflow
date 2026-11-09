const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "incident_officer_assignments",
  jsonKey: "incidentOfficerAssignments",
  columns: [
    { name: "incident_id", value: (item) => item.incidentId }, { name: "unit_id", value: (item) => item.unitId },
    { name: "officer_id", value: (item) => item.officerId }, { name: "response_role", value: (item) => item.responseRole },
    { name: "status", value: (item) => item.status || "ASSIGNED" }, { name: "assigned_by", value: (item) => item.assignedBy },
    { name: "assigned_at", value: (item) => dateValue(item.assignedAt) }, { name: "released_by", value: (item) => item.releasedBy || null },
    { name: "released_at", value: (item) => item.releasedAt ? dateValue(item.releasedAt) : null }, { name: "release_reason", value: (item) => item.releaseReason || null },
    { name: "created_at", value: (item) => dateValue(item.createdAt) }, { name: "updated_at", value: (item) => dateValue(item.updatedAt) }
  ],
  serialize: (record) => record,
  deserialize: (row) => ({ ...row.data, id: row.id, incidentId: row.incident_id, unitId: row.unit_id, officerId: row.officer_id, responseRole: row.response_role, status: row.status, assignedBy: row.assigned_by, assignedAt: row.assigned_at, releasedBy: row.released_by, releasedAt: row.released_at, releaseReason: row.release_reason, createdAt: row.created_at, updatedAt: row.updated_at })
});
