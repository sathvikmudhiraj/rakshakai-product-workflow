export function surveillanceSeverity(result = {}) {
  const explicit = String(result.alertClassification || "").toLowerCase();
  if (["observation", "watch", "warning", "critical"].includes(explicit)) return explicit;
  const severity = String(result.severity || "").toLowerCase();
  if (severity === "critical") return "critical";
  if (severity === "high") return "warning";
  if (severity === "medium") return "watch";
  return "observation";
}

export function shouldPlayAlertBeep(result = {}) {
  return ["warning", "critical"].includes(surveillanceSeverity(result))
    && Boolean(result.alert || result.actionable);
}

export function beepCooldownReady(lastBeepAt, now = Date.now(), cooldownMs = 10000) {
  return !Number.isFinite(lastBeepAt) || now - lastBeepAt >= cooldownMs;
}

export function boxOverlap(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== 4 || second.length !== 4) return 0;
  const [ax, ay, aw, ah] = first.map(Number);
  const [bx, by, bw, bh] = second.map(Number);
  if (![ax, ay, aw, ah, bx, by, bw, bh].every(Number.isFinite)) return 0;
  const intersection = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx))
    * Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  const union = aw * ah + bw * bh - intersection;
  return union > 0 ? intersection / union : 0;
}

export function duplicateObservation(previous = [], detection = {}, now = Date.now(), windowMs = 8000) {
  return previous.some((item) =>
    item.label === detection.label
    && now - item.timestampMs <= windowMs
    && boxOverlap(item.box, detection.box) >= 0.55
  );
}
