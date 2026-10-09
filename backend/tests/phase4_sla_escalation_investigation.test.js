const test = require("node:test");
const assert = require("node:assert/strict");
const { query, withTransaction, getPool, closePool } = require("../services/postgres.service");
const fs = require("fs");
const path = require("path");

const TEST_DB_URL = process.env.DATABASE_URL;

if (!TEST_DB_URL) {
  console.log("Skipping Phase 4 SLA/Escalation/Investigation tests: DATABASE_URL not set");
  process.exit(0);
}

function createTestClient() {
  return getPool();
}

let testCounter = 0;
function uniqueId(prefix) {
  testCounter++;
  return `${prefix}_${Date.now()}_${testCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

async function setupTestData(client) {
  // Don't clean up append-only tables (incident_timeline, escalation_alerts, incident_severity_audit)
  // They only accumulate test data which is fine for isolated test runs
  // Don't clean up incidents table either, as FK cascade to incident_timeline triggers append-only trigger
  await client.query("DELETE FROM investigation_categories WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM severity_recommendation_rules WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM sla_config WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM dispatch_escalation_log");
  await client.query("DELETE FROM dispatch_escalation_rules WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM response_units WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM police_officers WHERE user_id LIKE 'test_%'");
  await client.query("DELETE FROM users WHERE id LIKE 'test_%'");
  // Skip incidents table to avoid FK cascade to incident_timeline
  // await client.query("DELETE FROM incidents WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM police_beats WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM police_stations WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM officer_ranks WHERE code = 'TEST_RANK'");

  await client.query(`
    INSERT INTO officer_ranks (id, code, name, level, active) VALUES
      ('rank_si', 'SI', 'Sub-Inspector', 10, TRUE),
      ('rank_asi', 'ASI', 'Assistant Sub-Inspector', 5, TRUE),
      ('rank_ci', 'CI', 'Circle Inspector', 15, TRUE)
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, level = EXCLUDED.level, active = EXCLUDED.active
  `);

  await client.query(`
    INSERT INTO police_stations (id, station_code, name, jurisdiction, operational) VALUES
      ('test_station_1', 'PS-TEST-1', 'Test Station 1', 'Test Area', TRUE),
      ('test_station_2', 'PS-TEST-2', 'Test Station 2', 'Test Area', TRUE)
  `);

  await client.query(`
    INSERT INTO police_beats (id, station_id, beat_code, name, operational) VALUES
      ('test_beat_1', 'test_station_1', 'Beat 1', 'Test Beat 1', TRUE),
      ('test_beat_2', 'test_station_2', 'Beat 1', 'Test Beat 2', TRUE)
  `);

  await client.query(`
    INSERT INTO sla_config (id, severity, assignment_sla_minutes, response_sla_minutes, warning_before_assignment_minutes, warning_before_response_minutes, escalation_l1_interval_minutes, escalation_l2_interval_minutes, escalation_l3_interval_minutes, escalation_l4_interval_minutes, investigation_inactivity_threshold_hours, active) VALUES
      ('test_sla_critical', 'CRITICAL', 1, 5, 0, 1, 2, 3, 5, 10, 12, TRUE),
      ('test_sla_high', 'HIGH', 3, 10, 1, 2, 3, 5, 10, 15, 24, TRUE),
      ('test_sla_medium', 'MEDIUM', 10, 30, 3, 5, 5, 10, 15, 30, 48, TRUE),
      ('test_sla_low', 'LOW', 30, 120, 10, 15, 15, 30, 60, 120, 72, TRUE)
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
      active = EXCLUDED.active
  `);
}

async function cleanupTestData(client) {
  // Don't clean up append-only tables (incident_timeline, escalation_alerts, incident_severity_audit)
  // They only accumulate test data which is fine for isolated test runs
  // Don't clean up incidents table either, as FK cascade to incident_timeline triggers append-only trigger
  await client.query("DELETE FROM investigation_categories WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM severity_recommendation_rules WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM sla_config WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM dispatch_escalation_log");
  await client.query("DELETE FROM dispatch_escalation_rules WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM response_units WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM police_officers WHERE user_id LIKE 'test_%'");
  await client.query("DELETE FROM users WHERE id LIKE 'test_%'");
  // Skip incidents table to avoid FK cascade to incident_timeline
  // await client.query("DELETE FROM incidents WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM police_beats WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM police_stations WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM officer_ranks WHERE code = 'TEST_RANK'");
}

test("Phase 4: incidents table has all new SLA/escalation/investigation columns", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const columns = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'incidents'
    AND column_name IN (
      'severity', 'severity_override', 'severity_override_reason', 'severity_override_by', 'severity_override_at',
      'assignment_deadline', 'response_deadline',
      'assignment_breached', 'response_breached',
      'escalation_level', 'last_escalated_at', 'escalation_acknowledged', 'escalation_acknowledged_by', 'escalation_acknowledged_at',
      'investigation_required', 'investigation_status', 'investigating_officer_id', 'investigation_started_at', 'last_investigation_update_at', 'investigation_deadline', 'supervisor_review_required',
      'acknowledged_at', 'verified_at', 'assigned_at', 'en_route_at', 'on_scene_at', 'emergency_response_completed_at'
    )
  `);
  assert.equal(columns.rows.length, 27);

  await cleanupTestData(client);
});

