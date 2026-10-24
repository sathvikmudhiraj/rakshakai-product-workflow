const { getPool } = require('./services/postgres.service');
const pool = getPool();

pool.query("SELECT id, email, role, name FROM users WHERE role IN ('Admin', 'Police Officer')").then(r => {
  console.log('Users:');
  r.rows.forEach(row => console.log('  ', row));
  return pool.end();
}).catch(e => { console.error(e); pool.end(); });