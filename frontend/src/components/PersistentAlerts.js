let criticalBannerResizeObserver = null;
const criticalSeen = new Map();
const criticalSeenKey = (userId) => `rakshakai:critical-seen:${encodeURIComponent(userId)}`;

export function clearCriticalAttention(userId) {
  criticalSeen.delete(String(userId));
  try { document.defaultView.sessionStorage.removeItem(criticalSeenKey(userId)); } catch { /* Memory-only when storage is blocked. */ }
  removeGlobalBanner();
}

export function syncCriticalAttention({ userId, incidents = [], alerts = [], page, onView }) {
  if (!userId) { removeGlobalBanner(); return; }
  const closed = new Set(["closed", "resolved", "rejected", "cancelled", "completed"]);
  const records = new Map(incidents.map((item) => [item.id, item]));
  const ids = new Set(incidents.filter((item) => String(item.severity).toLowerCase() === "critical" && !closed.has(String(item.status).toLowerCase())).map((item) => item.id));
  // Alerts can arrive before the refreshed incident snapshot. Count incidents, not alert rows.
  for (const alert of alerts) {
    if (alert.active && !alert.resolved && String(alert.severity).toLowerCase() === "critical" && alert.incidentId && !records.has(alert.incidentId)) ids.add(alert.incidentId);
  }
  const key = String(userId);
  let seen = criticalSeen.get(key);
  if (!seen) {
    try {
      const stored = JSON.parse(document.defaultView.sessionStorage.getItem(criticalSeenKey(key)) || "[]");
      seen = new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : []);
    } catch { seen = new Set(); }
  }
  seen = new Set([...seen].filter((id) => ids.has(id)));
  const bannerHadFocus = document.getElementById("global-critical-banner")?.contains(document.activeElement);
  if (page === "incident-command") ids.forEach((id) => seen.add(id));
  criticalSeen.set(key, seen);
  try { document.defaultView.sessionStorage.setItem(criticalSeenKey(key), JSON.stringify([...seen])); } catch { /* In-memory fallback stays user-scoped. */ }
  const unseen = [...ids].filter((id) => !seen.has(id)).length;
  if (page === "incident-command" || !unseen) removeGlobalBanner();
  else createGlobalBanner(ids.size, onView);
  const summary = document.getElementById("command-critical-summary");
  if (summary) {
    summary.hidden = ids.size === 0;
    summary.querySelector("[data-critical-count]").textContent = `${ids.size} incident${ids.size === 1 ? "" : "s"} require${ids.size === 1 ? "s" : ""} attention`;
  }
  if (bannerHadFocus && page === "incident-command") {
    const heading = document.getElementById("viewTitle");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
  }
}

function syncCriticalBannerOffset(banner) {
  const height = banner && !banner.hidden ? Math.ceil(banner.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty("--critical-banner-height", `${height}px`);
}

export function createCriticalModal(alert, onView, onAcknowledge) {
  document.querySelectorAll(".persistent-modal-overlay").forEach((existing) => existing.remove());
  const modal = document.createElement("div");
  modal.className = "persistent-modal-overlay";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "critical-modal-title");
  modal.innerHTML = `
    <div class="persistent-modal critical-modal">
      <div class="modal-header">
        <span class="modal-icon" aria-hidden="true">🚨</span>
        <h2 id="critical-modal-title">${escapeHtml(alert.title)}</h2>
      </div>
      <div class="modal-body">
        <p class="modal-message">${escapeHtml(alert.message)}</p>
        <div class="modal-meta">
          <span class="severity-badge severity-${alert.severity.toLowerCase()}">${alert.severity}</span>
          <span class="escalation-badge escalation-${alert.escalationLevel.toLowerCase()}">${alert.escalationLevel}</span>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary btn-view-incident" data-incident-id="${escapeHtml(alert.incidentId)}">VIEW INCIDENT</button>
        <button type="button" class="btn btn-secondary btn-acknowledge" data-alert-id="${escapeHtml(alert.id)}">ACKNOWLEDGE</button>
      </div>
    </div>
  `;

  modal.querySelector(".btn-view-incident").addEventListener("click", () => {
    onView(alert.incidentId);
    modal.remove();
  });

  modal.querySelector(".btn-acknowledge").addEventListener("click", () => {
    onAcknowledge(alert.id);
  });

  document.body.appendChild(modal);
  return modal;
}

export function createGlobalBanner(activeCriticalCount, onClick) {
  let banner = document.getElementById("global-critical-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "global-critical-banner";
    banner.className = "global-critical-banner";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    document.body.insertBefore(banner, document.body.firstChild);
  }

  if (!banner.querySelector(".banner-action")) {
    banner.innerHTML = `
      <span class="banner-icon" aria-hidden="true">!</span>
      <span class="banner-text"><strong>Critical attention required</strong><span class="banner-count"></span></span>
      <button type="button" class="banner-action" aria-label="View critical incidents">View queue</button>
    `;
  }
  if (activeCriticalCount > 0) {
    banner.querySelector(".banner-count").textContent = `${activeCriticalCount} incident${activeCriticalCount === 1 ? " needs" : "s need"} review`;
    banner.hidden = false;
    banner.querySelector(".banner-action").onclick = onClick;
  } else {
    banner.hidden = true;
  }

  syncCriticalBannerOffset(banner);
  if (typeof ResizeObserver !== "undefined") {
    criticalBannerResizeObserver?.disconnect();
    criticalBannerResizeObserver = new ResizeObserver(() => syncCriticalBannerOffset(banner));
    criticalBannerResizeObserver.observe(banner);
  }

  return banner;
}

