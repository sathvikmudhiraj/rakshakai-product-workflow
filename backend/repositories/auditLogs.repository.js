const { createRepository, dateValue } = require("./base.repository");
const { query } = require("../services/postgres.service");

const repository = createRepository({
  table: "audit_logs",
  jsonKey: "auditLogs",
  appendOnly: true,
  columns: [
    { name: "incident_id", value: (item) => item.incidentId || null },
    { name: "actor_id", value: (item) => item.actorId || null },
    { name: "action", value: (item) => item.action || "unknown" },
    { name: "created_at", value: (item) => dateValue(item.timestamp || item.createdAt) }
  ]
});

const CATEGORY_SQL = `CASE
  WHEN lower(action) LIKE '%police%' OR lower(action) LIKE '%officer%' OR lower(action) LIKE '%station%' THEN 'personnel'
  WHEN lower(action) LIKE '%unit%' OR lower(action) LIKE '%member%' OR lower(action) LIKE '%assignment%' THEN 'units'
  WHEN lower(action) LIKE '%incident%' OR lower(action) LIKE '%dispatch%' OR lower(action) LIKE '%erss%' OR lower(action) LIKE '%sla%' OR lower(action) LIKE '%escalation%' THEN 'incidents'
  WHEN lower(action) LIKE '%auth%' OR lower(action) LIKE '%session%' OR lower(action) LIKE '%account%' OR lower(action) LIKE '%password%' THEN 'security'
  ELSE 'other' END`;

async function listPage({ limit, offset, search, category, actor, from, to }) {
  const where = [];
  const values = [];
  const add = (sql, ...args) => {
    const numbered = sql.replace(/\?/g, () => { values.push(args.shift()); return `$${values.length}`; });
    where.push(numbered);
  };
  if (search) add("(action ILIKE ? OR COALESCE(data->>'actorName','') ILIKE ? OR COALESCE(data->>'actorRole','') ILIKE ? OR COALESCE(data->>'details','') ILIKE ? OR COALESCE(data->>'incidentId','') ILIKE ? OR data::text ILIKE ?)", ...Array(6).fill(`%${search}%`));
  if (category && category !== "all") add(`${CATEGORY_SQL} = ?`, category);
  if (actor) add("(COALESCE(data->>'actorName','') ILIKE ? OR COALESCE(data->>'actorId', actor_id, '') ILIKE ?)", `%${actor}%`, `%${actor}%`);
  if (from) add("created_at >= ?::date", from);
  if (to) add("created_at < (?::date + INTERVAL '1 day')", to);
  const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const countResult = await query(`SELECT count(*)::int AS total FROM audit_logs${clause}`, values);
  const pageValues = [...values, limit, offset];
  const pageResult = await query(`SELECT data FROM audit_logs${clause} ORDER BY created_at DESC, id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, pageValues);
  return { auditLogs: pageResult.rows.map((row) => row.data), total: countResult.rows[0]?.total || 0 };
}

module.exports = { ...repository, listPage };
