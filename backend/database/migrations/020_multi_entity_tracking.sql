-- Extend human-reviewed tracking to the detector-supported entity families.
ALTER TABLE tracking_sessions DROP CONSTRAINT IF EXISTS tracking_sessions_track_type_check;
ALTER TABLE tracking_sessions ADD CONSTRAINT tracking_sessions_track_type_check
  CHECK (track_type IN ('PERSON', 'VEHICLE', 'OBJECT', 'ANIMAL'));

ALTER TABLE tracking_score_config DROP CONSTRAINT IF EXISTS tracking_score_config_track_type_check;
ALTER TABLE tracking_score_config ADD CONSTRAINT tracking_score_config_track_type_check
  CHECK (track_type IN ('PERSON', 'VEHICLE', 'OBJECT', 'ANIMAL'));
