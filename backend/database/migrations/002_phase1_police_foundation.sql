-- Phase 1: Data Migration for Police Station, Beat, Officer Rank, and Officer Foundation
-- Populates normalized tables from existing JSONB data

-- 1. Migrate police_stations from app_state.operational.policeStations
INSERT INTO police_stations (id, station_code, name, jurisdiction, sector_coverage, latitude, longitude, operational, created_at, updated_at)
SELECT
    MAX(id) as id,
    station_code,
    MAX(name) as name,
    MAX(jurisdiction) as jurisdiction,
    MAX(sector_coverage::text)::jsonb as sector_coverage,
    MAX(latitude) as latitude,
    MAX(longitude) as longitude,
    MAX(operational::int)::boolean as operational,
    MAX(created_at) as created_at,
    MAX(updated_at) as updated_at
FROM (
    SELECT DISTINCT
        COALESCE(station_data->>'id', station_data->>'stationId', 'station_' || md5(concat(station_data->>'stationName', station_data->>'stationId'))) as id,
        COALESCE(station_data->>'stationId', station_data->>'station_code', 'PS-' || md5(station_data->>'stationName')) as station_code,
        COALESCE(station_data->>'stationName', station_data->>'name', 'Police Station') as name,
        COALESCE(station_data->>'jurisdiction', station_data->>'zone', station_data->>'beat') as jurisdiction,
        CASE
            WHEN station_data->>'sectorCoverage' IS NOT NULL THEN
                CASE
                    WHEN jsonb_typeof(station_data->'sectorCoverage') = 'array' THEN station_data->'sectorCoverage'
                    ELSE to_jsonb(string_to_array(station_data->>'sectorCoverage', ','))
                END
            WHEN station_data->>'beat' IS NOT NULL THEN
                to_jsonb(string_to_array(station_data->>'beat', ','))
            ELSE '[]'::jsonb
        END as sector_coverage,
        CASE
            WHEN station_data->>'latitude' IS NOT NULL THEN (station_data->>'latitude')::double precision
            WHEN station_data->>'lat' IS NOT NULL THEN (station_data->>'lat')::double precision
            ELSE NULL
        END as latitude,
        CASE
            WHEN station_data->>'longitude' IS NOT NULL THEN (station_data->>'longitude')::double precision
            WHEN station_data->>'lng' IS NOT NULL THEN (station_data->>'lng')::double precision
            ELSE NULL
        END as longitude,
        COALESCE((station_data->>'operational')::boolean, TRUE) as operational,
        COALESCE((station_data->>'created_at')::timestamptz, NOW()) as created_at,
        COALESCE((station_data->>'updated_at')::timestamptz, (station_data->>'lastUpdated')::timestamptz, NOW()) as updated_at
    FROM (
        SELECT jsonb_array_elements(data->'policeStations') as station_data
        FROM app_state
        WHERE key = 'operational' AND data ? 'policeStations'
    ) stations
) src
GROUP BY station_code
ON CONFLICT (station_code) DO UPDATE SET
    name = CASE WHEN EXCLUDED.name = 'Police Station' THEN police_stations.name ELSE EXCLUDED.name END,
    jurisdiction = COALESCE(EXCLUDED.jurisdiction, police_stations.jurisdiction),
    sector_coverage = EXCLUDED.sector_coverage,
    latitude = COALESCE(EXCLUDED.latitude, police_stations.latitude),
    longitude = COALESCE(EXCLUDED.longitude, police_stations.longitude),
    operational = EXCLUDED.operational,
    updated_at = EXCLUDED.updated_at;

-- 1b. Migrate police_stations from response_units.data
INSERT INTO police_stations (id, station_code, name, jurisdiction, sector_coverage, latitude, longitude, operational, created_at, updated_at)
SELECT
    MAX(id) as id,
    station_code,
    MAX(name) as name,
    MAX(jurisdiction) as jurisdiction,
    MAX(sector_coverage::text)::jsonb as sector_coverage,
    MAX(latitude) as latitude,
    MAX(longitude) as longitude,
    MAX(operational::int)::boolean as operational,
    MAX(created_at) as created_at,
    MAX(updated_at) as updated_at
