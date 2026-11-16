const { query } = require('./services/postgres.service');
async function main() {
  try {
    const units = await query("SELECT id, status, station_id, data FROM response_units");
    console.log('=== Response Units ===');
    for (const unit of units.rows) {
      console.log(`${unit.id}:`, JSON.stringify(unit.data, null, 2));
    }
  } catch (e) {
    console.error(e);
  }
}
main();