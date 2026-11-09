-- Multi-Camera Tracking / Re-Identification tables
-- Tracks cross-camera subject continuity for persons and vehicles

-- Tracking sessions (one per reference detection to track across cameras)
CREATE TABLE IF NOT EXISTS tracking_sessions (
  id TEXT PRIMARY KEY,
  track_type TEXT NOT NULL CHECK (track_type IN ('PERSON', 'VEHICLE')),
  status TEXT NOT NULL CHECK (status IN ('SEARCHING', 'CANDIDATE_FOUND', 'HUMAN_REVIEW', 'CONFIRMED', 'REJECTED', 'CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reference_detection_id TEXT NOT NULL,
  reference_camera_id TEXT NOT NULL REFERENCES camera_sources(id) ON DELETE CASCADE,
  reference_timestamp TIMESTAMPTZ NOT NULL,
  last_seen_camera_id TEXT REFERENCES camera_sources(id) ON DELETE SET NULL,
  last_seen_at TIMESTAMPTZ,
  confidence DOUBLE PRECISION CHECK (confidence >= 0 AND confidence <= 1),
  verification_status TEXT CHECK (verification_status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'UNCERTAIN')),
  incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
  alert_id TEXT REFERENCES alerts(id) ON DELETE SET NULL,
  evidence_id TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Individual camera observations within a tracking session
CREATE TABLE IF NOT EXISTS tracking_observations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  camera_id TEXT NOT NULL REFERENCES camera_sources(id) ON DELETE CASCADE,
  detected_at TIMESTAMPTZ NOT NULL,
  detection_id TEXT,
  appearance_embedding JSONB,
  -- Person-specific fields
  upper_clothing_color TEXT,
  lower_clothing_color TEXT,
  clothing_type TEXT,
  carrying_bag TEXT CHECK (carrying_bag IN ('yes', 'no', 'unknown')),
  bag_description TEXT,
  helmet_hat TEXT,
  approx_height_cm INTEGER,
  body_build TEXT,
  movement_state TEXT CHECK (movement_state IN ('STANDING', 'WALKING', 'FAST_WALKING', 'RUNNING', 'UNKNOWN')),
  movement_speed_ms DOUBLE PRECISION,
  gait_embedding JSONB,
  activity_label TEXT,
  activity_confidence DOUBLE PRECISION,
  direction_degrees INTEGER CHECK (direction_degrees >= 0 AND direction_degrees < 360),
  -- Vehicle-specific fields
  plate_text TEXT,
  plate_confidence DOUBLE PRECISION CHECK (plate_confidence >= 0 AND plate_confidence <= 1),
  vehicle_color TEXT,
  vehicle_type TEXT CHECK (vehicle_type IN ('CAR', 'SUV', 'BIKE', 'AUTO', 'BUS', 'TRUCK', 'VAN', 'OTHER', 'unknown')),
  vehicle_brand TEXT,
  vehicle_model TEXT,
  brand_model_confidence DOUBLE PRECISION CHECK (brand_model_confidence >= 0 AND brand_model_confidence <= 1),
  distinctive_marks TEXT[],
  estimated_speed_kmh DOUBLE PRECISION,
  -- Common fields
  bounding_box JSONB,
  detection_confidence DOUBLE PRECISION CHECK (detection_confidence >= 0 AND detection_confidence <= 1),
  camera_health_status TEXT,
  camera_health_severity TEXT,
  frame_reference TEXT,
  video_clip_reference TEXT,
  ai_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Candidate matches between reference and other camera observations
CREATE TABLE IF NOT EXISTS tracking_candidates (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  observation_id TEXT NOT NULL REFERENCES tracking_observations(id) ON DELETE CASCADE,
  camera_id TEXT NOT NULL REFERENCES camera_sources(id) ON DELETE CASCADE,
  detected_at TIMESTAMPTZ NOT NULL,
  -- Explainable scoring components (0-1)
  appearance_similarity DOUBLE PRECISION CHECK (appearance_similarity >= 0 AND appearance_similarity <= 1),
  spatial_consistency DOUBLE PRECISION CHECK (spatial_consistency >= 0 AND spatial_consistency <= 1),
  timing_consistency DOUBLE PRECISION CHECK (timing_consistency >= 0 AND timing_consistency <= 1),
  direction_consistency DOUBLE PRECISION CHECK (direction_consistency >= 0 AND direction_consistency <= 1),
  activity_consistency DOUBLE PRECISION CHECK (activity_consistency >= 0 AND activity_consistency <= 1),
  -- Vehicle-specific scoring
  plate_similarity DOUBLE PRECISION CHECK (plate_similarity >= 0 AND plate_similarity <= 1),
  color_similarity DOUBLE PRECISION CHECK (color_similarity >= 0 AND color_similarity <= 1),
  vehicle_type_similarity DOUBLE PRECISION CHECK (vehicle_type_similarity >= 0 AND vehicle_type_similarity <= 1),
  brand_model_similarity DOUBLE PRECISION CHECK (brand_model_similarity >= 0 AND brand_model_similarity <= 1),
  distinctive_marks_similarity DOUBLE PRECISION CHECK (distinctive_marks_similarity >= 0 AND distinctive_marks_similarity <= 1),
  speed_consistency DOUBLE PRECISION CHECK (speed_consistency >= 0 AND speed_consistency <= 1),
  route_consistency DOUBLE PRECISION CHECK (route_consistency >= 0 AND route_consistency <= 1),
  -- Overall confidence
  overall_confidence DOUBLE PRECISION NOT NULL CHECK (overall_confidence >= 0 AND overall_confidence <= 1),
  status TEXT NOT NULL CHECK (status IN ('PENDING_REVIEW', 'CONFIRMED', 'REJECTED', 'UNCERTAIN')),
  match_explanation JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  review_reason TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Human verification records for candidate matches
CREATE TABLE IF NOT EXISTS tracking_verifications (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES tracking_candidates(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('CONFIRM_MATCH', 'REJECT_MATCH', 'UNCERTAIN')),
  ai_confidence DOUBLE PRECISION NOT NULL CHECK (ai_confidence >= 0 AND ai_confidence <= 1),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Camera adjacency/graph for spatial-temporal search optimization
CREATE TABLE IF NOT EXISTS camera_adjacency (
  id TEXT PRIMARY KEY,
  camera_a_id TEXT NOT NULL REFERENCES camera_sources(id) ON DELETE CASCADE,
  camera_b_id TEXT NOT NULL REFERENCES camera_sources(id) ON DELETE CASCADE,
  distance_meters DOUBLE PRECISION NOT NULL CHECK (distance_meters >= 0),
  expected_min_travel_seconds INTEGER NOT NULL CHECK (expected_min_travel_seconds >= 0),
  expected_max_travel_seconds INTEGER NOT NULL CHECK (expected_max_travel_seconds >= expected_min_travel_seconds),
  direction TEXT,
  route_type TEXT CHECK (route_type IN ('road', 'path', 'indoor', 'unknown')),
  is_bidirectional BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (camera_a_id, camera_b_id)
);

-- Configuration for scoring weights (backend-configurable)
CREATE TABLE IF NOT EXISTS tracking_score_config (
  id TEXT PRIMARY KEY,
  track_type TEXT NOT NULL CHECK (track_type IN ('PERSON', 'VEHICLE')),
  weight_key TEXT NOT NULL,
  weight_value DOUBLE PRECISION NOT NULL CHECK (weight_value >= 0),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (track_type, weight_key)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_status ON tracking_sessions(status);
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_type ON tracking_sessions(track_type);
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_created_by ON tracking_sessions(created_by);
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_incident ON tracking_sessions(incident_id);
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_reference_camera ON tracking_sessions(reference_camera_id);
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_reference_time ON tracking_sessions(reference_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_tracking_observations_session ON tracking_observations(session_id);
CREATE INDEX IF NOT EXISTS idx_tracking_observations_camera_time ON tracking_observations(camera_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_observations_detection ON tracking_observations(detection_id);

CREATE INDEX IF NOT EXISTS idx_tracking_candidates_session ON tracking_candidates(session_id);
CREATE INDEX IF NOT EXISTS idx_tracking_candidates_status ON tracking_candidates(status);
CREATE INDEX IF NOT EXISTS idx_tracking_candidates_camera ON tracking_candidates(camera_id);
CREATE INDEX IF NOT EXISTS idx_tracking_candidates_confidence ON tracking_candidates(overall_confidence DESC);

CREATE INDEX IF NOT EXISTS idx_tracking_verifications_session ON tracking_verifications(session_id);
CREATE INDEX IF NOT EXISTS idx_tracking_verifications_candidate ON tracking_verifications(candidate_id);
CREATE INDEX IF NOT EXISTS idx_tracking_verifications_actor ON tracking_verifications(actor_id);

CREATE INDEX IF NOT EXISTS idx_camera_adjacency_a ON camera_adjacency(camera_a_id);
CREATE INDEX IF NOT EXISTS idx_camera_adjacency_b ON camera_adjacency(camera_b_id);
CREATE INDEX IF NOT EXISTS idx_camera_adjacency_distance ON camera_adjacency(distance_meters);

CREATE INDEX IF NOT EXISTS idx_tracking_score_config_type ON tracking_score_config(track_type);