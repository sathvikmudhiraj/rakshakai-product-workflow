export function createInvestigationMonitor(incidents, onAssignOfficer, onUpdateInvestigation, onViewIncident) {
  const container = document.createElement("section");
  container.className = "investigation-monitor";
  container.innerHTML = `
    <header class="monitor-header">
      <h2>INVESTIGATION MONITORING</h2>
      <div class="monitor-filters">
        <select id="inv-filter" aria-label="Filter investigations">
          <option value="all">All</option>
          <option value="required">Requiring Investigation</option>
          <option value="missing_io">Missing Investigating Officer</option>
          <option value="inactive">Inactive / Overdue</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
        </select>
      </div>
    </header>
    <div class="monitor-stats" id="inv-stats"></div>
    <ul class="investigation-list" id="inv-list" role="list"></ul>
    <div class="monitor-empty" id="inv-empty" hidden>No investigations match the current filter.</div>
  `;

  const list = container.querySelector("#inv-list");
  const filterSelect = container.querySelector("#inv-filter");
  const emptyMessage = container.querySelector("#inv-empty");
  const statsContainer = container.querySelector("#inv-stats");

  let currentFilter = "all";

  function render() {
    let filtered = incidents.filter((inc) => {
      if (!inc.investigationRequired) return false;
      if (currentFilter === "all") return true;
      if (currentFilter === "required") return inc.investigationStatus === "NOT_STARTED";
      if (currentFilter === "missing_io") return !inc.investigatingOfficerId && inc.investigationStatus !== "COMPLETED";
      if (currentFilter === "inactive") return inc.investigationStatus === "ACTIVE" && isInvestigationInactive(inc);
      if (currentFilter === "active") return inc.investigationStatus === "ACTIVE";
      if (currentFilter === "completed") return inc.investigationStatus === "COMPLETED";
      return true;
    });

    list.innerHTML = "";
    emptyMessage.hidden = filtered.length > 0;

    filtered.forEach((inc) => {
      const li = createInvestigationListItem(inc);
      list.appendChild(li);
    });

    updateStats(filtered);
  }

  function createInvestigationListItem(inc) {
    const li = document.createElement("li");
    li.className = `investigation-item investigation-${inc.investigationStatus.toLowerCase().replace("_", "-")} ${inc.investigatingOfficerId ? "has-io" : "missing-io"} ${isInvestigationInactive(inc) ? "inactive" : ""}`;
    li.dataset.incidentId = inc.id;

    const inactiveSince = inc.lastInvestigationUpdateAt
      ? formatTimeAgo(inc.lastInvestigationUpdateAt)
      : inc.investigationStartedAt
        ? formatTimeAgo(inc.investigationStartedAt)
        : "Never updated";

    li.innerHTML = `
      <div class="investigation-main">
        <div class="investigation-badges">
          <span class="severity-badge severity-${inc.severity.toLowerCase()}">${inc.severity}</span>
          <span class="inv-status-badge status-${inc.investigationStatus.toLowerCase().replace("_", "-")}">${formatInvestigationStatus(inc.investigationStatus)}</span>
          ${!inc.investigatingOfficerId ? '<span class="missing-io-badge">NO IO</span>' : ""}
          ${isInvestigationInactive(inc) ? '<span class="inactive-badge">INACTIVE</span>' : ""}
        </div>
        <h3 class="investigation-title">${escapeHtml(inc.title || inc.id)}</h3>
        <p class="investigation-type">${escapeHtml(inc.type || "Unknown")}</p>
        <div class="investigation-meta">
          <span class="inv-incident-id">${inc.id}</span>
          <span class="inv-io">${inc.investigatingOfficerId ? `IO: ${inc.investigatingOfficerId}` : "No Investigating Officer assigned"}</span>
          <span class="inv-last-update">Last update: ${inactiveSince}</span>
          ${inc.investigationDeadline ? `<span class="inv-deadline">Deadline: ${formatDeadline(inc.investigationDeadline)}</span>` : ""}
        </div>
      </div>
      <div class="investigation-actions">
        ${!inc.investigatingOfficerId ? `<button type="button" class="btn btn-sm btn-assign-io" data-action="assign_io" aria-label="Assign Investigating Officer">ASSIGN IO</button>` : ""}
        ${inc.investigationStatus === "ACTIVE" ? `<button type="button" class="btn btn-sm btn-update" data-action="update" aria-label="Add investigation update">ADD UPDATE</button>` : ""}
        <button type="button" class="btn btn-sm btn-view" data-action="view" aria-label="View incident">VIEW INCIDENT</button>
      </div>
    `;

    li.querySelector("[data-action='assign_io']")?.addEventListener("click", (e) => {
      e.stopPropagation();
      onAssignOfficer(inc.id);
    });

    li.querySelector("[data-action='update']")?.addEventListener("click", (e) => {
      e.stopPropagation();
      onUpdateInvestigation(inc.id);
    });

    li.querySelector("[data-action='view']")?.addEventListener("click", (e) => {
      e.stopPropagation();
      onViewIncident(inc.id);
    });

    li.addEventListener("click", () => onViewIncident(inc.id));

    return li;
  }

  function updateStats(filtered) {
    const missingIO = filtered.filter(i => !i.investigatingOfficerId).length;
    const inactive = filtered.filter(i => isInvestigationInactive(i)).length;
    const active = filtered.filter(i => i.investigationStatus === "ACTIVE" && i.investigatingOfficerId && !isInvestigationInactive(i)).length;
    const completed = filtered.filter(i => i.investigationStatus === "COMPLETED").length;

    statsContainer.innerHTML = `
      <span class="stat missing-io">👮 ${missingIO} Missing IO</span>
      <span class="stat inactive">⏱ ${inactive} Inactive</span>
      <span class="stat active">🔍 ${active} Active</span>
      <span class="stat completed">✓ ${completed} Completed</span>
      <span class="stat total">📋 ${filtered.length} Total</span>
    `;
  }

  filterSelect.addEventListener("change", (e) => {
    currentFilter = e.target.value;
    render();
  });

  function isInvestigationInactive(inc) {
    if (!inc.investigationRequired || inc.investigationStatus === "COMPLETED") return false;
    if (!inc.lastInvestigationUpdateAt && !inc.investigationStartedAt) return true;

    const lastUpdate = inc.lastInvestigationUpdateAt
      ? new Date(inc.lastInvestigationUpdateAt).getTime()
      : new Date(inc.investigationStartedAt || inc.createdAt).getTime();

    const thresholdHours = 24;
    const thresholdMs = thresholdHours * 60 * 60 * 1000;

    return (Date.now() - lastUpdate) >= thresholdMs;
  }

  function formatInvestigationStatus(status) {
    return status
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function formatTimeAgo(isoString) {
    const diff = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ago`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "Just now";
  }

  function formatDeadline(isoString) {
    const date = new Date(isoString);
    return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  render();

  return {
    element: container,
    refresh: render,
    setIncidents: (newIncidents) => {
      incidents = newIncidents;
      render();
    }
  };
}