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

  if (activeCriticalCount > 0) {
    banner.innerHTML = `
      <span class="banner-icon" aria-hidden="true">🚨</span>
      <span class="banner-text">${activeCriticalCount} CRITICAL INCIDENT${activeCriticalCount !== 1 ? "S" : ""} REQUIRE ACTION</span>
      <button type="button" class="banner-action" aria-label="View critical incidents">VIEW QUEUE</button>
    `;
    banner.hidden = false;
    banner.querySelector(".banner-action").addEventListener("click", onClick);
  } else {
    banner.hidden = true;
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
}

export function removeRequiresAttentionPanel() {
  const panel = document.getElementById("requires-attention-panel");
  if (panel) panel.remove();
}
