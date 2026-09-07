function installShutdownHandlers(server, { closePool, onDrain, timeoutMs = 25000, signals = process } = {}) {
  let shutdown;
  function drain() {
    if (shutdown) return shutdown;
    onDrain?.();
    shutdown = new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.error(JSON.stringify({ event: "shutdown_deadline_exceeded" }));
        server.closeAllConnections();
      }, timeoutMs);
      timer.unref();
      server.close(async (error) => {
        clearTimeout(timer);
        try {
          await closePool();
          if (error) throw error;
        } catch {
          process.exitCode = 1;
          console.error(JSON.stringify({ event: "shutdown_failed" }));
        } finally {
          signals.removeListener("SIGTERM", drain);
          signals.removeListener("SIGINT", drain);
          resolve();
        }
      });
      server.closeIdleConnections();
    });
    return shutdown;
  }
  signals.on("SIGTERM", drain);
  signals.on("SIGINT", drain);
  return drain;
}

module.exports = { installShutdownHandlers };
