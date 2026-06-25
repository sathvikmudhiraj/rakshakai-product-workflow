function errorMiddleware(error, req, res, next) {
  if (res.headersSent) return next(error);
  const malformedJson = error instanceof SyntaxError && error.status === 400 && "body" in error;
  const tooLarge = error.type === "entity.too.large" || error.status === 413;
  const status = malformedJson ? 400 : tooLarge ? 413 : Number(error.status) || 500;
  const safeMessage = status >= 500 && process.env.NODE_ENV === "production"
    ? "Internal server error"
    : malformedJson
      ? "Invalid JSON payload"
      : tooLarge
        ? "Request payload is too large"
        : error.message || "Internal server error";
  if (status >= 500) {
    console.error("Request failed", {
      method: req.method,
      path: req.originalUrl,
      message: error.message
    });
  }
  res.status(status).json({ error: safeMessage });
}

module.exports = { errorMiddleware };
