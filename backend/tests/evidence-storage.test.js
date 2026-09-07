const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-evidence-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.RAKSHAKAI_DATA_FILE = path.join(testDirectory, "db.json");
process.env.EVIDENCE_STORAGE_DRIVER = "filesystem";
process.env.EVIDENCE_STORAGE_DIR = path.join(testDirectory, "objects");
process.env.JWT_SECRET = "rakshakai-test-secret-that-is-longer-than-32-characters";

const {
  __testables: {
    createVideoEvidenceRecord,
    parseEvidenceDataUrl,
    persistEvidenceWithCleanup
  }
} = require("../services/core.service");
const {
  cleanupEvidenceObject,
  writeEvidenceObject,
  checkEvidenceStorage,
  readEvidenceObject,
  validateEvidenceStorageConfig,
  validateStorageKey,
  __testables: { resolveLocalEvidencePath }
} = require("../services/evidenceStorage.service");
const { withTransaction } = require("../services/postgres.service");

test.after(() => fs.rmSync(testDirectory, { recursive: true, force: true }));

function dataUrl(mimeType, buffer) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function mp4Bytes(extra = "") {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftypisom0000", "ascii"),
    Buffer.from(extra)
  ]);
}

function pngBytes(extra = "") {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(extra)
  ]);
}

function dbFixture() {
  return {
    reports: [{ id: "report_own", createdBy: "u_citizen", status: "submitted_for_review" }],
    incidents: [],
    alerts: [],
    auditLogs: [],
    videoEvidence: []
  };
}

const user = {
  id: "u_admin",
  name: "Admin",
  role: "Admin"
};

test("evidence parser rejects declared MIME and magic-byte mismatches", () => {
  assert.throws(
    () => parseEvidenceDataUrl(dataUrl("video/mp4", pngBytes()), { allowImages: true }),
    /does not match/
  );
});

test("new evidence metadata excludes inline binary and stores bytes by safe key", async () => {
  const db = dbFixture();
  const bytes = mp4Bytes("upload");
  const evidence = await createVideoEvidenceRecord(db, {
    fileName: "../unsafe/path/video.mp4",
    dataUrl: dataUrl("video/mp4", bytes),
    linkedReportId: "report_own"
  }, user, {
    linkedReport: db.reports[0]
  });

  assert.equal("fileData" in evidence, false);
  assert.equal(evidence.mimeType, "video/mp4");
  assert.equal(evidence.fileSize, bytes.length);
  assert.equal(evidence.checksum, crypto.createHash("sha256").update(bytes).digest("hex"));
  assert.match(evidence.storageKey, /^[0-9-]+\/evd_[a-f0-9]+-[a-f0-9]+\.mp4$/);
  assert.doesNotMatch(evidence.storageKey, /\.\.|\\/);
  assert.equal(evidence.fileName.includes(".."), false);

  const stored = await readEvidenceObject(evidence);
  assert.deepEqual(stored, bytes);
});

test("storage key validation prevents traversal and absolute paths", () => {
  assert.throws(() => validateStorageKey("../escape.mp4"), /invalid|escaped/i);
  assert.throws(() => validateStorageKey("2026/../../escape.mp4"), /invalid|escaped/i);
  assert.throws(() => resolveLocalEvidencePath("C:/escape.mp4"), /invalid|escaped/i);
});

test("checksum verification rejects tampered stored evidence", async () => {
  const db = dbFixture();
  const evidence = await createVideoEvidenceRecord(db, {
    fileName: "tamper.mp4",
    dataUrl: dataUrl("video/mp4", mp4Bytes("before"))
  }, user);
  const storagePath = resolveLocalEvidencePath(evidence.storageKey);
  await fs.promises.writeFile(storagePath, mp4Bytes("after"));

  await assert.rejects(() => readEvidenceObject(evidence), /checksum/i);
});

test("database failure after storage write cleans up the evidence object", async () => {
  const db = dbFixture();
  const evidence = await createVideoEvidenceRecord(db, {
    fileName: "orphan.mp4",
    dataUrl: dataUrl("video/mp4", mp4Bytes("orphan"))
  }, user);
  const storagePath = resolveLocalEvidencePath(evidence.storageKey);
  assert.equal(fs.existsSync(storagePath), true);

  await assert.rejects(
    () => persistEvidenceWithCleanup(db, evidence, () => {
      db.videoEvidence.unshift(evidence);
    }, async () => {
      throw new Error("metadata persistence failed");
    }),
    /metadata persistence failed/
  );

  assert.equal(db.videoEvidence.some((item) => item.id === evidence.id), false);
  assert.equal(fs.existsSync(storagePath), false);
});

test("production filesystem storage requires an explicit durable path", () => {
  const previous = process.env.EVIDENCE_STORAGE_DIR;
  delete process.env.EVIDENCE_STORAGE_DIR;
  try {
    assert.throws(() => validateEvidenceStorageConfig({ production: true }), /EVIDENCE_STORAGE_DIR/);
  } finally {
    process.env.EVIDENCE_STORAGE_DIR = previous;
  }
});

