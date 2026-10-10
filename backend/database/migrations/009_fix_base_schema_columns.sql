-- Migration to add missing base schema columns to existing tables
-- This fixes the issue where base schema was not fully applied because tables already existed

-- response_units: Add GPS/location columns from base schema
ALTER TABLE response_units ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
ALTER TABLE response_units ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
ALTER TABLE response_units ADD COLUMN IF NOT EXISTS location_accuracy DOUBLE PRECISION CHECK (location_accuracy IS NULL OR location_accuracy >= 0);
ALTER TABLE response_units ADD COLUMN IF NOT EXISTS location_captured_at TIMESTAMPTZ;
ALTER TABLE response_units ADD COLUMN IF NOT EXISTS location_received_at TIMESTAMPTZ;
ALTER TABLE response_units ADD COLUMN IF NOT EXISTS location_source TEXT;

-- incidents: Add base schema columns that might be missing
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS response_requirements JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS dispatch_recommendation JSONB;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS support_allocations JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS dispatch_confirmed_at TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS dispatch_confirmed_by TEXT REFERENCES users(id) ON DELETE SET NULL;

-- alerts: Add base schema columns
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS incident_id TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS acknowledged BOOLEAN NOT NULL DEFAULT FALSE;

-- Create indexes from base schema
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged ON alerts(acknowledged);
CREATE INDEX IF NOT EXISTS idx_response_units_status ON response_units(status);
CREATE INDEX IF NOT EXISTS idx_response_units_station_id ON response_units(station_id);
CREATE INDEX IF NOT EXISTS idx_response_units_beat_id ON response_units(beat_id);
CREATE INDEX IF NOT EXISTS idx_response_units_location_captured_at ON response_units(location_captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_police_stations_operational ON police_stations(operational);
CREATE INDEX IF NOT EXISTS idx_police_stations_station_code ON police_stations(station_code);
CREATE INDEX IF NOT EXISTS idx_police_beats_station_id ON police_beats(station_id);
CREATE INDEX IF NOT EXISTS idx_police_beats_operational ON police_beats(operational);
CREATE INDEX IF NOT EXISTS idx_police_beats_station_operational ON police_beats(station_id, operational);
CREATE INDEX IF NOT EXISTS idx_officer_ranks_code ON officer_ranks(code);
CREATE INDEX IF NOT EXISTS idx_officer_ranks_active ON officer_ranks(active);
CREATE INDEX IF NOT EXISTS idx_officer_ranks_level ON officer_ranks(level);
CREATE INDEX IF NOT EXISTS idx_police_officers_station_id ON police_officers(station_id);
CREATE INDEX IF NOT EXISTS idx_police_officers_beat_id ON police_officers(beat_id);
CREATE INDEX IF NOT EXISTS idx_police_officers_rank_id ON police_officers(rank_id);
CREATE INDEX IF NOT EXISTS idx_police_officers_active ON police_officers(active);
CREATE INDEX IF NOT EXISTS idx_police_officers_badge_id ON police_officers(badge_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_events_incident_id ON dispatch_events(incident_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_custody_evidence_time ON evidence_custody_events(evidence_id, occurred_at DESC);

-- Foreign key constraints
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_alerts_incident_id' AND conrelid = 'alerts'::regclass) THEN
        ALTER TABLE alerts
            ADD CONSTRAINT fk_alerts_incident_id
            FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE SET NULL;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_response_units_assigned_incident' AND conrelid = 'response_units'::regclass) THEN
        ALTER TABLE response_units
            ADD CONSTRAINT fk_response_units_assigned_incident
            FOREIGN KEY (assigned_incident_id) REFERENCES incidents(id) ON DELETE SET NULL;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_response_units_station' AND conrelid = 'response_units'::regclass) THEN
        ALTER TABLE response_units
            ADD CONSTRAINT fk_response_units_station
            FOREIGN KEY (station_id) REFERENCES police_stations(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_response_units_beat' AND conrelid = 'response_units'::regclass) THEN
        ALTER TABLE response_units
            ADD CONSTRAINT fk_response_units_beat
            FOREIGN KEY (beat_id) REFERENCES police_beats(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_police_beats_station' AND conrelid = 'police_beats'::regclass) THEN
        ALTER TABLE police_beats
            ADD CONSTRAINT fk_police_beats_station
            FOREIGN KEY (station_id) REFERENCES police_stations(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_police_officers_user' AND conrelid = 'police_officers'::regclass) THEN
        ALTER TABLE police_officers
            ADD CONSTRAINT fk_police_officers_user
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_police_officers_station' AND conrelid = 'police_officers'::regclass) THEN
        ALTER TABLE police_officers
            ADD CONSTRAINT fk_police_officers_station
            FOREIGN KEY (station_id) REFERENCES police_stations(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_police_officers_beat' AND conrelid = 'police_officers'::regclass) THEN
        ALTER TABLE police_officers
            ADD CONSTRAINT fk_police_officers_beat
            FOREIGN KEY (beat_id) REFERENCES police_beats(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_police_officers_rank' AND conrelid = 'police_officers'::regclass) THEN
        ALTER TABLE police_officers
            ADD CONSTRAINT fk_police_officers_rank
            FOREIGN KEY (rank_id) REFERENCES officer_ranks(id);
    END IF;
END $$;

-- Composite unique index for station-beat FK references
CREATE UNIQUE INDEX IF NOT EXISTS uq_police_beats_station_id_id ON police_beats(station_id, id);

-- Composite FK for station-beat consistency (police_officers)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_police_officers_station_beat' AND conrelid = 'police_officers'::regclass) THEN
        ALTER TABLE police_officers
            ADD CONSTRAINT fk_police_officers_station_beat
            FOREIGN KEY (station_id, beat_id)
            REFERENCES police_beats(station_id, id)
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;

-- Composite FK for station-beat consistency (response_units)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_response_units_station_beat' AND conrelid = 'response_units'::regclass) THEN
        ALTER TABLE response_units
            ADD CONSTRAINT fk_response_units_station_beat
            FOREIGN KEY (station_id, beat_id)
            REFERENCES police_beats(station_id, id)
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;

-- Seed minimum required officer ranks
INSERT INTO officer_ranks (id, code, name, level, active) VALUES
    ('rank_si', 'SI', 'Sub-Inspector', 10, TRUE),
    ('rank_asi', 'ASI', 'Assistant Sub-Inspector', 5, TRUE),
    ('rank_ci', 'CI', 'Circle Inspector', 15, TRUE)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    level = EXCLUDED.level,
    active = EXCLUDED.active;
