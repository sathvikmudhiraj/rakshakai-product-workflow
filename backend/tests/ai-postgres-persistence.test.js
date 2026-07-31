const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-ai-pg-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.RAKSHAKAI_DATA_FILE = path.join(testDirectory, "db.json");
process.env.JWT_SECRET = "rakshakai-test-secret-that-is-longer-than-32-characters";

const {
  findMissingObjectMatches,
  persistAiAnalysisChanges
} = require("../controllers/ai.controller").__testables;

function fakeRepository(name, table, operations) {
  return {
    async upsert(record, client) {
      operations.push(`${name}:${record.id}`);
      table.set(record.id, { ...record });
      await client.query(`UPSERT ${name}`, [record.id]);
    }
  };
}

function postgresHarness() {
  const operations = [];
  const queries = [];
  const tables = {
    alerts: new Map(),
    auditLogs: new Map(),
    incidents: new Map(),
    reports: new Map()
  };
  const repositories = {
    alerts: fakeRepository("alerts", tables.alerts, operations),
    auditLogs: fakeRepository("auditLogs", tables.auditLogs, operations),
    incidents: fakeRepository("incidents", tables.incidents, operations),
    reports: fakeRepository("reports", tables.reports, operations)
  };
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      return { rows: [] };
    }
  };
  let transactionCalls = 0;
  return {
    operations,
    queries,
    repositories,
    tables,
    async withTransaction(callback) {
      transactionCalls += 1;
      return callback(client);
    },
    get transactionCalls() {
      return transactionCalls;
    }
  };
}

function aiDbSnapshot({ alertId = "alt_ai_target", auditId = "aud_ai_target" } = {}) {
  const timestamp = new Date().toISOString();
  const alert = {
    id: alertId,
    title: "Possible browser observation",
    message: "Possible browser observation. Human verification required.",
    source: "browser_camera",
    sourceType: "browser_camera",
    sourceName: "Browser Vision",
    threatType: "object_detected",
    status: "Pending Review",
    reviewStatus: "pending_review",
    verificationStatus: "human_verification_required",
    actionable: false,
    operationalAlert: false,
    createdAt: timestamp
  };
  const audit = {
    id: auditId,
    actorName: "RakshakAI System",
    action: "ai_observation_created",
    details: `${alert.id}: browser_camera`,
    timestamp
  };
  return {
    alert,
    audit,
    db: {
      alerts: [alert],
      auditLogs: [audit],
      incidents: [],
      reports: [],
      detections: [{
        id: "det_ai_target",
        sourceName: "Browser Vision",
        threatType: "object_detected",
        timestamp
      }]
    }
  };
}

test("PostgreSQL AI persistence keeps concurrent records outside the stale AI snapshot", async () => {
  const { alert, db } = aiDbSnapshot();
  const harness = postgresHarness();
  harness.tables.reports.set("report_concurrent", {
    id: "report_concurrent",
    name: "Concurrent citizen report"
  });
  harness.tables.incidents.set("incident_concurrent", {
    id: "incident_concurrent",
    title: "Concurrent incident"
  });

  await persistAiAnalysisChanges(db, {
    alerts: [alert],
    detections: db.detections
  }, {
    databaseMode: "postgres",
    repositories: harness.repositories,
    withTransaction: harness.withTransaction,
    writeDatabase: async () => {
      throw new Error("PostgreSQL AI persistence must not call writeDatabase");
    }
  });

  assert.equal(harness.transactionCalls, 1);
  assert.equal(harness.tables.reports.has("report_concurrent"), true);
  assert.equal(harness.tables.incidents.has("incident_concurrent"), true);
  assert.equal(harness.queries.some((query) => /\bDELETE\b/i.test(query.sql)), false);
});

test("PostgreSQL AI persistence updates only the AI request's intended records", async () => {
  const { alert, audit, db } = aiDbSnapshot();
  const unrelatedAlert = { id: "alt_unrelated", title: "Existing alert" };
  const unrelatedAudit = { id: "aud_unrelated", details: "alt_unrelated: existing" };
  db.alerts.push(unrelatedAlert);
  db.auditLogs.push(unrelatedAudit);
  const harness = postgresHarness();

  await persistAiAnalysisChanges(db, {
    alerts: [alert],
    detections: db.detections
  }, {
    databaseMode: "postgres",
    repositories: harness.repositories,
    withTransaction: harness.withTransaction,
    writeDatabase: async () => {
      throw new Error("PostgreSQL AI persistence must not call writeDatabase");
    }
  });

  assert.deepEqual(harness.operations, [
    `alerts:${alert.id}`,
    `auditLogs:${audit.id}`
  ]);
  assert.equal(harness.tables.alerts.has(unrelatedAlert.id), false);
  assert.equal(harness.tables.auditLogs.has(unrelatedAudit.id), false);
  assert.equal(harness.queries.some((query) => /app_state/i.test(query.sql)), true);
  assert.equal(harness.queries.some((query) => /\bDELETE\b/i.test(query.sql)), false);
});

function report(overrides = {}) {
  return {
    id: overrides.id || "report_object",
    reportType: "missing_object",
    category: "missing_object",
    name: "Blue backpack",
    description: "Lost blue backpack near Mobile Source",
    color: "blue",
    lastSeenLocation: "Mobile Source",
    address: "Mobile Source",
    status: "submitted_for_review",
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function objectResult(object) {
  return {
    configured: true,
    threatType: "object_detected",
    detections: [],
    objectAnalysis: [object]
  };
}

test("missing-object matcher rejects unrelated high-confidence detections", () => {
  const matches = findMissingObjectMatches({
    reports: [report()]
  }, objectResult({
    label: "umbrella",
    dominantColor: "yellow",
    confidence: 0.99
  }), {
    sourceName: "Browser Vision",
    zone: "Mobile Source",
    timestamp: new Date().toISOString()
  });

  assert.deepEqual(matches, []);
});

test("missing-object matcher rejects same broad category with conflicting attributes", () => {
  const matches = findMissingObjectMatches({
    reports: [report({
      id: "report_red_bag",
      name: "Red bag",
      description: "Lost red duffel bag",
      color: "red"
    })]
  }, objectResult({
    label: "bag",
    dominantColor: "blue",
    confidence: 0.99
  }), {
    missingObjectContext: { enabled: true, missingObjectIds: ["report_red_bag"] },
    sourceName: "Browser Vision",
    zone: "Mobile Source",
    timestamp: new Date().toISOString()
  });

  assert.deepEqual(matches, []);
});

test("missing-object matcher requires token or category overlap before returning a candidate", () => {
  const matches = findMissingObjectMatches({
    reports: [report({
      id: "report_black_phone",
      name: "Black phone",
      description: "Lost black mobile phone",
      color: "black"
    })]
  }, objectResult({
    label: "suitcase",
    dominantColor: "black",
    confidence: 0.99
  }), {
    sourceName: "Browser Vision",
    zone: "Mobile Source",
    timestamp: new Date().toISOString()
  });

  assert.deepEqual(matches, []);
});

test("missing-object matcher returns possible observations for genuine multi-signal overlap", () => {
  const matches = findMissingObjectMatches({
    reports: [report()]
  }, objectResult({
    label: "backpack",
    dominantColor: "blue",
    confidence: 0.88
  }), {
    sourceName: "Browser Vision",
    zone: "Mobile Source",
    timestamp: new Date().toISOString()
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].report.id, "report_object");
  assert.equal(matches[0].detection.label, "backpack");
  assert.ok(matches[0].confidence >= 0.58);
  assert.ok(matches[0].confidence < 0.95);
});
