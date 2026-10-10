-- Typed latest-observation fields for response-unit GPS telemetry.
-- Historical samples remain intentionally out of scope for this phase.
ALTER TABLE response_units ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE response_units ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE response_units ADD COLUMN IF NOT EXISTS location_accuracy DOUBLE PRECISION;
ALTER TABLE response_units ADD COLUMN IF NOT EXISTS location_captured_at TIMESTAMPTZ;
ALTER TABLE response_units ADD COLUMN IF NOT EXISTS location_received_at TIMESTAMPTZ;
ALTER TABLE response_units ADD COLUMN IF NOT EXISTS location_source TEXT;

ALTER TABLE response_units DROP CONSTRAINT IF EXISTS chk_response_units_latitude;
ALTER TABLE response_units ADD CONSTRAINT chk_response_units_latitude
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
ALTER TABLE response_units DROP CONSTRAINT IF EXISTS chk_response_units_longitude;
ALTER TABLE response_units ADD CONSTRAINT chk_response_units_longitude
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
ALTER TABLE response_units DROP CONSTRAINT IF EXISTS chk_response_units_location_accuracy;
ALTER TABLE response_units ADD CONSTRAINT chk_response_units_location_accuracy
  CHECK (location_accuracy IS NULL OR location_accuracy >= 0);

CREATE INDEX IF NOT EXISTS idx_response_units_location_captured_at
  ON response_units(location_captured_at DESC);
