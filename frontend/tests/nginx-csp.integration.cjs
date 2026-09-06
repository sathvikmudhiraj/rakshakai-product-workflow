// Run explicitly: node --test frontend/tests/nginx-csp.integration.cjs
// Requires Docker. Uses only an isolated frontend image/container, with no data mounts.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");
const { buildRakshakaiCsp } = require("../../csp.config.cjs");

const root = path.resolve(__dirname, "../..");
const runId = `rakshakai-csp-test-${crypto.randomBytes(6).toString("hex")}`;
const image = `${runId}:test`;
const containers = [];
const servers = new Map();
let built = false;

function docker(args, { allowFailure = false } = {}) {
  const result = spawnSync("docker", args, { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, timeout: 300000 });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`Docker ${args[0]} failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return result;
}

async function startFrontend(environment, extraEnv = []) {
  const name = `${runId}-${environment}`;
  docker(["run", "--detach", "--name", name, "--label", `rakshakai.csp-test=${runId}`,
    "--add-host", "backend:127.0.0.1", "--publish", "127.0.0.1::80",
    "--env", `CSP_ENV=${environment}`, ...extraEnv.flatMap((value) => ["--env", value]), image]);
  containers.push(name);
  const address = docker(["port", name, "80/tcp"]).stdout.trim();
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  const base = `http://${address}`;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(ready, true, `${environment} Nginx must become ready`);
  docker(["exec", name, "nginx", "-t"]);
  const effectiveConfig = docker(["exec", name, "nginx", "-T"]);
  assert.doesNotMatch(effectiveConfig.stdout, /\$\{RAKSHAKAI_CSP\}/);
  servers.set(environment, { name, base });
}

test.before(async () => {
  docker(["version", "--format", "{{.Server.Version}}"]);
  docker(["build", "--file", "frontend/Dockerfile", "--tag", image, "."]);
  built = true;
  await startFrontend("production");
  await startFrontend("development");
  await startFrontend("configured", ["CSP_ENV=production", "CSP_CONNECT_SRC=https://api.example.invalid"]);
});

test.after(() => {
  for (const name of containers.reverse()) {
    const label = docker(["inspect", "--format", '{{index .Config.Labels "rakshakai.csp-test"}}', name]).stdout.trim();
    assert.equal(label, runId, "Never remove a container outside this test run");
    docker(["rm", "--force", name]);
  }
  if (built) docker(["image", "rm", image]);
});

function expectedPolicy(environment, connectSrc = "") {
  return buildRakshakaiCsp({ environment, connectSrc, imgSrc: "" }).header;
}

function assertCsp(response, policy) {
  assert.ok(response.headers.get("content-security-policy"));
  assert.equal(response.headers.get("content-security-policy"), policy);
  for (const directive of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'"]) {
    assert.ok(policy.split("; ").includes(directive), directive);
  }
  assert.doesNotMatch(policy, /\*|unsafe-eval/);
}

test("production /, index.html and SPA routes serve HTML with CSP and unchanged no-cache policy", async () => {
  const { base } = servers.get("production");
  const policy = expectedPolicy("production");
  let original;
  for (const route of ["/", "/index.html", "/rakshak/live-vision", "/gis/route/details"]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    assertCsp(response, policy);
    assert.match(response.headers.get("content-type"), /^text\/html/);
    assert.equal(response.headers.get("cache-control"), "no-cache, must-revalidate");
    const body = await response.text();
    if (original === undefined) original = body;
    else assert.equal(body, original, "SPA fallback returns the same entry HTML");
  }
  assert.ok(policy.includes("upgrade-insecure-requests"));
  assert.doesNotMatch(policy, /unsafe-inline|localhost|127\.0\.0\.1/);
});

test("HEAD and conditional 304 HTML responses retain the production CSP", async () => {
  const { base } = servers.get("production");
  const head = await fetch(`${base}/index.html`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assertCsp(head, expectedPolicy("production"));
  assert.equal(await head.text(), "");
  const cached = await fetch(`${base}/index.html`, { headers: { "If-None-Match": head.headers.get("etag") } });
  assert.equal(cached.status, 304);
  assertCsp(cached, expectedPolicy("production"));
  assert.equal(cached.headers.get("cache-control"), "no-cache, must-revalidate");
});

test("built JavaScript and CSS retain immutable caching and valid MIME types", async () => {
  const { base } = servers.get("production");
  const html = await (await fetch(base)).text();
  const assets = [...html.matchAll(/(?:src|href)="([^\"]+\.(?:js|css))"/g)].map((match) => match[1]);
  assert.ok(assets.some((asset) => asset.endsWith(".css")));
  assert.ok(assets.some((asset) => asset.endsWith(".js")));
  for (const asset of assets) {
    const response = await fetch(new URL(asset, base));
    assert.equal(response.status, 200);
    assertCsp(response, expectedPolicy("production"));
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.match(response.headers.get("content-type"), asset.endsWith(".css") ? /^text\/css/ : /javascript/);
  }
  const icon = await fetch(`${base}/favicon.svg`);
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get("cache-control"), "public, max-age=604800");
});

test("Nginx HTML error responses retain CSP without changing asset cache directives", async () => {
  const { base } = servers.get("production");
  for (const [route, cache] of [["/assets/missing-12345678.js", "public, max-age=31536000, immutable"], ["/missing.svg", "public, max-age=604800"]]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 404);
    assert.match(response.headers.get("content-type"), /^text\/html/);
    assertCsp(response, expectedPolicy("production"));
    assert.equal(response.headers.get("cache-control"), cache);
  }
  const invalidMethod = await fetch(`${base}/index.html`, { method: "POST" });
  assert.equal(invalidMethod.status, 405);
  assertCsp(invalidMethod, expectedPolicy("production"));
});

test("missing entry HTML returns 404 with CSP and no-cache", async () => {
  const { name, base } = servers.get("configured");
  // Only the disposable container is changed, never a repository or runtime volume.
  docker(["exec", name, "mv", "/usr/share/nginx/html/index.html", "/tmp/csp-test-index.html"]);
  try {
    const response = await fetch(`${base}/index.html`);
    assert.equal(response.status, 404);
    assertCsp(response, expectedPolicy("production", "https://api.example.invalid"));
    assert.equal(response.headers.get("cache-control"), "no-cache, must-revalidate");
  } finally {
    docker(["exec", name, "mv", "/tmp/csp-test-index.html", "/usr/share/nginx/html/index.html"]);
  }
});

test("configured HTTPS API origin is preserved in served production CSP", async () => {
  const response = await fetch(servers.get("configured").base);
  assert.equal(response.status, 200);
  assertCsp(response, expectedPolicy("production", "https://api.example.invalid"));
});

test("Docker development keeps its development policy and HTML caching", async () => {
  const { base } = servers.get("development");
  for (const route of ["/", "/index.html", "/rakshak/live-vision"]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    assertCsp(response, expectedPolicy("development"));
    assert.equal(response.headers.get("cache-control"), "no-cache, must-revalidate");
    assert.match(response.headers.get("content-security-policy"), /ws:\/\/localhost:3000/);
    assert.doesNotMatch(response.headers.get("content-security-policy"), /upgrade-insecure-requests/);
  }
});
