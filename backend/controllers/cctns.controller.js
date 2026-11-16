const { readDatabase, withCctnsState, userFromReq, hasRole } = require("../services/core.service");
const cctns = require("../services/cctns.service");

function requireOperator(req, db) {
  const user = userFromReq(req, db);
  if (!user) throw Object.assign(new Error("Authentication required"), { status: 401 });
  if (!hasRole(user, ["Police Officer", "Admin"])) throw Object.assign(new Error("You do not have permission to access CCTNS records"), { status: 403 });
  return user;
}

exports.status = async (req, res, next) => {
  try { const db = await readDatabase(); requireOperator(req, db); res.json(cctns.adapterStatus()); } catch (error) { next(error); }
};

exports.search = async (req, res, next) => {
  try {
    const result = await withCctnsState((db) => {
      const user = requireOperator(req, db);
      const records = cctns.listRecords(db, user, req.query || {});
      cctns.auditSearch(db, user, req.query || {}, records.total);
      return records;
    });
    res.json(result);
  } catch (error) { next(error); }
};

exports.searchType = (type) => async (req, res, next) => {
  req.query = { ...req.query, type };
  return exports.search(req, res, next);
};

exports.getRecord = async (req, res, next) => {
  try {
    const result = await withCctnsState((db) => {
      const user = requireOperator(req, db);
      const detail = cctns.recordDetail(db, user, req.params.id);
      cctns.auditViewedRecord(db, user, detail.record);
      return detail;
    });
    res.json(result);
  } catch (error) { next(error); }
};

exports.createLink = async (req, res, next) => {
  try {
    const link = await withCctnsState((db) => cctns.createLink(db, requireOperator(req, db), req.body || {}), { writeLinks: true });
    res.status(201).json({ link });
  } catch (error) { next(error); }
};

exports.removeLink = async (req, res, next) => {
  try {
    const link = await withCctnsState((db) => cctns.unlinkReference(db, requireOperator(req, db), req.params.id), { writeLinks: true });
    res.json({ link });
  } catch (error) { next(error); }
};
