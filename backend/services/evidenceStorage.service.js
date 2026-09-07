const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { onTransactionFailure } = require("./postgres.service");

const root = path.join(__dirname, "..");
const DEFAULT_STORAGE_DIR = path.join(root, "storage", "evidence");
const LOCAL_DRIVERS = new Set(["filesystem", "local"]);
const SUPPORTED_STORAGE_DRIVERS = new Set([...LOCAL_DRIVERS]);

function evidenceStorageDriver() {
  return String(process.env.EVIDENCE_STORAGE_DRIVER || "filesystem").trim().toLowerCase();
}

function evidenceStorageDir() {
  return path.resolve(process.env.EVIDENCE_STORAGE_DIR || DEFAULT_STORAGE_DIR);
}

function validateStorageKey(key) {
  const value = String(key || "");
  if (!/^[a-z0-9][a-z0-9/_\-.]{0,220}$/i.test(value)) {
    throw Object.assign(new Error("Evidence storage reference is invalid"), { status: 500 });
  }
  if (value.includes("..") || path.isAbsolute(value)) {
    throw Object.assign(new Error("Evidence storage reference is invalid"), { status: 500 });
  }
  return value;
}

function resolveLocalEvidencePath(key) {
  const safeKey = validateStorageKey(key);
  const baseDir = evidenceStorageDir();
  const resolved = path.resolve(baseDir, safeKey);
  const relative = path.relative(baseDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw Object.assign(new Error("Evidence storage reference escaped storage root"), { status: 500 });
  }
  return resolved;
}

function extensionForMimeType(mimeType) {
  return ({
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "video/x-msvideo": ".avi",
    "video/mpeg": ".mpeg"
  })[mimeType] || ".bin";
}

function generateEvidenceStorageKey({ evidenceId, mimeType, uploadedAt = new Date().toISOString() } = {}) {
  const date = String(uploadedAt).slice(0, 10).replace(/[^0-9-]/g, "") || "undated";
  const random = crypto.randomBytes(16).toString("hex");
  const id = String(evidenceId || "evidence").replace(/[^a-z0-9_-]/gi, "_").slice(0, 64);
  return `${date}/${id}-${random}${extensionForMimeType(mimeType)}`;
}

async function writeEvidenceObject({ buffer, evidenceId, mimeType, checksum, uploadedAt }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw Object.assign(new Error("Evidence object is empty"), { status: 400 });
  }
  const driver = evidenceStorageDriver();
  if (!SUPPORTED_STORAGE_DRIVERS.has(driver)) {
    throw Object.assign(new Error(`Evidence storage driver is not supported: ${driver}`), { status: 500 });
  }
  const storageKey = generateEvidenceStorageKey({ evidenceId, mimeType, uploadedAt });
  const storagePath = resolveLocalEvidencePath(storageKey);
  await fs.promises.mkdir(path.dirname(storagePath), { recursive: true, mode: 0o700 });
  const handle = await fs.promises.open(storagePath, "wx", 0o600);
  try {
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.close();
  } catch (error) {
    // Closing a failed handle must not prevent cleanup or replace the original error.
    try { await handle.close(); } catch {}
    await cleanupEvidenceObject({ storageKey });
    throw error;
  }
  const reference = {
    storageDriver: "filesystem",
    storageProvider: "local-filesystem",
    storageKey,
    storageChecksum: checksum,
    storedAt: new Date().toISOString()
  };
  onTransactionFailure(({ outcome }) => cleanupEvidenceObject(reference, { outcome }));
  return reference;
}

async function readEvidenceObject(evidence) {
  if (!evidence?.storageKey) return null;
  const driver = String(evidence.storageDriver || "filesystem").toLowerCase();
  if (!LOCAL_DRIVERS.has(driver)) {
    throw Object.assign(new Error("Evidence storage driver is not available"), { status: 500 });
  }
  const storagePath = resolveLocalEvidencePath(evidence.storageKey);
  const buffer = await fs.promises.readFile(storagePath);
  if (evidence.checksum) {
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    if (checksum !== evidence.checksum) {
      throw Object.assign(new Error("Evidence checksum verification failed"), { status: 409 });
    }
  }
  return buffer;
}

async function deleteEvidenceObject(evidence) {
  if (!evidence?.storageKey) return false;
  try {
    await fs.promises.unlink(resolveLocalEvidencePath(evidence.storageKey));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function recordRecovery(evidence, reason) {
  const event = { event: "evidence_reconciliation_required", reason, storageKey: validateStorageKey(evidence.storageKey), timestamp: new Date().toISOString() };
  console.error(JSON.stringify(event));
  try {
    const handle = await fs.promises.open(path.join(evidenceStorageDir(), ".reconciliation.jsonl"), "a", 0o600);
    try {
      await handle.writeFile(JSON.stringify(event) + "\n");
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    console.error(JSON.stringify({ event: "evidence_reconciliation_journal_failed", reason }));
  }
}

async function cleanupEvidenceObject(evidence, { outcome = "rolled_back" } = {}) {
  if (!evidence?.storageKey) return;
  if (outcome === "unknown") return recordRecovery(evidence, "commit_outcome_unknown");
  try {
    await deleteEvidenceObject(evidence);
  } catch {
    await recordRecovery(evidence, "object_cleanup_failed");
  }
}

async function checkEvidenceStorage() {
  const { storageDir } = validateEvidenceStorageConfig();
  await fs.promises.mkdir(storageDir, { recursive: true, mode: 0o700 });
  const probe = path.join(storageDir, `.health-${crypto.randomUUID()}`);
  const handle = await fs.promises.open(probe, "wx", 0o600);
  try {
    await handle.writeFile("storage-check");
    await handle.sync();
  } finally {
    await handle.close();
    await fs.promises.unlink(probe);
  }
}

function validateEvidenceStorageConfig({ production = process.env.NODE_ENV === "production" } = {}) {
  const driver = evidenceStorageDriver();
  if (!driver || driver.includes("*") || driver.includes("..") || driver.includes("/") || driver.includes("\\")) {
    throw new Error("EVIDENCE_STORAGE_DRIVER must be a safe storage driver name");
  }
  if (!SUPPORTED_STORAGE_DRIVERS.has(driver)) {
    throw new Error(`Unsupported EVIDENCE_STORAGE_DRIVER: ${driver}`);
  }
  const dir = evidenceStorageDir();
  if (production && !process.env.EVIDENCE_STORAGE_DIR) {
    throw new Error("EVIDENCE_STORAGE_DIR is required in production for filesystem evidence storage");
  }
  return { driver: "filesystem", storageDir: dir };
}

module.exports = {
  checkEvidenceStorage,
  cleanupEvidenceObject,
  deleteEvidenceObject,
  evidenceStorageDir,
  evidenceStorageDriver,
  generateEvidenceStorageKey,
  readEvidenceObject,
  validateEvidenceStorageConfig,
  validateStorageKey,
  writeEvidenceObject,
  __testables: {
    DEFAULT_STORAGE_DIR,
    extensionForMimeType,
    resolveLocalEvidencePath
  }
};
