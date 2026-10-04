-- Preserve the complete evidence custody history in an append-only relation.
-- Existing JSON custody entries are backfilled before application writes stop
-- embedding the array in app_state.

CREATE TABLE IF NOT EXISTS evidence_custody_events (
  id TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO evidence_custody_events
  (id, evidence_id, action, actor_id, actor_name, actor_role, occurred_at, notes, data)
SELECT
  COALESCE(NULLIF(event.value->>'id', ''), 'custody_' || md5(evidence.value->>'id' || ':' || event.ordinality::text || ':' || event.value::text)),
  evidence.value->>'id',
  COALESCE(NULLIF(event.value->>'action', ''), 'legacy_custody_event'),
  NULLIF(event.value->>'actorId', ''),
  COALESCE(NULLIF(event.value->>'actorName', ''), 'RakshakAI System'),
  COALESCE(NULLIF(event.value->>'actorRole', ''), 'System'),
  COALESCE(NULLIF(event.value->>'timestamp', '')::timestamptz, NOW()),
  COALESCE(event.value->>'notes', ''),
  event.value
FROM app_state state
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(state.data->'videoEvidence', '[]'::jsonb)) evidence(value)
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(evidence.value->'chainOfCustody', '[]'::jsonb))
  WITH ORDINALITY event(value, ordinality)
WHERE state.key = 'operational'
  AND COALESCE(evidence.value->>'id', '') <> ''
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_evidence_custody_evidence_time
  ON evidence_custody_events(evidence_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION reject_evidence_custody_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'evidence custody events are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS evidence_custody_events_append_only ON evidence_custody_events;
CREATE TRIGGER evidence_custody_events_append_only
BEFORE UPDATE OR DELETE ON evidence_custody_events
FOR EACH ROW EXECUTE FUNCTION reject_evidence_custody_mutation();

DROP TRIGGER IF EXISTS evidence_custody_events_no_truncate ON evidence_custody_events;
CREATE TRIGGER evidence_custody_events_no_truncate
BEFORE TRUNCATE ON evidence_custody_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_evidence_custody_mutation();
