// Camera credential storage security.
//
// Camera source records (streamUrl/rtspUrl/hlsUrl/onvifUrl, username, password,
// token, apiKey, secret) must never be persisted in plaintext. This module provides
// application-level authenticated encryption (AES-256-GCM) for those fields before
// they are written to the JSON store or PostgreSQL JSONB columns.
//
// Storage format (versioned for future migrations):
//   enc:v1:<iv_base64url>:<ciphertext_base64url>:<authTag_base64url>
//
// - IV/nonce: 96-bit (12 bytes), fresh crypto.randomBytes per encryption
// - Auth tag: 128-bit (16 bytes) GCM tag, stored with the ciphertext
// - Key: 32 bytes from CAMERA_CREDENTIAL_ENCRYPTION_KEY (64 hex chars or base64)
//
// Security rules enforced here:
// - no hard-coded production key; production requires CAMERA_CREDENTIAL_ENCRYPTION_KEY
// - credential-free demo cameras work without a key in development
// - never log plaintext values, ciphertext content or key material
// - already-encrypted values are never double-encrypted (idempotent migrations)

const crypto = require("node:crypto");

const ENCRYPTION_VERSION = "v1";
const ENCRYPTION_PREFIX = `enc:${ENCRYPTION_VERSION}:`;
const IV_BYTES = 12;
const TAG_BYTES = 16;

// Camera source record fields that may carry secret material (including
// credentials embedded inside RTSP/HLS/ONVIF URLs such as rtsp://user:pass@host/...).
const CAMERA_SECRET_FIELDS = Object.freeze([
  "streamUrl",
  "rtspUrl",
  "hlsUrl",
  "onvifUrl",
  "username",
  "password",
  "token",
  "apiKey",
  "secret"
]);

// Development/demo fallback only. Never usable in production: resolveKey() throws
// when NODE_ENV=production and no real key is configured. This mirrors the existing
// dev-only JWT_SECRET fallback pattern so local demo cameras keep working.
function isProduction(env = process.env) {
  return String(env.NODE_ENV || "").trim().toLowerCase() === "production";
}

function parseKeyMaterial(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  const compact = value.replace(/=+$/, "");
  if (/^[A-Za-z0-9+/]+$/.test(compact)) {
    const decoded = Buffer.from(compact, "base64");
    if (decoded.length === 32 && decoded.toString("base64").replace(/=+$/, "") === compact) {
      return decoded;
    }
  }
  throw new Error(
    "CAMERA_CREDENTIAL_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters or base64. "
    + "Generate one with: node -e \"console.log(require('node:crypto').randomBytes(32).toString('hex'))\""
  );
}

function resolveKey(env = process.env) {
  const configured = parseKeyMaterial(env.CAMERA_CREDENTIAL_ENCRYPTION_KEY);
  if (configured) return configured;
  throw new Error("CAMERA_CREDENTIAL_ENCRYPTION_KEY is required to store or use camera credentials. Set a 32-byte key (64 hex characters or base64).");
}

function parseEncryptedSecret(value) {
  const parts = String(value).split(":");
  if (parts.length !== 5 || parts[0] !== "enc") {
    throw new Error("Malformed encrypted camera credential");
  }
  if (parts[1] !== ENCRYPTION_VERSION) {
    throw new Error("Unsupported camera credential encryption version");
  }
  const iv = Buffer.from(parts[2], "base64url");
  const ciphertext = Buffer.from(parts[3], "base64url");
  const authTag = Buffer.from(parts[4], "base64url");
  if (iv.length !== IV_BYTES || authTag.length !== TAG_BYTES || ciphertext.length === 0) {
    throw new Error("Malformed encrypted camera credential");
  }
  return { iv, ciphertext, authTag };
}

function isEncryptedSecret(value) {
  if (typeof value !== "string" || !value.startsWith(ENCRYPTION_PREFIX)) return false;
  try {
    parseEncryptedSecret(value);
    return true;
  } catch {
    return false;
  }
}

function encryptSecret(plaintext, env = process.env) {
  const value = String(plaintext);
  if (isEncryptedSecret(value)) return value;
  if (value.startsWith("enc:")) {
    throw new Error("Unsupported camera credential encryption version");
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", resolveKey(env), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENCRYPTION_PREFIX}${iv.toString("base64url")}:${ciphertext.toString("base64url")}:${authTag.toString("base64url")}`;
}

// Internal use only. Throws safe static errors; never includes secret/key material.
// Legacy plaintext values are returned as-is so internal callers can recognize them.
function decryptSecret(stored, env = process.env) {
  const value = String(stored || "");
  if (!value) return "";
  if (!value.startsWith("enc:")) return value; // legacy plaintext, internal recognition only
  const { iv, ciphertext, authTag } = parseEncryptedSecret(value);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", resolveKey(env), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Camera credential decryption failed");
  }
}

// Encrypts every plaintext secret field on a camera source record in place.
// Already-encrypted v1 values are left untouched (idempotent, safe to run repeatedly).
// Returns the number of fields encrypted during this call.
function encryptCameraSecrets(source, env = process.env) {
  if (!source || typeof source !== "object") return 0;
  let encryptedCount = 0;
  const replacements = {};
  for (const field of CAMERA_SECRET_FIELDS) {
    const value = source[field];
    if (typeof value !== "string" || value.length === 0) continue;
    if (value.startsWith("enc:")) {
      if (!isEncryptedSecret(value)) {
        throw new Error(`Unsupported camera credential encryption version in field "${field}"`);
      }
      continue;
    }
    replacements[field] = encryptSecret(value, env);
    encryptedCount += 1;
  }
  Object.assign(source, replacements);
  return encryptedCount;
}

function decryptCameraSecrets(source, env = process.env) {
  if (!source || typeof source !== "object") return source;
  const clone = { ...source };
  for (const field of CAMERA_SECRET_FIELDS) {
    if (typeof clone[field] === "string" && clone[field]) {
      clone[field] = decryptSecret(clone[field], env);
    }
  }
  return clone;
}

function hasEncryptedCameraSecrets(source) {
  if (!source || typeof source !== "object") return false;
  return CAMERA_SECRET_FIELDS.some((field) => isEncryptedSecret(source[field]));
}

function hasLegacyPlaintextSecrets(source) {
  if (!source || typeof source !== "object") return false;
  return CAMERA_SECRET_FIELDS.some((field) =>
    typeof source[field] === "string" && source[field].length > 0 && !isEncryptedSecret(source[field])
  );
}

// Production fails fast; development permits credential-free demo use only.
function validateCameraCredentialConfig({ production = isProduction(), env = process.env } = {}) {
  if (production) {
    if (!String(env.CAMERA_CREDENTIAL_ENCRYPTION_KEY || "").trim()) {
      throw new Error("CAMERA_CREDENTIAL_ENCRYPTION_KEY is required in production to store camera credentials.");
    }
    resolveKey(env);
    return { configured: true, developmentFallback: false };
  }
  const raw = String(env.CAMERA_CREDENTIAL_ENCRYPTION_KEY || "").trim();
  if (raw) {
    parseKeyMaterial(raw); // fail fast on malformed keys in every environment
    return { configured: true, developmentFallback: false };
  }
  return { configured: false, developmentFallback: false };
}

module.exports = {
  CAMERA_SECRET_FIELDS,
  ENCRYPTION_PREFIX,
  ENCRYPTION_VERSION,
  encryptSecret,
  decryptSecret,
  encryptCameraSecrets,
  decryptCameraSecrets,
  isEncryptedSecret,
  hasEncryptedCameraSecrets,
  hasLegacyPlaintextSecrets,
  validateCameraCredentialConfig
};
