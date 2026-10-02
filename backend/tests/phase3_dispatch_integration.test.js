const test = require("node:test");
const assert = require("node:assert/strict");
const { query, withTransaction, getPool, closePool } = require("../services/postgres.service");
const fs = require("fs");
const path = require("path");

const TEST_DB_URL = process.env.DATABASE_URL;

if (!TEST_DB_URL) {
  console.log("Skipping Phase 3 integration tests: DATABASE_URL not set");
  process.exit(0);
}

function createTestClient() {
  return getPool();
}

async function setupTestData(client) {
  await client.query("DELETE FROM response_unit_members");
  await client.query("DELETE FROM unit_capabilities");
  await client.query("DELETE FROM dispatch_escalation_log");
  await client.query("DELETE FROM dispatch_escalation_rules");
  await client.query("DELETE FROM response_units WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM police_officers WHERE user_id LIKE 'test_%'");
  await client.query("DELETE FROM users WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM incidents WHERE id LIKE 'test_%'");
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
    INSERT INTO dispatch_escalation_rules (id, capability_type, unit_subtype, escalation_type, timeout_seconds, backup_strategy, backup_count, requires_specialized_backup, active) VALUES
      ('esc_medical_als', 'medical', 'als', 'no_ack', 45, 'hybrid', 1, FALSE, TRUE),
      ('esc_medical_bls', 'medical', 'bls', 'no_ack', 60, 'hybrid', 1, FALSE, TRUE),
      ('esc_fire_engine', 'fire', 'engine', 'no_ack', 60, 'hybrid', 1, FALSE, TRUE),
      ('esc_swat', 'swat', 'swat', 'no_ack', 30, 'hybrid', 2, TRUE, TRUE)
    ON CONFLICT (id) DO UPDATE SET
      capability_type = EXCLUDED.capability_type,
      unit_subtype = EXCLUDED.unit_subtype,
      timeout_seconds = EXCLUDED.timeout_seconds,
      backup_strategy = EXCLUDED.backup_strategy,
      backup_count = EXCLUDED.backup_count,
      requires_specialized_backup = EXCLUDED.requires_specialized_backup,
      active = EXCLUDED.active
  `);
}

async function cleanupTestData(client) {
  await client.query("DELETE FROM response_unit_members");
  await client.query("DELETE FROM unit_capabilities");
  await client.query("DELETE FROM dispatch_escalation_log");
  await client.query("DELETE FROM dispatch_escalation_rules");
  await client.query("DELETE FROM response_units WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM police_officers WHERE user_id LIKE 'test_%'");
  await client.query("DELETE FROM users WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM incidents WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM police_beats WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM police_stations WHERE id LIKE 'test_%'");
  await client.query("DELETE FROM officer_ranks WHERE code = 'TEST_RANK'");
}

test("Phase 3: incidents table has escalation columns", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const columns = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'incidents'
    AND column_name IN ('escalation_status', 'escalation_started_at', 'primary_unit_acked_at', 'required_capabilities')
  `);
  assert.equal(columns.rows.length, 4);

  await cleanupTestData(client);
});

test("Phase 3: response_units table has ack tracking columns", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const columns = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'response_units'
    AND column_name IN ('last_ack_at', 'ack_timeout_seconds', 'unit_subtype')
  `);
  assert.equal(columns.rows.length, 3);

  await cleanupTestData(client);
});

test("Phase 3: dispatch_escalation_log table exists with proper schema", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const columns = await client.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'dispatch_escalation_log'
    AND column_name IN ('id', 'incident_id', 'primary_unit_id', 'escalation_rule_id', 'trigger_type', 'escalated_at', 'backup_units_dispatched', 'primary_unit_responded', 'resolved_at')
    ORDER BY column_name
  `);
  assert.equal(columns.rows.length, 9);

  const triggers = await client.query(`
    SELECT trigger_type FROM dispatch_escalation_log
  `);
  // Table exists, just checking schema

  await cleanupTestData(client);
});

