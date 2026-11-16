require("../services/testDatabaseSafety").prepareIntegrationTestEnvironment();

const test = require("node:test");
const assert = require("node:assert/strict");
const { withTransaction, closePool } = require("../services/postgres.service");
const officers = require("../repositories/policeOfficers.repository");
const users = require("../repositories/users.repository");
const stations = require("../repositories/policeStations.repository");
const { answer } = require("../services/copilotRead.service");

test.after(closePool);
test("SQL officer/user assignments retain distinct row and user IDs for scoped Copilot counts", {
  skip: !process.env.DATABASE_URL || !process.env.RAKSHAKAI_TEST_SCHEMA
}, async () => {
  await withTransaction(async (client) => {
    // Temporary tables shadow the originals only on this connection and disappear on commit.
    await client.query(`
      CREATE TEMP TABLE users (id TEXT, name TEXT, email TEXT, role TEXT, password_hash TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), data JSONB DEFAULT '{}') ON COMMIT DROP;
      CREATE TEMP TABLE police_stations (id TEXT, station_code TEXT, name TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), data JSONB DEFAULT '{}') ON COMMIT DROP;
      CREATE TEMP TABLE police_officers (id TEXT, user_id TEXT, badge_id TEXT, station_id TEXT, active BOOLEAN, duty_status TEXT, availability_status TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), data JSONB DEFAULT '{}') ON COMMIT DROP;
      INSERT INTO users (id, name, role) VALUES ('sql_person', 'SQL Officer', 'Police Officer');
      INSERT INTO police_stations (id, station_code, name) VALUES ('sql_station', 'PS-PATANCHERU', 'Patancheru Police Station');
      INSERT INTO police_officers (id, user_id, badge_id, station_id, active, duty_status, availability_status) VALUES ('sql_officer_row', 'sql_person', 'PO-SQL', 'sql_station', TRUE, 'on_duty', 'available');
    `);
    const db = { users: await users.list({}), policeOfficers: await officers.list({}), policeStations: await stations.list({}) };
    assert.equal(db.policeOfficers[0].userId, "sql_person");
    assert.equal(db.policeOfficers[0].id, "sql_officer_row");
    const response = answer(db, "ipudu eni officers unar o chepu patancheru ps", { actor: { id: "sql_person", role: "Police Officer" }, selectedLanguage: "en" });
    assert.equal(response.intent, "OFFICER_COUNT_BY_STATION");
    assert.equal(response.station.name, "Patancheru Police Station");
    assert.equal(response.summary.total, 1);
    assert.equal(response.summary.onDuty, 1);
    assert.equal(response.summary.available, 1);
    assert.equal(response.officers[0].name, "SQL Officer");
  });
});