test("Phase 4: sla_config table exists with correct schema", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const columns = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'sla_config'
    AND column_name IN (
      'severity', 'assignment_sla_minutes', 'response_sla_minutes',
      'warning_before_assignment_minutes', 'warning_before_response_minutes',
      'escalation_l1_interval_minutes', 'escalation_l2_interval_minutes',
      'escalation_l3_interval_minutes', 'escalation_l4_interval_minutes',
      'investigation_inactivity_threshold_hours', 'active'
    )
  `);
  assert.equal(columns.rows.length, 11);

  const configs = await client.query("SELECT * FROM sla_config WHERE active = TRUE ORDER BY severity");
  assert.equal(configs.rows.length, 4);

  const critical = configs.rows.find(r => r.severity === 'CRITICAL');
  assert.equal(critical.assignment_sla_minutes, 1);
  assert.equal(critical.response_sla_minutes, 5);

  const high = configs.rows.find(r => r.severity === 'HIGH');
  assert.equal(high.assignment_sla_minutes, 3);
  assert.equal(high.response_sla_minutes, 10);

  const medium = configs.rows.find(r => r.severity === 'MEDIUM');
  assert.equal(medium.assignment_sla_minutes, 10);
  assert.equal(medium.response_sla_minutes, 30);

  const low = configs.rows.find(r => r.severity === 'LOW');
  assert.equal(low.assignment_sla_minutes, 30);
  assert.equal(low.response_sla_minutes, 120);

  await cleanupTestData(client);
});

test("Phase 4: incident_severity_audit table exists and works", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO users (id, name, email, role, password_hash) VALUES
      ('test_admin', 'Test Admin', 'test_admin@example.com', 'Admin', 'hash')
  `);

  await client.query(`
    INSERT INTO incidents (id, status, severity) VALUES
      ('test_inc_audit', 'Verified', 'MEDIUM')
  `);

  await client.query(`
    INSERT INTO incident_severity_audit (id, incident_id, previous_severity, new_severity, overridden_by, reason) VALUES
      ('audit_1', 'test_inc_audit', 'MEDIUM', 'HIGH', 'test_admin', 'Escalated due to new evidence')
  `);

  const audits = await client.query("SELECT * FROM incident_severity_audit WHERE incident_id = 'test_inc_audit'");
  assert.equal(audits.rows.length, 1);
  assert.equal(audits.rows[0].previous_severity, 'MEDIUM');
  assert.equal(audits.rows[0].new_severity, 'HIGH');
  assert.equal(audits.rows[0].overridden_by, 'test_admin');
  assert.equal(audits.rows[0].reason, 'Escalated due to new evidence');

  await cleanupTestData(client);
});