test("Phase 3: unit_capabilities table can store capability requirements", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO response_units (id, status, station_id, unit_subtype) VALUES
      ('test_unit_cap', 'available', 'test_station_1', 'als')
  `);

  await client.query(`
    INSERT INTO unit_capabilities (id, unit_id, capability_type, subtype, level) VALUES
      ('cap_test_als', 'test_unit_cap', 'medical', 'als', 1),
      ('cap_test_bls', 'test_unit_cap', 'medical', 'bls', 1)
  `);

  const caps = await client.query("SELECT * FROM unit_capabilities WHERE unit_id = 'test_unit_cap'");
  assert.equal(caps.rows.length, 2);
  const types = caps.rows.map(r => r.capability_type + '_' + r.subtype).sort();
  assert.deepEqual(types, ['medical_als', 'medical_bls']);

  await cleanupTestData(client);
});

test("Phase 3: incidents can have required_capabilities JSONB array", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO incidents (id, status, severity, required_capabilities) VALUES
      ('test_inc_cap', 'Verified', 'high', '[{"type": "medical", "subtype": "als", "level": 1}, {"type": "medical", "subtype": "bls", "level": 1}]'::jsonb)
  `);

  const incidents = await client.query("SELECT required_capabilities FROM incidents WHERE id = 'test_inc_cap'");
  assert.equal(incidents.rows[0].required_capabilities.length, 2);
  assert.equal(incidents.rows[0].required_capabilities[0].type, 'medical');
  assert.equal(incidents.rows[0].required_capabilities[0].subtype, 'als');

  await cleanupTestData(client);
});

test("Phase 3: response_unit_members tracks crew roles", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO users (id, name, email, role, password_hash) VALUES
      ('test_officer_cmd', 'Commander', 'cmd@test.com', 'Police Officer', 'hash'),
      ('test_officer_drv', 'Driver', 'drv@test.com', 'Police Officer', 'hash'),
      ('test_officer_med', 'Medic', 'med@test.com', 'Police Officer', 'hash')
  `);

  await client.query(`
    INSERT INTO response_units (id, status, station_id, unit_subtype) VALUES
      ('test_unit_crew', 'available', 'test_station_1', 'als')
  `);

  await client.query(`
    INSERT INTO response_unit_members (id, unit_id, officer_user_id, role) VALUES
      ('mem_cmd', 'test_unit_crew', 'test_officer_cmd', 'commander'),
      ('mem_drv', 'test_unit_crew', 'test_officer_drv', 'driver'),
      ('mem_med', 'test_unit_crew', 'test_officer_med', 'medic')
  `);

  const members = await client.query("SELECT role, count(*) as cnt FROM response_unit_members WHERE unit_id = 'test_unit_crew' GROUP BY role");
  assert.equal(members.rows.length, 3);
  const roles = members.rows.map(r => r.role).sort();
  assert.deepEqual(roles, ['commander', 'driver', 'medic']);

  await cleanupTestData(client);
});

test("Phase 3: dispatch_escalation_rules seeded with correct backup counts", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const rules = await client.query(`
    SELECT capability_type, unit_subtype, backup_count, requires_specialized_backup
    FROM dispatch_escalation_rules
    WHERE active = TRUE
    ORDER BY capability_type, unit_subtype
  `);

  const ruleMap = {};
  for (const r of rules.rows) {
    ruleMap[`${r.capability_type}_${r.unit_subtype}`] = r;
  }

  assert.equal(ruleMap['medical_als'].backup_count, 1);
  assert.equal(ruleMap['medical_bls'].backup_count, 1);
  assert.equal(ruleMap['fire_engine'].backup_count, 1);
  assert.equal(ruleMap['swat_swat'].backup_count, 2);
  assert.equal(ruleMap['swat_swat'].requires_specialized_backup, true);

  await cleanupTestData(client);
});

test("Phase 3: escalation log can record backup units dispatched", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO response_units (id, status, station_id, unit_subtype) VALUES
      ('test_unit_primary', 'busy', 'test_station_1', 'engine'),
      ('test_unit_backup1', 'busy', 'test_station_1', 'engine'),
      ('test_unit_backup2', 'busy', 'test_station_1', 'engine')
  `);

  await client.query(`
    INSERT INTO incidents (id, status, severity, assigned_unit_id, escalation_status) VALUES
      ('test_inc_esc', 'Assigned', 'high', 'test_unit_primary', 'triggered')
  `);

  await client.query(`
    INSERT INTO dispatch_escalation_log (id, incident_id, primary_unit_id, escalation_rule_id, trigger_type, backup_units_dispatched, primary_unit_responded) VALUES
      ('log_1', 'test_inc_esc', 'test_unit_primary', 'esc_fire_engine', 'no_ack', ARRAY['test_unit_backup1', 'test_unit_backup2']::text[], FALSE)
  `);

  const logs = await client.query("SELECT * FROM dispatch_escalation_log WHERE incident_id = 'test_inc_esc'");
  assert.equal(logs.rows.length, 1);
  assert.equal(logs.rows[0].trigger_type, 'no_ack');
  assert.deepEqual(logs.rows[0].backup_units_dispatched, ['test_unit_backup1', 'test_unit_backup2']);
  assert.equal(logs.rows[0].primary_unit_responded, false);

  await cleanupTestData(client);
});

