const { getPool } = require('./services/postgres.service');
const pool = getPool();

async function checkSchema() {
  try {
    // Get actual column count
    const beatsCols = await pool.query(`
      SELECT attname, attnum
      FROM pg_attribute
      WHERE attrelid = 'police_beats'::regclass
      AND attnum > 0
      AND NOT attisdropped
      ORDER BY attnum
    `);
    console.log('police_beats actual columns (attnum):');
    beatsCols.rows.forEach(row => console.log('  ', row.attnum, row.attname));

    const officersCols = await pool.query(`
      SELECT attname, attnum
      FROM pg_attribute
      WHERE attrelid = 'police_officers'::regclass
      AND attnum > 0
      AND NOT attisdropped
      ORDER BY attnum
    `);
    console.log('\npolice_officers actual columns (attnum):');
    officersCols.rows.forEach(row => console.log('  ', row.attnum, row.attname));

    const unitsCols = await pool.query(`
      SELECT attname, attnum
      FROM pg_attribute
      WHERE attrelid = 'response_units'::regclass
      AND attnum > 0
      AND NOT attisdropped
      ORDER BY attnum
    `);
    console.log('\nresponse_units actual columns (attnum):');
    unitsCols.rows.forEach(row => console.log('  ', row.attnum, row.attname));

  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}

checkSchema();