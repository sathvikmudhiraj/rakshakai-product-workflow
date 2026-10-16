-- Keep deployed ERSS triage constraints aligned with the application workflow.
-- Older base schemas omitted the ASSESSING state and used an obsolete escalation
-- action name, causing valid ERSS records to fail when persisted to PostgreSQL.
BEGIN;

UPDATE erss_triage
SET action_taken = 'ESCALATE_TO_SUPERVISOR'
WHERE action_taken = 'ESCALATE_SUPERVISOR';

ALTER TABLE erss_triage DROP CONSTRAINT IF EXISTS erss_triage_emergency_type_check;
ALTER TABLE erss_triage DROP CONSTRAINT IF EXISTS erss_triage_priority_check;
ALTER TABLE erss_triage DROP CONSTRAINT IF EXISTS erss_triage_action_taken_check;

ALTER TABLE erss_triage
  ADD CONSTRAINT erss_triage_emergency_type_check
  CHECK (emergency_type IN ('POLICE', 'FIRE', 'MEDICAL', 'DISASTER', 'MULTI_SERVICE', 'ASSESSING'));

ALTER TABLE erss_triage
  ADD CONSTRAINT erss_triage_priority_check
  CHECK (priority IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'ASSESSING'));

ALTER TABLE erss_triage
  ADD CONSTRAINT erss_triage_action_taken_check
  CHECK (action_taken IN ('MARK_ACTIONABLE', 'NEED_VERIFICATION', 'MARK_ACCIDENTAL', 'MARK_FALSE_ALARM', 'MARK_NUISANCE', 'FORWARD_TO_DISPATCH', 'ESCALATE_TO_SUPERVISOR'));

COMMIT;
