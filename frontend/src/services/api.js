const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";
const API_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS || 15000);
localStorage.removeItem("rakshakai_session_token");
sessionStorage.removeItem("rakshakai_session_token");

const ROUTES = {
  "/api/health": "/health",
  "/api/me": "/auth/me",
  "/api/login": "/auth/login",
  "/api/register": "/auth/register",
  "/api/logout": "/auth/logout",
  "/api/change-password": "/auth/change-password",
  "/api/dashboard": "/dashboard",
  "/api/zones": "/zones",
  "/api/incidents/live": "/incidents",
  "/api/incidents/history": "/incidents/history",
  "/api/reports": "/missing-persons",
  "/api/report-missing": "/missing-persons",
  "/api/alerts": "/alerts",
  "/api/send-alert": "/alerts",
  "/api/alerts/clear": "/alerts/clear",
  "/api/camera-feeds": "/cameras/feeds",
  "/api/camera-sources": "/cameras/sources",
  "/api/devices/health": "/device-health",
  "/api/audit-logs": "/audit-logs",
  "/api/integrations/status": "/integrations/status",
  "/api/ai/run-scan": "/ai/run-scan",
  "/api/ai/health": "/ai/health",
  "/api/rakshak/analyze-frame": "/ai/analyze-frame",
  "/api/route": "/route",
  "/api/maps/route": "/maps/route"
};

function normalizeApiPath(path) {
  const [pathname, query = ""] = path.split("?");
  let mapped = ROUTES[pathname];
  if (!mapped) {
    mapped = pathname
      .replace(/^\/api\/alerts\/([^/]+)\/ack$/, "/alerts/$1/ack")
      .replace(/^\/api\/reports\/([^/]+)\/create-incident$/, "/reports/$1/create-incident")
      .replace(/^\/api\/reports\/([^/]+)\/reject$/, "/reports/$1/reject")
      .replace(/^\/api\/incidents\/([^/]+)\/assign-unit$/, "/incidents/$1/assign-unit")
      .replace(/^\/api\/incidents\/([^/]+)\/status$/, "/incidents/$1/status")
      .replace(/^\/api\/camera-sources\/([^/]+)\/config$/, "/cameras/sources/$1/config")
      .replace(/^\/api\/camera-sources\/([^/]+)\/test$/, "/cameras/sources/$1/test")
      .replace(/^\/api\/camera-sources\/([^/]+)\/analyze$/, "/cameras/sources/$1/analyze")
      .replace(/^\/api\/camera-sources\/([^/]+)$/, "/cameras/sources/$1");
  }
  if (mapped === pathname && pathname.startsWith("/api/")) mapped = pathname.slice(4);
  return `${API_BASE_URL}${mapped}${query ? `?${query}` : ""}`;
}

function isLoginRequest(path) {
  return ["/api/login", "/api/auth/login"].includes(path.split("?")[0]);
}

function safeApiMessage(path, status, data = {}, code = "") {
  const loginRequest = isLoginRequest(path);
  if (code === "API_TIMEOUT") return "Network request timed out. Check that RakshakAI services are reachable and try again.";
  if (String(data.code || "").startsWith("GEOCODER_")) {
    return typeof data.error === "string" && data.error.trim()
      ? data.error
      : "Place search provider is unavailable. Try again.";
  }
  if (code === "API_UNAVAILABLE" || [502, 503, 504].includes(status)) {
    return "Backend unavailable. Start the RakshakAI backend service and try again.";
  }
  if (status === 401 && loginRequest) return "Invalid email or password.";
  if (status === 429 && loginRequest) return "Too many login attempts. Please wait and try again.";
  if (status >= 500) return "Server error. Please try again.";
  if (typeof data.error === "string" && data.error.trim()) return data.error;
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  return "Request failed.";
}

async function parseResponseBody(res) {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json().catch(() => ({}));
  }
  const text = await res.text().catch(() => "");
  return text ? { error: text } : {};
}

export async function api(path, options = {}) {
  let res;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs || API_TIMEOUT_MS);
  try {
    res = await fetch(normalizeApiPath(path), {
      method: options.method || "GET",
      credentials: "include",
      signal: controller.signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  } catch (cause) {
    const code = cause?.name === "AbortError" ? "API_TIMEOUT" : "API_UNAVAILABLE";
    const error = new Error(safeApiMessage(path, 0, {}, code));
    error.cause = cause;
    error.code = code;
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
  const data = await parseResponseBody(res);
  if (!res.ok) {
    const error = new Error(safeApiMessage(path, res.status, data));
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}
