const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { assertSafeTestDatabase } = require('../services/testDatabaseSafety');

const testDatabaseUrl = assertSafeTestDatabase(process.env);
const testPassword = process.env.TEST_USER_PASSWORD || '';
if (testPassword.length < 12 || testPassword.length > 128 || !/[a-z]/.test(testPassword) || !/[A-Z]/.test(testPassword) || !/\d/.test(testPassword)) {
  throw new Error('TEST_USER_PASSWORD must be 12-128 characters and include uppercase, lowercase, and a number');
}
const pool = new Pool({ connectionString: testDatabaseUrl.toString(), ssl: false });

async function main() {
  const hash = await bcrypt.hash(testPassword, 12);
  const now = new Date().toISOString();
  
  const users = [
    { id: 'u_verify_admin', name: 'Verification Admin', email: 'verify_admin@test.local', role: 'Admin' },
    { id: 'u_verify_police', name: 'Verification Police', email: 'verify_police@test.local', role: 'Police Officer' },
    { id: 'u_verify_citizen', name: 'Verification Citizen', email: 'verify_citizen@test.local', role: 'Citizen' }
  ];
  
  for (const u of users) {
    const data = JSON.stringify({ name: u.name, email: u.email, role: u.role });
    await pool.query(
      'INSERT INTO users (id, name, email, role, password_hash, created_at, data) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT (id) DO UPDATE SET password_hash = $5, data = $7::jsonb',
      [u.id, u.name, u.email, u.role, hash, now, data]
    );
  }
  console.log(`Created ${users.length} synthetic test users in the validated disposable test database.`);
  await pool.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
