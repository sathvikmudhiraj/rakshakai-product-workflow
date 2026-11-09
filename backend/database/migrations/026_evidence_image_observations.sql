-- Evidence metadata currently lives in app_state. This stable key registry gives
-- analysis and observation rows an enforceable reference without duplicating media.
CREATE TABLE IF NOT EXISTS evidence_references (id TEXT PRIMARY KEY);
INSERT INTO evidence_references (id)
SELECT item->>'id' FROM app_state, LATERAL jsonb_array_elements(COALESCE(data->'videoEvidence', '[]'::jsonb)) item
WHERE key = 'operational' AND NULLIF(item->>'id', '') IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS evidence_image_analyses (
  id TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL REFERENCES evidence_references(id),
  input_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL,
  UNIQUE (id, evidence_id)
);
CREATE INDEX IF NOT EXISTS idx_evidence_image_analyses_evidence ON evidence_image_analyses(evidence_id, created_at DESC);

ALTER TABLE ai_observations ALTER COLUMN camera_id DROP NOT NULL;
ALTER TABLE ai_observations ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'camera';
ALTER TABLE ai_observations ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE ai_observations ADD COLUMN IF NOT EXISTS evidence_id TEXT REFERENCES evidence_references(id);
ALTER TABLE ai_observations ADD COLUMN IF NOT EXISTS analysis_id TEXT REFERENCES evidence_image_analyses(id);
ALTER TABLE ai_observations DROP CONSTRAINT IF EXISTS ai_observations_evidence_analysis_fk;
ALTER TABLE ai_observations ADD CONSTRAINT ai_observations_evidence_analysis_fk
  FOREIGN KEY (analysis_id, evidence_id) REFERENCES evidence_image_analyses(id, evidence_id);
UPDATE ai_observations SET source_id = camera_id WHERE source_id IS NULL AND source_type = 'camera';
ALTER TABLE ai_observations ALTER COLUMN source_id SET NOT NULL;
ALTER TABLE ai_observations DROP CONSTRAINT IF EXISTS ai_observations_source_check;
ALTER TABLE ai_observations ADD CONSTRAINT ai_observations_source_check CHECK (
  (source_type = 'camera' AND camera_id IS NOT NULL AND source_id = camera_id AND evidence_id IS NULL AND analysis_id IS NULL)
  OR (source_type = 'evidence_image' AND camera_id IS NULL AND evidence_id IS NOT NULL AND source_id = evidence_id AND analysis_id IS NOT NULL)
  OR (source_type = 'browser_upload' AND camera_id IS NULL AND evidence_id IS NULL AND analysis_id IS NULL)
);
