-- One row per transition; health alerts retain acknowledgement and resolution history.
CREATE TABLE IF NOT EXISTS camera_health_events (
  id TEXT PRIMARY KEY,
  camera_id TEXT NOT NULL REFERENCES camera_sources(id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  severity TEXT NOT NULL,
  reason TEXT NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS camera_health_alerts (
  id TEXT PRIMARY KEY,
  camera_id TEXT NOT NULL REFERENCES camera_sources(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  unique_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_camera_health_events_camera_time ON camera_health_events(camera_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_camera_health_alerts_active ON camera_health_alerts(camera_id, active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_camera_health_alerts_status ON camera_health_alerts(status, severity);
