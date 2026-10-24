const { getPool } = require('./services/postgres.service');
const pool = getPool();

async function addConstraints() {
  try {
    // Add composite FK for police_officers
    await pool.query(`
      DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_police_officers_station_beat' AND conrelid = 'police_officers'::regclass) THEN
              ALTER TABLE police_officers
                  ADD CONSTRAINT fk_police_officers_station_beat
                  FOREIGN KEY (station_id, beat_id)
                  REFERENCES police_beats(station_id, beat_code)
                  DEFERRABLE INITIALLY DEFERRED;
          END IF;
      END $$;
    `);
    console.log('Added fk_police_officers_station_beat');

    // Add composite FK for response_units
    await pool.query(`
      DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_response_units_station_beat' AND conrelid = 'response_units'::regclass) THEN
              ALTER TABLE response_units
                  ADD CONSTRAINT fk_response_units_station_beat
                  FOREIGN KEY (station_id, beat_id)
                  REFERENCES police_beats(station_id, beat_code)
                  DEFERRABLE INITIALLY DEFERRED;
          END IF;
      END $$;
    `);
    console.log('Added fk_response_units_station_beat');

  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}

addConstraints();