-- Phase 4: Incident SLA, Escalation, Persistent Alerts, and Investigation Monitoring
-- Adds severity classification, SLA deadlines, escalation levels, persistent alerts, and investigation tracking

-- 1. INCIDENTS TABLE ENHANCEMENTS FOR SLA & ESCALATION
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS severity TEXT CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW'));
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS severity_override BOOLEAN DEFAULT FALSE;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS severity_override_reason TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS severity_override_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS severity_override_at TIMESTAMPTZ;

-- SLA deadline tracking (stored as server-time timestamps)
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assignment_deadline TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS response_deadline TIMESTAMPTZ;

-- SLA breach flags
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assignment_breached BOOLEAN DEFAULT FALSE;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS response_breached BOOLEAN DEFAULT FALSE;

-- Escalation tracking (L0=normal, L1=warning, L2=breach, L3=escalated, L4=command_alert)
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS escalation_level TEXT DEFAULT 'L0' CHECK (escalation_level IN ('L0', 'L1', 'L2', 'L3', 'L4'));
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS last_escalated_at TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS escalation_acknowledged BOOLEAN DEFAULT FALSE;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS escalation_acknowledged_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS escalation_acknowledged_at TIMESTAMPTZ;

-- Investigation tracking
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS investigation_required BOOLEAN DEFAULT FALSE;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS investigation_status TEXT DEFAULT 'NOT_REQUIRED' CHECK (investigation_status IN ('NOT_REQUIRED', 'NOT_STARTED', 'ASSIGNED', 'ACTIVE', 'WAITING_FORENSICS', 'COMPLETED'));
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS investigating_officer_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS investigation_started_at TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS last_investigation_update_at TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS investigation_deadline TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS supervisor_review_required BOOLEAN DEFAULT FALSE;

-- Timestamps for lifecycle tracking
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS en_route_at TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS on_scene_at TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS emergency_response_completed_at TIMESTAMPTZ;

-- Indexes for SLA/escalation queries
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_assignment_deadline ON incidents(assignment_deadline);
CREATE INDEX IF NOT EXISTS idx_incidents_response_deadline ON incidents(response_deadline);
CREATE INDEX IF NOT EXISTS idx_incidents_escalation_level ON incidents(escalation_level);
CREATE INDEX IF NOT EXISTS idx_incidents_investigation_status ON incidents(investigation_status);
CREATE INDEX IF NOT EXISTS idx_incidents_investigating_officer ON incidents(investigating_officer_id);
CREATE INDEX IF NOT EXISTS idx_incidents_assignment_breached ON incidents(assignment_breached) WHERE assignment_breached = TRUE;
CREATE INDEX IF NOT EXISTS idx_incidents_response_breached ON incidents(response_breached) WHERE response_breached = TRUE;

-- 2. SLA CONFIGURATION TABLE
CREATE TABLE IF NOT EXISTS sla_config (
    id TEXT PRIMARY KEY,
    severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    assignment_sla_minutes INTEGER NOT NULL DEFAULT 30,
    response_sla_minutes INTEGER NOT NULL DEFAULT 120,
    warning_before_assignment_minutes INTEGER NOT NULL DEFAULT 1,
    warning_before_response_minutes INTEGER NOT NULL DEFAULT 5,
    escalation_l1_interval_minutes INTEGER NOT NULL DEFAULT 5,
    escalation_l2_interval_minutes INTEGER NOT NULL DEFAULT 5,
    escalation_l3_interval_minutes INTEGER NOT NULL DEFAULT 10,
    escalation_l4_interval_minutes INTEGER NOT NULL DEFAULT 15,
    investigation_inactivity_threshold_hours INTEGER NOT NULL DEFAULT 24,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (severity)
);

CREATE INDEX IF NOT EXISTS idx_sla_config_severity ON sla_config(severity);
CREATE INDEX IF NOT EXISTS idx_sla_config_active ON sla_config(active);

