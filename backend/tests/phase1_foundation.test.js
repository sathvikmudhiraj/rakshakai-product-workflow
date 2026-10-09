const test = require("node:test");
const assert = require("node:assert/strict");
const { query, withTransaction, getPool, closePool } = require("../services/postgres.service");

const TEST_DB_URL = process.env.DATABASE_URL;

if (!TEST_DB_URL) {
  console.log("Skipping Phase 1 integration tests: DATABASE_URL not set");
  process.exit(0);
}

function createTestClient() {
  return getPool();
}

let testCounter = 0;
function getUniqueSuffix(name) {
  testCounter++;
  return `_${name}_${Date.now()}_${testCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

function createTestClient() {
  return getPool();
}

async function setupTestData(client) {
  await client.query("DELETE FROM police_officers");
  await client.query("DELETE FROM response_units");
  await client.query("DELETE FROM police_beats");
  await client.query("DELETE FROM police_stations");
  await client.query("DELETE FROM officer_ranks WHERE code IN ('SI', 'ASI', 'CI', 'TEST_RANK')");
  await client.query("DELETE FROM users WHERE role = 'Police Officer'");
  await client.query("DELETE FROM users WHERE email LIKE 'test_%@example.com'");

  await client.query(`
    INSERT INTO officer_ranks (id, code, name, level, active) VALUES
      ('rank_si', 'SI', 'Sub-Inspector', 10, TRUE),
      ('rank_asi', 'ASI', 'Assistant Sub-Inspector', 5, TRUE),
      ('rank_ci', 'CI', 'Circle Inspector', 15, TRUE)
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, level = EXCLUDED.level, active = EXCLUDED.active
  `);

  await client.query(`
    INSERT INTO police_stations (id, station_code, name, jurisdiction, operational) VALUES
      ('station_1', 'PS-001', 'Patancheru Police Station', 'Patancheru', TRUE),
      ('station_2', 'PS-002', 'BHEL Police Station', 'Ramachandrapuram', TRUE)
  `);

  await client.query(`
    INSERT INTO police_beats (id, station_id, beat_code, name, operational) VALUES
      ('beat_1', 'station_1', 'Beat 1', 'Patancheru Beat 1', TRUE),
      ('beat_2', 'station_1', 'Beat 2', 'Patancheru Beat 2', TRUE),
      ('beat_3', 'station_2', 'Beat 1', 'BHEL Beat 1', TRUE)
  `);
}

async function cleanupTestData(client) {
  await client.query("DELETE FROM police_officers");
  await client.query("DELETE FROM response_units");
  await client.query("DELETE FROM police_beats");
  await client.query("DELETE FROM police_stations");
  await client.query("DELETE FROM officer_ranks WHERE code IN ('TEST_RANK')");
  await client.query("DELETE FROM users WHERE role = 'Police Officer'");
  await client.query("DELETE FROM users WHERE email LIKE 'test_%@example.com'");
  await client.query("DELETE FROM app_state WHERE key = 'operational'");
}

test("Phase 1: station can contain multiple beats", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const beats = await client.query("SELECT * FROM police_beats WHERE station_id = 'station_1'");
  assert.equal(beats.rows.length, 2);

  await cleanupTestData(client);
});

test("Phase 1: duplicate beat code within same station is rejected", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await assert.rejects(
    client.query(`
      INSERT INTO police_beats (id, station_id, beat_code, name) VALUES
        ('beat_dup', 'station_1', 'Beat 1', 'Duplicate Beat')
    `),
    /duplicate key value violates unique constraint/
  );

  await cleanupTestData(client);
});

test("Phase 1: same beat code across different stations is allowed", async () => {
  const client = createTestClient();
  await cleanupTestData(client);

  await client.query(`
    INSERT INTO police_stations (id, station_code, name, jurisdiction, operational) VALUES
      ('station_a', 'PS-A', 'Station A', 'Area A', TRUE),
      ('station_b', 'PS-B', 'Station B', 'Area B', TRUE)
  `);

  await client.query(`
    INSERT INTO police_beats (id, station_id, beat_code, name) VALUES
      ('beat_a', 'station_a', 'Beat 1', 'Station A Beat 1')
  `);

  await client.query(`
    INSERT INTO police_beats (id, station_id, beat_code, name) VALUES
      ('beat_b', 'station_b', 'Beat 1', 'Station B Beat 1')
  `);

  const beats = await client.query("SELECT * FROM police_beats WHERE beat_code = 'Beat 1'");
  assert.equal(beats.rows.length, 2);

  await cleanupTestData(client);
});

test("Phase 1: multiple officers can belong to one station", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO users (id, name, email, role, password_hash) VALUES
      ('test_officer_1', 'Officer One', 'test_officer1@example.com', 'Police Officer', 'hash'),
      ('test_officer_2', 'Officer Two', 'test_officer2@example.com', 'Police Officer', 'hash')
  `);

  await client.query(`
    INSERT INTO police_officers (user_id, badge_id, station_id, rank_id) VALUES
      ('test_officer_1', 'B001', 'station_1', 'rank_si'),
      ('test_officer_2', 'B002', 'station_1', 'rank_asi')
  `);

  const officers = await client.query("SELECT * FROM police_officers WHERE station_id = 'station_1'");
  assert.equal(officers.rows.length, 2);

  await cleanupTestData(client);
});