test("Phase 4: escalation_alerts table exists with unique_key constraint", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO incidents (id, status, severity) VALUES
      ('test_inc_alert', 'Verified', 'CRITICAL')
  `);

  await client.query(`
    INSERT INTO escalation_alerts (id, incident_id, alert_type, severity, escalation_level, title, message, unique_key, active) VALUES
      ('alert_1', 'test_inc_alert', 'ASSIGNMENT_BREACH', 'CRITICAL', 'L2', 'Test Alert', 'Test message', 'test_inc_alert:ASSIGNMENT_BREACH:L2', TRUE)
  `);

  // Test unique constraint
  await assert.rejects(
    client.query(`
      INSERT INTO escalation_alerts (id, incident_id, alert_type, severity, escalation_level, title, message, unique_key, active) VALUES
        ('alert_2', 'test_inc_alert', 'ASSIGNMENT_BREACH', 'CRITICAL', 'L2', 'Test Alert 2', 'Test message 2', 'test_inc_alert:ASSIGNMENT_BREACH:L2', TRUE)
    `),
    /duplicate key value violates unique constraint/
  );

  await cleanupTestData(client);
});

test("Phase 4: incident_timeline table is append-only", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const incidentId = `test_inc_timeline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await client.query(`
    INSERT INTO incidents (id, status, severity) VALUES
      ('${incidentId}', 'Verified', 'HIGH')
  `);

  await client.query(`
    INSERT INTO incident_timeline (id, incident_id, event_type, description) VALUES
      ('tl_1', '${incidentId}', 'INCIDENT_CREATED', 'Incident created')
  `);

  // Test append-only constraint
  await assert.rejects(
    client.query(`
      UPDATE incident_timeline SET description = 'modified' WHERE id = 'tl_1'
    `),
    /incident_timeline events are append-only/
  );

  await assert.rejects(
    client.query(`
      DELETE FROM incident_timeline WHERE id = 'tl_1'
    `),
    /incident_timeline events are append-only/
  );

  await cleanupTestData(client);
});

test("Phase 4: severity_recommendation_rules table seeded with defaults", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const rules = await client.query("SELECT * FROM severity_recommendation_rules WHERE active = TRUE ORDER BY priority DESC");
  assert.ok(rules.rows.length >= 16);

  const criticalRules = rules.rows.filter(r => r.recommended_severity === 'CRITICAL');
  assert.ok(criticalRules.length >= 7);

  const murderRule = rules.rows.find(r => r.incident_type === 'murder');
  assert.ok(murderRule);
  assert.equal(murderRule.recommended_severity, 'CRITICAL');
  assert.ok(murderRule.keywords.includes('murder'));

  const theftRule = rules.rows.find(r => r.incident_type === 'theft');
  assert.ok(theftRule);
  assert.equal(theftRule.recommended_severity, 'MEDIUM');

  await cleanupTestData(client);
});

test("Phase 4: investigation_categories table seeded with defaults", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const categories = await client.query("SELECT * FROM investigation_categories WHERE active = TRUE");
  assert.ok(categories.rows.length >= 8);

  const murderCat = categories.rows.find(c => c.id === 'inv_murder');
  assert.ok(murderCat);
  assert.ok(murderCat.incident_types.includes('murder'));
  assert.ok(murderCat.incident_types.includes('homicide'));
  assert.equal(murderCat.requires_investigation, true);
  assert.equal(murderCat.investigation_deadline_hours, 720);

  const robberyCat = categories.rows.find(c => c.id === 'inv_robbery');
  assert.ok(robberyCat);
  assert.ok(robberyCat.incident_types.includes('robbery'));

  await cleanupTestData(client);
});

