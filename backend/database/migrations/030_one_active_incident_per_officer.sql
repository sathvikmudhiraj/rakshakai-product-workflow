-- A Police officer may have at most one active incident deployment at a time.
-- Released history remains available and does not block a later deployment.
CREATE UNIQUE INDEX IF NOT EXISTS uq_incident_officer_one_active_per_officer
  ON incident_officer_assignments (officer_id)
  WHERE status IN ('ASSIGNED', 'EN_ROUTE', 'ON_SCENE');
