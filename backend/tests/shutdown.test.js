const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const { installShutdownHandlers } = require("../services/shutdown.service");

test("shutdown drains an active HTTP request before closing the database exactly once", async () => {
  let finishRequest;
  let sawRequest;
  const received = new Promise((resolve) => { sawRequest = resolve; });
  const server = http.createServer((req, res) => { finishRequest = () => res.end("saved"); sawRequest(); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const signals = new EventEmitter();
  let closed = 0;
  let draining = false;
  const drain = installShutdownHandlers(server, { signals, onDrain: () => { draining = true; }, closePool: async () => { closed++; } });
  const response = fetch(`http://127.0.0.1:${server.address().port}`);
  await received;
  const shutdown = drain();
  assert.equal(drain(), shutdown);
  assert.equal(draining, true);
  assert.equal(closed, 0);
  finishRequest();
  assert.equal(await (await response).text(), "saved");
  await shutdown;
  assert.equal(closed, 1);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});
