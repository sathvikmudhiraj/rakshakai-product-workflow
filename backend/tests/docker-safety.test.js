const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const compose = fs.readFileSync(path.join(root, "compose.yaml"), "utf8");
const composeDev = fs.readFileSync(path.join(root, "compose.dev.yaml"), "utf8");
const composeProd = fs.readFileSync(path.join(root, "compose.prod.yaml"), "utf8");
const importSource = fs.readFileSync(path.join(root, "backend", "scripts", "import-json-to-postgres.js"), "utf8");
const backendDockerfile = fs.readFileSync(path.join(root, "backend", "Dockerfile"), "utf8");
const backendServer = fs.readFileSync(path.join(root, "backend", "server.js"), "utf8");
const canonicalCsp = fs.readFileSync(path.join(root, "csp.config.cjs"), "utf8");

function serviceBlock(name, nextName, source = compose) {
  const end = nextName ? `\\n\\n  ${nextName}:` : "\\n\\nvolumes:";
  return source.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)${end}`))?.[1] || "";
}

test("OSRM is profile-gated and backend has no hard OSRM dependency", () => {
  const osrm = serviceBlock("osrm", "backend");
  const backend = serviceBlock("backend", "frontend");
  assert.match(osrm, /profiles:\s*\["osrm"\]/);
  assert.doesNotMatch(backend, /depends_on:[\s\S]*?\n\s+osrm:/);
  assert.match(backend, /OSRM_BASE_URL:\s*\$\{OSRM_BASE_URL:-http:\/\/osrm:5000\}/);
  assert.match(backend, /PUBLIC_OSRM_FALLBACK:\s*\$\{PUBLIC_OSRM_FALLBACK:-false\}/);
});

test("normal services do not require OSRM data and PostgreSQL remains persistent", () => {
  const backend = serviceBlock("backend", "frontend");
  assert.doesNotMatch(backend, /OSRM_DATA_(HOST_)?PATH/);
  assert.match(compose, /postgres-data:\/var\/lib\/postgresql\/data/);
  assert.match(compose, /\nvolumes:\n\s+postgres-data:/);
});

test("Compose base is shared and environment-specific settings live in overrides", () => {
  const baseBackend = serviceBlock("backend", "frontend");
  const devBackend = serviceBlock("backend", "frontend", composeDev);
  const prodBackend = serviceBlock("backend", "frontend", composeProd);
  const devFrontend = serviceBlock("frontend", null, `${composeDev}\n\nvolumes:`);
  const prodFrontend = serviceBlock("frontend", null, `${composeProd}\n\nvolumes:`);

  assert.doesNotMatch(baseBackend, /NODE_ENV:\s*development|CORS_ORIGIN:\s*http:\/\/localhost:3000/);
  assert.match(devBackend, /NODE_ENV:\s*development/);
  assert.match(devBackend, /CORS_ORIGIN:\s*http:\/\/localhost:3000/);
  assert.match(devFrontend, /CSP_ENV:\s*development/);
  assert.match(prodBackend, /NODE_ENV:\s*production/);
  assert.match(prodBackend, /CORS_ORIGIN:\s*\$\{CORS_ORIGIN:\?Set CORS_ORIGIN to the production frontend origin\}/);
  assert.match(prodFrontend, /CSP_ENV:\s*production/);
});

test("Docker PostgreSQL import uses sanitized example data instead of runtime db.json", () => {
  const backend = serviceBlock("backend", "frontend");
  assert.match(backend, /RAKSHAKAI_IMPORT_FILE:\s*\/app\/backend\/data\/db\.example\.json/);
  assert.match(compose, /npm run import:json -- --if-empty/);
  assert.match(backendDockerfile, /COPY backend\/data\/db\.example\.json \.\/data\/db\.example\.json/);
  assert.doesNotMatch(backendDockerfile, /COPY backend\/data \.\/data/);
});

test("AI URL and API key remain wired between backend and AI service", () => {
  const ai = serviceBlock("ai-service", "osrm");
  const backend = serviceBlock("backend", "frontend");
  assert.match(ai, /AI_SERVICE_API_KEY:\s*\$\{AI_SERVICE_API_KEY:\?Set AI_SERVICE_API_KEY in \.env\.docker\}/);
  assert.match(backend, /AI_SERVICE_URL:\s*http:\/\/ai-service:8000/);
  assert.match(backend, /AI_SERVICE_API_KEY:\s*\$\{AI_SERVICE_API_KEY:\?Set AI_SERVICE_API_KEY in \.env\.docker\}/);
});

test("OSRM validates prepared MLD files and never downloads map data", () => {
  const osrm = serviceBlock("osrm", "backend");
  assert.match(osrm, /required prepared regional file is missing or empty/);
  assert.match(osrm, /\.partition/);
  assert.match(osrm, /\.cells/);
  assert.match(osrm, /\.mldgr/);
  assert.doesNotMatch(osrm, /\b(curl|wget|Invoke-WebRequest)\b/);
});

test("JSON import reports additive ID-based counters without logging records or seed secrets", () => {
  assert.match(importSource, /WHERE id = \$1/);
  assert.match(importSource, /inserted=\$\{summary\.inserted\}/);
  assert.match(importSource, /skipped-existing=\$\{summary\.skippedExisting\}/);
  assert.match(importSource, /failed=\$\{summary\.failed\}/);
  assert.doesNotMatch(importSource, /console\.(?:log|error)\([^)]*(?:seededPassword|passwordHash|SEED_[A-Z_]+PASSWORD)/);
  assert.doesNotMatch(importSource, /console\.(?:log|error)\([^)]*JSON\.stringify\((?:record|db)/);
});

test("backend Docker image preserves the repository-relative canonical CSP import", () => {
  const backend = serviceBlock("backend", "frontend");
  assert.match(backend, /build:\s*\n\s+context:\s*\.\s*\n\s+dockerfile:\s*backend\/Dockerfile/);
  assert.match(backendDockerfile, /WORKDIR \/app\/backend/);
  assert.match(backendDockerfile, /COPY csp\.config\.cjs \/app\/csp\.config\.cjs/);
  assert.match(backendDockerfile, /COPY backend\/server\.js \.\//);
  assert.match(backendServer, /require\("\.\.\/csp\.config\.cjs"\)/);
  assert.equal(path.posix.resolve("/app/backend", "../csp.config.cjs"), "/app/csp.config.cjs");
  assert.match(canonicalCsp, /function buildRakshakaiCsp/);
  assert.match(canonicalCsp, /function helmetDirectives/);
  assert.doesNotMatch(backendServer, /["']default-src["']|["']script-src["']|["']frame-ancestors["']/);
  assert.doesNotMatch(backendDockerfile, /^COPY (?:\.|backend) \/?app/m);
});
