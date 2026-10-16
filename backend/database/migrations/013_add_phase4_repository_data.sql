-- Repository adapters persist the complete record alongside typed columns.
-- These columns are added here for databases that already applied migration 008.
ALTER TABLE severity_recommendation_rules
  ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE investigation_categories
  ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
