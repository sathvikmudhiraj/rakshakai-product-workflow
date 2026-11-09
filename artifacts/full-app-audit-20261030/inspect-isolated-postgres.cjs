const { Client } = require('../../backend/node_modules/pg');
(async () => {
  const client = new Client({ connectionString: 'postgresql://rakshakai_test:test-only-password-ui-2026@127.0.0.1:55440/rakshakai_test_copilot_utf8' });
  await client.connect();
  const db = await client.query('select current_database() db, current_schema() schema');
  const tables = await client.query("select table_name from information_schema.tables where table_schema='rakshakai_test_copilot_utf8' and table_type='BASE TABLE' order by table_name");
  const constraints = await client.query("select constraint_type, count(*)::int count from information_schema.table_constraints where constraint_schema='rakshakai_test_copilot_utf8' group by constraint_type order by constraint_type");
  console.log(JSON.stringify({ db: db.rows[0], tableCount: tables.rowCount, tables: tables.rows.map(row => row.table_name), constraints: constraints.rows }, null, 2));
  await client.end();
})().catch(error => { console.error(error.message); process.exit(1); });

