import EmbeddedPostgres from 'file:///C:/Users/Admin/AppData/Local/Temp/rakshakai-isolated-pg-runtime/node_modules/embedded-postgres/dist/index.js';
const pg = new EmbeddedPostgres({
  databaseDir: 'C:/Users/Admin/AppData/Local/Temp/rakshakai-final-verification-20261030/cluster',
  user: 'rakshakai_test',
  password: 'test-only-password-ui-2026',
  port: 55440,
  persistent: false,
  onLog: message => console.log(`[pg] ${message}`),
  onError: message => console.error(`[pg:error] ${message}`)
});
await pg.initialise();
await pg.start();
await pg.createDatabase('rakshakai_test_copilot_utf8');
console.log('ISOLATED_POSTGRES_READY host=127.0.0.1 port=55440 database=rakshakai_test_copilot_utf8');
process.on('SIGINT', async () => { await pg.stop(); process.exit(0); });
process.on('SIGTERM', async () => { await pg.stop(); process.exit(0); });
await new Promise(() => {});

