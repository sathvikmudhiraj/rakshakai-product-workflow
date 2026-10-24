-- Migration 025: Fix station-beat compatibility and migrate missing beats
-- Fixes: missing station_id handling, duplicate station-beat migration issue, composite FK reference

-- 1. Fix composite foreign key: it should reference the primary key (station_id, id) on police_beats
-- Drop the incorrect composite FK and index
ALTER TABLE police_officers DROP CONSTRAINT IF EXISTS fk_police_officers_station_beat;
ALTER TABLE response_units DROP CONSTRAINT IF EXISTS fk_response_units_station_beat;
DROP INDEX IF EXISTS uq_police_beats_station_id_id;

-- 2. Create unique index on (station_id, id) for composite FK reference
CREATE UNIQUE INDEX IF NOT EXISTS uq_police_beats_station_id_id ON police_beats(station_id, id);

-- 3. Recreate composite FKs referencing the primary key (station_id, id)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_police_officers_station_beat' AND conrelid = 'police_officers'::regclass) THEN
        ALTER TABLE police_officers
            ADD CONSTRAINT fk_police_officers_station_beat
            FOREIGN KEY (station_id, beat_id)
            REFERENCES police_beats(station_id, id)
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_response_units_station_beat' AND conrelid = 'response_units'::regclass) THEN
        ALTER TABLE response_units
            ADD CONSTRAINT fk_response_units_station_beat
            FOREIGN KEY (station_id, beat_id)
            REFERENCES police_beats(station_id, id)
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;

-- 4. Migrate beats from police_stations.sector_coverage
INSERT INTO police_beats (id, station_id, beat_code, name, description, jurisdiction, latitude, longitude, operational, created_at, updated_at)
SELECT DISTINCT ON (ps.id, TRIM(beat_elem))
    'beat_' || md5(concat(ps.id, TRIM(beat_elem))) as id,
    ps.id as station_id,
    TRIM(beat_elem) as beat_code,
    TRIM(beat_elem) as name,
    NULL as description,
    ps.jurisdiction,
    ps.latitude,
    ps.longitude,
    TRUE as operational,
    NOW() as created_at,
    NOW() as updated_at
FROM police_stations ps,
     jsonb_array_elements_text(COALESCE(ps.sector_coverage, '[]'::jsonb)) as beat_elem
WHERE TRIM(beat_elem) <> ''
ON CONFLICT (station_id, beat_code) DO UPDATE SET
    name = EXCLUDED.name,
    jurisdiction = EXCLUDED.jurisdiction,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    operational = EXCLUDED.operational,
    updated_at = EXCLUDED.updated_at;

-- 5. Migrate beats from police_officers.beat
INSERT INTO police_beats (id, station_id, beat_code, name, description, jurisdiction, latitude, longitude, operational, created_at, updated_at)
SELECT DISTINCT ON (ps.id, TRIM(po.beat))
    'beat_' || md5(concat(ps.id, TRIM(po.beat))) as id,
    ps.id as station_id,
    TRIM(po.beat) as beat_code,
    TRIM(po.beat) as name,
    NULL as description,
    COALESCE(po.jurisdiction, ps.jurisdiction),
    ps.latitude,
    ps.longitude,
    TRUE as operational,
    NOW() as created_at,
    NOW() as updated_at
FROM police_officers po
JOIN police_stations ps ON ps.id = po.station_id
WHERE po.beat IS NOT NULL AND TRIM(po.beat) <> ''
ON CONFLICT (station_id, beat_code) DO UPDATE SET
    name = EXCLUDED.name,
    jurisdiction = EXCLUDED.jurisdiction,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    operational = EXCLUDED.operational,
    updated_at = EXCLUDED.updated_at;

-- 6. Migrate beats from response_units.data->>'beat'
INSERT INTO police_beats (id, station_id, beat_code, name, description, jurisdiction, latitude, longitude, operational, created_at, updated_at)
SELECT DISTINCT ON (ps.id, TRIM(ru.data->>'beat'))
    'beat_' || md5(concat(ps.id, TRIM(ru.data->>'beat'))) as id,
    ps.id as station_id,
    TRIM(ru.data->>'beat') as beat_code,
    TRIM(ru.data->>'beat') as name,
    NULL as description,
    COALESCE(ru.data->>'jurisdiction', ps.jurisdiction),
    ps.latitude,
    ps.longitude,
    TRUE as operational,
    NOW() as created_at,
    NOW() as updated_at
FROM response_units ru
JOIN police_stations ps ON ps.id = ru.station_id OR ps.station_code = ru.station_id
WHERE ru.data ? 'beat' AND ru.data->>'beat' IS NOT NULL AND TRIM(ru.data->>'beat') <> ''
ON CONFLICT (station_id, beat_code) DO UPDATE SET
    name = EXCLUDED.name,
    jurisdiction = EXCLUDED.jurisdiction,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    operational = EXCLUDED.operational,
    updated_at = EXCLUDED.updated_at;

-- 7. Update police_officers with correct beat_id (matching beat id)
UPDATE police_officers po
SET beat_id = pb.id
FROM police_beats pb
WHERE pb.station_id = po.station_id
  AND pb.beat_code = TRIM(po.beat)
  AND po.beat IS NOT NULL
  AND TRIM(po.beat) <> ''
  AND (po.beat_id IS NULL OR po.beat_id <> pb.id);

-- 8. Update response_units with correct beat_id (matching beat id from data)
UPDATE response_units ru
SET beat_id = pb.id
FROM police_beats pb
WHERE pb.station_id = ru.station_id
  AND pb.beat_code = TRIM(ru.data->>'beat')
  AND ru.data ? 'beat'
  AND ru.data->>'beat' IS NOT NULL
  AND TRIM(ru.data->>'beat') <> ''
  AND (ru.beat_id IS NULL OR ru.beat_id <> pb.id);

-- 9. Ensure station_id is properly set for response_units from data if missing
UPDATE response_units ru
SET station_id = ps.id
FROM police_stations ps
WHERE (ru.station_id IS NULL OR ru.station_id NOT IN (SELECT id FROM police_stations))
  AND (ps.id = ru.data->>'stationId' OR ps.station_code = ru.data->>'stationId' OR ps.id = ru.data->>'linkedStationId' OR ps.station_code = ru.data->>'linkedStationId' OR ps.name = ru.data->>'stationName')
  AND ru.id IS NOT NULL;