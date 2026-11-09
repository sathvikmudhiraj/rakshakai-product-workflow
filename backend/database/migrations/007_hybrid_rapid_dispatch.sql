-- Canonical hybrid dispatch recommendation, station support, and officer workload fields.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS response_requirements JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS dispatch_recommendation JSONB;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS support_allocations JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS dispatch_confirmed_at TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS dispatch_confirmed_by TEXT REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE police_officers ADD COLUMN IF NOT EXISTS duty_status TEXT NOT NULL DEFAULT 'on_duty';
ALTER TABLE police_officers ADD COLUMN IF NOT EXISTS availability_status TEXT NOT NULL DEFAULT 'available';
ALTER TABLE police_officers ADD COLUMN IF NOT EXISTS assigned_incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_police_officers_dispatch_availability
  ON police_officers(station_id, active, duty_status, availability_status);
CREATE INDEX IF NOT EXISTS idx_police_officers_assigned_incident
  ON police_officers(assigned_incident_id);