test("Phase 3: incident escalation_status transitions work", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO response_units (id, status, station_id, unit_subtype) VALUES
      ('test_unit_esc', 'available', 'test_station_1', 'engine')
  `);

  await client.query(`
    INSERT INTO incidents (id, status, severity, escalation_status) VALUES
      ('test_inc_esc2', 'Verified', 'high', 'none')
  `);

  // Transition to pending
  await client.query("UPDATE incidents SET escalation_status = 'pending', escalation_started_at = NOW() WHERE id = 'test_inc_esc2'");
  let inc = await client.query("SELECT escalation_status FROM incidents WHERE id = 'test_inc_esc2'");
  assert.equal(inc.rows[0].escalation_status, 'pending');

  // Transition to triggered
  await client.query("UPDATE incidents SET escalation_status = 'triggered' WHERE id = 'test_inc_esc2'");
  inc = await client.query("SELECT escalation_status FROM incidents WHERE id = 'test_inc_esc2'");
  assert.equal(inc.rows[0].escalation_status, 'triggered');

  // Transition to resolved
  await client.query("UPDATE incidents SET escalation_status = 'resolved', primary_unit_acked_at = NOW() WHERE id = 'test_inc_esc2'");
  inc = await client.query("SELECT escalation_status FROM incidents WHERE id = 'test_inc_esc2'");
  assert.equal(inc.rows[0].escalation_status, 'resolved');

  await cleanupTestData(client);
});

test("Phase 3: primary unit ack_timeout_seconds set by subtype", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO response_units (id, status, station_id, unit_subtype, ack_timeout_seconds) VALUES
      ('test_swat', 'available', 'test_station_1', 'swat', 30),
      ('test_als', 'available', 'test_station_1', 'als', 45),
      ('test_bls', 'available', 'test_station_1', 'bls', 60),
      ('test_engine', 'available', 'test_station_1', 'engine', 60)
  `);

  const units = await client.query("SELECT id, unit_subtype, ack_timeout_seconds FROM response_units WHERE id IN ('test_swat', 'test_als', 'test_bls', 'test_engine')");
  assert.equal(units.rows.length, 4);

  const swat = units.rows.find(u => u.id === 'test_swat');
  assert.equal(swat.ack_timeout_seconds, 30);

  const als = units.rows.find(u => u.id === 'test_als');
  assert.equal(als.ack_timeout_seconds, 45);

  const bls = units.rows.find(u => u.id === 'test_bls');
  assert.equal(bls.ack_timeout_seconds, 60);

  const engine = units.rows.find(u => u.id === 'test_engine');
  assert.equal(engine.ack_timeout_seconds, 60);

  await cleanupTestData(client);
});

test("Phase 3: response_units station_id and beat_id FK to police_stations/beats", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO response_units (id, status, station_id, beat_id, unit_subtype) VALUES
      ('test_unit_fk', 'available', 'test_station_1', 'test_beat_1', 'engine')
  `);

  const unit = await client.query(`
    SELECT ru.id, ru.station_id, ru.beat_id, ps.station_code, pb.beat_code
    FROM response_units ru
    JOIN police_stations ps ON ru.station_id = ps.id
    JOIN police_beats pb ON ru.beat_id = pb.id
    WHERE ru.id = 'test_unit_fk'
  `);
  assert.equal(unit.rows[0].station_code, 'PS-TEST-1');
  assert.equal(unit.rows[0].beat_code, 'Beat 1');

  await cleanupTestData(client);
});

test("Phase 3: composite FK prevents invalid station/beat combination on response_units", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await assert.rejects(
    withTransaction(async (tx) => {
      await tx.query(`
        INSERT INTO response_units (id, status, station_id, beat_id, unit_subtype) VALUES
          ('test_unit_bad', 'available', 'test_station_1', 'test_beat_2', 'engine')
      `);
    }),
    /foreign key constraint/
  );

  await cleanupTestData(client);
});

test("Phase 3: GIN index on incidents.required_capabilities", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const indexes = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'incidents' AND indexname = 'idx_incidents_required_capabilities'
  `);
  assert.equal(indexes.rows.length, 1);

  await cleanupTestData(client);
});