FROM (
    SELECT DISTINCT
        COALESCE(station_data->>'id', station_data->>'stationId', 'station_' || md5(concat(station_data->>'stationName', station_data->>'stationId'))) as id,
        COALESCE(station_data->>'stationId', station_data->>'station_code', 'PS-' || md5(station_data->>'stationName')) as station_code,
        COALESCE(station_data->>'stationName', station_data->>'name', 'Police Station') as name,
        COALESCE(station_data->>'jurisdiction', station_data->>'zone', station_data->>'beat') as jurisdiction,
        CASE
            WHEN station_data->>'sectorCoverage' IS NOT NULL THEN
                CASE
                    WHEN jsonb_typeof(station_data->'sectorCoverage') = 'array' THEN station_data->'sectorCoverage'
                    ELSE to_jsonb(string_to_array(station_data->>'sectorCoverage', ','))
                END
            WHEN station_data->>'beat' IS NOT NULL THEN
                to_jsonb(string_to_array(station_data->>'beat', ','))
            ELSE '[]'::jsonb
        END as sector_coverage,
        CASE
            WHEN station_data->>'latitude' IS NOT NULL THEN (station_data->>'latitude')::double precision
            WHEN station_data->>'lat' IS NOT NULL THEN (station_data->>'lat')::double precision
            ELSE NULL
        END as latitude,
        CASE
            WHEN station_data->>'longitude' IS NOT NULL THEN (station_data->>'longitude')::double precision
            WHEN station_data->>'lng' IS NOT NULL THEN (station_data->>'lng')::double precision
            ELSE NULL
        END as longitude,
        COALESCE((station_data->>'operational')::boolean, TRUE) as operational,
        COALESCE((station_data->>'created_at')::timestamptz, NOW()) as created_at,
        COALESCE((station_data->>'updated_at')::timestamptz, (station_data->>'lastUpdated')::timestamptz, NOW()) as updated_at
    FROM (
        SELECT data::jsonb as station_data
        FROM response_units
        WHERE data ? 'stationId' OR data ? 'linkedStationId' OR data ? 'stationName'
    ) stations
) src
GROUP BY station_code
ON CONFLICT (station_code) DO UPDATE SET
    name = CASE WHEN EXCLUDED.name = 'Police Station' THEN police_stations.name ELSE EXCLUDED.name END,
    jurisdiction = COALESCE(EXCLUDED.jurisdiction, police_stations.jurisdiction),
    sector_coverage = EXCLUDED.sector_coverage,
    latitude = COALESCE(EXCLUDED.latitude, police_stations.latitude),
    longitude = COALESCE(EXCLUDED.longitude, police_stations.longitude),
    operational = EXCLUDED.operational,
    updated_at = EXCLUDED.updated_at;

-- 1c. Migrate police_stations from users.data (Police Officers)
INSERT INTO police_stations (id, station_code, name, jurisdiction, sector_coverage, latitude, longitude, operational, created_at, updated_at)
SELECT
    MAX(id) as id,
    station_code,
    MAX(name) as name,
    MAX(jurisdiction) as jurisdiction,
    MAX(sector_coverage::text)::jsonb as sector_coverage,
    MAX(latitude) as latitude,
    MAX(longitude) as longitude,
    MAX(operational::int)::boolean as operational,
    MAX(created_at) as created_at,
    MAX(updated_at) as updated_at
