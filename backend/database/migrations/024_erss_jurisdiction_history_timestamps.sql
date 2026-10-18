-- Existing deployments created this table before repository timestamps were added.
-- CREATE TABLE IF NOT EXISTS in later schema snapshots cannot repair that drift.
ALTER TABLE erss_jurisdiction_history
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Preserve the historical event time rather than replacing it with migration time.
UPDATE erss_jurisdiction_history
SET created_at = COALESCE(created_at, changed_at),
    updated_at = COALESCE(updated_at, changed_at)
WHERE created_at IS NULL OR updated_at IS NULL;

ALTER TABLE erss_jurisdiction_history
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;
