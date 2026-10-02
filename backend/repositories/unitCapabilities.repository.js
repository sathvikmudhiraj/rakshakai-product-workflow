const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "unit_capabilities",
  jsonKey: "unitCapabilities",
  columns: [
    { name: "unit_id", value: (item) => item.unitId || item.unit_id || "" },
    { name: "capability_type", value: (item) => item.capabilityType || item.capability_type || "" },
    { name: "subtype", value: (item) => item.subtype || null },
    { name: "level", value: (item) => Number(item.level || 1) },
    { name: "notes", value: (item) => item.notes || null }
  ],
  serialize: (record) => record,
  deserialize: (row) => ({
    ...row.data,
    id: row.id,
    unitId: row.data?.unit_id || row.unit_id || "",
    unit_id: row.data?.unit_id || row.unit_id || "",
    capabilityType: row.data?.capability_type || row.capability_type || "",
    capability_type: row.data?.capability_type || row.capability_type || "",
    subtype: row.data?.subtype || row.subtype || null,
    level: row.data?.level ?? row.level ?? 1,
    notes: row.data?.notes || row.notes || null
  })
});