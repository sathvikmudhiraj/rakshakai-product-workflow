/**
 * Reset local JSON demo users to passwords configured in backend/.env.
 *
 * Usage:
 *   npm --prefix backend run reset:demo-users
 *
 * This script is deliberately JSON-only so it cannot change PostgreSQL users.
 */

const bcrypt = require("bcryptjs");
const { getDatabaseMode } = require("../services/postgres.service");

const DEMO_USERS = [
  { id: "u_admin", name: "Admin Control Room", email: "admin@rakshakai.local", role: "Admin" },
  { id: "u_police", name: "Inspector Kavya Rao", email: "police@rakshakai.local", role: "Police Officer" },
  { id: "u_citizen", name: "Citizen Reporter", email: "citizen@rakshakai.local", role: "Citizen" }
];

function assertNonProduction() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to reset demo users when NODE_ENV=production");
  }
  if (getDatabaseMode() !== "json") {
    throw new Error("Refusing to reset demo users while DATABASE_URL is configured; local demo accounts are JSON-only");
  }
}

function configuredPasswords() {
  const passwords = {
    Admin: process.env.SEED_ADMIN_PASSWORD || "",
    "Police Officer": process.env.SEED_POLICE_PASSWORD || "",
    Citizen: process.env.SEED_CITIZEN_PASSWORD || ""
  };
  for (const [role, password] of Object.entries(passwords)) {
    if (password.length < 12 || password.length > 128 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
      throw new Error(`SEED password for ${role} must be 12-128 characters and include uppercase, lowercase, and a number`);
    }
  }
  if (new Set(Object.values(passwords)).size !== Object.keys(passwords).length) {
    throw new Error("SEED password values must be distinct");
  }
  return passwords;
}

async function resetJsonUsers(passwordHashes) {
  const { readDb, writeDb, now } = require("../services/core.service");
  const db = readDb();
  db.users = Array.isArray(db.users) ? db.users : [];
  for (const demo of DEMO_USERS) {
    const existing = db.users.find((user) => String(user.email || "").toLowerCase() === demo.email)
      || db.users.find((user) => user.id === demo.id);
    const record = {
      ...(existing || {}),
      ...demo,
      passwordHash: passwordHashes[demo.role],
      sessionVersion: null,
      createdAt: existing?.createdAt || now()
    };
    delete record.password;
    if (existing) Object.assign(existing, record);
    else db.users.push(record);
  }
  writeDb(db);
}

async function main() {
  assertNonProduction();
  const passwords = configuredPasswords();
  const passwordHashes = Object.fromEntries(await Promise.all(
    Object.entries(passwords).map(async ([role, password]) => [role, await bcrypt.hash(password, 12)])
  ));
  await resetJsonUsers(passwordHashes);
  console.log("Local JSON demo accounts reset. Password values were not displayed.");
}

main()
  .catch((error) => {
    console.error("Failed to reset demo users:", error.message);
    process.exitCode = 1;
  });
