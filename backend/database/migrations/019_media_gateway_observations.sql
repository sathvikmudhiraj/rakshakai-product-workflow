CREATE TABLE IF NOT EXISTS ai_observations (
  id TEXT PRIMARY KEY,
  camera_id TEXT NOT NULL REFERENCES camera_sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  captured_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ai_observations_status_check CHECK (
    status IN ('PENDING_REVIEW', 'CONFIRMED', 'REJECTED', 'UNCERTAIN')
  )
);

CREATE INDEX IF NOT EXISTS idx_ai_observations_camera_time
  ON ai_observations(camera_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_observations_review_queue
  ON ai_observations(status, created_at DESC);