FROM (
    SELECT DISTINCT
        COALESCE(station_data->>'id', station_data->>'stationId', 'station_' || md5(concat(station_data->>'stationName', station_data->>'stationId'))) as id,
        COALESCE(station_data->>'stationId', station_data->>'station_code', 'PS-' || md5(station_data->>'stationName')) as station_code,
        COALESCE(station_data->>'stationName', station_data->>'name', 'Police Station') as name,
        COALESCE(station_data->>'jurisdiction', station_data->>'zone', station_data->>'beat') as jurisdiction,
        CASE
            WHEN station_data->>'sectorCoverage' IS NOT NULL THEN
                CASE
                    WHEN jsonb_typeof(station_data->'sectorCoverage') = 'array' THEN station_data->'sectorCoverage'
                    ELSE to_jsonb(string_to_array(station_data->>'sectorCoverage', ','))
                END
            WHEN station_data->>'beat' IS NOT NULL THEN
                to_jsonb(string_to_array(station_data->>'beat', ','))
            ELSE '[]'::jsonb
        END as sector_coverage,
        CASE
            WHEN station_data->>'latitude' IS NOT NULL THEN (station_data->>'latitude')::double precision
            WHEN station_data->>'lat' IS NOT NULL THEN (station_data->>'lat')::double precision
            ELSE NULL
        END as latitude,
        CASE
            WHEN station_data->>'longitude' IS NOT NULL THEN (station_data->>'longitude')::double precision
            WHEN station_data->>'lng' IS NOT NULL THEN (station_data->>'lng')::double precision
            ELSE NULL
        END as longitude,
        COALESCE((station_data->>'operational')::boolean, TRUE) as operational,
        COALESCE((station_data->>'created_at')::timestamptz, NOW()) as created_at,
        COALESCE((station_data->>'updated_at')::timestamptz, (station_data->>'lastUpdated')::timestamptz, NOW()) as updated_at
    FROM (
        SELECT data::jsonb as station_data
        FROM users
        WHERE role = 'Police Officer' AND (data ? 'stationId' OR data ? 'station' OR data ? 'stationName')
    ) stations
) src
GROUP BY station_code
ON CONFLICT (station_code) DO UPDATE SET
    name = CASE WHEN EXCLUDED.name = 'Police Station' THEN police_stations.name ELSE EXCLUDED.name END,
    jurisdiction = COALESCE(EXCLUDED.jurisdiction, police_stations.jurisdiction),
    sector_coverage = EXCLUDED.sector_coverage,
    latitude = COALESCE(EXCLUDED.latitude, police_stations.latitude),
    longitude = COALESCE(EXCLUDED.longitude, police_stations.longitude),
    operational = EXCLUDED.operational,
    updated_at = EXCLUDED.updated_at;

-- 2. Migrate beats from response_units data
INSERT INTO police_beats (id, station_id, beat_code, name, description, jurisdiction, latitude, longitude, operational, created_at, updated_at)
SELECT DISTINCT
    COALESCE('beat_' || md5(concat(ps.id, beat_data)), 'beat_' || md5(beat_data)) as id,
    ps.id as station_id,
    TRIM(beat_data) as beat_code,
    TRIM(beat_data) as name,
    NULL as description,
    COALESCE(station_data->>'jurisdiction', station_data->>'zone') as jurisdiction,
    CASE
        WHEN station_data->>'latitude' IS NOT NULL THEN (station_data->>'latitude')::double precision
        WHEN station_data->>'lat' IS NOT NULL THEN (station_data->>'lat')::double precision
        ELSE NULL
    END as latitude,
    CASE
        WHEN station_data->>'longitude' IS NOT NULL THEN (station_data->>'longitude')::double precision
        WHEN station_data->>'lng' IS NOT NULL THEN (station_data->>'lng')::double precision
        ELSE NULL
    END as longitude,
    TRUE as operational,
    NOW() as created_at,
    NOW() as updated_at
FROM (
    SELECT data::jsonb as station_data, data->>'stationId' as station_id_val, data->>'beat' as beat_data
    FROM response_units
    WHERE data ? 'beat' AND (data ? 'stationId' OR data ? 'linkedStationId')
) beats_data
JOIN police_stations ps ON ps.station_code = beats_data.station_id_val OR ps.id = beats_data.station_id_val OR ps.name = beats_data.station_data->>'stationName'
WHERE beat_data IS NOT NULL AND TRIM(beat_data) <> ''
ON CONFLICT (station_id, beat_code) DO UPDATE SET
    name = EXCLUDED.name,
    jurisdiction = EXCLUDED.jurisdiction,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    operational = EXCLUDED.operational,
    updated_at = EXCLUDED.updated_at;

