const express = require("express");
const controller = require("../controllers/auth.controller");
const google = require("../controllers/googleWorkspace.controller");
const { rateLimit } = require("express-rate-limit");

const router = express.Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT || 10),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many login attempts. Please wait and try again." }
});
const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.PASSWORD_CHANGE_RATE_LIMIT || 10),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many password change attempts. Please wait and try again." }
});

router.get("/me", controller.me);
router.get("/google/status", google.status);
router.get("/google/start", authLimiter, google.start);
router.get("/google/callback", authLimiter, google.callback);
router.get("/sessions", controller.sessions);
router.post("/sessions/revoke-others", passwordChangeLimiter, controller.revokeOtherSessions);
router.delete("/sessions/:id", passwordChangeLimiter, controller.revokeSession);
router.post("/login", authLimiter, controller.login);
router.post("/register", controller.register);
router.post("/logout", controller.logout);
router.post("/change-password", passwordChangeLimiter, controller.changePassword);

module.exports = router;
