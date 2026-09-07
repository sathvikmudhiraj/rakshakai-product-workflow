const test = require("node:test");
const assert = require("node:assert/strict");
const { createMonitor } = require("../../scripts/monitor-release.cjs");

test("readiness failure alerts once, then reports recovery and a fresh outage", async () => {
  const events = [];
  let healthy = false;
  const monitor = createMonitor({ baseUrl: "https://monitor.example.invalid", output: (event) => events.push(event), fetcher: async () => ({ ok: healthy, json: async () => ({ status: healthy ? "ok" : "error" }) }) });
  await monitor.poll(); await monitor.poll();
  healthy = true;
  await monitor.poll();
  healthy = false;
  await monitor.poll();
  assert.deepEqual(events.map((event) => event.state), ["firing", "resolved", "firing"]);
});

test("HTTP 5xx burst is deduplicated and does not forward sensitive log fields", async () => {
  const events = [];
  const monitor = createMonitor({ baseUrl: "http://127.0.0.1:5000", output: (event) => events.push(event) });
  for (let i = 0; i < 6; i++) await monitor.consume(JSON.stringify({ event: "http_request", status: 500, token: "private-test-value" }));
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "http_5xx_burst");
  assert.doesNotMatch(JSON.stringify(events), /private-test-value|token/);
});

test("recovery and shutdown errors produce immediate sanitized webhook alerts", async () => {
  const bodies = [];
  const monitor = createMonitor({ baseUrl: "https://monitor.example.invalid", webhook: "https://receiver.example.invalid/hook", output() {}, fetcher: async (url, options) => { bodies.push(JSON.parse(options.body)); return { ok: true }; } });
  for (const event of ["evidence_reconciliation_journal_failed", "shutdown_deadline_exceeded", "transaction_cleanup_failed"]) await monitor.consume(JSON.stringify({ event, storageKey: "private-test-key" }));
  assert.equal(bodies.length, 3);
  assert.doesNotMatch(JSON.stringify(bodies), /private-test-key/);
});

test("delivery errors are reported safely and retried on the next matching event", async () => {
  const events = [];
  const monitor = createMonitor({ baseUrl: "https://monitor.example.invalid", webhook: "https://receiver.example.invalid/hook", output: (event) => events.push(event), fetcher: async () => { throw new Error("private webhook value"); } });
  await monitor.consume('{"event":"shutdown_failed"}');
  await monitor.consume('{"event":"shutdown_failed"}');
  assert.equal(events.filter((event) => event.event === "alert_delivery_failed").length, 2);
  assert.doesNotMatch(JSON.stringify(events), /private webhook value/);
});

test("monitor rejects remote plaintext and credential-bearing URLs", () => {
  for (const baseUrl of ["http://remote.example.invalid", "https://user:password@example.invalid"]) assert.throws(() => createMonitor({ baseUrl }));
  assert.throws(() => createMonitor({ baseUrl: "https://monitor.example.invalid", webhook: "http://receiver.example.invalid" }));
});

test("invalid, null and unrelated log lines cannot trigger alerts", async () => {
  const events = [];
  const monitor = createMonitor({ baseUrl: "http://127.0.0.1:5000", output: (event) => events.push(event) });
  for (const line of ["startup text", "null", "42", "{}", '{"event":"request_failed","status":500}']) await monitor.consume(line);
  assert.deepEqual(events, []);
});
