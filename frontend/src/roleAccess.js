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
  settings: "System Settings"
};

export function landingForRole(role) {
  if (role === "Citizen") return "missing";
  if (role === "Admin") return "dashboard";
  return "dashboard";
}

export function isOperatorRole(role) {
  return ["Police Officer", "Admin"].includes(role);
}

function querySelectorAll(document, selector) {
  return Array.from(document.querySelectorAll(selector));
}

function querySelector(document, selector) {
  return document.querySelector(selector);
}

export function resolveViewAccess({ view, role, document, viewTitles = VIEW_TITLES }) {
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

const RESTRICTED_AI_HEALTH = { configured: false, status: "restricted" };

export async function loadAiVisionData({ role, api }) {
  const operator = isOperatorRole(role);
  const [cameras, sources, videoEvidence, aiHealth] = await Promise.all([
    operator ? api("/api/camera-feeds") : Promise.resolve({ cameras: [] }),
    operator ? api("/api/camera-sources") : Promise.resolve({ sources: [] }),
    operator ? api("/api/video-evidence") : Promise.resolve({ evidence: [], observations: [] }),
    operator
      ? api("/api/ai/health").catch(() => ({ configured: true, status: "unreachable" }))
      : Promise.resolve({ ...RESTRICTED_AI_HEALTH })
  ]);
  return { cameras, sources, videoEvidence, aiHealth };
}