-- 2b. Migrate beats from users data (Police Officers)
INSERT INTO police_beats (id, station_id, beat_code, name, description, jurisdiction, latitude, longitude, operational, created_at, updated_at)
SELECT DISTINCT
    COALESCE('beat_' || md5(concat(ps.id, beat_data)), 'beat_' || md5(beat_data)) as id,
    ps.id as station_id,
    TRIM(beat_data) as beat_code,
    TRIM(beat_data) as name,
    NULL as description,
    COALESCE(station_data->>'jurisdiction', station_data->>'zone') as jurisdiction,
    CASE
        WHEN station_data->>'latitude' IS NOT NULL THEN (station_data->>'latitude')::double precision
        WHEN station_data->>'lat' IS NOT NULL THEN (station_data->>'lat')::double precision
        ELSE NULL
    END as latitude,
    CASE
        WHEN station_data->>'longitude' IS NOT NULL THEN (station_data->>'longitude')::double precision
        WHEN station_data->>'lng' IS NOT NULL THEN (station_data->>'lng')::double precision
        ELSE NULL
    END as longitude,
    TRUE as operational,
    NOW() as created_at,
    NOW() as updated_at
FROM (
    SELECT data::jsonb as station_data, data->>'stationId' as station_id_val, data->>'beat' as beat_data
    FROM users
    WHERE role = 'Police Officer' AND data ? 'beat' AND data ? 'stationId'
) beats_data
JOIN police_stations ps ON ps.station_code = beats_data.station_id_val OR ps.id = beats_data.station_id_val OR ps.name = beats_data.station_data->>'stationName'
WHERE beat_data IS NOT NULL AND TRIM(beat_data) <> ''
ON CONFLICT (station_id, beat_code) DO UPDATE SET
    name = EXCLUDED.name,
    jurisdiction = EXCLUDED.jurisdiction,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    operational = EXCLUDED.operational,
    updated_at = EXCLUDED.updated_at;

-- 2c. Migrate beats from response_units linkedStationId
INSERT INTO police_beats (id, station_id, beat_code, name, description, jurisdiction, latitude, longitude, operational, created_at, updated_at)
SELECT DISTINCT
    COALESCE('beat_' || md5(concat(ps.id, beat_data)), 'beat_' || md5(beat_data)) as id,
    ps.id as station_id,
    TRIM(beat_data) as beat_code,
    TRIM(beat_data) as name,
    NULL as description,
    COALESCE(station_data->>'jurisdiction', station_data->>'zone') as jurisdiction,
    CASE
        WHEN station_data->>'latitude' IS NOT NULL THEN (station_data->>'latitude')::double precision
        WHEN station_data->>'lat' IS NOT NULL THEN (station_data->>'lat')::double precision
        ELSE NULL
    END as latitude,
    CASE
        WHEN station_data->>'longitude' IS NOT NULL THEN (station_data->>'longitude')::double precision
        WHEN station_data->>'lng' IS NOT NULL THEN (station_data->>'lng')::double precision
        ELSE NULL
    END as longitude,
    TRUE as operational,
    NOW() as created_at,
    NOW() as updated_at
FROM (
    SELECT data::jsonb as station_data, data->>'linkedStationId' as station_id_val, data->>'beat' as beat_data
    FROM response_units
    WHERE data ? 'beat' AND data ? 'linkedStationId'
) beats_data
JOIN police_stations ps ON ps.station_code = beats_data.station_id_val OR ps.id = beats_data.station_id_val OR ps.name = beats_data.station_data->>'stationName'
WHERE beat_data IS NOT NULL AND TRIM(beat_data) <> ''
ON CONFLICT (station_id, beat_code) DO UPDATE SET
    name = EXCLUDED.name,
    jurisdiction = EXCLUDED.jurisdiction,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    operational = EXCLUDED.operational,
    updated_at = EXCLUDED.updated_at;

