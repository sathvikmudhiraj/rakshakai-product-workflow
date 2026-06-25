require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const hash = await bcrypt.hash('RakshakAI@2024', 12);
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
    console.log('Created:', u.email, '-', u.role);
  }
  
  console.log('ALL TEST USERS CREATED SUCCESSFULLY');
  await pool.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
