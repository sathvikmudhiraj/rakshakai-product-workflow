// Handshake authentication alone leaves an already-connected dashboard alive
// after token expiry or revocation. Check incoming packets and passive sockets.
function installSocketSessionGuard(io, { resolveUser, intervalMs = 30000 } = {}) {
  let checking = false;
  async function validate(socket) {
    try {
      const user = await resolveUser(socket.request);
      if (!user || !["Admin", "Police Officer"].includes(user.role) || user.role !== socket.data.user?.role) {
        socket.disconnect(true); return false;
      }
      socket.data.user = user;
      return true;
    } catch { socket.disconnect(true); return false; }
  }
  async function checkAll() {
    if (checking) return;
    checking = true;
    try { for (const socket of io.sockets.sockets.values()) await validate(socket); }
    finally { checking = false; }
  }
  const interval = Number.isFinite(intervalMs) ? Math.max(1000, Math.min(30000, intervalMs)) : 30000;
  const timer = setInterval(() => { checkAll().catch(() => {}); }, interval);
  timer.unref?.();
  return {
    checkAll,
    attach(socket) {
      socket.use(async (packet, next) => {
        if (await validate(socket)) next(); else next(new Error("Session expired or revoked"));
      });
    },
    stop() { clearInterval(timer); }
  };
}

module.exports = { installSocketSessionGuard };
