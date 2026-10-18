const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "/api";
const API_TIMEOUT_MS = Number(import.meta.env?.VITE_API_TIMEOUT_MS || 15000);
// Browsers no longer use these tokens, but remove legacy values when storage
// is present.  Guarding this also keeps API modules usable in Node test runs.
globalThis.localStorage?.removeItem("rakshakai_session_token");
globalThis.sessionStorage?.removeItem("rakshakai_session_token");

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
  "/api/maps/route": "/maps/route",
  "/api/tracking/sessions": "/tracking/sessions",
  "/api/tracking/camera-adjacency": "/tracking/camera-adjacency",
  "/api/tracking/score-config": "/tracking/score-config",
  "/api/erss/events": "/erss/events",
  "/api/erss/events/simulate": "/erss/events/simulate"
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
  if (path.split("?")[0] === "/api/copilot/query" && typeof data.error === "string" && data.error.trim()) return data.error;
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

export function googleWorkspaceSignInUrl() { return normalizeApiPath("/api/auth/google/start"); }

export const trackingApi = {
  createSession: (data) => api("/api/tracking/sessions", { method: "POST", body: data }),
  listSessions: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return api(`/api/tracking/sessions${query ? `?${query}` : ""}`);
  },
  getSession: (sessionId) => api(`/api/tracking/sessions/${sessionId}`),
  searchCandidates: (sessionId, timeWindowMinutes = 30) =>
    api(`/api/tracking/sessions/${sessionId}/search?timeWindowMinutes=${timeWindowMinutes}`, { method: "POST" }),
  getTimeline: (sessionId) => api(`/api/tracking/sessions/${sessionId}/timeline`),
  getMapData: (sessionId) => api(`/api/tracking/sessions/${sessionId}/map`),
  getRecommendations: (sessionId) => api(`/api/tracking/sessions/${sessionId}/recommendations`),
  handoff: (sessionId, data = {}) => api(`/api/tracking/sessions/${sessionId}/handoff`, { method: "POST", body: data }),
  verifyCandidate: (sessionId, candidateId, decision, reason) =>
    api(`/api/tracking/sessions/${sessionId}/candidates/${candidateId}/verify`, {
      method: "POST",
      body: { decision, reason }
    }),
  getCandidateDetails: (sessionId, candidateId) => api(`/api/tracking/sessions/${sessionId}/candidates/${candidateId}`),
  closeSession: (sessionId) => api(`/api/tracking/sessions/${sessionId}/close`, { method: "POST" }),
  getCameraAdjacency: () => api("/api/tracking/camera-adjacency"),
  createCameraAdjacency: (data) => api("/api/tracking/camera-adjacency", { method: "POST", body: data }),
  getScoreConfig: (trackType) => api(`/api/tracking/score-config${trackType ? `?trackType=${trackType}` : ""}`),
  updateScoreConfig: (data) => api("/api/tracking/score-config", { method: "POST", body: data })
};

