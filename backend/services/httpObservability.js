const WINDOW_MS = 60_000;
const recentRateLimits = new Map();
let rateLimitTotal = 0;

function routeGroup(pathname = "") {
  if (["/api/auth/me", "/api/auth/login", "/api/login", "/api/sla/monitoring"].includes(pathname)) return pathname;
  if (pathname.startsWith("/api/maps/")) return "/api/maps/*";
  if (pathname.startsWith("/api/")) return "/api/other";
  return "other";
}

function trimRecent(nowMs) {
  for (const second of recentRateLimits.keys()) {
    if (second * 1000 <= nowMs - WINDOW_MS) recentRateLimits.delete(second);
  }
}

function recordHttpResponse(status, pathname, nowMs = Date.now()) {
  if (status !== 429) return;
  trimRecent(nowMs);
  const second = Math.floor(nowMs / 1000);
  const bucket = recentRateLimits.get(second) || { total: 0, byRoute: {} };
  bucket.total += 1;
  const route = routeGroup(pathname);
  bucket.byRoute[route] = (bucket.byRoute[route] || 0) + 1;
  recentRateLimits.set(second, bucket);
  rateLimitTotal += 1;
}

function rateLimitSnapshot(nowMs = Date.now()) {
  trimRecent(nowMs);
  const byRoute = {};
  let count = 0;
  for (const bucket of recentRateLimits.values()) {
    count += bucket.total;
    for (const [route, value] of Object.entries(bucket.byRoute)) byRoute[route] = (byRoute[route] || 0) + value;
  }
  return { http429LastMinute: count, http429Total: rateLimitTotal, http429ByRouteLastMinute: byRoute };
}

module.exports = { recordHttpResponse, rateLimitSnapshot, routeGroup };
