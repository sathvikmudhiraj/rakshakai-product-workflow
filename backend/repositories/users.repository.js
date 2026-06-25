const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "users",
  jsonKey: "users",
  columns: [
    { name: "name", value: (item) => item.name || "Unknown user" },
    { name: "email", value: (item) => String(item.email || "").toLowerCase() },
    { name: "role", value: (item) => item.role || "Citizen" },
    { name: "password_hash", value: (item) => item.passwordHash || item.password || "" },
    { name: "created_at", value: (item) => dateValue(item.createdAt) }
  ],
  serialize: ({ password, passwordHash, ...user }) => user,
  deserialize: (row) => ({
    ...row.data,
    id: row.id,
    name: row.data?.name || row.name || "Unknown user",
    email: row.data?.email || row.email || "",
    role: row.data?.role || row.role || "Citizen",
    passwordHash: row.password_hash,
    createdAt: row.data?.createdAt || row.created_at || null
  })
});
