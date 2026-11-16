const google = require("../services/googleWorkspace.service");
const { completeGoogleLogin } = require("../services/core.service");

exports.status = (req, res, next) => {
  try { res.json({ enabled: Boolean(google.config()), requireWorkspaceSso: process.env.GOOGLE_REQUIRE_WORKSPACE_SSO === "true" }); }
  catch (error) { next(error); }
};

exports.start = async (req, res, next) => {
  try {
    const settings = google.config();
    if (!settings) return res.status(503).json({ error: "Google Workspace sign-in is not configured" });
    const flow = await google.begin(settings);
    res.setHeader("Set-Cookie", flow.cookie);
    res.setHeader("Referrer-Policy", "no-referrer");
    res.redirect(303, flow.url);
  } catch (error) { next(error); }
};

exports.callback = async (req, res) => {
  let settings;
  try {
    settings = google.config();
    if (!settings) return res.status(503).json({ error: "Google Workspace sign-in is not configured" });
    res.setHeader("Set-Cookie", google.clearCookie(settings));
    res.setHeader("Referrer-Policy", "no-referrer");
    const identity = await google.finish(settings, req);
    const result = await completeGoogleLogin(identity, req);
    res.setHeader("Set-Cookie", [google.clearCookie(settings), ...result.cookies]);
    res.redirect(303, `${settings.appOrigin}/`);
  } catch {
    // Provider errors can contain authorization codes or tokens. Never forward them.
    if (settings) return res.redirect(303, `${settings.appOrigin}/?authError=google_sign_in_failed`);
    res.status(503).json({ error: "Google Workspace sign-in is unavailable" });
  }
};
