const { query } = require('./services/postgres.service');
async function main() {
  try {
    const result = await query('SELECT * FROM police_officers');
    console.log('=== Police Officers ===');
    console.table(result.rows);
    const units = await query('SELECT * FROM response_units');
    console.log('=== Response Units ===');
    console.table(units.rows);
    const members = await query('SELECT * FROM response_unit_members');
    console.log('=== Response Unit Members ===');
    console.table(members.rows);
    const users = await query("SELECT id, name, email, role, badgeid, unitid, station, status FROM users WHERE role = 'Police Officer'");
    console.log('=== Users (Police Officers) ===');
    console.table(users.rows);
    const incidents = await query('SELECT id, status, assigned_unit_id, severity FROM incidents');
    console.log('=== Incidents ===');
    console.table(incidents.rows);
  } catch (e) {
    console.error(e);
  }
}
main();