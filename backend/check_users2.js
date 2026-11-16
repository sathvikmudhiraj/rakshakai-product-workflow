const { query } = require('./services/postgres.service');
async function main() {
  try {
    const users = await query("SELECT id, name, email, role, data FROM users WHERE role = 'Police Officer'");
    console.log('=== Users (Police Officers) ===');
    for (const user of users.rows) {
      console.log(`${user.name} (${user.id}):`, JSON.stringify(user.data, null, 2));
    }
  } catch (e) {
    console.error(e);
  }
}
main();