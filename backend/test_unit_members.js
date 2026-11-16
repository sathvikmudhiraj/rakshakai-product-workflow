const { query } = require('./services/postgres.service');
const { readDatabase } = require('./services/core.service');
const { policeManagementUsers } = require('./services/copilotOfficers.service');

async function main() {
  try {
    const db = await readDatabase();
    console.log('=== Raw user data for socket_police_1791546320787_rl2hc4inz8n ===');
    const user = db.users.find(u => u.id === 'socket_police_1791546320787_rl2hc4inz8n');
    console.log('User:', JSON.stringify(user, null, 2));
    
    console.log('\n=== Police Management Users ===');
    const users = policeManagementUsers(db);
    console.table(users.map(u => ({ id: u.id, name: u.name, station: u.station, unitId: u.unitId, isDemo: u.isDemo, badgeId: u.badgeId, dutyStatus: u.dutyStatus, availabilityStatus: u.availabilityStatus })));
  } catch (e) {
    console.error(e);
  }
}
main();