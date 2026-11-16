-- Phase 4 corrective migration: deterministic escalation clocks and durable history.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assignment_breached_at TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS response_breached_at TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS escalation_l2_at TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS escalation_l3_at TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS escalation_l4_at TIMESTAMPTZ;
ALTER TABLE incident_timeline ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_incidents_escalation_l2_at ON incidents(escalation_l2_at);
CREATE INDEX IF NOT EXISTS idx_incidents_escalation_l3_at ON incidents(escalation_l3_at);
CREATE INDEX IF NOT EXISTS idx_incidents_escalation_l4_at ON incidents(escalation_l4_at);

-- A CRITICAL assignment SLA must have an observable warning period before breach.
UPDATE sla_config
SET warning_before_assignment_minutes = 1, updated_at = NOW()
WHERE severity = 'CRITICAL' AND warning_before_assignment_minutes < 1;

-- Deleting an incident must not rewrite or detach its append-only custody history.
ALTER TABLE incident_timeline DROP CONSTRAINT IF EXISTS incident_timeline_incident_id_fkey;
ALTER TABLE incident_timeline ADD CONSTRAINT incident_timeline_incident_id_fkey
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE RESTRICT;

DO $$
BEGIN
  ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_severity_check;
  ALTER TABLE incidents ADD CONSTRAINT incidents_severity_check
    CHECK (UPPER(severity) IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW'));
END $$;
