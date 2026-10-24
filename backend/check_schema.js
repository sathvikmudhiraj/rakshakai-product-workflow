const { getPool } = require('./services/postgres.service');
const pool = getPool();

async function checkSchema() {
  try {
    const migrations = await pool.query('SELECT version, name FROM schema_migrations ORDER BY version');
    console.log('Applied migrations:');
    migrations.rows.forEach(row => console.log('  ', row.version, row.name));

    const beatsCols = await pool.query('SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = \'police_beats\' ORDER BY ordinal_position');
    console.log('\npolice_beats columns:');
    beatsCols.rows.forEach(row => console.log('  ', row.column_name, row.data_type, row.is_nullable));

    const officersCols = await pool.query('SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = \'police_officers\' ORDER BY ordinal_position');
    console.log('\npolice_officers columns:');
    officersCols.rows.forEach(row => console.log('  ', row.column_name, row.data_type, row.is_nullable));

    const unitsCols = await pool.query('SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = \'response_units\' ORDER BY ordinal_position');
    console.log('\nresponse_units columns:');
    unitsCols.rows.forEach(row => console.log('  ', row.column_name, row.data_type, row.is_nullable));

    const beatsData = await pool.query('SELECT * FROM police_beats');
    console.log('\npolice_beats data:');
    beatsData.rows.forEach(row => console.log('  ', row));

    const officersData = await pool.query('SELECT * FROM police_officers');
    console.log('\npolice_officers data:');
    officersData.rows.forEach(row => console.log('  ', row));

    const unitsData = await pool.query('SELECT id, station_id, beat_id FROM response_units');
    console.log('\nresponse_units station_id/beat_id:');
    unitsData.rows.forEach(row => console.log('  ', row));

  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}

checkSchema();