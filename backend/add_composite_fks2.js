const { getPool } = require('./services/postgres.service');
const pool = getPool();

async function addConstraints() {
  try {
    // Create unique index on (station_id, id) for police_beats
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_police_beats_station_id_id ON police_beats(station_id, id);
    `);
    console.log('Created uq_police_beats_station_id_id');

    // Add composite FK for police_officers referencing (station_id, id)
    await pool.query(`
      DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_police_officers_station_beat' AND conrelid = 'police_officers'::regclass) THEN
              ALTER TABLE police_officers
                  ADD CONSTRAINT fk_police_officers_station_beat
                  FOREIGN KEY (station_id, beat_id)
                  REFERENCES police_beats(station_id, id)
                  DEFERRABLE INITIALLY DEFERRED;
          END IF;
      END $$;
    `);
    console.log('Added fk_police_officers_station_beat');

    // Add composite FK for response_units referencing (station_id, id)
    await pool.query(`
      DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_response_units_station_beat' AND conrelid = 'response_units'::regclass) THEN
              ALTER TABLE response_units
                  ADD CONSTRAINT fk_response_units_station_beat
                  FOREIGN KEY (station_id, beat_id)
                  REFERENCES police_beats(station_id, id)
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