const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { analyzeFrame } = require("../services/ai.service");

test("evidence analysis accepts a complete inference and rejects ambiguous or malformed responses", async (t) => {
  let response;
  const server = http.createServer((req, res) => {
    if (req.url === "/health") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ modelLoaded: true, modelName: "test-model", minimumConfidence: 0.5 })); return; }
    req.resume();
    req.on("end", () => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(response)); });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const originalUrl = process.env.AI_SERVICE_URL;
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { if (originalUrl === undefined) delete process.env.AI_SERVICE_URL; else process.env.AI_SERVICE_URL = originalUrl; });
  const performance = { imageWidth: 100, imageHeight: 100, inferenceMs: 12, analyzedAt: new Date().toISOString() };
  for (const invalid of [
    { configured: true, detections: [], performance: { inferenceMs: 0, analyzedAt: performance.analyzedAt } },
    { configured: true, detections: "invalid", performance },
    { configured: true, detections: [{ label: "person", confidence: 0.9, box: [90, 1, 20, 2] }], performance }
  ]) {
    response = invalid;
    const result = await analyzeFrame({}, { strictEvidence: true });
    assert.match(result.serviceError, /valid image result/);
  }
  response = { configured: true, detections: [], performance };
  const valid = await analyzeFrame({}, { strictEvidence: true });
  assert.equal(valid.serviceError, undefined);
  assert.deepEqual(valid.detections, []);
});

test("evidence AI transport failures remain errors", async (t) => {
  let mode = "http500";
  const server = http.createServer((req, res) => {
    if (req.url === "/health") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ modelLoaded: true, modelName: "test-model", minimumConfidence: 0.5 })); return; }
    req.resume();
    if (mode === "timeout") return;
    if (mode === "malformed") { res.writeHead(200); return res.end("not json"); }
    res.writeHead(500); res.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previousUrl = process.env.AI_SERVICE_URL;
  const previousTimeout = process.env.AI_SERVICE_TIMEOUT_MS;
  t.after(() => {
    if (previousUrl === undefined) delete process.env.AI_SERVICE_URL; else process.env.AI_SERVICE_URL = previousUrl;
    if (previousTimeout === undefined) delete process.env.AI_SERVICE_TIMEOUT_MS; else process.env.AI_SERVICE_TIMEOUT_MS = previousTimeout;
  });
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.AI_SERVICE_TIMEOUT_MS = "100";
  for (mode of ["http500", "malformed", "timeout"]) {
    const result = await analyzeFrame({}, { strictEvidence: true });
    assert.equal(typeof result.serviceError, "string", mode);
    assert.equal(result.failureCode, { http500: "AI_HTTP_ERROR", malformed: "AI_MALFORMED_RESPONSE", timeout: "AI_TIMEOUT" }[mode]);
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  const refused = await analyzeFrame({}, { strictEvidence: true });
  assert.equal(typeof refused.serviceError, "string");
  assert.equal(refused.failureCode, "AI_UNAVAILABLE");
});