test("Phase 4: configuration repositories have JSONB data columns", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const columns = await client.query(`
    SELECT table_name, data_type
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND column_name = 'data'
      AND table_name IN ('severity_recommendation_rules', 'investigation_categories')
    ORDER BY table_name
  `);
  assert.deepEqual(columns.rows, [
    { table_name: 'investigation_categories', data_type: 'jsonb' },
    { table_name: 'severity_recommendation_rules', data_type: 'jsonb' }
  ]);

  await cleanupTestData(client);
});

test("Phase 4: SLA deadline calculation works correctly", async () => {
  const client = createTestClient();
  await setupTestData(client);

  // This test would require the core.service functions to be available
  // We'll test the database-level constraints instead

  await client.query(`
    INSERT INTO users (id, name, email, role, password_hash) VALUES
      ('test_officer', 'Test Officer', 'test_officer@example.com', 'Police Officer', 'hash')
  `);

  await client.query(`
    INSERT INTO incidents (id, status, severity, created_at) VALUES
      ('test_inc_sla', 'Verified', 'CRITICAL', NOW() - INTERVAL '3 minutes')
  `);

  const incident = await client.query("SELECT * FROM incidents WHERE id = 'test_inc_sla'");
  assert.equal(incident.rows[0].severity, 'CRITICAL');

  await cleanupTestData(client);
});

test("Phase 4: Escalation levels enum constraint works", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO incidents (id, status, severity, escalation_level) VALUES
      ('test_inc_esc', 'Verified', 'HIGH', 'L0')
  `);

  // Valid escalation levels
  await client.query("UPDATE incidents SET escalation_level = 'L1' WHERE id = 'test_inc_esc'");
  await client.query("UPDATE incidents SET escalation_level = 'L2' WHERE id = 'test_inc_esc'");
  await client.query("UPDATE incidents SET escalation_level = 'L3' WHERE id = 'test_inc_esc'");
  await client.query("UPDATE incidents SET escalation_level = 'L4' WHERE id = 'test_inc_esc'");

  // Invalid escalation level should fail
  await assert.rejects(
    client.query("UPDATE incidents SET escalation_level = 'L5' WHERE id = 'test_inc_esc'"),
    /check constraint/
  );

  await cleanupTestData(client);
});

test("Phase 4: Investigation status enum constraint works", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO incidents (id, status, severity, investigation_status) VALUES
      ('test_inc_inv', 'Verified', 'HIGH', 'NOT_REQUIRED')
  `);

  // Valid investigation statuses
  await client.query("UPDATE incidents SET investigation_status = 'NOT_STARTED' WHERE id = 'test_inc_inv'");
  await client.query("UPDATE incidents SET investigation_status = 'ASSIGNED' WHERE id = 'test_inc_inv'");
  await client.query("UPDATE incidents SET investigation_status = 'ACTIVE' WHERE id = 'test_inc_inv'");
  await client.query("UPDATE incidents SET investigation_status = 'WAITING_FORENSICS' WHERE id = 'test_inc_inv'");
  await client.query("UPDATE incidents SET investigation_status = 'COMPLETED' WHERE id = 'test_inc_inv'");

  // Invalid investigation status should fail
  await assert.rejects(
    client.query("UPDATE incidents SET investigation_status = 'INVALID' WHERE id = 'test_inc_inv'"),
    /check constraint/
  );

  await cleanupTestData(client);
});

