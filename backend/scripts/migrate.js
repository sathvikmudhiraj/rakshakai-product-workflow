const fs = require("node:fs");
const path = require("node:path");
const { query, closePool } = require("../services/postgres.service");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Add the Neon connection string to backend/.env.");
  }
  const schemaPath = path.join(__dirname, "..", "database", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  const attempts = Math.max(1, Number(process.env.PG_MIGRATION_RETRIES || 20));
  const retryDelay = Math.max(250, Number(process.env.PG_MIGRATION_RETRY_MS || 1500));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await query(schema);
      console.log("PostgreSQL migration completed successfully.");
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      console.warn(`PostgreSQL not ready for migration (attempt ${attempt}/${attempts}); retrying...`);
      await sleep(retryDelay);
    }
  }
}

main()
  .catch((error) => {
    console.error("PostgreSQL migration failed:", error.message);
    process.exitCode = 1;
  })
  .finally(closePool);
