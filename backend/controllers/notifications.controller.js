const { readDatabase, writeDb, addAuditLog } = require("../services/core.service");
const { getDatabaseMode } = require("../services/postgres.service");
const auditLogsRepository = require("../repositories/auditLogs.repository");
const notificationService = require("../services/notification.service");

function authenticatedUser(req, db) {
  const { userFromReq } = require("../services/core.service");
  const user = userFromReq(req, db);
  if (!user) throw Object.assign(new Error("Authentication required"), { status: 401 });
  return user;
}

async function audit(db, user, action, notification, details = "") {
  const log = addAuditLog(db, action, user, notification?.entityType === "incident" ? notification.entityId : null, `${notification?.id || "all"}${details ? `; ${details}` : ""}`);
  if (getDatabaseMode() === "postgres") await auditLogsRepository.upsert(log);
  else writeDb(db);
}

exports.list = async (req, res, next) => {
  try { const db = await readDatabase(); const user = authenticatedUser(req, db); res.json(await notificationService.listNotifications(db, user)); }
  catch (error) { next(error); }
};

exports.read = async (req, res, next) => {
  try {
    const db = await readDatabase(); const user = authenticatedUser(req, db);
    const result = await notificationService.setRead(db, user, req.params.id, req.body?.read !== false);
    const notification = await notificationService.findNotification(db, user, req.params.id);
    await audit(db, user, result.read ? "notification_marked_read" : "notification_marked_unread", notification);
    res.json({ notification: { ...notification, ...result } });
  } catch (error) { next(error); }
};

exports.markAllRead = async (req, res, next) => {
  try { const db = await readDatabase(); const user = authenticatedUser(req, db); const result = await notificationService.markAllRead(db, user); await audit(db, user, "notifications_marked_all_read", null, `count=${result.updated}`); res.json(result); }
  catch (error) { next(error); }
};

exports.details = async (req, res, next) => {
  try {
    const db = await readDatabase(); const user = authenticatedUser(req, db);
    const notification = await notificationService.findNotification(db, user, req.params.id);
    const detail = await notificationService.authoritativeDetail(db, user, notification);
    await audit(db, user, "notification_viewed", notification);
    res.json({ notification, detail, fetchedAt: new Date().toISOString() });
  } catch (error) { next(error); }
};

exports.opened = async (req, res, next) => {
  try { const db = await readDatabase(); const user = authenticatedUser(req, db); const notification = await notificationService.findNotification(db, user, req.params.id); await audit(db, user, "notification_opened_entity", notification); res.json({ ok: true }); }
  catch (error) { next(error); }
};
