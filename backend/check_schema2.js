const { getPool } = require('./services/postgres.service');
const pool = getPool();

async function checkSchema() {
  try {
    const stations = await pool.query('SELECT * FROM police_stations');
    console.log('police_stations:');
    stations.rows.forEach(row => console.log('  ', row));

    const beats = await pool.query('SELECT * FROM police_beats');
    console.log('\npolice_beats:');
    beats.rows.forEach(row => console.log('  ', row));

    // Check constraints
    const constraints = await pool.query(`
      SELECT conname, contype, conrelid::regclass as table_name
      FROM pg_constraint
      WHERE conrelid IN ('police_beats'::regclass, 'police_officers'::regclass, 'response_units'::regclass)
      ORDER BY conrelid, conname
    `);
    console.log('\nConstraints:');
    constraints.rows.forEach(row => console.log('  ', row.conname, row.contype, row.table_name));

    // Check indexes
    const indexes = await pool.query(`
      SELECT indexname, tablename, indexdef
      FROM pg_indexes
      WHERE tablename IN ('police_beats', 'police_officers', 'response_units', 'police_stations')
      ORDER BY tablename, indexname
    `);
    console.log('\nIndexes:');
    indexes.rows.forEach(row => console.log('  ', row.tablename, row.indexname));

  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}

checkSchema();