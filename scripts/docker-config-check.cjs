const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env.docker");
const env = {};

function report(label, ok, detail = "") {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

function recommend(label, ok, detail = "") {
  console.log(`[${ok ? "PASS" : "WARN"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

function readEnv(file) {
  const result = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match) result[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return result;
}

function cameraKeyIsValid(value) {
  const key = String(value || "").trim();
  if (/^[0-9a-f]{64}$/i.test(key)) return true;
  const compact = key.replace(/=+$/, "");
  if (!/^[A-Za-z0-9+/]+$/.test(compact)) return false;
  const decoded = Buffer.from(compact, "base64");
  return decoded.length === 32 && decoded.toString("base64").replace(/=+$/, "") === compact;
}

function check(condition, label, detail) {
  report(label, Boolean(condition), condition ? detail : "configuration check failed; secret values suppressed");
  return Boolean(condition);
}

if (!fs.existsSync(envPath)) {
  report(".env.docker exists", false, "required file is missing");
  process.exit(1);
}

Object.assign(env, readEnv(envPath));
let compose;
try {
  const rendered = execFileSync(
    "docker",
    ["compose", "--env-file", envPath, "-f", "compose.yaml", "-f", "compose.dev.yaml", "config", "--format", "json"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
  );
  compose = JSON.parse(rendered);
} catch {
  report("Compose configuration parses", false, "Docker Compose validation failed; command output suppressed");
  process.exit(1);
}

let failed = false;
const services = compose.services || {};
for (const name of ["postgres", "backend", "ai-service", "frontend"]) {
  failed = !check(services[name], `${name} service is defined`) || failed;
}

const pgEnvironment = services.postgres?.environment || {};
const backendEnvironment = services.backend?.environment || {};
const aiEnvironment = services["ai-service"]?.environment || {};
const frontendEnvironment = services.frontend?.environment || {};
const frontendArgs = services.frontend?.build?.args || {};
let databaseUrl;
try { databaseUrl = new URL(backendEnvironment.DATABASE_URL); } catch {}
failed = !check(
  env.POSTGRES_HOST === "postgres" && databaseUrl && databaseUrl.hostname === "postgres" && databaseUrl.port === env.POSTGRES_PORT
    && databaseUrl.username === env.POSTGRES_USER && databaseUrl.pathname === `/${env.POSTGRES_DB}`,
  "Docker backend targets the configured local PostgreSQL service",
  "credentials and URL omitted"
) || failed;
failed = !check(
  pgEnvironment.POSTGRES_DB === env.POSTGRES_DB && pgEnvironment.POSTGRES_USER === env.POSTGRES_USER
    && Boolean(pgEnvironment.POSTGRES_PASSWORD),
  "PostgreSQL initialization settings are present"
) || failed;
failed = !check(
  frontendArgs.VITE_API_BASE_URL === "/api",
  "Frontend build uses the same-origin API route"
) || failed;
failed = !check(
  backendEnvironment.AI_SERVICE_URL === "http://ai-service:8000"
    && Boolean(backendEnvironment.CORS_ORIGIN && backendEnvironment.FRONTEND_ORIGINS),
  "Backend API, AI service hostname, and local CORS settings are configured"
) || failed;

const privateVariable = /(DATABASE_URL|POSTGRES_PASSWORD|JWT_SECRET|AI_SERVICE_API_KEY|CAMERA_CREDENTIAL_ENCRYPTION_KEY|SEED_.*PASSWORD)/i;
const frontendHasPrivate = [...Object.keys(frontendEnvironment), ...Object.keys(frontendArgs)].some((key) => privateVariable.test(key));
failed = !check(!frontendHasPrivate, "Frontend receives no private environment variables") || failed;
failed = !check(
  Boolean(backendEnvironment.JWT_SECRET && backendEnvironment.AI_SERVICE_API_KEY)
    && Boolean(aiEnvironment.AI_SERVICE_API_KEY)
    && backendEnvironment.AI_SERVICE_API_KEY === aiEnvironment.AI_SERVICE_API_KEY,
  "Backend and AI service authentication variables are aligned"
) || failed;

const publishedPorts = Object.fromEntries(Object.entries(services).flatMap(([name, service]) =>
  (service.ports || []).map((port) => [name, String(port.published)])
));
for (const [service, key] of Object.entries({
  postgres: "POSTGRES_HOST_PORT",
  backend: "BACKEND_HOST_PORT",
  "ai-service": "AI_SERVICE_HOST_PORT",
  frontend: "FRONTEND_PORT"
})) {
  failed = !check(publishedPorts[service] === env[key], `${service} host port matches ${key}`) || failed;
}

const jwtValid = String(env.JWT_SECRET || "").length >= 32;
report("Docker JWT secret meets the 32-character minimum", jwtValid, jwtValid ? "value suppressed" : "operator review required; value suppressed");
if (!jwtValid) failed = true;

const aiKeyValid = String(env.AI_SERVICE_API_KEY || "").length >= 32;
recommend("Docker AI API key meets the 32-character recommendation", aiKeyValid, aiKeyValid ? "value suppressed" : "operator-controlled rotation recommended; value suppressed");

const cameraValid = cameraKeyIsValid(env.CAMERA_CREDENTIAL_ENCRYPTION_KEY);
report("Camera encryption key has a supported 32-byte format", cameraValid, cameraValid ? "value suppressed" : "operator review required; do not regenerate without checking encrypted data");
if (!cameraValid) failed = true;

const seedNames = ["SEED_ADMIN_PASSWORD", "SEED_POLICE_PASSWORD", "SEED_CITIZEN_PASSWORD"];
const seedValues = seedNames.map((name) => env[name] || "");
const seedPasswordsValid = seedValues.every((value) => value.length >= 16) && new Set(seedValues).size === seedValues.length;
recommend("Seed passwords are distinct and meet the 16-character recommendation", seedPasswordsValid, seedPasswordsValid ? "values suppressed" : "operator action required; existing user passwords are not changed by seed settings");

if (failed) process.exitCode = 1;
