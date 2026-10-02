const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "officer_ranks",
  jsonKey: "officerRanks",
  columns: [
    { name: "code", value: (item) => item.code || "" },
    { name: "name", value: (item) => item.name || "" },
    { name: "level", value: (item) => Number(item.level || 0) },
    { name: "active", value: (item) => item.active !== undefined ? Boolean(item.active) : true },
    { name: "created_at", value: (item) => dateValue(item.createdAt) }
  ],
  serialize: (record) => record,
  deserialize: (row) => ({
    ...row.data,
    id: row.id,
    code: row.data?.code || row.code || "",
    name: row.data?.name || row.name || "",
    level: row.data?.level ?? row.level ?? 0,
    active: row.data?.active ?? row.active ?? true,
    createdAt: row.data?.createdAt || row.created_at || null
  })
});