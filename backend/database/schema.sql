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
  response_requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
  dispatch_recommendation JSONB,
  support_allocations JSONB NOT NULL DEFAULT '[]'::jsonb,
  dispatch_confirmed_at TIMESTAMPTZ,
  dispatch_confirmed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  assignment_breached_at TIMESTAMPTZ,
  response_breached_at TIMESTAMPTZ,
  escalation_l2_at TIMESTAMPTZ,
  escalation_l3_at TIMESTAMPTZ,
  escalation_l4_at TIMESTAMPTZ,
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
  duty_status TEXT NOT NULL DEFAULT 'on_duty',
  availability_status TEXT NOT NULL DEFAULT 'available',
  assigned_incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
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
  latitude DOUBLE PRECISION CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  location_accuracy DOUBLE PRECISION CHECK (location_accuracy IS NULL OR location_accuracy >= 0),
  location_captured_at TIMESTAMPTZ,
  location_received_at TIMESTAMPTZ,
  location_source TEXT,
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
CREATE INDEX IF NOT EXISTS idx_response_units_location_captured_at ON response_units(location_captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_police_officers_dispatch_availability ON police_officers(station_id, active, duty_status, availability_status);
CREATE INDEX IF NOT EXISTS idx_police_officers_assigned_incident ON police_officers(assigned_incident_id);
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

-- ERSS-112 Emergency Response System Tables
CREATE TABLE IF NOT EXISTS erss_events (
    id TEXT PRIMARY KEY,
    external_event_id TEXT,
    channel TEXT NOT NULL CHECK (channel IN ('VOICE_CALL', 'SMS', 'SOS', 'APP', 'WEB', 'IOT', 'EXTERNAL_EVENT')),
    simulated BOOLEAN NOT NULL DEFAULT FALSE,
    caller_reference TEXT,
    caller_latitude DOUBLE PRECISION,
    caller_longitude DOUBLE PRECISION,
    caller_location_text TEXT,
    incident_latitude DOUBLE PRECISION,
    incident_longitude DOUBLE PRECISION,
    incident_location_text TEXT,
    location_source TEXT NOT NULL CHECK (location_source IN ('CALLER_CONFIRMED', 'GPS', 'DEVICE', 'MANUAL_OPERATOR', 'REVERSE_GEOCODED', 'EXTERNAL_EVENT', 'UNKNOWN')),
    location_confidence TEXT CHECK (location_confidence IN ('high', 'medium', 'low')),
    jurisdiction_id TEXT REFERENCES police_stations(id) ON DELETE SET NULL,
    emergency_type TEXT NOT NULL CHECK (emergency_type IN ('POLICE', 'FIRE', 'MEDICAL', 'DISASTER', 'MULTI_SERVICE', 'ASSESSING')),
    priority TEXT NOT NULL CHECK (priority IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'ASSESSING')),
    call_status TEXT NOT NULL CHECK (call_status IN ('IN_PROGRESS', 'COMPLETED', 'DROPPED', 'CALLBACK')),
    triage_status TEXT NOT NULL CHECK (triage_status IN ('RECEIVED', 'CALL_IN_PROGRESS', 'TRIAGING', 'ACTIONABLE', 'VERIFYING', 'ACCIDENTAL', 'FALSE_ALARM', 'NUISANCE', 'DISPATCH_RECOMMENDED', 'DISPATCHED', 'LEGAL_REVIEW', 'CLOSED')),
    dispatcher_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
    call_taker_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS erss_calls (
    id TEXT PRIMARY KEY,
    erss_event_id TEXT NOT NULL REFERENCES erss_events(id) ON DELETE CASCADE,
    call_taker_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ENDED', 'TRANSFERRED', 'ON_HOLD')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    transcript TEXT,
    ai_summary TEXT,
    ai_suggestions JSONB,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS erss_triage (
    id TEXT PRIMARY KEY,
    erss_event_id TEXT NOT NULL REFERENCES erss_events(id) ON DELETE CASCADE,
    call_taker_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    emergency_type TEXT NOT NULL CHECK (emergency_type IN ('POLICE', 'FIRE', 'MEDICAL', 'DISASTER', 'MULTI_SERVICE')),
    priority TEXT NOT NULL CHECK (priority IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    caller_location_verified BOOLEAN NOT NULL DEFAULT FALSE,
    incident_location_verified BOOLEAN NOT NULL DEFAULT FALSE,
    immediate_danger BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT,
    ai_emergency_type_suggestion TEXT,
    ai_priority_suggestion TEXT,
    ai_jurisdiction_suggestion TEXT,
    human_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    action_taken TEXT CHECK (action_taken IN ('FORWARD_TO_DISPATCH', 'MARK_ACCIDENTAL', 'MARK_FALSE_ALARM', 'MARK_NUISANCE', 'ESCALATE_SUPERVISOR', 'NEED_VERIFICATION')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS erss_dispatch_requests (
    id TEXT PRIMARY KEY,
    erss_event_id TEXT NOT NULL REFERENCES erss_events(id) ON DELETE CASCADE,
    incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
    dispatcher_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    recommended_services JSONB NOT NULL DEFAULT '[]'::jsonb,
    primary_recommendation JSONB,
    fallback_recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'MODIFIED', 'ESCALATED')),
    approved_at TIMESTAMPTZ,
    approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS erss_unit_requests (
    id TEXT PRIMARY KEY,
    erss_dispatch_request_id TEXT NOT NULL REFERENCES erss_dispatch_requests(id) ON DELETE CASCADE,
    erss_event_id TEXT NOT NULL REFERENCES erss_events(id) ON DELETE CASCADE,
    unit_id TEXT NOT NULL REFERENCES response_units(id) ON DELETE RESTRICT,
    station_id TEXT REFERENCES police_stations(id) ON DELETE SET NULL,
    service_type TEXT NOT NULL CHECK (service_type IN ('POLICE', 'FIRE', 'MEDICAL', 'DISASTER')),
    status TEXT NOT NULL CHECK (status IN ('REQUESTED', 'ACKNOWLEDGED', 'ACCEPTED', 'UNAVAILABLE', 'DECLINED', 'TIMEOUT', 'CANCELLED', 'ESCALATED')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    dispatched_at TIMESTAMPTZ,
    timeout_at TIMESTAMPTZ,
    ack_timeout_seconds INTEGER NOT NULL DEFAULT 60,
    fallback_unit_id TEXT REFERENCES response_units(id) ON DELETE SET NULL,
    fallback_recommended_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS erss_assistance_requests (
    id TEXT PRIMARY KEY,
    erss_event_id TEXT NOT NULL REFERENCES erss_events(id) ON DELETE CASCADE,
    requesting_station_id TEXT NOT NULL REFERENCES police_stations(id) ON DELETE RESTRICT,
    requested_station_id TEXT NOT NULL REFERENCES police_stations(id) ON DELETE RESTRICT,
    incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
    priority TEXT NOT NULL CHECK (priority IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    reason TEXT NOT NULL,
    suggested_unit_id TEXT REFERENCES response_units(id) ON DELETE SET NULL,
    suggested_eta_minutes INTEGER,
    status TEXT NOT NULL CHECK (status IN ('REQUESTED', 'ACKNOWLEDGED', 'ACCEPTED', 'DECLINED', 'UNAVAILABLE', 'TIMEOUT', 'ESCALATED', 'CANCELLED', 'COMPLETED')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    declined_at TIMESTAMPTZ,
    decline_reason TEXT CHECK (decline_reason IN ('NO_AVAILABLE_UNIT', 'ACTIVE_CRITICAL_INCIDENT', 'ROAD_BLOCKED', 'RESOURCE_UNSUITABLE', 'SERVICE_UNAVAILABLE', 'OTHER')),
    decline_notes TEXT,
    timeout_at TIMESTAMPTZ,
    ack_timeout_seconds INTEGER NOT NULL DEFAULT 120,
    escalated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS erss_jurisdiction_history (
    id TEXT PRIMARY KEY,
    erss_event_id TEXT NOT NULL REFERENCES erss_events(id) ON DELETE CASCADE,
    old_jurisdiction_id TEXT REFERENCES police_stations(id) ON DELETE SET NULL,
    new_jurisdiction_id TEXT NOT NULL REFERENCES police_stations(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL,
    changed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS erss_ownership_transfers (
    id TEXT PRIMARY KEY,
    erss_event_id TEXT NOT NULL REFERENCES erss_events(id) ON DELETE CASCADE,
    incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
    from_station_id TEXT NOT NULL REFERENCES police_stations(id) ON DELETE RESTRICT,
    to_station_id TEXT NOT NULL REFERENCES police_stations(id) ON DELETE RESTRICT,
    requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('TRANSFER_REQUESTED', 'TARGET_ACKNOWLEDGED', 'OWNERSHIP_TRANSFERRED', 'REJECTED', 'CANCELLED')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    transferred_at TIMESTAMPTZ,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Indexes for ERSS-112 tables
CREATE INDEX IF NOT EXISTS idx_erss_events_caller_location ON erss_events(caller_latitude, caller_longitude);
CREATE INDEX IF NOT EXISTS idx_erss_events_incident_location ON erss_events(incident_latitude, incident_longitude);
CREATE INDEX IF NOT EXISTS idx_erss_events_jurisdiction ON erss_events(jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_erss_events_triage_status ON erss_events(triage_status);
CREATE INDEX IF NOT EXISTS idx_erss_events_call_status ON erss_events(call_status);
CREATE INDEX IF NOT EXISTS idx_erss_events_priority ON erss_events(priority);
CREATE INDEX IF NOT EXISTS idx_erss_events_created_at ON erss_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_erss_events_call_taker ON erss_events(call_taker_id);
CREATE INDEX IF NOT EXISTS idx_erss_events_dispatcher ON erss_events(dispatcher_id);
CREATE INDEX IF NOT EXISTS idx_erss_events_incident ON erss_events(incident_id);
CREATE INDEX IF NOT EXISTS idx_erss_calls_event ON erss_calls(erss_event_id);
CREATE INDEX IF NOT EXISTS idx_erss_calls_taker ON erss_calls(call_taker_id);
CREATE INDEX IF NOT EXISTS idx_erss_triage_event ON erss_triage(erss_event_id);
CREATE INDEX IF NOT EXISTS idx_erss_triage_taker ON erss_triage(call_taker_id);
CREATE INDEX IF NOT EXISTS idx_erss_dispatch_requests_event ON erss_dispatch_requests(erss_event_id);
CREATE INDEX IF NOT EXISTS idx_erss_dispatch_requests_dispatcher ON erss_dispatch_requests(dispatcher_id);
CREATE INDEX IF NOT EXISTS idx_erss_dispatch_requests_status ON erss_dispatch_requests(status);
CREATE INDEX IF NOT EXISTS idx_erss_unit_requests_dispatch ON erss_unit_requests(erss_dispatch_request_id);
CREATE INDEX IF NOT EXISTS idx_erss_unit_requests_event ON erss_unit_requests(erss_event_id);
CREATE INDEX IF NOT EXISTS idx_erss_unit_requests_unit ON erss_unit_requests(unit_id);
CREATE INDEX IF NOT EXISTS idx_erss_unit_requests_status ON erss_unit_requests(status);
CREATE INDEX IF NOT EXISTS idx_erss_assistance_requests_event ON erss_assistance_requests(erss_event_id);
CREATE INDEX IF NOT EXISTS idx_erss_assistance_requests_requesting ON erss_assistance_requests(requesting_station_id);
CREATE INDEX IF NOT EXISTS idx_erss_assistance_requests_requested ON erss_assistance_requests(requested_station_id);
CREATE INDEX IF NOT EXISTS idx_erss_assistance_requests_status ON erss_assistance_requests(status);
CREATE INDEX IF NOT EXISTS idx_erss_jurisdiction_history_event ON erss_jurisdiction_history(erss_event_id);
CREATE INDEX IF NOT EXISTS idx_erss_ownership_transfers_event ON erss_ownership_transfers(erss_event_id);
CREATE INDEX IF NOT EXISTS idx_erss_ownership_transfers_status ON erss_ownership_transfers(status);
