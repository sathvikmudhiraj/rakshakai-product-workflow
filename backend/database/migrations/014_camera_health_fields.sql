-- Camera health state is independent from video-content AI observations.
ALTER TABLE camera_sources ADD COLUMN IF NOT EXISTS health_status TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE camera_sources ADD COLUMN IF NOT EXISTS health_severity TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE camera_sources ADD COLUMN IF NOT EXISTS criticality TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE camera_sources ADD COLUMN IF NOT EXISTS expected_fps DOUBLE PRECISION;
ALTER TABLE camera_sources ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;
ALTER TABLE camera_sources ADD COLUMN IF NOT EXISTS last_stream_received_at TIMESTAMPTZ;
ALTER TABLE camera_sources ADD COLUMN IF NOT EXISTS last_frame_received_at TIMESTAMPTZ;
ALTER TABLE camera_sources ADD COLUMN IF NOT EXISTS last_health_check_at TIMESTAMPTZ;
ALTER TABLE camera_sources ADD COLUMN IF NOT EXISTS health_issue_started_at TIMESTAMPTZ;
ALTER TABLE camera_sources ADD COLUMN IF NOT EXISTS last_healthy_at TIMESTAMPTZ;
ALTER TABLE camera_sources ADD COLUMN IF NOT EXISTS maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE camera_sources ADD COLUMN IF NOT EXISTS maintenance_reason TEXT;
ALTER TABLE camera_sources ADD COLUMN IF NOT EXISTS maintenance_started_by TEXT;
ALTER TABLE camera_sources ADD COLUMN IF NOT EXISTS maintenance_started_at TIMESTAMPTZ;
ALTER TABLE camera_sources ADD COLUMN IF NOT EXISTS maintenance_expected_return_at TIMESTAMPTZ;

ALTER TABLE camera_sources DROP CONSTRAINT IF EXISTS chk_camera_sources_health_status;
ALTER TABLE camera_sources ADD CONSTRAINT chk_camera_sources_health_status CHECK (health_status IN (
  'ONLINE','DEGRADED','LOW_FPS','HIGH_LATENCY','NO_SIGNAL','NO_VIDEO_FRAMES',
  'OBSTRUCTED','TAMPER_SUSPECTED','TAMPER_CONFIRMED','BLURRY','TOO_DARK',
  'STORAGE_ERROR','OFFLINE','MAINTENANCE','UNKNOWN'
));
ALTER TABLE camera_sources DROP CONSTRAINT IF EXISTS chk_camera_sources_criticality;
ALTER TABLE camera_sources ADD CONSTRAINT chk_camera_sources_criticality CHECK (criticality IN ('NORMAL','IMPORTANT','CRITICAL'));

CREATE INDEX IF NOT EXISTS idx_camera_sources_health_status ON camera_sources(health_status);
CREATE INDEX IF NOT EXISTS idx_camera_sources_maintenance_mode ON camera_sources(maintenance_mode) WHERE maintenance_mode = TRUE;
