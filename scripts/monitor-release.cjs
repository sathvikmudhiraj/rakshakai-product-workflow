const readline = require("node:readline");

function safeUrl(value, { local = false } = {}) {
  const url = new URL(value);
  if (url.username || url.password || url.hash || (url.protocol !== "https:" && !(local && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("Monitoring requires HTTPS, except explicit loopback health checks");
  }
  return url;
}

function createMonitor({ baseUrl, webhook, fetcher = fetch, output = (event) => console.log(JSON.stringify(event)), now = Date.now } = {}) {
  const base = safeUrl(baseUrl, { local: true });
  const receiver = webhook ? safeUrl(webhook) : null;
  const delivered = new Map();
  let failures = [];
  let wasHealthy;
  let polling = false;
  async function alert(kind, state, severity = "critical") {
    const key = `${kind}:${state}`;
    if (delivered.has(key) && now() - delivered.get(key) < 60000) return;
    delivered.set(key, now());
    const event = { event: "operational_alert", service: "RakshakAI", kind, state, severity, timestamp: new Date(now()).toISOString() };
    output(event);
    if (!receiver) return;
    try {
      const response = await fetcher(receiver, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event), signal: AbortSignal.timeout(5000), redirect: "error" });
      if (!response.ok) throw new Error("Alert delivery rejected");
    } catch {
      delivered.delete(key);
      output({ event: "alert_delivery_failed", kind, state });
    }
  }
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      let healthy = false;
      try {
        const response = await fetcher(new URL("/api/health", base), { signal: AbortSignal.timeout(10000), redirect: "error" });
        healthy = response.ok && (await response.json()).status === "ok";
      } catch {}
      if (!healthy) await alert("readiness", "firing");
      else if (wasHealthy === false) await alert("readiness", "resolved", "info");
      if (healthy !== wasHealthy) delivered.delete(`readiness:${healthy ? "firing" : "resolved"}`);
      wasHealthy = healthy;
    } finally { polling = false; }
  }
  async function consume(line) {
    if (line.length > 16384) return;
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (!event || typeof event !== "object") return;
    const immediate = new Set(["shutdown_deadline_exceeded", "shutdown_failed", "evidence_reconciliation_required", "evidence_reconciliation_journal_failed", "transaction_cleanup_failed"]);
    if (immediate.has(event.event)) return alert(event.event, "firing");
    // Count the request summary once, not the matching request_failed log as well.
    if (event.event === "http_request" && Number(event.status) >= 500) {
      failures = failures.filter((timestamp) => now() - timestamp < 60000);
      failures.push(now());
      if (failures.length > 3) failures.shift();
      if (failures.length >= 3) await alert("http_5xx_burst", "firing");
    }
  }
  return { poll, consume, alert };
}

async function main() {
  const monitor = createMonitor({ baseUrl: process.env.MONITOR_BASE_URL, webhook: process.env.ALERT_WEBHOOK_URL });
  console.log(JSON.stringify({ event: "monitor_started", webhookConfigured: Boolean(process.env.ALERT_WEBHOOK_URL) }));
  const lines = readline.createInterface({ input: process.stdin });
  let stopping = false;
  lines.on("line", (line) => { monitor.consume(line).catch(() => console.error('{"event":"monitor_processing_failed"}')); });
  lines.on("close", () => { if (!stopping) monitor.alert("log_stream_closed", "firing").catch(() => {}); });
  const timer = setInterval(() => { monitor.poll().catch(() => console.error('{"event":"monitor_poll_failed"}')); }, 15000);
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { stopping = true; clearInterval(timer); lines.close(); });
  await monitor.poll();
}
if (require.main === module) main().catch(() => { console.error("Monitor configuration is invalid; URLs and secrets are not logged."); process.exitCode = 1; });
module.exports = { createMonitor };
