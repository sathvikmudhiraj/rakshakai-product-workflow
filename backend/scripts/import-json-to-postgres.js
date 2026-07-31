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

  const summaries = [];
  await withTransaction(async (client) => {
    for (const [key, repository] of mappings) {
      const records = db[key] || [];
      let inserted = 0;
      let skippedExisting = 0;
      let failed = 0;
      for (const record of records) {
        await client.query("SAVEPOINT import_record");
        try {
          const result = await client.query(`SELECT 1 FROM ${repository.table} WHERE id = $1`, [record.id]);
          if (result.rowCount) {
            skippedExisting += 1;
          } else {
            await repository.upsert(record, client);
            inserted += 1;
          }
          await client.query("RELEASE SAVEPOINT import_record");
        } catch {
          failed += 1;
          await client.query("ROLLBACK TO SAVEPOINT import_record");
          await client.query("RELEASE SAVEPOINT import_record");
        }
      }
      const summary = { collection: key, table: repository.table, inserted, skippedExisting, failed };
      summaries.push(summary);
      console.log(
        `collection=${summary.collection} table=${summary.table} inserted=${summary.inserted} `
        + `skipped-existing=${summary.skippedExisting} failed=${summary.failed}`
      );
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
  const totals = summaries.reduce(
    (result, summary) => ({
      inserted: result.inserted + summary.inserted,
      skippedExisting: result.skippedExisting + summary.skippedExisting,
      failed: result.failed + summary.failed
    }),
    { inserted: 0, skippedExisting: 0, failed: 0 }
  );
  console.log(
    `import totals: inserted=${totals.inserted} skipped-existing=${totals.skippedExisting} failed=${totals.failed}`
  );
  if (totals.failed > 0) {
    process.exitCode = 1;
    console.error("db.json import completed with failed records; review collection/table counters.");
  } else {
    console.log("db.json import completed successfully.");
  }
}

main()
  .catch(() => {
    console.error("db.json import failed. Review database connectivity and schema diagnostics.");
    process.exitCode = 1;
  })
  .finally(closePool);
