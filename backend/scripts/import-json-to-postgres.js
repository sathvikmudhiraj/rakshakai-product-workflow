const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const { withTransaction, closePool } = require("../services/postgres.service");
const users = require("../repositories/users.repository");
const incidents = require("../repositories/incidents.repository");
const alerts = require("../repositories/alerts.repository");
const responseUnits = require("../repositories/responseUnits.repository");
const dispatchEvents = require("../repositories/dispatchEvents.repository");
const cameraSources = require("../repositories/cameraSources.repository");
const auditLogs = require("../repositories/auditLogs.repository");
const missingPersons = require("../repositories/missingPersons.repository");

const mappings = [
  ["users", users],
  ["incidents", incidents],
  ["alerts", alerts],
  ["responseUnits", responseUnits],
  ["dispatchEvents", dispatchEvents],
  ["cameraSources", cameraSources],
  ["auditLogs", auditLogs],
  ["reports", missingPersons]
];

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Run npm run migrate before importing.");
  }
  const dbPath = path.join(__dirname, "..", "data", "db.json");
  const seedOnly = process.argv.includes("--if-empty");
  const db = JSON.parse(fs.readFileSync(dbPath, "utf8").replace(/^\uFEFF/, ""));
  db.reports = db.reports || db.missingPersons || [];
  db.users = await Promise.all((db.users || []).map(async (user) => {
    const seededPassword = user.role === "Admin"
      ? process.env.SEED_ADMIN_PASSWORD
      : user.role === "Police Officer"
        ? process.env.SEED_POLICE_PASSWORD
        : user.role === "Citizen"
          ? process.env.SEED_CITIZEN_PASSWORD
          : "";
    const existingHash = user.passwordHash || (/^\$2[aby]\$/.test(user.password || "") ? user.password : null);
    return {
      ...user,
      passwordHash: seededPassword
        ? await bcrypt.hash(String(seededPassword), 12)
        : existingHash || await bcrypt.hash(String(user.password || ""), 12),
      password: undefined
    };
  }));

  await withTransaction(async (client) => {
    for (const [key, repository] of mappings) {
      const records = db[key] || [];
      let imported = 0;
      for (const record of records) {
        const result = await client.query(`SELECT 1 FROM ${repository.table} WHERE id = $1`, [record.id]);
        if (result.rowCount) continue;
        await repository.upsert(record, client);
        imported += 1;
      }
      console.log(`${key}: imported ${imported}, skipped ${(records.length - imported)}`);
    }
    const extraState = {
      cameras: db.cameras || [],
      zones: db.zones || [],
      devices: db.devices || [],
      detections: db.detections || []
    };
    if (seedOnly) {
      await client.query(
        `INSERT INTO app_state (key, data) VALUES ('operational', $1::jsonb)
         ON CONFLICT (key) DO NOTHING`,
        [JSON.stringify(extraState)]
      );
    } else {
      await client.query(
        `INSERT INTO app_state (key, data) VALUES ('operational', $1::jsonb)
         ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [JSON.stringify(extraState)]
      );
    }
  });
  console.log("db.json import completed successfully.");
}

main()
  .catch((error) => {
    console.error("db.json import failed:", error.message);
    process.exitCode = 1;
  })
  .finally(closePool);
