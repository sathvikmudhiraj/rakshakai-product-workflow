const VIEW_TITLES = {
  dashboard: "Sector 7 Safety Grid",
  "incident-command": "Incident Command",
  gis: "GIS Monitoring",
  cctv: "CCTV Monitoring",
  "live-vision": "Rakshak Live Vision",
  "video-evidence": "Video Evidence Upload",
  missing: "Missing & Found Report Center",
  alerts: "Emergency Alert Center",
  history: "Incident History",
  "police-management": "Police Management",
  settings: "System Settings",
  "erss-call-taker": "ERSS-112 Call Taker",
  "erss-dispatcher": "ERSS-112 Dispatcher",
  "erss-assistance": "ERSS-112 Inter-Station Assistance",
  "erss-supervisor": "ERSS-112 Supervisor Queue",
  "erss-field": "ERSS-112 Field Assignments"
};

const OPERATIONAL_ROLES = ["CALL_TAKER", "DISPATCHER", "SUPERVISOR", "FIELD_OFFICER"];

export function landingForRole(role) {
  if (role === "Citizen") return "missing";
  if (role === "Admin") return "dashboard";
  return "dashboard";
}

export function isOperatorRole(role) {
  return ["Police Officer", "Admin"].includes(role);
}

export function hasOperationalRole(user, allowedRoles) {
  if (!user) return false;
  const opRole = user.operationalRole || user.data?.operationalRole;
  return allowedRoles.includes(opRole);
}

export function getOperationalRole(user) {
  return user?.operationalRole || user?.data?.operationalRole || null;
}

function querySelectorAll(document, selector) {
  return Array.from(document.querySelectorAll(selector));
}

function querySelector(document, selector) {
  return document.querySelector(selector);
}

export function resolveViewAccess({ view, role, user, document, viewTitles = VIEW_TITLES }) {
  const nav = querySelectorAll(document, ".nav-item").find((button) => button.dataset.view === view);
  let resolvedView = view;
  if (nav?.hidden) {
    const permission = querySelector(document, "#permissionMessage");
    if (permission) {
      permission.textContent = role === "Citizen"
        ? "You do not have permission to view this operational page."
        : "Admin permission is required to view this page.";
      permission.classList.remove("restricted-hidden");
    }
    resolvedView = landingForRole(role);
  } else {
    const permission = querySelector(document, "#permissionMessage");
    if (permission) permission.classList.add("restricted-hidden");
  }
  querySelectorAll(document, ".nav-item").forEach((b) => {
    const isActive = b.dataset.view === resolvedView;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-current", isActive ? "page" : "false");
  });
  querySelectorAll(document, "[data-panel]").forEach((p) => p.classList.toggle("active", p.dataset.panel === resolvedView));
  const viewTitle = querySelector(document, "#viewTitle");
  if (viewTitle) viewTitle.textContent = viewTitles[resolvedView] || "RakshakAI";
  document.body.dataset.view = resolvedView;
  return resolvedView;
}

export function canAccessErssPage(view, user) {
  const role = user?.role;
  const opRole = getOperationalRole(user);
  if (role === "Admin") return true;
  if (role !== "Police Officer") return false;
  switch (view) {
    case "erss-call-taker": return opRole === "CALL_TAKER";
    case "erss-dispatcher": return opRole === "DISPATCHER";
    case "erss-assistance": return ["DISPATCHER", "SUPERVISOR"].includes(opRole);
    case "erss-supervisor": return opRole === "SUPERVISOR";
    case "erss-field": return opRole === "FIELD_OFFICER";
    default: return false;
  }
}

const RESTRICTED_AI_HEALTH = { configured: false, status: "restricted" };

export async function loadAiVisionData({ role, api }) {
  const operator = isOperatorRole(role);
  const [cameras, sources, videoEvidence, aiHealth, aiObservations] = await Promise.all([
    operator ? api("/api/camera-feeds") : Promise.resolve({ cameras: [] }),
    operator ? api("/api/camera-sources") : Promise.resolve({ sources: [] }),
    operator ? api("/api/video-evidence") : Promise.resolve({ evidence: [], observations: [] }),
    operator
      ? api("/api/ai/health").catch(() => ({ configured: true, status: "unreachable" }))
      : Promise.resolve({ ...RESTRICTED_AI_HEALTH }),
    operator ? api("/api/ai-observations") : Promise.resolve({ observations: [], pendingCount: 0 })
  ]);
  return { cameras, sources, videoEvidence, aiHealth, aiObservations };
}