-- Seed default SLA configuration
INSERT INTO sla_config (id, severity, assignment_sla_minutes, response_sla_minutes, warning_before_assignment_minutes, warning_before_response_minutes, escalation_l1_interval_minutes, escalation_l2_interval_minutes, escalation_l3_interval_minutes, escalation_l4_interval_minutes, investigation_inactivity_threshold_hours, active) VALUES
    ('sla_critical', 'CRITICAL', 1, 5, 0, 1, 2, 3, 5, 10, 12, TRUE),
    ('sla_high', 'HIGH', 3, 10, 1, 2, 3, 5, 10, 15, 24, TRUE),
    ('sla_medium', 'MEDIUM', 10, 30, 3, 5, 5, 10, 15, 30, 48, TRUE),
    ('sla_low', 'LOW', 30, 120, 10, 15, 15, 30, 60, 120, 72, TRUE)
ON CONFLICT (severity) DO UPDATE SET
    assignment_sla_minutes = EXCLUDED.assignment_sla_minutes,
    response_sla_minutes = EXCLUDED.response_sla_minutes,
    warning_before_assignment_minutes = EXCLUDED.warning_before_assignment_minutes,
    warning_before_response_minutes = EXCLUDED.warning_before_response_minutes,
    escalation_l1_interval_minutes = EXCLUDED.escalation_l1_interval_minutes,
    escalation_l2_interval_minutes = EXCLUDED.escalation_l2_interval_minutes,
    escalation_l3_interval_minutes = EXCLUDED.escalation_l3_interval_minutes,
    escalation_l4_interval_minutes = EXCLUDED.escalation_l4_interval_minutes,
    investigation_inactivity_threshold_hours = EXCLUDED.investigation_inactivity_threshold_hours,
    active = EXCLUDED.active,
    updated_at = NOW();