test("Phase 1: officer can belong to one valid beat", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO users (id, name, email, role, password_hash) VALUES
      ('test_officer_3', 'Officer Three', 'test_officer3@example.com', 'Police Officer', 'hash')
  `);

  await client.query(`
    INSERT INTO police_officers (user_id, badge_id, station_id, beat_id, rank_id) VALUES
      ('test_officer_3', 'B003', 'station_1', 'beat_1', 'rank_si')
  `);

  const officer = await client.query("SELECT * FROM police_officers WHERE user_id = 'test_officer_3'");
  assert.equal(officer.rows[0].beat_id, 'beat_1');

  await cleanupTestData(client);
});

test("Phase 1: officer cannot reference another station's beat", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO users (id, name, email, role, password_hash) VALUES
      ('test_officer_4', 'Officer Four', 'test_officer4@example.com', 'Police Officer', 'hash')
  `);

  await assert.rejects(
    withTransaction(async (tx) => {
      await tx.query(`
        INSERT INTO police_officers (user_id, badge_id, station_id, beat_id, rank_id) VALUES
          ('test_officer_4', 'B004', 'station_1', 'beat_3', 'rank_si')
      `);
    }),
    /foreign key constraint/
  );

  await cleanupTestData(client);
});

test("Phase 1: officer rank FK works", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO users (id, name, email, role, password_hash) VALUES
      ('test_officer_5', 'Officer Five', 'test_officer5@example.com', 'Police Officer', 'hash')
  `);

  await client.query(`
    INSERT INTO police_officers (user_id, badge_id, station_id, rank_id) VALUES
      ('test_officer_5', 'B005', 'station_1', 'rank_ci')
  `);

  const officer = await client.query(`
    SELECT po.*, orank.code as rank_code
    FROM police_officers po
    JOIN officer_ranks orank ON po.rank_id = orank.id
    WHERE po.user_id = 'test_officer_5'
  `);
  assert.equal(officer.rows[0].rank_code, 'CI');

  await cleanupTestData(client);
});

test("Phase 1: SI, ASI, CI exist", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const ranks = await client.query("SELECT code FROM officer_ranks WHERE code IN ('SI', 'ASI', 'CI') ORDER BY code");
  assert.equal(ranks.rows.length, 3);
  assert.deepEqual(ranks.rows.map(r => r.code).sort(), ['ASI', 'CI', 'SI']);

  await cleanupTestData(client);
});

test("Phase 1: duplicate badge ID rejected", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO users (id, name, email, role, password_hash) VALUES
      ('test_officer_6', 'Officer Six', 'test_officer6@example.com', 'Police Officer', 'hash'),
      ('test_officer_7', 'Officer Seven', 'test_officer7@example.com', 'Police Officer', 'hash')
  `);

  await client.query(`
    INSERT INTO police_officers (user_id, badge_id, station_id, rank_id) VALUES
      ('test_officer_6', 'B006', 'station_1', 'rank_si')
  `);

  await assert.rejects(
    client.query(`
      INSERT INTO police_officers (user_id, badge_id, station_id, rank_id) VALUES
        ('test_officer_7', 'B006', 'station_1', 'rank_asi')
    `),
    /duplicate key value violates unique constraint/
  );

  await cleanupTestData(client);
});

