-- Phase 2: Response Unit Members, Capabilities, Escalation & Auto-Dispatch
-- Adds capability-based dispatch, auto-escalation, and unit crew management

-- 1. RESPONSE UNIT MEMBERS TABLE
CREATE TABLE IF NOT EXISTS response_unit_members (
    id TEXT PRIMARY KEY,
    unit_id TEXT NOT NULL REFERENCES response_units(id) ON DELETE CASCADE,
    officer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member', -- 'driver', 'commander', 'member', 'medic'
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (unit_id, officer_user_id),
    data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_response_unit_members_unit_id ON response_unit_members(unit_id);
CREATE INDEX IF NOT EXISTS idx_response_unit_members_officer_user_id ON response_unit_members(officer_user_id);

-- 2. UNIT CAPABILITIES TABLE
CREATE TABLE IF NOT EXISTS unit_capabilities (
    id TEXT PRIMARY KEY,
    unit_id TEXT NOT NULL REFERENCES response_units(id) ON DELETE CASCADE,
    capability_type TEXT NOT NULL, -- 'fire', 'medical', 'swat', 'hazmat', 'extrication', 'traffic', 'k9', 'air_support'
    subtype TEXT, -- 'engine', 'ladder', 'rescue', 'als', 'bls', 'heavy', 'standard', 'major'
    level INTEGER NOT NULL DEFAULT 1, -- 1=basic, 2=intermediate, 3=advanced
    notes TEXT,
    UNIQUE (unit_id, capability_type, subtype),
    data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_unit_capabilities_unit_id ON unit_capabilities(unit_id);
CREATE INDEX IF NOT EXISTS idx_unit_capabilities_type ON unit_capabilities(capability_type);

-- 3. DISPATCH ESCALATION RULES TABLE
CREATE TABLE IF NOT EXISTS dispatch_escalation_rules (
    id TEXT PRIMARY KEY,
    capability_type TEXT NOT NULL, -- 'fire', 'medical', 'swat', 'hazmat'
    unit_subtype TEXT, -- 'engine', 'ladder', 'rescue', 'als', 'bls', 'heavy', 'standard', 'major', 'swat'
    escalation_type TEXT NOT NULL DEFAULT 'no_ack', -- 'no_ack', 'no_enroute', 'no_onscene'
    timeout_seconds INTEGER NOT NULL DEFAULT 60,
    backup_strategy TEXT NOT NULL DEFAULT 'hybrid', -- 'nearest_station', 'nearest_unit', 'hybrid'
    backup_count INTEGER NOT NULL DEFAULT 1,
    requires_specialized_backup BOOLEAN NOT NULL DEFAULT FALSE, -- for SWAT/HazMat
    active BOOLEAN NOT NULL DEFAULT TRUE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_escalation_rules_capability ON dispatch_escalation_rules(capability_type);
CREATE INDEX IF NOT EXISTS idx_escalation_rules_active ON dispatch_escalation_rules(active);

-- Seed default escalation rules per confirmed requirements
INSERT INTO dispatch_escalation_rules (id, capability_type, unit_subtype, escalation_type, timeout_seconds, backup_strategy, backup_count, requires_specialized_backup, active) VALUES
    -- Fire: Engine + Ladder first, then additional based on need
    ('esc_fire_engine', 'fire', 'engine', 'no_ack', 60, 'hybrid', 1, FALSE, TRUE),
    ('esc_fire_ladder', 'fire', 'ladder', 'no_ack', 60, 'hybrid', 1, FALSE, TRUE),
    -- Medical: ALS first, fallback to BLS
    ('esc_medical_als', 'medical', 'als', 'no_ack', 45, 'hybrid', 1, FALSE, TRUE),
    ('esc_medical_bls', 'medical', 'bls', 'no_ack', 60, 'hybrid', 1, FALSE, TRUE),
    ('esc_medical_heavy', 'medical', 'heavy', 'no_ack', 60, 'hybrid', 2, FALSE, TRUE),
    -- SWAT: Nearby station officers for immediate backup until SWAT arrives
    ('esc_swat', 'swat', 'swat', 'no_ack', 30, 'hybrid', 2, TRUE, TRUE),
    -- HazMat: Nearby station officers for immediate backup until HazMat arrives
    ('esc_hazmat_standard', 'hazmat', 'standard', 'no_ack', 60, 'hybrid', 1, TRUE, TRUE),
    ('esc_hazmat_major', 'hazmat', 'major', 'no_ack', 60, 'hybrid', 2, TRUE, TRUE)
ON CONFLICT (id) DO UPDATE SET
    capability_type = EXCLUDED.capability_type,
    unit_subtype = EXCLUDED.unit_subtype,
    timeout_seconds = EXCLUDED.timeout_seconds,
    backup_strategy = EXCLUDED.backup_strategy,
    backup_count = EXCLUDED.backup_count,
    requires_specialized_backup = EXCLUDED.requires_specialized_backup,
    active = EXCLUDED.active;

-- 4. DISPATCH ESCALATION LOG TABLE
CREATE TABLE IF NOT EXISTS dispatch_escalation_log (
    id TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    primary_unit_id TEXT NOT NULL REFERENCES response_units(id),
    escalation_rule_id TEXT REFERENCES dispatch_escalation_rules(id),
    trigger_type TEXT NOT NULL, -- 'no_ack', 'timeout', 'manual'
    escalated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    backup_units_dispatched TEXT[], -- array of unit_ids
    primary_unit_responded BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_escalation_log_incident_id ON dispatch_escalation_log(incident_id);
CREATE INDEX IF NOT EXISTS idx_escalation_log_primary_unit ON dispatch_escalation_log(primary_unit_id);

-- 5. INCIDENTS TABLE ENHANCEMENTS
-- Add assigned_unit_id FK (replaces JSON assignedUnitId)
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assigned_unit_id TEXT REFERENCES response_units(id) ON DELETE SET NULL;

-- Add required_capabilities JSONB for capability-based dispatch
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS required_capabilities JSONB DEFAULT '[]'::jsonb;

-- Add escalation tracking columns
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS escalation_status TEXT DEFAULT 'none'; -- 'none', 'pending', 'triggered', 'resolved'
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS escalation_started_at TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS primary_unit_acked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_incidents_assigned_unit ON incidents(assigned_unit_id);
CREATE INDEX IF NOT EXISTS idx_incidents_escalation_status ON incidents(escalation_status);
CREATE INDEX IF NOT EXISTS idx_incidents_required_capabilities ON incidents USING GIN(required_capabilities);

-- 6. RESPONSE UNITS ENHANCEMENTS
-- Add unit_subtype for escalation rule matching
ALTER TABLE response_units ADD COLUMN IF NOT EXISTS unit_subtype TEXT; -- 'engine', 'ladder', 'rescue', 'als', 'bls', 'heavy', 'standard', 'major', 'swat', 'hazmat'

-- Add acknowledgment tracking columns
ALTER TABLE response_units ADD COLUMN IF NOT EXISTS last_ack_at TIMESTAMPTZ;
ALTER TABLE response_units ADD COLUMN IF NOT EXISTS ack_timeout_seconds INTEGER DEFAULT 60;

CREATE INDEX IF NOT EXISTS idx_response_units_subtype ON response_units(unit_subtype);

-- 7. COMPOSITE UNIQUE INDEX for escalation rule matching
CREATE UNIQUE INDEX IF NOT EXISTS uq_escalation_rules_cap_subtype ON dispatch_escalation_rules(capability_type, unit_subtype);

-- 8. SEED UNIT CAPABILITIES from existing response_units data
INSERT INTO unit_capabilities (id, unit_id, capability_type, subtype, level)
SELECT
    'cap_' || ru.id,
    ru.id,
    CASE
        WHEN ru.data->>'unitType' = 'fire' THEN 'fire'
        WHEN ru.data->>'unitType' = 'medical' THEN 'medical'
        WHEN ru.data->>'unitType' = 'swat' THEN 'swat'
        WHEN ru.data->>'unitType' = 'hazmat' THEN 'hazmat'
        ELSE 'fire'
    END,
    CASE
        WHEN ru.data->>'unitType' = 'fire' AND (ru.data->>'vehicleType' ILIKE '%ladder%' OR ru.data->>'vehicleType' ILIKE '%truck%' OR ru.data->>'name' ILIKE '%ladder%' OR ru.data->>'name' ILIKE '%truck%') THEN 'ladder'
        WHEN ru.data->>'unitType' = 'fire' AND (ru.data->>'vehicleType' ILIKE '%rescue%' OR ru.data->>'name' ILIKE '%rescue%') THEN 'rescue'
        WHEN ru.data->>'unitType' = 'fire' THEN 'engine'
        WHEN ru.data->>'unitType' = 'medical' AND (ru.data->>'vehicleType' ILIKE '%als%' OR ru.data->>'name' ILIKE '%als%' OR ru.data->>'unitSubtype' = 'als') THEN 'als'
        WHEN ru.data->>'unitType' = 'medical' AND (ru.data->>'vehicleType' ILIKE '%bls%' OR ru.data->>'name' ILIKE '%bls%' OR ru.data->>'unitSubtype' = 'bls') THEN 'bls'
        WHEN ru.data->>'unitType' = 'medical' AND (ru.data->>'vehicleType' ILIKE '%heavy%' OR ru.data->>'name' ILIKE '%heavy%' OR ru.data->>'unitSubtype' = 'heavy') THEN 'heavy'
        WHEN ru.data->>'unitType' = 'medical' THEN 'als'
        WHEN ru.data->>'unitType' = 'hazmat' AND (ru.data->>'vehicleType' ILIKE '%major%' OR ru.data->>'name' ILIKE '%major%' OR ru.data->>'unitSubtype' = 'major') THEN 'major'
        WHEN ru.data->>'unitType' = 'hazmat' THEN 'standard'
        WHEN ru.data->>'unitType' = 'swat' THEN 'swat'
        ELSE 'engine'
    END,
    1
FROM response_units ru
WHERE NOT EXISTS (
    SELECT 1 FROM unit_capabilities uc WHERE uc.unit_id = ru.id
)
ON CONFLICT (unit_id, capability_type, subtype) DO NOTHING;

-- 9. SEED RESPONSE UNIT MEMBERS from existing data
INSERT INTO response_unit_members (id, unit_id, officer_user_id, role)
SELECT
    'member_' || ru.id,
    ru.id,
    u.id,
    CASE
        WHEN ru.data->>'officerName' IS NOT NULL THEN 'commander'
        WHEN ru.data->>'teamName' IS NOT NULL THEN 'member'
        ELSE 'member'
    END
FROM response_units ru
JOIN users u ON u.role = 'Police Officer'
    AND (u.data->>'stationId' = ru.data->>'stationId'
         OR u.data->>'stationId' = ru.data->>'linkedStationId'
         OR u.data->>'stationName' = ru.data->>'stationName')
WHERE ru.id IS NOT NULL
    AND u.id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM response_unit_members rum WHERE rum.unit_id = ru.id AND rum.officer_user_id = u.id
    )
ON CONFLICT (unit_id, officer_user_id) DO NOTHING;

-- 10. SET UNIT SUBTYPE on response_units
UPDATE response_units
SET unit_subtype =
    CASE
        WHEN data->>'unitType' = 'fire' AND (data->>'vehicleType' ILIKE '%ladder%' OR data->>'vehicleType' ILIKE '%truck%' OR data->>'unitName' ILIKE '%ladder%' OR data->>'unitName' ILIKE '%truck%') THEN 'ladder'
        WHEN data->>'unitType' = 'fire' AND (data->>'vehicleType' ILIKE '%rescue%' OR data->>'unitName' ILIKE '%rescue%') THEN 'rescue'
        WHEN data->>'unitType' = 'fire' THEN 'engine'
        WHEN data->>'unitType' = 'medical' AND (data->>'vehicleType' ILIKE '%als%' OR data->>'unitName' ILIKE '%als%' OR data->>'unitSubtype' = 'als') THEN 'als'
        WHEN data->>'unitType' = 'medical' AND (data->>'vehicleType' ILIKE '%bls%' OR data->>'unitName' ILIKE '%bls%' OR data->>'unitSubtype' = 'bls') THEN 'bls'
        WHEN data->>'unitType' = 'medical' AND (data->>'vehicleType' ILIKE '%heavy%' OR data->>'unitName' ILIKE '%heavy%' OR data->>'unitSubtype' = 'heavy') THEN 'heavy'
        WHEN data->>'unitType' = 'medical' THEN 'als'
        WHEN data->>'unitType' = 'hazmat' AND (data->>'vehicleType' ILIKE '%major%' OR data->>'unitName' ILIKE '%major%' OR data->>'unitSubtype' = 'major') THEN 'major'
        WHEN data->>'unitType' = 'hazmat' THEN 'standard'
        WHEN data->>'unitType' = 'swat' THEN 'swat'
        ELSE 'engine'
    END
WHERE unit_subtype IS NULL;

-- 11. MIGRATE INCIDENTS: assignedUnitId -> assigned_unit_id FK
UPDATE incidents
SET assigned_unit_id = (
    SELECT id FROM response_units WHERE id = incidents.data->>'assignedUnitId'
)
WHERE assigned_unit_id IS NULL
    AND data ? 'assignedUnitId'
    AND data->>'assignedUnitId' IS NOT NULL
    AND data->>'assignedUnitId' <> '';

-- 12. MIGRATE INCIDENTS: Set required_capabilities from existing data
UPDATE incidents
SET required_capabilities =
    CASE
        WHEN data->>'category' ILIKE '%fire%' OR data->>'type' ILIKE '%fire%' THEN '[{"type": "fire", "subtype": "engine", "level": 1}, {"type": "fire", "subtype": "ladder", "level": 1}]'::jsonb
        WHEN data->>'category' ILIKE '%medical%' OR data->>'type' ILIKE '%medical%' THEN '[{"type": "medical", "subtype": "als", "level": 1}]'::jsonb
        WHEN data->>'category' ILIKE '%hazmat%' OR data->>'type' ILIKE '%hazmat%' THEN '[{"type": "hazmat", "subtype": "standard", "level": 1}]'::jsonb
        WHEN data->>'category' ILIKE '%swat%' OR data->>'type' ILIKE '%swat%' THEN '[{"type": "swat", "subtype": "swat", "level": 1}]'::jsonb
        ELSE '[]'::jsonb
    END
WHERE required_capabilities IS NULL OR required_capabilities = '[]'::jsonb;

-- 13. SET ACK TIMEOUTS based on unit subtype
UPDATE response_units
SET ack_timeout_seconds =
    CASE
        WHEN unit_subtype = 'swat' THEN 30
        WHEN unit_subtype = 'als' THEN 45
        WHEN unit_subtype = 'bls' THEN 60
        WHEN unit_subtype IN ('engine', 'ladder', 'rescue') THEN 60
        WHEN unit_subtype IN ('standard', 'major') THEN 60
        ELSE 60
    END
WHERE ack_timeout_seconds IS NULL OR ack_timeout_seconds = 60;

-- 14. SET DEFAULT ESCALATION STATUS
UPDATE incidents
SET escalation_status = 'none'
WHERE escalation_status IS NULL;