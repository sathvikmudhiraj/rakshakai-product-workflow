const crypto = require("node:crypto");
const { getDatabaseMode, query } = require("../services/postgres.service");

function eventId(evidenceId, event, index = 0) {
  if (event.id) return String(event.id);
  const digest = crypto.createHash("sha256")
    .update(JSON.stringify([evidenceId, index, event.action, event.actorId, event.timestamp, event.notes]))
    .digest("hex")
    .slice(0, 32);
  return `custody_${digest}`;
}

function eventsFromEvidence(evidenceRecords = []) {
  return evidenceRecords.flatMap((evidence) => (evidence.chainOfCustody || []).map((event, index) => ({
    ...event,
    id: eventId(evidence.id, event, index),
    evidenceId: evidence.id
  })));
}

async function list() {
  if (getDatabaseMode() === "json") return [];
  const result = await query(`
    SELECT id, evidence_id, action, actor_id, actor_name, actor_role, occurred_at, notes
    FROM evidence_custody_events
    ORDER BY occurred_at DESC, id DESC
  `);
  return result.rows.map((row) => ({
    id: row.id,
    evidenceId: row.evidence_id,
    action: row.action,
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    timestamp: new Date(row.occurred_at).toISOString(),
    notes: row.notes || ""
  }));
}

async function appendFromEvidence(evidenceRecords, client = { query }) {
  if (getDatabaseMode() === "json") return;
  for (const event of eventsFromEvidence(evidenceRecords)) {
    await client.query(
      `INSERT INTO evidence_custody_events
        (id, evidence_id, action, actor_id, actor_name, actor_role, occurred_at, notes, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        event.id,
        event.evidenceId,
        event.action,
        event.actorId || null,
        event.actorName || "RakshakAI System",
        event.actorRole || "System",
        event.timestamp,
        event.notes || "",
        JSON.stringify(event)
      ]
    );
  }
}

module.exports = { list, appendFromEvidence, eventsFromEvidence, eventId };
