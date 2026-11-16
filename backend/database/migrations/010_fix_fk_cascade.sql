-- Fix FK cascade delete on append-only tables
-- Change ON DELETE CASCADE to ON DELETE SET NULL for incident_timeline, escalation_alerts, incident_severity_audit

-- incident_timeline
ALTER TABLE incident_timeline DROP CONSTRAINT IF EXISTS incident_timeline_incident_id_fkey;
ALTER TABLE incident_timeline ALTER COLUMN incident_id DROP NOT NULL;
ALTER TABLE incident_timeline ADD CONSTRAINT incident_timeline_incident_id_fkey
    FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE SET NULL;

-- escalation_alerts
ALTER TABLE escalation_alerts DROP CONSTRAINT IF EXISTS escalation_alerts_incident_id_fkey;
ALTER TABLE escalation_alerts ALTER COLUMN incident_id DROP NOT NULL;
ALTER TABLE escalation_alerts ADD CONSTRAINT escalation_alerts_incident_id_fkey
    FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE SET NULL;

-- incident_severity_audit
ALTER TABLE incident_severity_audit DROP CONSTRAINT IF EXISTS incident_severity_audit_incident_id_fkey;
ALTER TABLE incident_severity_audit ALTER COLUMN incident_id DROP NOT NULL;
ALTER TABLE incident_severity_audit ADD CONSTRAINT incident_severity_audit_incident_id_fkey
    FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE SET NULL;