const bcrypt = require("bcryptjs");
const { query, closePool } = require("../services/postgres.service");

async function fixPasswords() {
  const hash = await bcrypt.hash("demo123", 12);
  console.log("hash:", hash);
  await query("UPDATE users SET password_hash = $1 WHERE email = $2", [hash, "admin@example.test"]);
  await query("UPDATE users SET password_hash = $1 WHERE email = $2", [hash, "admin@rakshakai.local"]);
  await query("UPDATE users SET password_hash = $1 WHERE email = $2", [hash, "police@rakshakai.local"]);
  await query("UPDATE users SET password_hash = $1 WHERE email = $2", [hash, "officer@example.test"]);
  console.log("done");
  await closePool();
}

fixPasswords().catch(console.error);