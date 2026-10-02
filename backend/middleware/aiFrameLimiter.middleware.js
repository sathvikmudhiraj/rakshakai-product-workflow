const { rateLimit } = require("express-rate-limit");

// Dedicated limiter for authenticated AI frame analysis. Live Vision samples at
// 800-1500 ms (40-75 requests/minute), so this budget keeps continuous sessions
// running while still limiting abusive request rates. Normal API protection
// remains governed by the general limiter in server.js.
const aiFrameLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.AI_FRAME_RATE_LIMIT || 300),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many AI frame requests. Please reduce the Live Vision sampling rate." }
});

module.exports = { aiFrameLimiter };
