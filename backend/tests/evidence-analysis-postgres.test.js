require("../services/testDatabaseSafety").prepareIntegrationTestEnvironment();

const test = require("node:test");
const assert = require("node:assert/strict");
const { query, closePool } = require("../services/postgres.service");
const { __testables: { persistEvidenceAnalysis } } = require("../services/core.service");

const enabled = Boolean(process.env.DATABASE_URL && process.env.RAKSHAKAI_TEST_SCHEMA);
test.after(async () => { await closePool(); });

test("evidence writes are atomic, preserve unrelated data, and never create a camera", { skip: !enabled }, async () => {
  const evidence = { id: "evd_atomic_test", linkedReportId: null, linkedIncidentId: null };
  await query("INSERT INTO app_state(key,data) VALUES ('operational',$1::jsonb) ON CONFLICT (key) DO UPDATE SET data = app_state.data || EXCLUDED.data", [JSON.stringify({ videoEvidence: [evidence], atomicMarker: "preserved" })]);
  const db = { auditLogs: [], aiObservations: [] };
  const cameraCount = (await query("SELECT count(*)::int n FROM camera_sources")).rows[0].n;
  const timestamp = new Date().toISOString();
  const analysis = (id) => ({ id, evidenceId: evidence.id, runType: "reanalysis", reason: "atomic rollback test", inputSha256: "a".repeat(64), analyzedAt: timestamp, inferenceTimestamp: timestamp, model: "test-model", modelVersion: null, threshold: 0.5, detections: [{ class: "truck", confidence: 0.8, bbox: { x1: 1, y1: 1, x2: 10, y2: 10 } }] });
  const user = { name: "Test reviewer", role: "Admin" };
  await query("CREATE FUNCTION evidence_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected test failure'; END $$");
  for (const [table, id] of [["evidence_image_analyses", "analysis_fail_insert"], ["ai_observations", "analysis_fail_observation"], ["audit_logs", "analysis_fail_audit"]]) {
    await query(`CREATE TRIGGER evidence_test_failure BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION evidence_test_fail()`);
    try {
      await assert.rejects(persistEvidenceAnalysis(db, evidence, analysis(id), user));
      assert.equal((await query("SELECT count(*)::int n FROM evidence_image_analyses WHERE id=$1", [id])).rows[0].n, 0);
      assert.equal((await query("SELECT count(*)::int n FROM ai_observations WHERE analysis_id=$1", [id])).rows[0].n, 0);
      assert.equal((await query("SELECT count(*)::int n FROM audit_logs WHERE data->>'details' LIKE $1", [`%${id}%`])).rows[0].n, 0);
    } finally { await query(`DROP TRIGGER evidence_test_failure ON ${table}`); }
  }
  const result = await persistEvidenceAnalysis(db, evidence, analysis("analysis_atomic_success"), user);
  const row = (await query("SELECT source_type,source_id,camera_id,evidence_id,status FROM ai_observations WHERE id=$1", [result.observation.id])).rows[0];
  assert.deepEqual(row, { source_type: "evidence_image", source_id: evidence.id, camera_id: null, evidence_id: evidence.id, status: "PENDING_REVIEW" });
  assert.equal((await query("SELECT count(*)::int n FROM camera_sources")).rows[0].n, cameraCount);
  assert.equal((await query("SELECT data->>'atomicMarker' marker FROM app_state WHERE key='operational'")).rows[0].marker, "preserved");
  const duplicate = await persistEvidenceAnalysis(db, evidence, analysis("analysis_atomic_duplicate"), user);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.observation.id, result.observation.id);
  assert.equal((await query("SELECT count(*)::int n FROM ai_observations WHERE source_type='evidence_image'")).rows[0].n, 1);
  const zero = { ...analysis("analysis_atomic_zero"), detections: [] };
  const noDetection = await persistEvidenceAnalysis(db, evidence, zero, user);
  assert.equal(noDetection.observation, null);
  assert.equal((await query("SELECT count(*)::int n FROM evidence_image_analyses WHERE id=$1", [zero.id])).rows[0].n, 1);
  assert.equal((await query("SELECT count(*)::int n FROM ai_observations WHERE analysis_id=$1", [zero.id])).rows[0].n, 0);
  assert.equal((await query("SELECT count(*)::int n FROM audit_logs WHERE data->>'details'=$1", [zero.id])).rows[0].n, 1);
});
