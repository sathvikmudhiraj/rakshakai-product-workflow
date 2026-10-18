const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const google = require("../services/googleWorkspace.service");

const env = { NODE_ENV: "production", GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "test-only-secret",
  GOOGLE_REDIRECT_URI: "https://ops.example.test/api/auth/google/callback", GOOGLE_APP_ORIGIN: "https://ops.example.test", GOOGLE_WORKSPACE_DOMAINS: "example.test", JWT_SECRET: "test-only-signing-key-at-least-32-characters" };

test("Google SSO is optional but fails closed on incomplete, unsafe or wildcard configuration", () => {
  assert.equal(google.config({}), null);
  for (const values of [{ GOOGLE_REQUIRE_WORKSPACE_SSO: "true" }, { ...env, GOOGLE_CLIENT_SECRET: "" }, { ...env, GOOGLE_WORKSPACE_DOMAINS: "*" },
    { ...env, GOOGLE_REDIRECT_URI: "http://ops.example.test/api/auth/google/callback" }, { ...env, GOOGLE_APP_ORIGIN: "https://attacker.example.test" }]) {
    assert.throws(() => google.config(values));
  }
  assert.equal(google.config(env).appOrigin, "https://ops.example.test");
});

test("Google authorization uses PKCE, nonce and a short-lived protected flow cookie", async () => {
  const settings = google.config(env);
  const result = await google.begin(settings);
  const url = new URL(result.url);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("hd"), "example.test");
  assert.equal(url.searchParams.get("access_type"), "online");
  assert.ok(url.searchParams.get("nonce"));
  assert.match(result.cookie, /HttpOnly; SameSite=Lax; Max-Age=300; Secure/);
  const encoded = result.cookie.split(";")[0].split("=")[1];
  const flow = jwt.verify(encoded, settings.flowKey, { audience: "google-oauth-flow", algorithms: ["HS256"] });
  assert.equal(flow.sub, url.searchParams.get("state"));
  assert.equal(flow.nonce, url.searchParams.get("nonce"));
  assert.ok(flow.verifier);
});

test("Google callback binds state, PKCE and verified token audience before accepting Workspace identity", async () => {
  const settings = google.config(env);
  const result = await google.begin(settings);
  const url = new URL(result.url);
  const req = { headers: { cookie: result.cookie.split(";")[0] }, query: { state: url.searchParams.get("state"), code: "test-authorization-code" } };
  let exchanges = 0;
  const oauth = {
    async getToken(input) { exchanges++; assert.ok(input.codeVerifier); assert.equal(input.redirect_uri, env.GOOGLE_REDIRECT_URI); return { tokens: { id_token: "provider-id-token" } }; },
    async verifyIdToken(input) { assert.equal(input.audience, env.GOOGLE_CLIENT_ID); assert.equal(input.idToken, "provider-id-token");
      return { getPayload: () => ({ sub: "subject-1", email: "operator@example.test", email_verified: true, hd: "example.test", nonce: url.searchParams.get("nonce") }) }; }
  };
  assert.deepEqual(await google.finish(settings, req, oauth), { sub: "subject-1", email: "operator@example.test" });
  await assert.rejects(google.finish(settings, { ...req, query: { ...req.query, state: "wrong" } }, oauth), { status: 400 });
  await assert.rejects(google.finish(settings, { ...req, headers: { cookie: "rakshakai_google_flow=tampered" } }, oauth), { status: 400 });
  assert.equal(exchanges, 1);
});

test("Workspace access checks signed hosted-domain and nonce claims rather than an email suffix", () => {
  const settings = google.config(env);
  const identity = { sub: "subject-1", email: "operator@example.test", email_verified: true, hd: "example.test", nonce: "expected" };
  for (const change of [{ hd: undefined }, { hd: "attacker.test" }, { nonce: "wrong" }, { email_verified: "true" }, { email_verified: false }, { sub: "" }]) {
    assert.throws(() => google.validateIdentity({ ...identity, ...change }, { nonce: "expected" }, settings), { status: 403 });
  }
});
