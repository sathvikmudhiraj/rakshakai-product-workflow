/**
 * hash-json-passwords.js
 *
 * Migrates plaintext passwords in backend/data/db.json to bcrypt hashes.
 * Idempotent: skips users that already have a passwordHash field
 * with a valid bcrypt hash.
 *
 * Usage:
 *   node backend/scripts/hash-json-passwords.js
 *
 * Run this once after setting up the project.
 * After migration, set JSON_BODY_LIMIT in .env and restart.
 */

const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcryptjs");

const dbPath = path.join(__dirname, "..", "data", "db.json");

function main() {
  if (!fs.existsSync(dbPath)) {
    console.error("backend/data/db.json not found at", dbPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(dbPath, "utf8").replace(/^\uFEFF/, "");
  const db = JSON.parse(raw);
  const users = db.users || [];

  if (!users.length) {
    console.log("No users found in backend/data/db.json. Nothing to do.");
    return;
  }

  let migrated = 0;
  let skipped = 0;

  users.forEach((user) => {
    // If already has a bcrypt passwordHash, skip
    if (user.passwordHash && /^\$2[aby]\$/.test(user.passwordHash)) {
      skipped += 1;
      return;
    }

    // If has passwordHash but not bcrypt (e.g., a raw hash), re-hash
    const plaintext = user.password || user.passwordHash || "";
    if (!plaintext) {
      skipped += 1;
      return;
    }

    // Hash the password using bcrypt with cost factor 12
    user.passwordHash = bcrypt.hashSync(String(plaintext), 12);
    delete user.password;
    migrated += 1;
  });

  if (migrated > 0) {
    // Normalize the JSON output to match the existing file format
    const output = JSON.stringify(db, null, 2) + "\n";
    fs.writeFileSync(dbPath, output);
    console.log(`Migrated ${migrated} user(s): plaintext passwords replaced with bcrypt hashes.`);
  } else {
    console.log("No plaintext passwords found. All users already use bcrypt hashes.");
  }

  if (skipped > 0) {
    console.log(`Skipped ${skipped} user(s) (already hashed or no password).`);
  }
}

main();
