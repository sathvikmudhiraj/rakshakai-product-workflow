const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const express = require("express");
const { Server } = require("socket.io");
const { io: createClient } = require("socket.io-client");
const { installShutdownHandlers, createDrainMiddleware } = require("../services/shutdown.service");

function createLogger() {
  const logs = [];
  const errors = [];
  return {
    logs,
    errors,
    log(line) { logs.push(JSON.parse(line)); },
    error(line) { errors.push(JSON.parse(line)); }
  };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(() => resolve()));
}

test("SIGTERM drains an in-flight request, closes Socket.IO, then closes the pool", async () => {
  let release;
  let sawRequest;
  const received = new Promise((resolve) => { sawRequest = resolve; });
  const server = http.createServer((req, res) => { release = () => res.end("saved"); sawRequest(); });
  const port = await listen(server);
  const socketServer = new Server(server);
  const client = createClient(`http://127.0.0.1:${port}`, { transports: ["websocket"], reconnection: false });
  await new Promise((resolve, reject) => {
    client.once("connect", resolve);
    client.once("connect_error", reject);
  });
  const disconnected = new Promise((resolve) => client.once("disconnect", resolve));

  const signals = new EventEmitter();
  const logger = createLogger();
  const order = [];
  let poolCloses = 0;
  let jobsStopped = 0;
  let resourcesStopped = 0;
  let exitCode = null;
  const drain = installShutdownHandlers(server, {
    signals,
    io: socketServer,
    logger,
    onDrain: () => order.push("drain"),
    stopBackgroundJobs: async () => { jobsStopped += 1; order.push("jobs"); },
    stopResources: async () => { resourcesStopped += 1; order.push("resources"); },
    closePool: async () => { poolCloses += 1; order.push("pool"); },
    exit: (code) => { exitCode = code; }
  });

  const response = fetch(`http://127.0.0.1:${port}/`);
  await received;
  signals.emit("SIGTERM");
  const shutdown = drain();
  assert.equal(jobsStopped, 0);
  assert.equal(poolCloses, 0);
  assert.equal(order[0], "drain");

  release();
  assert.equal(await (await response).text(), "saved");
  assert.equal(await shutdown, 0);
  await disconnected;

  assert.equal(exitCode, 0);
  assert.equal(poolCloses, 1);
  assert.equal(jobsStopped, 1);
  assert.equal(resourcesStopped, 1);
  assert.deepEqual(order, ["drain", "jobs", "resources", "pool"]);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
  assert.equal(signals.listenerCount("SIGINT"), 0);
  const complete = logger.logs.find((entry) => entry.event === "shutdown_complete");
  assert.equal(complete.forced, false);
  assert.equal(complete.reason, "drained");
  assert.equal(complete.exitCode, 0);
  client.close();
});

test("SIGINT performs the same shutdown and exits cleanly", async () => {
  const server = http.createServer((req, res) => res.end("ok"));
  await listen(server);
  const signals = new EventEmitter();
  const logger = createLogger();
  let poolCloses = 0;
  let exitCode = null;
  const drain = installShutdownHandlers(server, {
    signals,
    logger,
    closePool: async () => { poolCloses += 1; },
    exit: (code) => { exitCode = code; }
  });

  signals.emit("SIGINT");
  assert.equal(await drain(), 0);
  assert.equal(poolCloses, 1);
  assert.equal(exitCode, 0);
  assert.ok(logger.logs.some((entry) => entry.event === "shutdown_started" && entry.signal === "SIGINT"));
});

test("repeated shutdown signals never run cleanup twice", async () => {
  const server = http.createServer((req, res) => res.end("ok"));
  await listen(server);
  const signals = new EventEmitter();
  const logger = createLogger();
  let poolCloses = 0;
  let jobsStopped = 0;
  const drain = installShutdownHandlers(server, {
    signals,
    logger,
    stopBackgroundJobs: async () => { jobsStopped += 1; },
    closePool: async () => { poolCloses += 1; }
  });

  const first = drain("SIGTERM");
  const second = drain("SIGINT");
  signals.emit("SIGTERM");
  assert.equal(first, second);
  assert.equal(await first, 0);
  assert.equal(poolCloses, 1);
  assert.equal(jobsStopped, 1);
  const ignored = logger.logs.filter((entry) => entry.event === "shutdown_signal_ignored");
  assert.equal(ignored.length, 2);
  assert.equal(ignored[0].reason, "already_shutting_down");
});

