const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { readDatabase, userFromReq, hasRole, addAuditLog, writeSelectedRecords } = require("../services/core.service");
const copilot = require("../services/copilotRead.service");
const conversations = require("../services/copilotConversation.service");
const auditLogsRepository = require("../repositories/auditLogs.repository");

const router = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.COPILOT_RATE_LIMIT || 90), standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many Copilot requests. Please wait and try again." } });

router.post("/query", limiter, async (req, res, next) => {
  try {
    const db = await readDatabase();
    const user = userFromReq(req, db);
    if (!user) throw Object.assign(new Error("Authentication required"), { status: 401 });
    if (!hasRole(user, ["Admin", "Police Officer"])) throw Object.assign(new Error("Copilot is available to authorized operational personnel only"), { status: 403 });
    const message = String(req.body?.message || "").trim();
    if (!message || message.length > 2000) throw Object.assign(new Error("Message must contain 1 to 2000 characters"), { status: 400 });
    const pageContext = copilot.sanitizePageContext(req.body?.pageContext);
    const conversation = conversations.open(user.id, req.body?.conversationId);
    let result;
    try {
      result = copilot.answer(db, message, { pageContext, priorEntities: conversation.entities, priorLanguage: conversation.language, selectedLanguage: req.body?.selectedLanguage });
    } catch (error) {
      const audit = addAuditLog(db, "copilot_query", user, null, JSON.stringify({ page: pageContext.page, intent: "failure", entities: [], success: false }));
      await writeSelectedRecords(db, [[auditLogsRepository, [audit]]]);
      return res.status(503).json({ error: "Rakshak Copilot is temporarily unavailable.", readOnly: true, generatedAt: new Date().toISOString() });
    }
    conversations.remember(conversation.key, result.entities, result.responseLanguage);
    const audit = addAuditLog(db, "copilot_query", user, null, JSON.stringify({ page: pageContext.page, intent: result.intent, detectedLanguage: result.detectedLanguage, selectedLanguage: ["auto", "en", "te", "hi"].includes(req.body?.selectedLanguage) ? req.body.selectedLanguage : "auto", responseLanguage: result.responseLanguage, entities: result.entities.map(({ type, id }) => ({ type, id })).slice(0, 8), success: true }));
    await writeSelectedRecords(db, [[auditLogsRepository, [audit]]]);
    res.json({ ...result, conversationId: conversation.conversationId, readOnly: true, generatedAt: new Date().toISOString() });
  } catch (error) { next(error); }
});
module.exports = router;