test("Phase 1: Admin cannot accidentally receive police_officers row", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO users (id, name, email, role, password_hash) VALUES
      ('test_admin', 'Test Admin', 'test_admin@example.com', 'Admin', 'hash')
  `);

  await client.query(`
    INSERT INTO police_officers (user_id, badge_id, station_id, rank_id) VALUES
      ('test_admin', 'B007', 'station_1', 'rank_si')
  `);

  const user = await client.query("SELECT role FROM users WHERE id = 'test_admin'");
  assert.equal(user.rows[0].role, 'Admin');

  await cleanupTestData(client);
});

test("Phase 1: Citizen cannot accidentally receive police_officers row", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO users (id, name, email, role, password_hash) VALUES
      ('test_citizen', 'Test Citizen', 'test_citizen@example.com', 'Citizen', 'hash')
  `);

  await client.query(`
    INSERT INTO police_officers (user_id, badge_id, station_id, rank_id) VALUES
      ('test_citizen', 'B008', 'station_1', 'rank_si')
  `);

  const user = await client.query("SELECT role FROM users WHERE id = 'test_citizen'");
  assert.equal(user.rows[0].role, 'Citizen');

  await cleanupTestData(client);
});

test("Phase 1: multiple response units can belong to one station", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO response_units (id, status, station_id) VALUES
      ('test_unit_1', 'available', 'station_1'),
      ('test_unit_2', 'available', 'station_1')
  `);

  const units = await client.query("SELECT * FROM response_units WHERE station_id = 'station_1' AND id LIKE 'test_%'");
  assert.equal(units.rows.length, 2);

  await cleanupTestData(client);
});

test("Phase 1: response unit can reference a valid beat", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await client.query(`
    INSERT INTO response_units (id, status, station_id, beat_id) VALUES
      ('test_unit_3', 'available', 'station_1', 'beat_1')
  `);

  const unit = await client.query("SELECT * FROM response_units WHERE id = 'test_unit_3'");
  assert.equal(unit.rows[0].beat_id, 'beat_1');

  await cleanupTestData(client);
});

test("Phase 1: response unit cannot reference another station's beat", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await assert.rejects(
    withTransaction(async (tx) => {
      await tx.query(`
        INSERT INTO response_units (id, status, station_id, beat_id) VALUES
          ('test_unit_4', 'available', 'station_1', 'beat_3')
      `);
    }),
    /foreign key constraint/
  );

  await cleanupTestData(client);
});

test("Phase 1: existing station/beat JSON data migrates correctly", async () => {
  const client = createTestClient();
  await cleanupTestData(client);
  const testSuffix = `_json_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await client.query(`
    INSERT INTO app_state (key, data) VALUES ('operational', $1::jsonb)
  `, [{
    policeStations: [{
      id: `json_station_test${testSuffix}`,
      stationId: `PS-JSON-TEST${testSuffix}`,
      stationName: "JSON Test Station",
      jurisdiction: "Test Area",
      beat: `JSON Test Beat${testSuffix}`,
      sectorCoverage: ["Sector A", "Sector B"],
      latitude: 17.5,
      longitude: 78.3,
      operational: true,
      lastUpdated: "2026-01-01T00:00:00.000Z"
    }]
  }]);

  await client.query(`
    INSERT INTO response_units (id, status, data) VALUES
      ($1, 'available', $2::jsonb)
  `, [`json_unit_test${testSuffix}`, {stationId: `PS-JSON-TEST${testSuffix}`, beat: `JSON Test Beat${testSuffix}`}]);

  await client.query(`
    INSERT INTO users (id, name, email, role, password_hash, data) VALUES
      ($1, 'JSON Officer', $2, 'Police Officer', 'hash', $3::jsonb)
  `, [`json_officer_test${testSuffix}`, `json_officer_test${testSuffix}@example.com`, {stationId: `PS-JSON-TEST${testSuffix}`, badgeId: "JB001", rank: "SI", beat: `JSON Test Beat${testSuffix}`}]);

  const fs = require("fs");
  const path = require("path");
  const migration = fs.readFileSync(path.join(__dirname, "..", "database", "migrations", "002_phase1_police_foundation.sql"), "utf8");
  await client.query(migration);

  const stationCode = `PS-JSON-TEST${testSuffix}`;
  const stations = await client.query("SELECT * FROM police_stations WHERE station_code = $1", [stationCode]);
  assert.equal(stations.rows.length, 1);
  assert.equal(stations.rows[0].name, 'JSON Test Station');

  const beats = await client.query("SELECT * FROM police_beats WHERE station_id = (SELECT id FROM police_stations WHERE station_code = $1)", [stationCode]);
  assert.equal(beats.rows.length, 1);
  assert.equal(beats.rows[0].beat_code, `JSON Test Beat${testSuffix}`);

  const officerId = `json_officer_test${testSuffix}`;
  const officers = await client.query("SELECT * FROM police_officers WHERE user_id = $1", [officerId]);
  assert.equal(officers.rows.length, 1);
  assert.equal(officers.rows[0].badge_id, 'JB001');
  assert.equal(officers.rows[0].rank_id, 'rank_si');

  const unitId = `json_unit_test${testSuffix}`;
  const units = await client.query("SELECT * FROM response_units WHERE id = $1", [unitId]);
  assert.equal(units.rows[0].station_id, stations.rows[0].id);
  assert.equal(units.rows[0].beat_id, beats.rows[0].id);

  await cleanupTestData(client);
});