export const erssApi = {
  listEvents: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return api(`/api/erss/events${query ? `?${query}` : ""}`);
  },
  createEvent: (data) => api("/api/erss/events", { method: "POST", body: data }),
  simulateEvent: (data) => api("/api/erss/events/simulate", { method: "POST", body: data }),
  getEvent: (id) => api(`/api/erss/events/${id}`),
  updateEvent: (id, data) => api(`/api/erss/events/${id}`, { method: "PATCH", body: data }),
  updateLocation: (id, data) => api(`/api/erss/events/${id}/location`, { method: "POST", body: data }),
  updateJurisdiction: (id, data) => api(`/api/erss/events/${id}/jurisdiction`, { method: "POST", body: data }),
  listCalls: (eventId) => api(`/api/erss/events/${eventId}/calls`),
  createCall: (eventId, data) => api(`/api/erss/events/${eventId}/calls`, { method: "POST", body: data }),
  updateCall: (callId, data) => api(`/api/erss/calls/${callId}`, { method: "PATCH", body: data }),
  endCall: (callId, data) => api(`/api/erss/calls/${callId}/end`, { method: "POST", body: data }),
  createTriage: (eventId, data) => api(`/api/erss/events/${eventId}/triage`, { method: "POST", body: data }),
  getTriage: (eventId) => api(`/api/erss/events/${eventId}/triage`),
  createDispatchRequest: (eventId, data) => api(`/api/erss/events/${eventId}/dispatch-request`, { method: "POST", body: data }),
  getDispatchRequest: (eventId) => api(`/api/erss/events/${eventId}/dispatch-request`),
  approveDispatchRequest: (requestId, data) => api(`/api/erss/dispatch-requests/${requestId}/approve`, { method: "POST", body: data }),
  rejectDispatchRequest: (requestId, data) => api(`/api/erss/dispatch-requests/${requestId}/reject`, { method: "POST", body: data }),
  createUnitRequest: (dispatchRequestId, data) => api(`/api/erss/dispatch-requests/${dispatchRequestId}/unit-requests`, { method: "POST", body: data }),
  listUnitRequests: (dispatchRequestId) => api(`/api/erss/dispatch-requests/${dispatchRequestId}/unit-requests`),
  acknowledgeUnitRequest: (requestId, data) => api(`/api/erss/unit-requests/${requestId}/acknowledge`, { method: "POST", body: data }),
  acceptUnitRequest: (requestId, data) => api(`/api/erss/unit-requests/${requestId}/accept`, { method: "POST", body: data }),
  declineUnitRequest: (requestId, data) => api(`/api/erss/unit-requests/${requestId}/decline`, { method: "POST", body: data }),
  timeoutUnitRequest: (requestId) => api(`/api/erss/unit-requests/${requestId}/timeout`, { method: "POST" }),
  recommendFallbackUnit: (eventId, data) => api(`/api/erss/events/${eventId}/fallback-unit`, { method: "POST", body: data }),
  createAssistanceRequest: (eventId, data) => api(`/api/erss/events/${eventId}/assistance-requests`, { method: "POST", body: data }),
  listAssistanceRequests: (eventId) => api(`/api/erss/events/${eventId}/assistance-requests`),
  acknowledgeAssistanceRequest: (requestId, data) => api(`/api/erss/assistance-requests/${requestId}/acknowledge`, { method: "POST", body: data }),
  acceptAssistanceRequest: (requestId, data) => api(`/api/erss/assistance-requests/${requestId}/accept`, { method: "POST", body: data }),
  declineAssistanceRequest: (requestId, data) => api(`/api/erss/assistance-requests/${requestId}/decline`, { method: "POST", body: data }),
  timeoutAssistanceRequest: (requestId) => api(`/api/erss/assistance-requests/${requestId}/timeout`, { method: "POST" }),
  createOwnershipTransfer: (eventId, data) => api(`/api/erss/events/${eventId}/ownership-transfer`, { method: "POST", body: data }),
  listOwnershipTransfers: (eventId) => api(`/api/erss/events/${eventId}/ownership-transfers`),
  acknowledgeOwnershipTransfer: (transferId, data) => api(`/api/erss/ownership-transfers/${transferId}/acknowledge`, { method: "POST", body: data }),
  completeOwnershipTransfer: (transferId, data) => api(`/api/erss/ownership-transfers/${transferId}/complete`, { method: "POST", body: data }),
  getJurisdictionHistory: (eventId) => api(`/api/erss/jurisdiction-history/${eventId}`),
  getDispatcherWorkload: (dispatcherId) => api(`/api/erss/dispatcher/${dispatcherId}/workload`),
  getSupervisorQueue: () => api("/api/erss/supervisor/queue"),
  getRecommendations: (eventId) => api(`/api/erss/events/${eventId}/recommendations`),
  refreshRecommendations: (eventId) => api(`/api/erss/events/${eventId}/recommendations/refresh`, { method: "POST" })
};

export const cctnsApi = {
  status: () => api("/api/cctns/status"),
  search: (params = {}) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")).toString();
    return api(`/api/cctns/search${query ? `?${query}` : ""}`);
  },
  searchVehicles: (params = {}) => cctnsApi.search({ ...params, type: "vehicle" }),
  searchPersons: (params = {}) => cctnsApi.search({ ...params, type: "person" }),
  searchMissingPersons: (params = {}) => cctnsApi.search({ ...params, type: "missing_person" }),
  searchCases: (params = {}) => cctnsApi.search({ ...params, type: "case" }),
  searchProperty: (params = {}) => cctnsApi.search({ ...params, type: "property" }),
  getRecord: (id) => api(`/api/cctns/records/${encodeURIComponent(id)}`),
  createLink: (data) => api("/api/cctns/links", { method: "POST", body: data }),
  removeLink: (id) => api(`/api/cctns/links/${encodeURIComponent(id)}`, { method: "DELETE" })
};
