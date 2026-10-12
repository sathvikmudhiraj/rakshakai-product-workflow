const { readDatabase, userFromReq, hasRole } = require("../services/core.service");
const { gateway } = require("../services/mediaGatewayRuntime.service");

function requireRole(req, db, roles) {
  const user = userFromReq(req, db);
  if (!user) throw Object.assign(new Error("Authentication required"), { status: 401 });
  if (!hasRole(user, roles)) throw Object.assign(new Error("You do not have permission for this action"), { status: 403 });
  return user;
}

function camera(db, id) {
  const source = (db.cameraSources || []).find((item) => item.id === id || item.cameraId === id);
  if (!source) throw Object.assign(new Error("Camera source not found"), { status: 404 });
  if (source.isDemo) throw Object.assign(new Error("Demo feeds do not use the real RTSP gateway"), { status: 409 });
  return source;
}

exports.health = async (req, res, next) => {
  try {
    const db = await readDatabase(); requireRole(req, db, ["Admin", "Police Officer"]);
    res.json({ gateway: gateway.health(), streams: [...gateway.sessions.values()].map((session) => gateway.snapshot(session)) });
  } catch (error) { next(error); }
};
exports.start = async (req, res, next) => {
  try {
    const db = await readDatabase(); requireRole(req, db, ["Admin"]);
    const source = camera(db, req.params.id);
    if (source.streamEnabled !== true) throw Object.assign(new Error("Enable stream processing in camera configuration first"), { status: 409 });
    res.json({ cameraId: source.id, state: await gateway.startCamera(source) });
  } catch (error) { next(error); }
};

exports.stop = async (req, res, next) => {
  try {
    const db = await readDatabase(); requireRole(req, db, ["Admin"]); camera(db, req.params.id);
    res.json({ cameraId: req.params.id, stopped: await gateway.stopCamera(req.params.id) });
  } catch (error) { next(error); }
};

