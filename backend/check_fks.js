const { getPool } = require('./services/postgres.service');
const pool = getPool();

pool.query(`
  SELECT conname, contype, conrelid::regclass as table_name
  FROM pg_constraint
  WHERE conname LIKE '%station_beat%'
  ORDER BY conrelid, conname
`).then(r => {
  console.log('Station-beat constraints:');
  r.rows.forEach(row => console.log('  ', row.conname, row.contype, row.table_name));
  return pool.end();
}).catch(e => { console.error(e); pool.end(); });