const { getDatabaseMode, query } = require("../services/postgres.service");

function dateValue(value) {
  if (!value || Number.isNaN(Date.parse(value))) return new Date().toISOString();
  return new Date(value).toISOString();
}

function createRepository({
  table,
  jsonKey,
  columns,
  serialize = (record) => record,
  deserialize = (row) => row.data
}) {
  async function list(fallbackDb) {
    if (getDatabaseMode() === "json") return fallbackDb[jsonKey] || [];
    const orderBy = columns.some((column) => column.name === "created_at")
      ? " ORDER BY created_at DESC"
      : "";
    const result = await query(`SELECT * FROM ${table}${orderBy}`);
    return result.rows.map(deserialize);
  }

  async function upsert(record, client = { query }) {
    const values = columns.map((column) => column.value(record));
    const names = ["id", ...columns.map((column) => column.name), "data"];
    const placeholders = names.map((_, index) => `$${index + 1}`);
    const updates = names.slice(1).map((name) => `${name} = EXCLUDED.${name}`);
    await client.query(
      `INSERT INTO ${table} (${names.join(", ")})
       VALUES (${placeholders.join(", ")})
       ON CONFLICT (id) DO UPDATE SET ${updates.join(", ")}`,
      [record.id, ...values, JSON.stringify(serialize(record))]
    );
  }

  async function replaceAll(records, client) {
    const ids = records.map((record) => record.id);
    for (const record of records) await upsert(record, client);
    if (ids.length) {
      await client.query(`DELETE FROM ${table} WHERE NOT (id = ANY($1::text[]))`, [ids]);
    } else {
      await client.query(`DELETE FROM ${table}`);
    }
  }

  return { table, jsonKey, list, upsert, replaceAll, getDatabaseMode, dateValue };
}

module.exports = { createRepository, dateValue };