test("late outer COMMIT failure removes stored evidence after metadata saving returned", async () => {
  let evidence;
  const pool = { connect: async () => ({
    async query(sql) {
      if (sql === "COMMIT") throw Object.assign(new Error("deferred constraint"), { code: "23503" });
      return { rows: [] };
    },
    release() {}
  }) };
  await assert.rejects(withTransaction(async () => {
    evidence = await createVideoEvidenceRecord(dbFixture(), { dataUrl: dataUrl("video/mp4", mp4Bytes()) }, user);
    await persistEvidenceWithCleanup(dbFixture(), evidence, () => {}, async () => {});
    assert.equal(fs.existsSync(resolveLocalEvidencePath(evidence.storageKey)), true);
  }, pool), /deferred constraint/);
  assert.equal(fs.existsSync(resolveLocalEvidencePath(evidence.storageKey)), false);
});

test("unknown commit outcomes preserve bytes and record a durable reconciliation notice", async (t) => {
  t.mock.method(console, "error", () => {});
  const evidence = await createVideoEvidenceRecord(dbFixture(), { dataUrl: dataUrl("video/mp4", mp4Bytes()) }, user);
  await cleanupEvidenceObject(evidence, { outcome: "unknown" });
  assert.equal(fs.existsSync(resolveLocalEvidencePath(evidence.storageKey)), true);
  const journal = fs.readFileSync(path.join(process.env.EVIDENCE_STORAGE_DIR, ".reconciliation.jsonl"), "utf8");
  assert.equal(journal.includes(evidence.storageKey), true);
  assert.equal(journal.includes("commit_outcome_unknown"), true);
});

test("failed object cleanup is recorded without exposing the underlying filesystem error", async (t) => {
  const messages = [];
  t.mock.method(console, "error", (value) => messages.push(value));
  const evidence = await createVideoEvidenceRecord(dbFixture(), { dataUrl: dataUrl("video/mp4", mp4Bytes()) }, user);
  t.mock.method(fs.promises, "unlink", async () => { throw new Error("sensitive filesystem detail"); });
  await cleanupEvidenceObject(evidence);
  assert.match(messages.join(""), /object_cleanup_failed/);
  assert.doesNotMatch(messages.join(""), /sensitive filesystem detail/);
});

test("storage health performs a real write and removes its probe", async () => {
  await checkEvidenceStorage();
  assert.equal(fs.readdirSync(process.env.EVIDENCE_STORAGE_DIR).some((name) => name.startsWith(".health-")), false);
  const previous = process.env.EVIDENCE_STORAGE_DIR;
  process.env.EVIDENCE_STORAGE_DIR = path.join(testDirectory, "not-a-directory");
  fs.writeFileSync(process.env.EVIDENCE_STORAGE_DIR, "test");
  try { await assert.rejects(checkEvidenceStorage()); }
  finally { process.env.EVIDENCE_STORAGE_DIR = previous; }
});

for (const operation of ["writeFile", "sync", "close"]) {
  test(`${operation} failure cleans up partial evidence and preserves the original error`, async (t) => {
    const open = fs.promises.open.bind(fs.promises);
    const failure = new Error("injected storage failure");
    let objectPath;
    t.mock.method(fs.promises, "open", async (file, ...args) => {
      const handle = await open(file, ...args);
      if (!String(file).endsWith(".mp4")) return handle;
      objectPath = file;
      const original = handle[operation].bind(handle);
      let failed = false;
      handle[operation] = async (...values) => {
        if (failed) return original(...values);
        failed = true;
        if (operation === "writeFile") await original(Buffer.from("partial"));
        if (operation === "close") await original();
        throw failure;
      };
      return handle;
    });
    await assert.rejects(writeEvidenceObject({ buffer: mp4Bytes(), mimeType: "video/mp4" }), (error) => error === failure);
    assert.ok(objectPath);
    assert.equal(fs.existsSync(objectPath), false);
  });
}

test("cleanup failure writes and flushes a recovery record for the retained object", async (t) => {
  t.mock.method(console, "error", () => {});
  const evidence = await writeEvidenceObject({ buffer: mp4Bytes(), mimeType: "video/mp4" });
  const open = fs.promises.open.bind(fs.promises);
  let flushed = false;
  t.mock.method(fs.promises, "open", async (file, ...args) => {
    const handle = await open(file, ...args);
    if (String(file).endsWith(".reconciliation.jsonl")) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => { await sync(); flushed = true; };
    }
    return handle;
  });
  t.mock.method(fs.promises, "unlink", async () => { throw new Error("injected unlink failure"); });
  await cleanupEvidenceObject(evidence);
  assert.equal(flushed, true);
  assert.equal(fs.existsSync(resolveLocalEvidencePath(evidence.storageKey)), true);
  const records = fs.readFileSync(path.join(process.env.EVIDENCE_STORAGE_DIR, ".reconciliation.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(records.some((record) => record.storageKey === evidence.storageKey && record.reason === "object_cleanup_failed"));
});

test("journal failure emits a safe recovery alert without masking the database failure", async (t) => {
  const messages = [];
  t.mock.method(console, "error", (message) => messages.push(JSON.parse(message)));
  const db = dbFixture();
  const evidence = await createVideoEvidenceRecord(db, { dataUrl: dataUrl("video/mp4", mp4Bytes()) }, user);
  const failure = new Error("metadata failed");
  t.mock.method(fs.promises, "unlink", async () => { throw new Error("private path"); });
  t.mock.method(fs.promises, "open", async () => { throw new Error("private path"); });
  await assert.rejects(persistEvidenceWithCleanup(db, evidence, () => {}, async () => { throw failure; }), (error) => error === failure);
  assert.ok(messages.some((event) => event.event === "evidence_reconciliation_journal_failed"));
  assert.ok(messages.some((event) => event.storageKey === evidence.storageKey));
  assert.doesNotMatch(JSON.stringify(messages), /private path/);
});
