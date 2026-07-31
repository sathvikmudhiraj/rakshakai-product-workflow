/**
 * Reset local/demo users to the documented demo credentials.
 *
 * Usage:
 *   npm --prefix backend run reset:demo-users
 *
 * This script refuses to run in production. It supports the current database
 * mode: JSON when DATABASE_URL is empty, PostgreSQL when DATABASE_URL is set.
 */

const bcrypt = require("bcryptjs");
const usersRepository = require("../repositories/users.repository");
const { readDb, writeDb, now } = require("../services/core.service");
const {
  closePool,
  getDatabaseMode,
  query
} = require("../services/postgres.service");

const DEMO_PASSWORD = "demo123";
const DEMO_USERS = [
  { id: "u_admin", name: "Admin Control Room", email: "admin@rakshakai.local", role: "Admin" },
  { id: "u_police", name: "Inspector Kavya Rao", email: "police@rakshakai.local", role: "Police Officer" },
  { id: "u_citizen", name: "Citizen Reporter", email: "citizen@rakshakai.local", role: "Citizen" }
];

function assertNonProduction() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to reset demo users when NODE_ENV=production");
  }
}

async function resetJsonUsers(passwordHash) {
  const db = readDb();
  db.users = Array.isArray(db.users) ? db.users : [];
  for (const demo of DEMO_USERS) {
    const existing = db.users.find((user) => String(user.email || "").toLowerCase() === demo.email)
      || db.users.find((user) => user.id === demo.id);
    const record = {
      ...(existing || {}),
      ...demo,
      passwordHash,
      sessionVersion: null,
      createdAt: existing?.createdAt || now()
    };
    delete record.password;
    if (existing) Object.assign(existing, record);
    else db.users.push(record);
  }
  writeDb(db);
}

async function resetPostgresUsers(passwordHash) {
  for (const demo of DEMO_USERS) {
    const existing = await query("SELECT id, created_at FROM users WHERE lower(email) = lower($1) LIMIT 1", [demo.email]);
    const record = {
      ...demo,
      id: existing.rows[0]?.id || demo.id,
      passwordHash,
      sessionVersion: null,
      createdAt: existing.rows[0]?.created_at || now()
    };
    await usersRepository.upsert(record);
  }
}

async function main() {
  assertNonProduction();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  if (getDatabaseMode() === "postgres") await resetPostgresUsers(passwordHash);
  else await resetJsonUsers(passwordHash);
  console.log(`Demo users reset in ${getDatabaseMode()} mode:`);
  for (const user of DEMO_USERS) console.log(`- ${user.email} / ${DEMO_PASSWORD} (${user.role})`);
}

main()
  .catch((error) => {
    console.error("Failed to reset demo users:", error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));
