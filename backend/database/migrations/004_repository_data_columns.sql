-- Phase 4: Repository persistence alignment
-- base.repository.upsert writes (id, <mapped columns>, data) for every
-- repository-backed table. The phase 1/2 tables predate that contract and are
-- missing the data JSONB blob; police_officers also lacks the `id` identity
-- column used by the repository layer (its primary key is user_id).

ALTER TABLE police_stations ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE police_beats ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE officer_ranks ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE police_officers ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE unit_capabilities ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE response_unit_members ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE dispatch_escalation_rules ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE dispatch_escalation_log ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Repository identity column for police_officers (table PK remains user_id).
ALTER TABLE police_officers ADD COLUMN IF NOT EXISTS id TEXT;
UPDATE police_officers SET id = user_id WHERE id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_police_officers_id ON police_officers(id);
