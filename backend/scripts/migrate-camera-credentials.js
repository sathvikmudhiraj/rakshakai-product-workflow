/*
 * One-shot, idempotent migration: encrypts any legacy plaintext camera credentials
 * (streamUrl/rtspUrl/hlsUrl/onvifUrl, username, password, token, apiKey, secret)
 * stored in the JSON database file or in PostgreSQL camera_sources rows.
 *
 * - Idempotent: already-encrypted enc:v1 values are recognized and skipped.
 * - Reports counts only. Credential values and key material are never printed.
 * - Storage selected exactly like the backend: DATABASE_URL set -> PostgreSQL,
 *   otherwise the JSON file (RAKSHAKAI_DATA_FILE or backend/data/db.json).
 *
 * Usage: npm run migrate:camera-credentials
 */
const fs = require("node:fs");
const path = require("node:path");
const { getDatabaseMode, query, withTransaction, closePool } = require("../services/postgres.service");
const {
  encryptCameraSecrets,
  hasLegacyPlaintextSecrets,
  validateCameraCredentialConfig
} = require("../services/cameraSecrets.service");

function jsonDbPath() {
  return process.env.RAKSHAKAI_DATA_FILE
    ? path.resolve(process.env.RAKSHAKAI_DATA_FILE)
    : path.join(__dirname, "..", "data", "db.json");
}

async function migrateJsonStore(summary) {
  const dbPath = jsonDbPath();
  if (!fs.existsSync(dbPath)) {
    console.log("No JSON database found; nothing to migrate.");
    return;
  }
  const raw = fs.readFileSync(dbPath, "utf8");
  const db = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  const sources = Array.isArray(db.cameraSources) ? db.cameraSources : [];
  for (const source of sources) summary.scanOne(source);
  if (summary.fieldsEncrypted > 0) {
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
  }
}

async function migratePostgres(summary) {
  const rows = (await query("SELECT id, data FROM camera_sources")).rows;
  const dirty = [];
  for (const row of rows) {
    const source = row.data && typeof row.data === "object" ? row.data : {};
    summary.scanOne(source, row.id);
    if (summary.lastChanged) dirty.push({ id: row.id, data: source });
  }
  if (!dirty.length) return;
  await withTransaction(async (client) => {
    for (const row of dirty) {
      await client.query("UPDATE camera_sources SET data = $2::jsonb, updated_at = NOW() WHERE id = $1", [row.id, JSON.stringify(row.data)]);
    }
  });
}

function createSummary() {
  return {
    scanned: 0,
    camerasMigrated: 0,
    fieldsEncrypted: 0,
    failures: 0,
    lastChanged: false,
    scanOne(source, id = source?.id || "unknown") {
      this.scanned += 1;
      this.lastChanged = false;
      try {
        if (!hasLegacyPlaintextSecrets(source)) return;
        const encrypted = encryptCameraSecrets(source);
        if (encrypted > 0) {
          this.camerasMigrated += 1;
          this.fieldsEncrypted += encrypted;
          this.lastChanged = true;
        }
      } catch {
        // IDs and exception messages may contain legacy secret material.
        this.failures += 1;
      }
    }
  };
}

async function main() {
  validateCameraCredentialConfig();
  const summary = createSummary();
  const mode = getDatabaseMode();
  if (mode === "json") await migrateJsonStore(summary);
  else await migratePostgres(summary);
  console.log(`camera credential migration (${mode}): scanned=${summary.scanned} migrated=${summary.camerasMigrated} fields-encrypted=${summary.fieldsEncrypted} failures=${summary.failures}`);
  if (summary.failures > 0) {
    process.exitCode = 1;
    console.error("Camera credential migration completed with failures; review counters above.");
  } else if (summary.camerasMigrated === 0) {
    console.log("No plaintext camera credentials found. Storage already encrypted or empty.");
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error("Camera credential migration failed; no credential values were printed.");
      process.exitCode = 1;
    })
    .finally(closePool);
}

module.exports = { main, createSummary, jsonDbPath };