-- 2d. Migrate beats from app_state policeStations
INSERT INTO police_beats (id, station_id, beat_code, name, description, jurisdiction, latitude, longitude, operational, created_at, updated_at)
SELECT DISTINCT
    COALESCE('beat_' || md5(concat(ps.id, beat_data)), 'beat_' || md5(beat_data)) as id,
    ps.id as station_id,
    TRIM(beat_data) as beat_code,
    TRIM(beat_data) as name,
    NULL as description,
    COALESCE(station_data->>'jurisdiction', station_data->>'zone') as jurisdiction,
    CASE
        WHEN station_data->>'latitude' IS NOT NULL THEN (station_data->>'latitude')::double precision
        WHEN station_data->>'lat' IS NOT NULL THEN (station_data->>'lat')::double precision
        ELSE NULL
    END as latitude,
    CASE
        WHEN station_data->>'longitude' IS NOT NULL THEN (station_data->>'longitude')::double precision
        WHEN station_data->>'lng' IS NOT NULL THEN (station_data->>'lng')::double precision
        ELSE NULL
    END as longitude,
    TRUE as operational,
    NOW() as created_at,
    NOW() as updated_at
FROM (
    SELECT station_data::jsonb, data->>'stationId' as station_id_val, station_data->>'beat' as beat_data
    FROM app_state, jsonb_array_elements(data->'policeStations') as station_data
    WHERE key = 'operational' AND data ? 'policeStations' AND station_data ? 'beat'
) beats_data
JOIN police_stations ps ON ps.station_code = beats_data.station_id_val OR ps.id = beats_data.station_id_val OR ps.name = beats_data.station_data->>'stationName'
WHERE beat_data IS NOT NULL AND TRIM(beat_data) <> ''
ON CONFLICT (station_id, beat_code) DO UPDATE SET
    name = EXCLUDED.name,
    jurisdiction = EXCLUDED.jurisdiction,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    operational = EXCLUDED.operational,
    updated_at = EXCLUDED.updated_at;

-- 3. Migrate police_officers from users with role 'Police Officer'
INSERT INTO police_officers (user_id, badge_id, station_id, beat_id, rank_id, beat, jurisdiction, active, created_at, updated_at)
SELECT
    u.id as user_id,
    u.data->>'badgeId' as badge_id,
    ps.id as station_id,
    pb.id as beat_id,
    COALESCE(orank.id, 'rank_si') as rank_id,
    u.data->>'beat' as beat,
    u.data->>'jurisdiction' as jurisdiction,
    TRUE as active,
    COALESCE((u.data->>'createdAt')::timestamptz, u.created_at, NOW()) as created_at,
    NOW() as updated_at
FROM users u
LEFT JOIN police_stations ps
    ON ps.station_code = u.data->>'stationId'
    OR ps.id = u.data->>'stationId'
    OR ps.name = u.data->>'stationName'
    OR ps.name = u.data->>'station'
LEFT JOIN police_beats pb
    ON pb.station_id = ps.id
    AND pb.beat_code = TRIM(u.data->>'beat')
LEFT JOIN officer_ranks orank
    ON orank.code = u.data->>'rank'
WHERE u.role = 'Police Officer'
ON CONFLICT (user_id) DO UPDATE SET
    badge_id = EXCLUDED.badge_id,
    station_id = EXCLUDED.station_id,
    beat_id = EXCLUDED.beat_id,
    rank_id = EXCLUDED.rank_id,
    beat = EXCLUDED.beat,
    jurisdiction = EXCLUDED.jurisdiction,
    active = EXCLUDED.active,
    updated_at = EXCLUDED.updated_at;

-- 4. Migrate response_units station_id and beat_id
UPDATE response_units
SET
    station_id = sub.ps_id,
    beat_id = sub.pb_id
FROM (
    SELECT
        ru.id as ru_id,
        ps.id as ps_id,
        pb.id as pb_id
    FROM response_units ru
    JOIN police_stations ps
        ON ps.station_code = ru.data->>'stationId'
        OR ps.station_code = ru.data->>'linkedStationId'
        OR ps.id = ru.data->>'stationId'
        OR ps.id = ru.data->>'linkedStationId'
        OR ps.name = ru.data->>'stationName'
        OR ps.name = ru.data->>'station'
    LEFT JOIN police_beats pb
        ON pb.station_id = ps.id
        AND pb.beat_code = TRIM(ru.data->>'beat')
    WHERE ru.station_id IS NULL OR ru.beat_id IS NULL
) sub
WHERE response_units.id = sub.ru_id;