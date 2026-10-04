CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('Admin', 'Police Officer', 'Citizen')),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  severity TEXT,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  incident_id TEXT,
  status TEXT NOT NULL,
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS police_stations (
  id TEXT PRIMARY KEY,
  station_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  jurisdiction TEXT,
  sector_coverage JSONB,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  operational BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS police_beats (
  id TEXT PRIMARY KEY,
  station_id TEXT NOT NULL,
  beat_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  jurisdiction TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  operational BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (station_id, beat_code),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS officer_ranks (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  level INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS police_officers (
  user_id TEXT PRIMARY KEY,
  badge_id TEXT UNIQUE,
  station_id TEXT NOT NULL,
  beat_id TEXT,
  rank_id TEXT NOT NULL,
  beat TEXT,
  jurisdiction TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  id TEXT UNIQUE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS response_units (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  assigned_incident_id TEXT,
  station_id TEXT,
  beat_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS dispatch_events (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  event_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS camera_sources (
  id TEXT PRIMARY KEY,
  status TEXT,
  source_type TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  incident_id TEXT,
  actor_id TEXT,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_incident_id_fkey;

CREATE TABLE IF NOT EXISTS missing_persons (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS evidence_custody_events (
  id TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION reject_evidence_custody_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'evidence custody events are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS evidence_custody_events_append_only ON evidence_custody_events;
CREATE TRIGGER evidence_custody_events_append_only
BEFORE UPDATE OR DELETE ON evidence_custody_events
FOR EACH ROW EXECUTE FUNCTION reject_evidence_custody_mutation();

DROP TRIGGER IF EXISTS evidence_custody_events_no_truncate ON evidence_custody_events;
CREATE TRIGGER evidence_custody_events_no_truncate
BEFORE TRUNCATE ON evidence_custody_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_evidence_custody_mutation();

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Foreign key constraints (added after all tables exist, idempotent)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_alerts_incident_id') THEN
        ALTER TABLE alerts
            ADD CONSTRAINT fk_alerts_incident_id
            FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE SET NULL;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_response_units_assigned_incident') THEN
        ALTER TABLE response_units
            ADD CONSTRAINT fk_response_units_assigned_incident
            FOREIGN KEY (assigned_incident_id) REFERENCES incidents(id) ON DELETE SET NULL;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_response_units_station') THEN
        ALTER TABLE response_units
            ADD CONSTRAINT fk_response_units_station
            FOREIGN KEY (station_id) REFERENCES police_stations(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_response_units_beat') THEN
        ALTER TABLE response_units
            ADD CONSTRAINT fk_response_units_beat
            FOREIGN KEY (beat_id) REFERENCES police_beats(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_police_beats_station') THEN
        ALTER TABLE police_beats
            ADD CONSTRAINT fk_police_beats_station
            FOREIGN KEY (station_id) REFERENCES police_stations(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_police_officers_user') THEN
        ALTER TABLE police_officers
            ADD CONSTRAINT fk_police_officers_user
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_police_officers_station') THEN
        ALTER TABLE police_officers
            ADD CONSTRAINT fk_police_officers_station
            FOREIGN KEY (station_id) REFERENCES police_stations(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_police_officers_beat') THEN
        ALTER TABLE police_officers
            ADD CONSTRAINT fk_police_officers_beat
            FOREIGN KEY (beat_id) REFERENCES police_beats(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_police_officers_rank') THEN
        ALTER TABLE police_officers
            ADD CONSTRAINT fk_police_officers_rank
            FOREIGN KEY (rank_id) REFERENCES officer_ranks(id);
    END IF;
END $$;

UPDATE users SET data = data - 'password' - 'passwordHash';

-- Composite unique index for station-beat FK references
CREATE UNIQUE INDEX IF NOT EXISTS uq_police_beats_station_id_id ON police_beats(station_id, id);

-- Composite FK for station-beat consistency (police_officers)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_police_officers_station_beat') THEN
        ALTER TABLE police_officers
            ADD CONSTRAINT fk_police_officers_station_beat
            FOREIGN KEY (station_id, beat_id)
            REFERENCES police_beats(station_id, id)
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;

-- Composite FK for station-beat consistency (response_units)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_response_units_station_beat') THEN
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

CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged ON alerts(acknowledged);
CREATE INDEX IF NOT EXISTS idx_response_units_status ON response_units(status);
CREATE INDEX IF NOT EXISTS idx_response_units_station_id ON response_units(station_id);
CREATE INDEX IF NOT EXISTS idx_response_units_beat_id ON response_units(beat_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_events_incident_id ON dispatch_events(incident_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_custody_evidence_time ON evidence_custody_events(evidence_id, occurred_at DESC);
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
