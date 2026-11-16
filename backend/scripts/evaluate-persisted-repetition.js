/* Local synthetic gateway/persistence diagnostic: mock detections, isolated JSON and storage. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-repeat-persist-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.RAKSHAKAI_DATA_FILE = path.join(directory, "db.json");
process.env.EVIDENCE_STORAGE_DRIVER = "filesystem";
process.env.EVIDENCE_STORAGE_DIR = path.join(directory, "evidence");
fs.copyFileSync(path.join(__dirname, "../tests/fixtures/db.fixture.json"), process.env.RAKSHAKAI_DATA_FILE);
const { MediaGateway } = require("../services/mediaGateway.service");
const { persistGatewayObservation } = require("../services/aiObservation.service");
const { readDatabase } = require("../services/core.service");
async function run() {
  let now = Date.now(), requests = 0, responses = 0;
  const gateway = new MediaGateway({ clock: () => now, connectorFactory: () => ({ start() { return this; }, stop() {} }),
    analyzeFrame: async () => { requests++; responses++; return { configured: true, detections: [{ label: "person", confidence: 0.9, box: [1, 2, 20, 40] }] }; },
    persistObservation: persistGatewayObservation });
  await gateway.startCamera({ id: "synthetic-repeat", enabled: true, streamEnabled: true, aiEnabled: true, samplingIntervalMs: 1000 });
  const session = gateway.sessions.get("synthetic-repeat");
  const data = Buffer.from([255,216,255,224,255,217]);
  for (let i = 0; i < 121; i++) { await gateway.frame(session, data, { capturedAt: new Date(now).toISOString() }); now += 1000; }
  const db = await readDatabase();
  const records = (db.aiObservations || []).filter(item => item.cameraId === "synthetic-repeat");
  const alerts = (db.alerts || []).filter(item => item.sourceCameraId === "synthetic-repeat");
  const incidents = (db.incidents || []).filter(item => item.sourceCameraId === "synthetic-repeat");
  const output = { durationSeconds: 120, framesReceived: session.metrics.frames, aiRequests: requests, aiResponses: responses, observations: records.length, occurrenceCounts: records.map(item => item.occurrenceCount), alerts: alerts.length, incidents: incidents.length, note: "Synthetic bytes and mocked AI; actual observation persistence, simulated timestamps, isolated JSON storage; no physical camera or real inference." };
  await gateway.stopAll();
  console.log(JSON.stringify(output, null, 2));
}
run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => fs.rmSync(directory, { recursive: true, force: true }));
