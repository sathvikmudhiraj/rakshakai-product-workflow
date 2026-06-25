const { readDatabase, userFromReq } = require("../services/core.service");

async function attachUser(req, res, next) {
  try {
    req.db = await readDatabase();
    req.user = userFromReq(req, req.db);
    next();
  } catch (error) {
    next(error);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  next();
}

module.exports = { attachUser, requireAuth };