test("draining rejects new requests while liveness remains available", async () => {
  let draining = false;
  const app = express();
  app.use(createDrainMiddleware(() => draining));
  app.get("/api/live", (req, res) => res.json({ status: "ok" }));
  app.get("/api/health", (req, res) => res.json({ status: "ok" }));
  app.get("/api/incidents", (req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  const port = await listen(server);

  assert.equal((await fetch(`http://127.0.0.1:${port}/api/incidents`)).status, 200);
  draining = true;

  const blocked = await fetch(`http://127.0.0.1:${port}/api/incidents`);
  assert.equal(blocked.status, 503);
  assert.equal(blocked.headers.get("connection"), "close");
  assert.equal((await blocked.json()).code, "SERVER_SHUTTING_DOWN");

  const live = await fetch(`http://127.0.0.1:${port}/api/live`);
  assert.equal(live.status, 200);
  assert.equal((await live.json()).status, "ok");

  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(health.status, 503);
  assert.equal((await health.json()).status, "draining");

  await closeServer(server);
});

test("stalled connections hit the bounded deadline and report a forced shutdown", async () => {
  let sawRequest;
  const received = new Promise((resolve) => { sawRequest = resolve; });
  const server = http.createServer(() => { sawRequest(); /* never responds */ });
  const port = await listen(server);
  const signals = new EventEmitter();
  const logger = createLogger();
  let poolCloses = 0;
  let exitCode = null;
  const drain = installShutdownHandlers(server, {
    signals,
    logger,
    timeoutMs: 120,
    stopBackgroundJobs: async () => {},
    closePool: async () => { poolCloses += 1; },
    exit: (code) => { exitCode = code; }
  });

  const pending = fetch(`http://127.0.0.1:${port}/`).catch(() => null);
  await received;
  const startedAt = Date.now();
  const code = await drain("SIGTERM");
  const elapsed = Date.now() - startedAt;
  await pending;

  assert.equal(code, 1);
  assert.equal(exitCode, 1);
  assert.equal(poolCloses, 1);
  assert.ok(elapsed < 3000, `shutdown should be bounded, took ${elapsed}ms`);
  const deadline = logger.errors.find((entry) => entry.event === "shutdown_deadline_exceeded");
  assert.equal(deadline.timeoutMs, 120);
  const complete = logger.errors.find((entry) => entry.event === "shutdown_complete");
  assert.equal(complete.forced, true);
  assert.equal(complete.reason, "deadline_exceeded");
  assert.equal(complete.exitCode, 1);
});

test("database cleanup failures are logged without secrets and exit non-zero", async () => {
  const server = http.createServer((req, res) => res.end("ok"));
  await listen(server);
  const signals = new EventEmitter();
  const logger = createLogger();
  let exitCode = null;
  const drain = installShutdownHandlers(server, {
    signals,
    logger,
    stopBackgroundJobs: async () => {},
    stopResources: async () => {},
    closePool: async () => { throw new Error("pool unavailable"); },
    exit: (code) => { exitCode = code; }
  });

  const code = await drain("SIGTERM");
  assert.equal(code, 1);
  assert.equal(exitCode, 1);
  const failure = logger.errors.find((entry) => entry.event === "shutdown_step_failed");
  assert.equal(failure.step, "database_pool");
  assert.equal(failure.error, "pool unavailable");
  assert.equal(JSON.stringify(logger.errors).includes("stack"), false);
  const complete = logger.errors.find((entry) => entry.event === "shutdown_complete");
  assert.equal(complete.reason, "cleanup_failed");
});
