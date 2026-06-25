const {
  ensureDb,
  readDb,
  writeDb,
  readDatabase,
  writeDatabase
} = require("./core.service");
const { getDatabaseMode } = require("./postgres.service");

module.exports = {
  ensureDb,
  readDb,
  writeDb,
  readDatabase,
  writeDatabase,
  getDatabaseMode
};
