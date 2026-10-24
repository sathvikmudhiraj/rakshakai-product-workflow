-- Primary-unit officer deployments. This deliberately does not alter
-- response_unit_members or police_officers.assigned_incident_id (hybrid support).
CREATE TABLE IF NOT EXISTS incident_officer_assignments (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE RESTRICT,
  unit_id TEXT NOT NULL REFERENCES response_units(id) ON DELETE RESTRICT,
  officer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  response_role TEXT NOT NULL CHECK (response_role IN ('TEAM_LEAD','RESPONSE_OFFICER','DRIVER','FIELD_OFFICER','SUPPORT_OFFICER')),
  status TEXT NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN ('ASSIGNED','EN_ROUTE','ON_SCENE','RELEASED')),
  assigned_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  released_at TIMESTAMPTZ,
  release_reason TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status = 'RELEASED') = (released_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_incident_officer_active_deployment
  ON incident_officer_assignments (incident_id, officer_id) WHERE status <> 'RELEASED';
CREATE INDEX IF NOT EXISTS idx_incident_officer_assignments_incident ON incident_officer_assignments (incident_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_officer_assignments_officer_active ON incident_officer_assignments (officer_id) WHERE status <> 'RELEASED';