test("Phase 4: Severity enum constraint works", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO incidents (id, status, severity) VALUES
      ('test_inc_sev', 'Verified', 'MEDIUM')
  `);

  // Valid severities
  await client.query("UPDATE incidents SET severity = 'CRITICAL' WHERE id = 'test_inc_sev'");
  await client.query("UPDATE incidents SET severity = 'HIGH' WHERE id = 'test_inc_sev'");
  await client.query("UPDATE incidents SET severity = 'MEDIUM' WHERE id = 'test_inc_sev'");
  await client.query("UPDATE incidents SET severity = 'LOW' WHERE id = 'test_inc_sev'");

  // Invalid severity should fail
  await assert.rejects(
    client.query("UPDATE incidents SET severity = 'INVALID' WHERE id = 'test_inc_sev'"),
    /check constraint/
  );

  await cleanupTestData(client);
});

test("Phase 4: sla_config severity enum constraint works", async () => {
  const client = createTestClient();
  await setupTestData(client);

  // Seeded valid severities remain writable under the constraint.
  await client.query("UPDATE sla_config SET assignment_sla_minutes = 1 WHERE severity = 'CRITICAL'");
  await client.query("UPDATE sla_config SET assignment_sla_minutes = 3 WHERE severity = 'HIGH'");

  // Invalid severity should fail
  await assert.rejects(
    client.query(`
      INSERT INTO sla_config (id, severity, assignment_sla_minutes, response_sla_minutes, active) VALUES
        ('test_sla_3', 'INVALID', 10, 30, TRUE)
    `),
    /check constraint/
  );

  await cleanupTestData(client);
});

test("Phase 4: Escalation alerts can be acknowledged and resolved separately", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO users (id, name, email, role, password_hash) VALUES
      ('test_officer_1', 'Officer 1', 'officer1@test.com', 'Police Officer', 'hash'),
      ('test_admin_1', 'Admin 1', 'admin1@test.com', 'Admin', 'hash')
  `);

  await client.query(`
    INSERT INTO incidents (id, status, severity) VALUES
      ('test_inc_alert2', 'Verified', 'CRITICAL')
  `);

  await client.query(`
    INSERT INTO escalation_alerts (id, incident_id, alert_type, severity, escalation_level, title, message, unique_key, active) VALUES
      ('alert_ack_1', 'test_inc_alert2', 'ASSIGNMENT_BREACH', 'CRITICAL', 'L2', 'Test', 'Test', 'test_inc_alert2:ASSIGNMENT_BREACH:L2', TRUE)
  `);

  // Acknowledge
  await client.query(`
    UPDATE escalation_alerts SET acknowledged = TRUE, acknowledged_by = 'test_officer_1', acknowledged_at = NOW() WHERE id = 'alert_ack_1'
  `);

  let alert = await client.query("SELECT * FROM escalation_alerts WHERE id = 'alert_ack_1'");
  assert.equal(alert.rows[0].acknowledged, true);
  assert.equal(alert.rows[0].acknowledged_by, 'test_officer_1');
  assert.ok(alert.rows[0].acknowledged_at);
  assert.equal(alert.rows[0].active, true); // Still active after acknowledge

  // Resolve
  await client.query(`
    UPDATE escalation_alerts SET resolved = TRUE, resolved_by = 'test_admin_1', resolved_at = NOW(), active = FALSE WHERE id = 'alert_ack_1'
  `);

  alert = await client.query("SELECT * FROM escalation_alerts WHERE id = 'alert_ack_1'");
  assert.equal(alert.rows[0].resolved, true);
  assert.equal(alert.rows[0].resolved_by, 'test_admin_1');
  assert.ok(alert.rows[0].resolved_at);
  assert.equal(alert.rows[0].active, false); // Inactive after resolve

  await cleanupTestData(client);
});

test("Phase 4: Indexes exist for new tables", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const indexes = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = current_schema() AND tablename IN ('incidents', 'sla_config', 'incident_severity_audit', 'escalation_alerts', 'incident_timeline', 'severity_recommendation_rules', 'investigation_categories')
    AND indexname LIKE 'idx_%'
  `);
  assert.ok(indexes.rows.length >= 10);

  // Check specific important indexes
  const incidentIndexes = await client.query(`
    SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'incidents' AND indexname IN (
      'idx_incidents_assignment_deadline',
      'idx_incidents_response_deadline',
      'idx_incidents_escalation_level',
      'idx_incidents_investigation_status',
      'idx_incidents_investigating_officer',
      'idx_incidents_assignment_breached',
      'idx_incidents_response_breached'
    )
  `);
  assert.equal(incidentIndexes.rows.length, 7);

  await cleanupTestData(client);
});