-- 3. INCIDENT SEVERITY OVERRIDE AUDIT TABLE
CREATE TABLE IF NOT EXISTS incident_severity_audit (
    id TEXT PRIMARY KEY,
    incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
    previous_severity TEXT CHECK (previous_severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    new_severity TEXT NOT NULL CHECK (new_severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    overridden_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    overridden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_severity_audit_incident ON incident_severity_audit(incident_id);
CREATE INDEX IF NOT EXISTS idx_severity_audit_overridden_by ON incident_severity_audit(overridden_by);
CREATE INDEX IF NOT EXISTS idx_severity_audit_overridden_at ON incident_severity_audit(overridden_at DESC);

-- 4. ESCALATION ALERTS / PERSISTENT NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS escalation_alerts (
    id TEXT PRIMARY KEY,
    incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
    alert_type TEXT NOT NULL, -- 'ASSIGNMENT_WARNING', 'ASSIGNMENT_BREACH', 'RESPONSE_WARNING', 'RESPONSE_BREACH', 'ESCALATION_L1', 'ESCALATION_L2', 'ESCALATION_L3', 'ESCALATION_L4', 'INVESTIGATION_MISSING_IO', 'INVESTIGATION_INACTIVE'
    severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    escalation_level TEXT NOT NULL CHECK (escalation_level IN ('L0', 'L1', 'L2', 'L3', 'L4')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    unique_key TEXT NOT NULL, -- e.g., 'INC-1042:ASSIGNMENT_BREACH:L2' for idempotency
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMPTZ,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_escalation_alerts_unique_key ON escalation_alerts(unique_key);
CREATE INDEX IF NOT EXISTS idx_escalation_alerts_incident ON escalation_alerts(incident_id);
CREATE INDEX IF NOT EXISTS idx_escalation_alerts_active ON escalation_alerts(active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_escalation_alerts_type ON escalation_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_escalation_alerts_escalation_level ON escalation_alerts(escalation_level);
CREATE INDEX IF NOT EXISTS idx_escalation_alerts_acknowledged ON escalation_alerts(acknowledged);
CREATE INDEX IF NOT EXISTS idx_escalation_alerts_resolved ON escalation_alerts(resolved);

-- 5. INCIDENT TIMELINE / AUDIT EVENTS TABLE (append-only)
CREATE TABLE IF NOT EXISTS incident_timeline (
    id TEXT PRIMARY KEY,
    incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL, -- 'ALERT_DETECTED', 'ALERT_CREATED', 'ALERT_ACKNOWLEDGED', 'ALERT_VERIFIED', 'INCIDENT_CREATED', 'SLA_STARTED', 'SEVERITY_SET', 'SEVERITY_OVERRIDE', 'ASSIGNMENT_DEADLINE_SET', 'RESPONSE_DEADLINE_SET', 'ASSIGNMENT_WARNING', 'ASSIGNMENT_BREACH', 'TEAM_ASSIGNED', 'EN_ROUTE', 'ON_SCENE', 'RESPONSE_WARNING', 'RESPONSE_BREACH', 'ESCALATION_L1', 'ESCALATION_L2', 'ESCALATION_L3', 'ESCALATION_L4', 'ESCALATION_ACKNOWLEDGED', 'EMERGENCY_RESPONSE_COMPLETE', 'INVESTIGATION_REQUIRED', 'INVESTIGATION_STARTED', 'INVESTIGATION_OFFICER_ASSIGNED', 'INVESTIGATION_UPDATE', 'INVESTIGATION_INACTIVE_WARNING', 'INVESTIGATION_COMPLETE', 'INCIDENT_RESOLVED', 'INCIDENT_CLOSED'
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    actor_name TEXT,
    actor_role TEXT,
    description TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Make timeline append-only
CREATE OR REPLACE FUNCTION reject_incident_timeline_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'incident_timeline events are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS incident_timeline_append_only ON incident_timeline;
CREATE TRIGGER incident_timeline_append_only
BEFORE UPDATE OR DELETE ON incident_timeline
FOR EACH ROW EXECUTE FUNCTION reject_incident_timeline_mutation();

CREATE INDEX IF NOT EXISTS idx_incident_timeline_incident ON incident_timeline(incident_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_timeline_event_type ON incident_timeline(event_type);

-- 6. SEVERITY RECOMMENDATION RULES TABLE
CREATE TABLE IF NOT EXISTS severity_recommendation_rules (
    id TEXT PRIMARY KEY,
    incident_type TEXT NOT NULL, -- e.g., 'murder', 'fire', 'assault', 'theft'
    category TEXT, -- broader category
    recommended_severity TEXT NOT NULL CHECK (recommended_severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    keywords TEXT[], -- keywords in description/title that trigger this rule
    priority INTEGER NOT NULL DEFAULT 0, -- higher priority rules win
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_severity_rules_incident_type ON severity_recommendation_rules(incident_type);
CREATE INDEX IF NOT EXISTS idx_severity_rules_active ON severity_recommendation_rules(active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_severity_rules_priority ON severity_recommendation_rules(priority DESC);

-- Seed default severity recommendation rules
INSERT INTO severity_recommendation_rules (id, incident_type, category, recommended_severity, keywords, priority, active) VALUES
    ('sev_murder', 'murder', 'violent_crime', 'CRITICAL', ARRAY['murder', 'homicide', 'killing'], 100, TRUE),
    ('sev_possible_murder', 'possible_murder', 'violent_crime', 'CRITICAL', ARRAY['possible murder', 'suspected murder', 'body found'], 95, TRUE),
    ('sev_active_violence', 'active_violence', 'violent_crime', 'CRITICAL', ARRAY['active violence', 'active shooter', 'stabbing in progress', 'shooting in progress'], 100, TRUE),
    ('sev_armed_attack', 'armed_attack', 'violent_crime', 'CRITICAL', ARRAY['armed attack', 'armed robbery in progress', 'weapon'], 90, TRUE),
    ('sev_fire', 'fire', 'emergency', 'CRITICAL', ARRAY['fire', 'building fire', 'structure fire', 'wildfire'], 100, TRUE),
    ('sev_major_accident', 'major_accident', 'emergency', 'CRITICAL', ARRAY['major accident', 'multi-vehicle', 'pileup', 'fatal accident'], 95, TRUE),
    ('sev_robbery_progress', 'robbery_in_progress', 'violent_crime', 'CRITICAL', ARRAY['robbery in progress', 'armed robbery', 'bank robbery'], 90, TRUE),
    ('sev_life_threatening', 'life_threatening', 'emergency', 'CRITICAL', ARRAY['life threatening', 'critical condition', 'unconscious', 'not breathing'], 100, TRUE),

    ('sev_assault', 'assault', 'violent_crime', 'HIGH', ARRAY['assault', 'battery', 'attack'], 50, TRUE),
    ('sev_burglary', 'burglary', 'property_crime', 'HIGH', ARRAY['burglary', 'break-in', 'breaking and entering'], 50, TRUE),
    ('sev_serious_disturbance', 'serious_disturbance', 'public_order', 'HIGH', ARRAY['serious disturbance', 'riot', 'large fight', 'crowd violence'], 50, TRUE),
    ('sev_dangerous_suspicious', 'dangerous_suspicious', 'suspicious', 'HIGH', ARRAY['suspicious person with weapon', 'armed suspicious', 'hostage'], 60, TRUE),

    ('sev_theft', 'theft', 'property_crime', 'MEDIUM', ARRAY['theft', 'shoplifting', 'pickpocket', 'stolen property'], 30, TRUE),
    ('sev_suspicious_activity', 'suspicious_activity', 'suspicious', 'MEDIUM', ARRAY['suspicious activity', 'suspicious person', 'loitering', 'trespassing'], 30, TRUE),
    ('sev_non_immediate_threat', 'non_immediate_threat', 'security', 'MEDIUM', ARRAY['security threat', 'potential threat'], 25, TRUE),

    ('sev_minor_complaint', 'minor_complaint', 'general', 'LOW', ARRAY['minor complaint', 'noise complaint', 'parking issue', 'civil dispute'], 10, TRUE),
    ('sev_low_risk', 'low_risk_observation', 'general', 'LOW', ARRAY['observation', 'low risk', 'minor'], 5, TRUE)
ON CONFLICT (id) DO UPDATE SET
    incident_type = EXCLUDED.incident_type,
    category = EXCLUDED.category,
    recommended_severity = EXCLUDED.recommended_severity,
    keywords = EXCLUDED.keywords,
    priority = EXCLUDED.priority,
    active = EXCLUDED.active,
    updated_at = NOW();

-- 7. INVESTIGATION CATEGORIES (configurable serious incident types requiring investigation)
CREATE TABLE IF NOT EXISTS investigation_categories (
    id TEXT PRIMARY KEY,
    category_name TEXT NOT NULL,
    incident_types TEXT[] NOT NULL, -- e.g., ARRAY['murder', 'suspicious_death', 'major_fire']
    requires_investigation BOOLEAN NOT NULL DEFAULT TRUE,
    investigation_deadline_hours INTEGER, -- optional deadline for investigation completion
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investigation_categories_active ON investigation_categories(active) WHERE active = TRUE;

INSERT INTO investigation_categories (id, category_name, incident_types, requires_investigation, investigation_deadline_hours, active) VALUES
    ('inv_murder', 'Homicide Investigation', ARRAY['murder', 'homicide', 'possible_murder', 'suspected_murder'], TRUE, 720, TRUE), -- 30 days
    ('inv_suspicious_death', 'Suspicious Death', ARRAY['suspicious_death', 'unexplained_death', 'body_found'], TRUE, 720, TRUE),
    ('inv_major_fire', 'Major Fire Investigation', ARRAY['major_fire', 'structure_fire', 'arson'], TRUE, 720, TRUE),
    ('inv_major_accident', 'Major Accident Investigation', ARRAY['major_accident', 'fatal_accident', 'multi_vehicle_pileup'], TRUE, 720, TRUE),
    ('inv_serious_assault', 'Serious Assault', ARRAY['aggravated_assault', 'assault_with_weapon', 'attempted_murder'], TRUE, 720, TRUE),
    ('inv_robbery', 'Robbery Investigation', ARRAY['robbery', 'armed_robbery', 'bank_robbery'], TRUE, 720, TRUE),
    ('inv_sexual_assault', 'Sexual Assault', ARRAY['sexual_assault', 'rape'], TRUE, 720, TRUE),
    ('inv_kidnapping', 'Kidnapping/Abduction', ARRAY['kidnapping', 'abduction', 'missing_person_high_risk'], TRUE, 720, TRUE)
ON CONFLICT (id) DO UPDATE SET
    category_name = EXCLUDED.category_name,
    incident_types = EXCLUDED.incident_types,
    requires_investigation = EXCLUDED.requires_investigation,
    investigation_deadline_hours = EXCLUDED.investigation_deadline_hours,
    active = EXCLUDED.active,
    updated_at = NOW();