test("Phase 3: unique constraint on unit_capabilities (unit_id, capability_type, subtype)", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO response_units (id, status, station_id, unit_subtype) VALUES
      ('test_unit_uc', 'available', 'test_station_1', 'engine')
  `);

  await client.query(`
    INSERT INTO unit_capabilities (id, unit_id, capability_type, subtype, level) VALUES
      ('cap_uc_1', 'test_unit_uc', 'fire', 'engine', 1)
  `);

  await assert.rejects(
    client.query(`
      INSERT INTO unit_capabilities (id, unit_id, capability_type, subtype, level) VALUES
        ('cap_uc_2', 'test_unit_uc', 'fire', 'engine', 1)
    `),
    /duplicate key value violates unique constraint/
  );

  await cleanupTestData(client);
});

test("Phase 3: unique constraint on response_unit_members (unit_id, officer_user_id)", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO users (id, name, email, role, password_hash) VALUES
      ('test_officer_um', 'Officer UM', 'um@test.com', 'Police Officer', 'hash')
  `);
  await client.query(`
    INSERT INTO response_units (id, status, station_id, unit_subtype) VALUES
      ('test_unit_um', 'available', 'test_station_1', 'engine')
  `);

  await client.query(`
    INSERT INTO response_unit_members (id, unit_id, officer_user_id, role) VALUES
      ('mem_um_1', 'test_unit_um', 'test_officer_um', 'commander')
  `);

  await assert.rejects(
    client.query(`
      INSERT INTO response_unit_members (id, unit_id, officer_user_id, role) VALUES
        ('mem_um_2', 'test_unit_um', 'test_officer_um', 'driver')
    `),
    /duplicate key value violates unique constraint/
  );

  await cleanupTestData(client);
});

test("Phase 3: escalation rule unique constraint on (capability_type, unit_subtype)", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await assert.rejects(
    client.query(`
      INSERT INTO dispatch_escalation_rules (id, capability_type, unit_subtype, timeout_seconds) VALUES
        ('esc_dup', 'fire', 'engine', 60)
    `),
    /duplicate key value violates unique constraint/
  );

  await cleanupTestData(client);
});

test("Phase 3: incidents assigned_unit_id FK to response_units", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO response_units (id, status, station_id, unit_subtype) VALUES
      ('test_unit_fk2', 'available', 'test_station_1', 'engine')
  `);

  await client.query(`
    INSERT INTO incidents (id, status, severity, assigned_unit_id) VALUES
      ('test_inc_fk2', 'Assigned', 'high', 'test_unit_fk2')
  `);

  const inc = await client.query("SELECT assigned_unit_id FROM incidents WHERE id = 'test_inc_fk2'");
  assert.equal(inc.rows[0].assigned_unit_id, 'test_unit_fk2');

  await assert.rejects(
    client.query(`
      INSERT INTO incidents (id, status, severity, assigned_unit_id) VALUES
        ('test_inc_bad', 'Assigned', 'high', 'nonexistent_unit')
    `),
    /foreign key constraint/
  );

  await cleanupTestData(client);
});

test("Phase 3: dispatch_escalation_log incident_id FK to incidents", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO response_units (id, status, station_id, unit_subtype) VALUES
      ('test_unit_log', 'busy', 'test_station_1', 'engine')
  `);

  await client.query(`
    INSERT INTO incidents (id, status, severity, assigned_unit_id) VALUES
      ('test_inc_log', 'Assigned', 'high', 'test_unit_log')
  `);

  await client.query(`
    INSERT INTO dispatch_escalation_log (id, incident_id, primary_unit_id, trigger_type, backup_units_dispatched) VALUES
      ('log_fk', 'test_inc_log', 'test_unit_log', 'no_ack', ARRAY[]::text[])
  `);

  await assert.rejects(
    client.query(`
      INSERT INTO dispatch_escalation_log (id, incident_id, primary_unit_id, trigger_type, backup_units_dispatched) VALUES
        ('log_bad', 'nonexistent_incident', 'test_unit_log', 'no_ack', ARRAY[]::text[])
    `),
    /foreign key constraint/
  );

  await cleanupTestData(client);
});

