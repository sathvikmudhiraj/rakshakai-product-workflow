const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");

const FLOW_COOKIE = "rakshakai_google_flow";
function config(env = process.env) {
  const keys = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "GOOGLE_WORKSPACE_DOMAINS", "GOOGLE_APP_ORIGIN"];
  if (!keys.some((key) => env[key]) && env.GOOGLE_REQUIRE_WORKSPACE_SSO !== "true") return null;
  if (keys.some((key) => !String(env[key] || "").trim())) throw new Error("Google Workspace SSO configuration is incomplete");
  const redirect = new URL(env.GOOGLE_REDIRECT_URI);
  const app = new URL(env.GOOGLE_APP_ORIGIN);
  for (const url of [redirect, app]) {
    const local = env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((!local && url.protocol !== "https:") || url.username || url.password || url.hash || url.search) throw new Error("Google SSO requires safe HTTPS application URLs");
  }
  if (redirect.pathname !== "/api/auth/google/callback" || app.pathname !== "/" || redirect.origin !== app.origin) throw new Error("Google SSO requires a same-origin callback through the application proxy");
  const domains = env.GOOGLE_WORKSPACE_DOMAINS.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!domains.length || domains.some((domain) => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain))) throw new Error("Explicit Google Workspace domains are required");
  if (String(env.JWT_SECRET || "").length < 32) throw new Error("Google SSO requires a JWT_SECRET of at least 32 characters");
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: redirect.href, appOrigin: app.origin, domains,
    flowKey: crypto.createHmac("sha256", env.JWT_SECRET).update("rakshakai-google-oauth-flow-v1").digest(), secure: env.NODE_ENV === "production" };
}

function cookie(value, settings, clear = false) {
  return `${FLOW_COOKIE}=${value}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 300}${settings.secure ? "; Secure" : ""}`;
}

function flowCookie(req) {
  return String(req.headers.cookie || "").split(";").map((item) => item.trim()).find((item) => item.startsWith(`${FLOW_COOKIE}=`))?.slice(FLOW_COOKIE.length + 1) || "";
}

function client(settings) {
  return new OAuth2Client({ clientId: settings.clientId, clientSecret: settings.clientSecret, redirectUri: settings.redirectUri, transporterOptions: { timeout: 10000, retry: false } });
}

async function begin(settings, oauth = client(settings)) {
  const state = crypto.randomBytes(32).toString("base64url");
  const nonce = crypto.randomBytes(32).toString("base64url");
  const codes = await oauth.generateCodeVerifierAsync();
  const flow = jwt.sign({ nonce, verifier: codes.codeVerifier }, settings.flowKey, { algorithm: "HS256", audience: "google-oauth-flow", subject: state, expiresIn: 300 });
  const url = oauth.generateAuthUrl({ scope: ["openid", "email", "profile"], access_type: "online", prompt: "select_account", state, nonce,
    code_challenge_method: "S256", code_challenge: codes.codeChallenge, hd: settings.domains.length === 1 ? settings.domains[0] : undefined });
  return { url, cookie: cookie(flow, settings) };
}

function validateIdentity(payload, flow, settings) {
  if (!payload || payload.nonce !== flow.nonce || payload.email_verified !== true || !payload.sub || typeof payload.email !== "string"
    || !settings.domains.includes(String(payload.hd || "").toLowerCase())) {
    throw Object.assign(new Error("Google Workspace identity is not authorized"), { status: 403 });
  }
  return { sub: payload.sub, email: payload.email };
}

async function finish(settings, req, oauth = client(settings)) {
  let flow;
  try { flow = jwt.verify(flowCookie(req), settings.flowKey, { algorithms: ["HS256"], audience: "google-oauth-flow" }); }
  catch { throw Object.assign(new Error("Sign-in request expired. Start Google sign-in again."), { status: 400 }); }
  if (typeof req.query.state !== "string" || req.query.state !== flow.sub || typeof req.query.code !== "string" || !req.query.code || req.query.code.length > 4096) {
    throw Object.assign(new Error("Invalid Google sign-in response"), { status: 400 });
  }
  const { tokens } = await oauth.getToken({ code: req.query.code, codeVerifier: flow.verifier, redirect_uri: settings.redirectUri });
  const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: settings.clientId });
  return validateIdentity(ticket.getPayload(), flow, settings);
}

module.exports = { config, begin, finish, validateIdentity, clearCookie: (settings) => cookie("", settings, true) };
