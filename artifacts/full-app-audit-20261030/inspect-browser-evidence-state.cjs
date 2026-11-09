const { Client } = require('../../backend/node_modules/pg');

(async () => {
  const evidenceId = process.argv[2];
  if (!evidenceId) throw new Error('Pass the synthetic evidence ID to inspect.');
  const client = new Client({ connectionString: 'postgresql://rakshakai_test:test-only-password-ui-2026@127.0.0.1:55440/rakshakai_test_copilot_utf8' });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'rakshakai_test_full_%'");
    const matches = [];
    for (const { schema_name: schema } of rows) {
      const result = await client.query(`SELECT data->'videoEvidence' AS evidence FROM "${schema}".app_state WHERE key='operational'`);
      const evidence = result.rows[0]?.evidence || [];
      if (evidence.some((item) => item.id === evidenceId)) {
        matches.push({ schema, evidence: evidence.filter((item) => String(item.id).startsWith('evd_')).map((item) => ({ id: item.id, uploadedByRole: item.uploadedByRole, uploadedAt: item.uploadedAt, fileName: item.fileName })) });
      }
    }
    console.log(JSON.stringify(matches, null, 2));
  } finally {
    await client.end();
  }
})().catch((error) => { console.error(error.message); process.exit(1); });
