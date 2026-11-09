const DEFAULT_TIMEOUT_MS = 25_000;
// If the deadline is reached, database shutdown gets one short final grace
// period. A pool that is still stuck after that is reported and abandoned;
// the process must not outlive the container's stop grace period.
const FORCED_POOL_CLOSE_GRACE_MS = 2_000;
const TIMEOUT = Symbol("shutdown-timeout");

// Resolves with TIMEOUT or the promise's value and always clears its timer,
// so a fast cleanup does not leave a stray handle keeping the process alive.
function withGrace(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMEOUT), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function errorMessage(error) {
  return error && typeof error.message === "string" ? error.message : "unknown error";
}

/**
 * Rejects new work once shutdown starts while keeping liveness cheap and
 * side-effect free. In-flight requests already inside the application finish;
 * requests reusing a keep-alive socket after draining begins get a 503.
 */
function createDrainMiddleware(isDraining) {
  const readDraining = typeof isDraining === "function"
    ? isDraining
    : () => Boolean(isDraining && isDraining.draining);
  return function drainMiddleware(req, res, next) {
    if (!readDraining()) return next();
    res.setHeader("Connection", "close");
    if (req.path === "/api/live") return res.json({ status: "ok" });
    if (req.path === "/api/health") return res.status(503).json({ status: "draining" });
    return res.status(503).json({ error: "Server is shutting down", code: "SERVER_SHUTTING_DOWN" });
  };
}

