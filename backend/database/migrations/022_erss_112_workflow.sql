-- ERSS-112 structures for installations created before ERSS was added to schema.sql.
CREATE TABLE IF NOT EXISTS erss_events (
  id TEXT PRIMARY KEY, external_event_id TEXT, channel TEXT NOT NULL CHECK (channel IN ('VOICE_CALL','SMS','SOS','APP','WEB','IOT','EXTERNAL_EVENT')), simulated BOOLEAN NOT NULL DEFAULT FALSE,
  caller_reference TEXT, caller_latitude DOUBLE PRECISION, caller_longitude DOUBLE PRECISION, caller_location_text TEXT,
  incident_latitude DOUBLE PRECISION, incident_longitude DOUBLE PRECISION, incident_location_text TEXT,
  location_source TEXT NOT NULL, location_confidence TEXT, jurisdiction_id TEXT REFERENCES police_stations(id) ON DELETE SET NULL,
  emergency_type TEXT NOT NULL CHECK (emergency_type IN ('POLICE','FIRE','MEDICAL','DISASTER','MULTI_SERVICE','ASSESSING')), priority TEXT NOT NULL CHECK (priority IN ('CRITICAL','HIGH','MEDIUM','LOW','ASSESSING')), call_status TEXT NOT NULL CHECK (call_status IN ('IN_PROGRESS','COMPLETED','DROPPED','CALLBACK')), triage_status TEXT NOT NULL CHECK (triage_status IN ('RECEIVED','CALL_IN_PROGRESS','TRIAGING','ACTIONABLE','VERIFYING','ACCIDENTAL','FALSE_ALARM','NUISANCE','DISPATCH_RECOMMENDED','DISPATCHED','LEGAL_REVIEW','CLOSED')),
  dispatcher_id TEXT REFERENCES users(id) ON DELETE SET NULL, incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
  call_taker_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), closed_at TIMESTAMPTZ, data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS erss_calls (
  id TEXT PRIMARY KEY, erss_event_id TEXT NOT NULL REFERENCES erss_events(id) ON DELETE CASCADE,
  call_taker_id TEXT REFERENCES users(id) ON DELETE SET NULL, status TEXT NOT NULL CHECK (status IN ('ACTIVE','ENDED')), started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ, duration_seconds INTEGER, transcript TEXT, ai_summary TEXT, ai_suggestions JSONB, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS erss_triage (
  id TEXT PRIMARY KEY, erss_event_id TEXT NOT NULL REFERENCES erss_events(id) ON DELETE CASCADE,
  call_taker_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, emergency_type TEXT NOT NULL, priority TEXT NOT NULL,
  caller_location_verified BOOLEAN NOT NULL DEFAULT FALSE, incident_location_verified BOOLEAN NOT NULL DEFAULT FALSE,
  immediate_danger BOOLEAN NOT NULL DEFAULT FALSE, description TEXT, ai_emergency_type_suggestion TEXT,
  ai_priority_suggestion TEXT, ai_jurisdiction_suggestion TEXT, human_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  action_taken TEXT CHECK (action_taken IN ('MARK_ACTIONABLE','NEED_VERIFICATION','MARK_ACCIDENTAL','MARK_FALSE_ALARM','MARK_NUISANCE','FORWARD_TO_DISPATCH','ESCALATE_TO_SUPERVISOR')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS erss_dispatch_requests (
  id TEXT PRIMARY KEY, erss_event_id TEXT NOT NULL REFERENCES erss_events(id) ON DELETE CASCADE,
  incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL, dispatcher_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recommended_services JSONB NOT NULL DEFAULT '[]'::jsonb, primary_recommendation JSONB, fallback_recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','MODIFIED','ESCALATED')), approved_at TIMESTAMPTZ, approved_by TEXT REFERENCES users(id) ON DELETE SET NULL, rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS erss_unit_requests (
  id TEXT PRIMARY KEY, erss_dispatch_request_id TEXT NOT NULL REFERENCES erss_dispatch_requests(id) ON DELETE CASCADE,
  erss_event_id TEXT NOT NULL REFERENCES erss_events(id) ON DELETE CASCADE, unit_id TEXT NOT NULL REFERENCES response_units(id) ON DELETE RESTRICT,
  station_id TEXT REFERENCES police_stations(id) ON DELETE SET NULL, service_type TEXT NOT NULL CHECK (service_type IN ('POLICE','FIRE','MEDICAL','DISASTER')), status TEXT NOT NULL CHECK (status IN ('REQUESTED','ACKNOWLEDGED','ACCEPTED','UNAVAILABLE','DECLINED','TIMEOUT','CANCELLED','ESCALATED')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), acknowledged_at TIMESTAMPTZ, accepted_at TIMESTAMPTZ, dispatched_at TIMESTAMPTZ,
  timeout_at TIMESTAMPTZ, ack_timeout_seconds INTEGER NOT NULL DEFAULT 60, fallback_unit_id TEXT REFERENCES response_units(id) ON DELETE SET NULL,
  fallback_recommended_at TIMESTAMPTZ, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS erss_assistance_requests (
  id TEXT PRIMARY KEY, erss_event_id TEXT NOT NULL REFERENCES erss_events(id) ON DELETE CASCADE,
  requesting_station_id TEXT NOT NULL REFERENCES police_stations(id) ON DELETE RESTRICT,
  requested_station_id TEXT NOT NULL REFERENCES police_stations(id) ON DELETE RESTRICT, incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
  priority TEXT NOT NULL CHECK (priority IN ('CRITICAL','HIGH','MEDIUM','LOW')), reason TEXT NOT NULL, suggested_unit_id TEXT REFERENCES response_units(id) ON DELETE SET NULL,
  suggested_eta_minutes INTEGER, status TEXT NOT NULL CHECK (status IN ('REQUESTED','ACKNOWLEDGED','ACCEPTED','DECLINED','UNAVAILABLE','TIMEOUT','ESCALATED','CANCELLED','COMPLETED')), requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), acknowledged_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ, declined_at TIMESTAMPTZ, decline_reason TEXT, decline_notes TEXT, timeout_at TIMESTAMPTZ,
  ack_timeout_seconds INTEGER NOT NULL DEFAULT 120, escalated_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS erss_jurisdiction_history (
  id TEXT PRIMARY KEY, erss_event_id TEXT NOT NULL REFERENCES erss_events(id) ON DELETE CASCADE,
  old_jurisdiction_id TEXT REFERENCES police_stations(id) ON DELETE SET NULL, new_jurisdiction_id TEXT NOT NULL REFERENCES police_stations(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL, changed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS erss_ownership_transfers (
  id TEXT PRIMARY KEY, erss_event_id TEXT NOT NULL REFERENCES erss_events(id) ON DELETE CASCADE, incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
  from_station_id TEXT NOT NULL REFERENCES police_stations(id) ON DELETE RESTRICT, to_station_id TEXT NOT NULL REFERENCES police_stations(id) ON DELETE RESTRICT,
  requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, status TEXT NOT NULL CHECK (status IN ('TRANSFER_REQUESTED','TARGET_ACKNOWLEDGED','OWNERSHIP_TRANSFERRED','REJECTED','CANCELLED')), requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ, transferred_at TIMESTAMPTZ, reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_erss_events_created_at ON erss_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_erss_events_jurisdiction ON erss_events(jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_erss_events_triage_status ON erss_events(triage_status);
CREATE INDEX IF NOT EXISTS idx_erss_dispatch_requests_event ON erss_dispatch_requests(erss_event_id);
CREATE INDEX IF NOT EXISTS idx_erss_unit_requests_unit ON erss_unit_requests(unit_id);
CREATE INDEX IF NOT EXISTS idx_erss_assistance_requests_requested ON erss_assistance_requests(requested_station_id);
CREATE INDEX IF NOT EXISTS idx_erss_unit_requests_event ON erss_unit_requests(erss_event_id);
CREATE INDEX IF NOT EXISTS idx_erss_assistance_requests_event ON erss_assistance_requests(erss_event_id);
