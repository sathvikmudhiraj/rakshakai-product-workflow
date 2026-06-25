const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";
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
      .replace(/^\/api\/incidents\/([^/]+)\/assign-unit$/, "/incidents/$1/assign-unit")
      .replace(/^\/api\/incidents\/([^/]+)\/status$/, "/incidents/$1/status")
      .replace(/^\/api\/camera-sources\/([^/]+)\/config$/, "/cameras/sources/$1/config")
      .replace(/^\/api\/camera-sources\/([^/]+)\/test$/, "/cameras/sources/$1/test");
  }
  if (mapped === pathname && pathname.startsWith("/api/")) mapped = pathname.slice(4);
  return `${API_BASE_URL}${mapped}${query ? `?${query}` : ""}`;
}

export async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(normalizeApiPath(path), {
      method: options.method || "GET",
      credentials: "include",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  } catch (cause) {
    const error = new Error("Unable to reach the RakshakAI API. Check that the app services are running, then refresh this page.");
    error.cause = cause;
    error.code = "API_UNAVAILABLE";
    throw error;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || "Request failed");
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}
