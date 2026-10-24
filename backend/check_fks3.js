const { getPool } = require('./services/postgres.service');
const pool = getPool();

pool.query(`
  SELECT conname, contype, conrelid::regclass as table_name, confrelid::regclass as ref_table
  FROM pg_constraint
  WHERE conrelid IN ('police_officers'::regclass, 'response_units'::regclass)
    AND contype = 'f'
  ORDER BY conrelid, conname
`).then(r => {
  console.log('Main DB Foreign Keys:');
  r.rows.forEach(row => console.log('  ', row.conname, row.table_name, '->', row.ref_table));
  return pool.end();
}).catch(e => { console.error(e); pool.end(); });