function installShutdownHandlers(server, options = {}) {
  const {
    closePool = async () => {},
    onDrain = null,
    io = null,
    stopBackgroundJobs = null,
    stopResources = null,
    timeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    signals = process,
    logger = console,
    exit = null
  } = options;

  const parsedTimeout = Number(timeoutMs);
  const shutdownTimeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0
    ? Math.max(50, parsedTimeout)
    : DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  let shutdown = null;
  let signalName = "manual";
  let phase = "startup";
  let exitCode = 0;
  let forced = false;

  const log = (level, event, fields = {}) => {
    try {
      const line = JSON.stringify({ event, ...fields });
      if (level === "error" && typeof logger.error === "function") logger.error(line);
      else if (typeof logger.log === "function") logger.log(line);
    } catch {
      // Logging must never decide whether shutdown can proceed.
    }
  };

  function beginHttpClose() {
    if (!server || !server.listening) return Promise.resolve();
    return new Promise((resolve) => {
      try {
        server.close((error) => {
          if (error && error.code !== "ERR_SERVER_NOT_RUNNING") {
            exitCode = 1;
            log("error", "shutdown_http_close_failed", { error: errorMessage(error) });
          }
          resolve();
        });
      } catch (error) {
        exitCode = 1;
        log("error", "shutdown_http_close_failed", { error: errorMessage(error) });
        resolve();
      }
    });
  }

  function closeSocketIO() {
    if (!io) return;
    try {
      // Best-effort notification; a slow or dead client must not delay draining.
      io.emit("server_shutdown", { reason: "shutdown" });
    } catch (error) {
      exitCode = 1;
      log("error", "shutdown_socket_notify_failed", { error: errorMessage(error) });
    }
    try {
      // Engine.IO closes every client connection and the attached HTTP server.
      io.close();
    } catch (error) {
      exitCode = 1;
      log("error", "shutdown_socket_close_failed", { error: errorMessage(error) });
    }
  }

  function forceCloseConnections() {
    try { server?.closeIdleConnections?.(); } catch { /* already closed */ }
    try { server?.closeAllConnections?.(); } catch { /* already closed */ }
    try { io?.disconnectSockets?.(true); } catch { /* already closed */ }
  }

  let poolClose = null;
  function beginPoolClose() {
    if (!poolClose) poolClose = Promise.resolve().then(() => closePool());
    return poolClose;
  }

  async function run() {
    log("log", "shutdown_started", { signal: signalName, timeoutMs: shutdownTimeoutMs });

    phase = "mark_draining";
    try {
      onDrain?.();
    } catch (error) {
      exitCode = 1;
      log("error", "shutdown_drain_notification_failed", { error: errorMessage(error) });
    }

    let deadlineTimer;
    let deadlineResolved = false;
    const deadline = new Promise((resolve) => {
      deadlineTimer = setTimeout(() => {
        deadlineResolved = true;
        forced = true;
        exitCode = 1;
        log("error", "shutdown_deadline_exceeded", { timeoutMs: shutdownTimeoutMs, phase });
        forceCloseConnections();
        resolve(TIMEOUT);
      }, shutdownTimeoutMs);
    });

    async function step(name, task) {
      if (deadlineResolved) return TIMEOUT;
      phase = name;
      const work = Promise.resolve().then(task);
      const outcome = await Promise.race([
        work.then(() => ({ ok: true }), (error) => ({ ok: false, error })),
        deadline
      ]);
      if (outcome === TIMEOUT) return TIMEOUT;
      if (!outcome.ok) {
        exitCode = 1;
        log("error", "shutdown_step_failed", { step: name, error: errorMessage(outcome.error) });
        return false;
      }
      return true;
    }

    try {
      // Stop accepting new connections first, then end upgraded connections so
      // the HTTP close callback can complete once in-flight requests finish.
      const httpClosed = beginHttpClose();
      closeSocketIO();
      try { server?.closeIdleConnections?.(); } catch { /* not supported */ }

      if (await step("background_jobs", () => stopBackgroundJobs?.()) !== TIMEOUT) {
        // Requests may still be writing to PostgreSQL; the pool is closed only
        // after the HTTP listener is fully drained and jobs have settled.
        await step("http_connections", () => httpClosed);
        await step("application_resources", () => stopResources?.());
        if (!deadlineResolved) await step("database_pool", () => beginPoolClose());
      }

      if (deadlineResolved) {
        forceCloseConnections();
        closeSocketIO();
        phase = "application_resources";
        const resourceOutcome = await withGrace(
          Promise.resolve().then(() => stopResources?.()).then(() => "stopped", (error) => {
            log("error", "shutdown_step_failed", { step: "application_resources", error: errorMessage(error) });
            return "failed";
          }),
          500
        );
        if (resourceOutcome === TIMEOUT) {
          log("error", "shutdown_resources_incomplete", { graceMs: 500 });
        }
        phase = "database_pool";
        const poolOutcome = await withGrace(
          beginPoolClose().then(
            () => "closed",
            (error) => {
              log("error", "shutdown_step_failed", { step: "database_pool", error: errorMessage(error) });
              return "failed";
            }
          ),
          FORCED_POOL_CLOSE_GRACE_MS
        );
        if (poolOutcome === TIMEOUT) {
          log("error", "shutdown_database_close_incomplete", { graceMs: FORCED_POOL_CLOSE_GRACE_MS });
        }
      }
    } catch (error) {
      exitCode = 1;
      log("error", "shutdown_failed", { phase, error: errorMessage(error) });
      forceCloseConnections();
      try {
        await withGrace(beginPoolClose().then(() => undefined, () => undefined), FORCED_POOL_CLOSE_GRACE_MS);
      } catch {
        // Cleanup failures are already reflected in the exit code.
      }
    } finally {
      clearTimeout(deadlineTimer);
      signals.removeListener?.("SIGTERM", onSigterm);
      signals.removeListener?.("SIGINT", onSigint);
    }

    const finalCode = forced || exitCode !== 0 ? 1 : 0;
    log(finalCode ? "error" : "log", "shutdown_complete", {
      signal: signalName,
      forced,
      reason: forced ? "deadline_exceeded" : finalCode ? "cleanup_failed" : "drained",
      exitCode: finalCode,
      durationMs: Date.now() - startedAt
    });
    if (typeof exit === "function") {
      try {
        exit(finalCode);
      } catch (error) {
        try { logger.error?.(JSON.stringify({ event: "shutdown_exit_failed", error: errorMessage(error) })); } catch { /* ignore */ }
      }
    }
    return finalCode;
  }

  function handleSignal(signal) {
    if (shutdown) {
      log("log", "shutdown_signal_ignored", { signal: String(signal), reason: "already_shutting_down" });
      return shutdown;
    }
    signalName = String(signal || "manual");
    shutdown = run();
    return shutdown;
  }

  function onSigterm() { return handleSignal("SIGTERM"); }
  function onSigint() { return handleSignal("SIGINT"); }
  signals.on?.("SIGTERM", onSigterm);
  signals.on?.("SIGINT", onSigint);
  return handleSignal;
}

module.exports = { installShutdownHandlers, createDrainMiddleware, __testables: { DEFAULT_TIMEOUT_MS, FORCED_POOL_CLOSE_GRACE_MS } };
