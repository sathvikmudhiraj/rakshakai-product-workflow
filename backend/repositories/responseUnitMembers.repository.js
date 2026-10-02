const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "response_unit_members",
  jsonKey: "responseUnitMembers",
  columns: [
    { name: "unit_id", value: (item) => item.unitId || item.unit_id || "" },
    { name: "officer_user_id", value: (item) => item.officerUserId || item.officer_user_id || "" },
    { name: "role", value: (item) => item.role || "member" },
    { name: "assigned_at", value: (item) => dateValue(item.assignedAt) }
  ],
  serialize: (record) => record,
  deserialize: (row) => ({
    ...row.data,
    id: row.id,
    unitId: row.data?.unit_id || row.unit_id || "",
    unit_id: row.data?.unit_id || row.unit_id || "",
    officerUserId: row.data?.officer_user_id || row.officer_user_id || "",
    officer_user_id: row.data?.officer_user_id || row.officer_user_id || "",
    role: row.data?.role || row.role || "member",
    assignedAt: row.data?.assignedAt || row.assigned_at || null
  })
});