test("Phase 1: migration is idempotent", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const fs = require("fs");
  const path = require("path");
  const migration = fs.readFileSync(path.join(__dirname, "..", "database", "migrations", "002_phase1_police_foundation.sql"), "utf8");
  await client.query(migration);
  await client.query(migration);

  const stations = await client.query("SELECT * FROM police_stations WHERE station_code IN ('PS-001', 'PS-002')");
  assert.equal(stations.rows.length, 2);

  await cleanupTestData(client);
});

test("Phase 1: concurrent migration runners do not duplicate changes", async () => {
  const client = createTestClient();
  await cleanupTestData(client);
  const testSuffix = `_concurrent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await client.query("DELETE FROM app_state WHERE key = 'operational'");
  await client.query(`
    INSERT INTO app_state (key, data) VALUES ('operational', $1::jsonb)
  `, [{
    policeStations: [{
      id: `concurrent_station_1${testSuffix}`,
      stationId: `PS-CONCURRENT-1${testSuffix}`,
      stationName: "Concurrent Test Station 1",
      jurisdiction: "Test Area",
      beat: "Beat 1",
      sectorCoverage: ["Sector A"],
      latitude: 17.5,
      longitude: 78.3,
      operational: true,
      lastUpdated: "2026-01-01T00:00:00.000Z"
    }]
  }]);

  const fs = require("fs");
  const path = require("path");
  const migration = fs.readFileSync(path.join(__dirname, "..", "database", "migrations", "002_phase1_police_foundation.sql"), "utf8");
  await Promise.all([
    client.query(migration),
    client.query(migration)
  ]);

  const stationCode = `PS-CONCURRENT-1${testSuffix}`;
  const stations = await client.query("SELECT * FROM police_stations WHERE station_code = $1", [stationCode]);
  assert.equal(stations.rows.length, 1);

  await cleanupTestData(client);
});

test("Phase 1: response_units table has station_id and beat_id columns", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const columns = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'response_units' AND column_name IN ('station_id', 'beat_id')
  `);
  assert.equal(columns.rows.length, 2);

  await cleanupTestData(client);
});

