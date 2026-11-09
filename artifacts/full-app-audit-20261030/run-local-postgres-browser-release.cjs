const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { Pool, Client } = require('../../backend/node_modules/pg');

const root = path.resolve(__dirname, '../..');
const baseUrl = 'postgresql://rakshakai_test:test-only-password-ui-2026@127.0.0.1:55440/rakshakai_test_copilot_utf8';
const databaseName = 'rakshakai_test_copilot_utf8';
const reuseSchema = process.env.RELEASE_TEST_REUSE_SCHEMA || '';
const schema = reuseSchema || `rakshakai_test_full_${crypto.randomBytes(5).toString('hex')}`;
if (!/^rakshakai_test_full_[a-z0-9_]+$/.test(schema)) throw new Error('Refusing an unsafe test schema name.');
const scopedUrl = new URL(baseUrl);
scopedUrl.searchParams.set('options', `-csearch_path=${schema}`);
const databaseUrl = scopedUrl.toString();
const password = process.env.RELEASE_TEST_PASSWORD;
if (!password) throw new Error('Set RELEASE_TEST_PASSWORD to a synthetic test-only password.');
const frontendUrl = process.env.RELEASE_TEST_FRONTEND_URL || 'http://127.0.0.1:3002';
const backendPort = process.env.RELEASE_TEST_BACKEND_PORT || '5001';
const logFile = path.join(__dirname, 'full-app-backend.log');
let backend;

async function main() {
  console.log(`Isolated PostgreSQL acceptance schema: ${schema}`);
  const web = await fetch(frontendUrl);
  if (!web.ok) throw new Error(`Frontend test server returned ${web.status}`);
  if (!reuseSchema) {
    const adminPool = new Pool({ connectionString: baseUrl, ssl: false });
    try {
      await adminPool.query(`CREATE SCHEMA "${schema}"`);
    } finally {
      await adminPool.end();
    }

    const scopedPool = new Pool({ connectionString: databaseUrl, ssl: false });
    try {
      const client = await scopedPool.connect();
      try {
        process.env.NODE_ENV = 'test';
        process.env.TEST_DATABASE_URL = baseUrl;
        process.env.RAKSHAKAI_TEST_DATABASE_NAME = databaseName;
        process.env.RAKSHAKAI_TEST_SCHEMA = schema;
        process.env.DATABASE_URL = databaseUrl;
        process.env.PG_SSL_MODE = 'disable';
        const { __testables } = require('../../backend/scripts/migrate.js');
        await __testables.runMigrations({ client });
      } finally {
        client.release();
      }
    } finally {
      await scopedPool.end();
    }
  }

  const commonEnv = {
    ...process.env,
    NODE_ENV: 'test',
    TEST_DATABASE_URL: baseUrl,
    RAKSHAKAI_TEST_DATABASE_NAME: databaseName,
    RAKSHAKAI_TEST_SCHEMA: schema,
    DATABASE_URL: databaseUrl,
    PG_SSL_MODE: 'disable',
    JWT_SECRET: 'isolated-full-app-e2e-jwt-secret-2026-long',
    CAMERA_CREDENTIAL_ENCRYPTION_KEY: '71'.repeat(32),
    SEED_ADMIN_PASSWORD: password,
    SEED_POLICE_PASSWORD: password,
    SEED_CITIZEN_PASSWORD: password,
    RAKSHAKAI_IMPORT_FILE: path.join(root, 'backend/data/db.example.json'),
    EVIDENCE_STORAGE_DRIVER: 'filesystem',
    EVIDENCE_STORAGE_DIR: path.join(__dirname, 'evidence-storage'),
    AI_SERVICE_URL: '',
    GIS_ROUTING_PROVIDER: 'self_hosted',
    OSRM_BASE_URL: 'http://127.0.0.1:1',
    PUBLIC_OSRM_FALLBACK: 'false',
    ROUTE_TIMEOUT_MS: '500',
    FRONTEND_ORIGINS: `${frontendUrl},http://localhost:3002`,
    PORT: backendPort,
    ESCALATION_SWEEP_INTERVAL_MS: '3600000',
    SLA_SWEEP_INTERVAL_MS: '3600000'
  };
  if (!reuseSchema) {
    const imported = spawnSync(process.execPath, ['scripts/import-json-to-postgres.js', '--source', 'data/db.example.json'], {
      cwd: path.join(root, 'backend'), env: commonEnv, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024
    });
    fs.writeFileSync(path.join(__dirname, 'postgres-seed-import.log'), `${imported.stdout || ''}${imported.stderr || ''}`);
    if (imported.status !== 0) throw new Error(`Synthetic PostgreSQL fixture import failed (exit ${imported.status}); see postgres-seed-import.log`);
  }

  fs.writeFileSync(logFile, '');
  let output;
  const stopBackend = async () => {
    if (backend) {
      const child = backend;
      if (child.exitCode === null) {
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 5000);
          timer.unref();
          child.once('exit', () => { clearTimeout(timer); resolve(); });
          child.kill('SIGTERM');
        });
      }
      if (output) {
        child.stdout.unpipe(output);
        child.stderr.unpipe(output);
        output.end();
        await new Promise(resolve => output.closed ? resolve() : output.once('close', resolve));
        output = null;
      }
    }
    backend = null;
  };
  const startBackend = async () => {
    output = fs.createWriteStream(logFile, { flags: 'a' });
    backend = spawn(process.execPath, ['backend/server.js'], { cwd: root, env: commonEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    backend.stdout.pipe(output);
    backend.stderr.pipe(output);
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      try { const response = await fetch(`http://127.0.0.1:${backendPort}/api/health`); if (response.ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const ready = await fetch(`http://127.0.0.1:${backendPort}/api/health`).catch(() => null);
    if (!ready?.ok) throw new Error('Isolated PostgreSQL backend did not become ready.');
  };
  await startBackend();

  process.env.RELEASE_TEST_BROWSERS = 'chromium';
  const { runBrowserChecks } = require(path.join(root, 'scripts/browser-release-no-map-provider.cjs'));
  let scenariosStarted = 0;
  try {
    if (process.env.RELEASE_TEST_SKIP_MATRIX !== 'true') {
      await runBrowserChecks({
        baseUrl: frontendUrl,
        password,
        beforeScenario: async () => {
          if (scenariosStarted++ > 0) {
            await stopBackend();
            await startBackend();
          }
        }
      });
    }
    if (process.env.RELEASE_TEST_WORKFLOW_SCRIPT) {
      const workflow = require(path.resolve(root, process.env.RELEASE_TEST_WORKFLOW_SCRIPT));
      if (typeof workflow.runPriorityWorkflow !== 'function') throw new Error('Workflow script must export runPriorityWorkflow().');
      await workflow.runPriorityWorkflow({ baseUrl: frontendUrl, password, schema, databaseUrl, screenshots: path.join(__dirname, 'screenshots') });
    }
    console.log(JSON.stringify({ result: 'browser checks completed', schema, database: databaseName, backend: `http://127.0.0.1:${backendPort}`, frontend: frontendUrl }));
  } finally {
    await stopBackend();
  }
}

main().catch(async error => {
  console.error(error.stack || error.message);
  if (backend && backend.exitCode === null) await new Promise(resolve => { backend.once('exit', resolve); backend.kill('SIGTERM'); setTimeout(resolve, 5000).unref(); });
  process.exitCode = 1;
});
