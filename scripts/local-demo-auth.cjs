const path = require("node:path");
require("../backend/node_modules/dotenv").config({
  path: path.join(__dirname, "..", "backend", ".env"),
  quiet: true
});

const ENV_BY_ROLE = {
  admin: "SEED_ADMIN_PASSWORD",
  police: "SEED_POLICE_PASSWORD",
  citizen: "SEED_CITIZEN_PASSWORD"
};

function localDemoPassword(role) {
  const envName = ENV_BY_ROLE[String(role || "").toLowerCase()];
  if (!envName) throw new Error(`Unknown local demo role: ${role}`);
  const password = process.env[envName];
  if (!password) throw new Error(`${envName} must be set in backend/.env for local browser acceptance`);
  return password;
}

module.exports = { localDemoPassword };
