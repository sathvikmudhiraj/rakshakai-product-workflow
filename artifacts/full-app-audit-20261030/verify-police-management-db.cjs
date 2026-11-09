const assert = require('node:assert/strict');
const { Client } = require('../../backend/node_modules/pg');

const database = 'rakshakai_test_copilot_utf8';
const schema = 'rakshakai_test_full_19019f7f28';
const connectionString = process.env.TEST_DATABASE_URL;
assert.ok(connectionString, 'Set TEST_DATABASE_URL to the isolated test database before running this verifier.');
const client = new Client({
  connectionString
});

(async () => {
  assert.match(schema, /^rakshakai_test_full_[a-f0-9]+$/);
  await client.connect();
  try {
    assert.equal(client.connectionParameters.database, database, 'Verification must stay in the isolated test database');
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(`
      SELECT
        count(*) FILTER (WHERE u.email LIKE 'qa-officer-%@example.test')::int AS synthetic_officers,
        count(*) FILTER (WHERE u.email LIKE 'qa-officer-%@example.test' AND u.data->>'operationalRole'='SUPERVISOR')::int AS supervisors,
        count(*) FILTER (WHERE u.email LIKE 'qa-officer-%@example.test' AND m.id IS NOT NULL)::int AS remaining_test_memberships
      FROM "${schema}".users u
      JOIN "${schema}".police_officers o ON o.user_id=u.id
      LEFT JOIN "${schema}".response_unit_members m ON m.officer_user_id=u.id
    `);
    const evidence = await client.query(`
      SELECT jsonb_array_length(data->'videoEvidence')::int AS persisted_video_evidence
      FROM "${schema}".app_state WHERE key='operational'
    `);
    assert.equal(rows[0].synthetic_officers, rows[0].supervisors);
    assert.equal(rows[0].remaining_test_memberships, 0);
    assert.ok(evidence.rows[0].persisted_video_evidence >= 10);
    console.log(JSON.stringify({ database, schema, ...rows[0], persisted_video_evidence: evidence.rows[0].persisted_video_evidence }));
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