function createRequiresAttentionSummaryPanel(alerts, onItemClick) {
  let panel = document.getElementById("requires-attention-panel");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "requires-attention-panel";
    panel.className = "requires-attention-panel";
    panel.innerHTML = `
      <h3>REQUIRES ATTENTION</h3>
      <ul class="attention-list" role="list"></ul>
    `;
  }

  const list = panel.querySelector(".attention-list");
  list.innerHTML = "";

  const criticalUnassigned = alerts.filter(a => a.alertType === "ASSIGNMENT_BREACH" && a.active).length;
  const responseBreached = alerts.filter(a => a.alertType === "RESPONSE_BREACH" && a.active).length;
  const highNearSla = alerts.filter(a => a.alertType === "ASSIGNMENT_WARNING" && a.active && a.severity === "HIGH").length;
  const investigationOverdue = alerts.filter(a => (a.alertType === "INVESTIGATION_MISSING_IO" || a.alertType === "INVESTIGATION_INACTIVE") && a.active).length;

  const items = [
    { count: criticalUnassigned, label: "Critical incidents unassigned", icon: "🔴", type: "critical_unassigned", severity: "critical" },
    { count: responseBreached, label: "Response SLA breached", icon: "🔴", type: "response_breached", severity: "critical" },
    { count: highNearSla, label: "High-priority incidents near SLA", icon: "🟠", type: "high_near_sla", severity: "high" },
    { count: investigationOverdue, label: "Investigations without recent updates", icon: "🟡", type: "investigation_overdue", severity: "medium" }
  ];

  items.forEach((item) => {
    if (item.count > 0) {
      const li = document.createElement("li");
      li.className = `attention-item attention-${item.severity}`;
      li.dataset.type = item.type;
      li.innerHTML = `
        <span class="attention-icon" aria-hidden="true">${item.icon}</span>
        <span class="attention-count">${item.count}</span>
        <span class="attention-label">${item.label}</span>
      `;
      li.addEventListener("click", () => onItemClick(item.type));
      list.appendChild(li);
    }
  });

  return panel;
}

export function createRequiresAttentionPanel(alerts, onItemClick, onAcknowledge) {
  let panel = document.getElementById("requires-attention-panel");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "requires-attention-panel";
    panel.className = "requires-attention-panel";
    panel.innerHTML = '<h3>REQUIRES ATTENTION</h3><ul class="attention-list" role="list"></ul>';
  }
  const list = panel.querySelector(".attention-list");
  list.textContent = "";
  alerts.filter((alert) => alert.active).forEach((alert) => {
    const item = document.createElement("li");
    item.className = `attention-item attention-${String(alert.severity || "medium").toLowerCase()}`;
    item.dataset.alertId = alert.id;
    item.innerHTML = `
      <strong>${escapeHtml(alert.title)}</strong>
      <span class="attention-label">${escapeHtml(alert.incidentId)} · ${escapeHtml(alert.message)}</span>
      <span class="attention-actions">
        <button type="button" data-action="view">VIEW INCIDENT</button>
        ${alert.alertType === "ASSIGNMENT_BREACH" ? '<button type="button" data-action="assign">ASSIGN TEAM</button>' : ""}
        <button type="button" data-action="ack" ${alert.acknowledged ? "disabled" : ""}>${alert.acknowledged ? "ACKNOWLEDGED" : "ACKNOWLEDGE"}</button>
      </span>`;
    item.querySelector('[data-action="view"]')?.addEventListener("click", () => onItemClick(alert.incidentId));
    item.querySelector('[data-action="assign"]')?.addEventListener("click", () => onItemClick(alert.incidentId));
    item.querySelector('[data-action="ack"]')?.addEventListener("click", () => onAcknowledge(alert.id));
    list.appendChild(item);
  });
  if (!list.children.length) list.innerHTML = '<li class="attention-empty">No active escalation alerts.</li>';
  return panel;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function updateCriticalModal(alert) {
  const existing = document.querySelector(".persistent-modal-overlay");
  if (existing) existing.remove();
}

export function removeGlobalBanner() {
  const banner = document.getElementById("global-critical-banner");
  if (banner) banner.hidden = true;
  criticalBannerResizeObserver?.disconnect();
  criticalBannerResizeObserver = null;
  syncCriticalBannerOffset(null);
}

export function removeRequiresAttentionPanel() {
  const panel = document.getElementById("requires-attention-panel");
  if (panel) panel.remove();
}