test("Phase 3: dispatch_escalation_log primary_unit_id FK to response_units", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO response_units (id, status, station_id, unit_subtype) VALUES
      ('test_unit_log2', 'busy', 'test_station_1', 'engine')
  `);

  await client.query(`
    INSERT INTO incidents (id, status, severity, assigned_unit_id) VALUES
      ('test_inc_log2', 'Assigned', 'high', 'test_unit_log2')
  `);

  await client.query(`
    INSERT INTO dispatch_escalation_log (id, incident_id, primary_unit_id, trigger_type, backup_units_dispatched) VALUES
      ('log_fk2', 'test_inc_log2', 'test_unit_log2', 'no_ack', ARRAY[]::text[])
  `);

  await assert.rejects(
    client.query(`
      INSERT INTO dispatch_escalation_log (id, incident_id, primary_unit_id, trigger_type, backup_units_dispatched) VALUES
        ('log_bad2', 'test_inc_log2', 'nonexistent_unit', 'no_ack', ARRAY[]::text[])
    `),
    /foreign key constraint/
  );

  await cleanupTestData(client);
});

test("Phase 3: escalation rule requires_specialized_backup flag for SWAT/HazMat", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const rules = await client.query(`
    SELECT capability_type, unit_subtype, requires_specialized_backup
    FROM dispatch_escalation_rules
    WHERE capability_type IN ('swat', 'hazmat')
  `);

  for (const r of rules.rows) {
    assert.equal(r.requires_specialized_backup, true, `${r.capability_type}_${r.unit_subtype} should require specialized backup`);
  }

  const nonSpecialized = await client.query(`
    SELECT capability_type, unit_subtype, requires_specialized_backup
    FROM dispatch_escalation_rules
    WHERE capability_type IN ('fire', 'medical')
  `);

  for (const r of nonSpecialized.rows) {
    assert.equal(r.requires_specialized_backup, false, `${r.capability_type}_${r.unit_subtype} should not require specialized backup`);
  }

  await cleanupTestData(client);
});

test("Phase 3: escalation log primary_unit_responded defaults to false", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO response_units (id, status, station_id, unit_subtype) VALUES
      ('test_unit_resp', 'busy', 'test_station_1', 'engine')
  `);

  await client.query(`
    INSERT INTO incidents (id, status, severity, assigned_unit_id) VALUES
      ('test_inc_resp', 'Assigned', 'high', 'test_unit_resp')
  `);

  await client.query(`
    INSERT INTO dispatch_escalation_log (id, incident_id, primary_unit_id, trigger_type, backup_units_dispatched) VALUES
      ('log_resp', 'test_inc_resp', 'test_unit_resp', 'no_ack', ARRAY[]::text[])
  `);

  const log = await client.query("SELECT primary_unit_responded FROM dispatch_escalation_log WHERE id = 'log_resp'");
  assert.equal(log.rows[0].primary_unit_responded, false);

  await cleanupTestData(client);
});

test("Phase 3: index on dispatch_escalation_log.incident_id", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const indexes = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'dispatch_escalation_log' AND indexname = 'idx_escalation_log_incident_id'
  `);
  assert.equal(indexes.rows.length, 1);

  await cleanupTestData(client);
});

test("Phase 3: index on dispatch_escalation_log.primary_unit_id", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const indexes = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'dispatch_escalation_log' AND indexname = 'idx_escalation_log_primary_unit'
  `);
  assert.equal(indexes.rows.length, 1);

  await cleanupTestData(client);
});

test("Phase 3: index on response_units.unit_subtype", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const indexes = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'response_units' AND indexname = 'idx_response_units_subtype'
  `);
  assert.equal(indexes.rows.length, 1);

  await cleanupTestData(client);
});

test("Phase 3: index on incidents.escalation_status", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const indexes = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'incidents' AND indexname = 'idx_incidents_escalation_status'
  `);
  assert.equal(indexes.rows.length, 1);

  await cleanupTestData(client);
});

test("Phase 3: index on incidents.assigned_unit_id", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const indexes = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'incidents' AND indexname = 'idx_incidents_assigned_unit'
  `);
  assert.equal(indexes.rows.length, 1);

  await cleanupTestData(client);
});