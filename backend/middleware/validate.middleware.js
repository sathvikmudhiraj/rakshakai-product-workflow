function validateJson(req, res, next) {
  if (!["POST", "PUT", "PATCH"].includes(req.method)) return next();
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  const contentLength = Number(req.headers["content-length"] || 0);
  if (!contentType && contentLength === 0 && !req.headers["transfer-encoding"]) {
    req.body = {};
    return next();
  }
  if (!contentType.startsWith("application/json")) {
    return res.status(415).json({ error: "Content-Type must be application/json" });
  }
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return res.status(400).json({ error: "Request body must be a JSON object" });
  }
  next();
}

module.exports = { validateJson };
