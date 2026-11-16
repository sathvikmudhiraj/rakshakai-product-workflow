/* Isolated mock-stream diagnostic. No DB, camera, AI service, or image data is used. */
const { createHash } = require("node:crypto");
const { MediaGateway } = require("../services/mediaGateway.service");

async function evaluate(label, frames) {
  let now = Date.parse("2026-10-20T12:00:00.000Z"), requests = 0, observationCalls = 0;
  const connector = { start() { return this; }, stop() {} };
  const gateway = new MediaGateway({
    clock: () => now,
    connectorFactory: () => connector,
    analyzeFrame: async () => { requests += 1; return { configured: true, detections: [] }; },
    persistObservation: async () => { observationCalls += 1; return null; }
  });
  await gateway.startCamera({ id: "evaluation", enabled: true, streamEnabled: true, aiEnabled: true, samplingIntervalMs: 1000 });
  const session = gateway.sessions.get("evaluation");
  const hashes = new Set();
  for (const frame of frames) {
    hashes.add(createHash("sha256").update(frame).digest("hex"));
    await gateway.frame(session, frame, { capturedAt: new Date(now).toISOString() });
    now += 1000;
  }
  const state = gateway.state("evaluation");
  await gateway.stopAll();
  return { label, frames: frames.length, durationSeconds: frames.length - 1, uniqueExactHashes: hashes.size,
    aiRequests: requests, observationCallbackCalls: observationCalls, streamState: state.streamState,
    note: "Synthetic mock stream; observation callback returns null; not a camera freeze classifier or production observation count." };
}

async function main() {
  const base = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
  const repeated = (count) => Array.from({ length: count }, () => Buffer.from(base));
  const nearIdentical = Array.from({ length: 31 }, (_, index) => Buffer.concat([base, Buffer.from([index % 2])]));
  const recovery = [...repeated(6), Buffer.concat([base, Buffer.from([42])])];
  const results = [];
  for (const [name, data] of [["exact_5_seconds", repeated(6)], ["exact_30_seconds", repeated(31)], ["near_identical_30_seconds", nearIdentical], ["changed_after_repeat", recovery]]) {
    results.push(await evaluate(name, data));
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
