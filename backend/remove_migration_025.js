const { getPool } = require('./services/postgres.service');
const pool = getPool();

pool.query("DELETE FROM schema_migrations WHERE version = '025'").then(r => {
  console.log('Removed migration 025 record');
  return pool.end();
}).catch(e => { console.error(e); pool.end(); });