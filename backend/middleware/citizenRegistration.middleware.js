function requireCitizenRegistrationEnabled(req, res, next) {
  const configured = String(process.env.ALLOW_CITIZEN_REGISTRATION ?? "true").trim().toLowerCase();
  if (configured !== "true" && configured !== "false") {
    return res.status(503).json({ error: "Citizen registration is unavailable because its setting is invalid." });
  }
  if (configured === "false") {
    return res.status(403).json({ error: "Citizen self-registration is disabled." });
  }
  return next();
}

module.exports = { requireCitizenRegistrationEnabled };