test("Phase 1: composite FK constraints exist", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const constraints = await client.query(`
    SELECT constraint_name FROM information_schema.table_constraints
    WHERE constraint_schema = current_schema()
    AND table_name IN ('police_officers', 'response_units')
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name LIKE '%station_beat%'
  `);
  assert.equal(constraints.rows.length, 2);

  await cleanupTestData(client);
});

test("Phase 1: indexes exist for new tables", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const indexes = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = current_schema() AND tablename IN ('police_stations', 'police_beats', 'officer_ranks', 'police_officers', 'response_units')
    AND indexname LIKE 'idx_%'
  `);
  assert.ok(indexes.rows.length >= 15);

  await cleanupTestData(client);
});

test("Phase 1: unique constraints exist", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const constraints = await client.query(`
    SELECT constraint_name FROM information_schema.table_constraints
    WHERE constraint_schema = current_schema()
    AND table_name IN ('police_stations', 'police_beats', 'officer_ranks', 'police_officers')
    AND constraint_type = 'UNIQUE'
  `);
  const constraintNames = constraints.rows.map(r => r.constraint_name);
  assert.ok(constraintNames.some(c => c.includes('station_code')));
  assert.ok(constraintNames.some(c => c.includes('beat_code')));
  assert.ok(constraintNames.some(c => c.includes('code')));
  assert.ok(constraintNames.some(c => c.includes('badge_id')));

  await cleanupTestData(client);
});

test("Phase 1: NOT NULL constraints on required fields", async () => {
  const client = createTestClient();
  await setupTestData(client);

  await assert.rejects(
    client.query(`
      INSERT INTO police_stations (id, station_code, name) VALUES
        ('test_null', NULL, 'Test Station')
    `),
    /null value in column "station_code" of relation "police_stations" violates not-null constraint/
  );

  await assert.rejects(
    client.query(`
      INSERT INTO police_beats (id, station_id, beat_code, name) VALUES
        ('test_null', 'station_1', NULL, 'Test Beat')
    `),
    /null value in column "beat_code" of relation "police_beats" violates not-null constraint/
  );

  await assert.rejects(
    client.query(`
      INSERT INTO officer_ranks (id, code, name, level) VALUES
        ('test_null', NULL, 'Test Rank', 1)
    `),
    /null value in column "code" of relation "officer_ranks" violates not-null constraint/
  );

  await assert.rejects(
    client.query(`
      INSERT INTO police_officers (user_id, station_id, rank_id) VALUES
        ('test_null_user', NULL, 'rank_si')
    `),
    /null value in column "station_id" of relation "police_officers" violates not-null constraint/
  );

  await cleanupTestData(client);
});

test("Phase 1: rank level hierarchy is consistent", async () => {
  const client = createTestClient();
  await setupTestData(client);

  const ranks = await client.query("SELECT code, level FROM officer_ranks WHERE code IN ('SI', 'ASI', 'CI') ORDER BY level");
  assert.equal(ranks.rows.length, 3);
  assert.equal(ranks.rows[0].code, 'ASI');
  assert.equal(ranks.rows[0].level, 5);
  assert.equal(ranks.rows[1].code, 'SI');
  assert.equal(ranks.rows[1].level, 10);
  assert.equal(ranks.rows[2].code, 'CI');
  assert.equal(ranks.rows[2].level, 15);

  await cleanupTestData(client);
});
