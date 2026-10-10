export function createEscalationQueueView(alerts, onAlertClick, onAcknowledge, onViewIncident) {
  const container = document.createElement("section");
  container.className = "escalation-queue-view";
  container.innerHTML = `
    <header class="queue-header">
      <h2>REQUIRES ATTENTION / ESCALATIONS</h2>
      <div class="queue-filters">
        <select id="queue-filter" aria-label="Filter alerts">
          <option value="all">All</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="breached">Breached</option>
          <option value="escalated">Escalated</option>
          <option value="command">Command Alert</option>
          <option value="investigation">Investigation</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="unacknowledged">Unacknowledged</option>
        </select>
        <select id="queue-sort" aria-label="Sort alerts">
          <option value="escalation_severity_overdue">Escalation → Severity → Overdue</option>
          <option value="severity_escalation_overdue">Severity → Escalation → Overdue</option>
          <option value="overdue_escalation_severity">Overdue → Escalation → Severity</option>
          <option value="created_desc">Newest First</option>
          <option value="created_asc">Oldest First</option>
        </select>
      </div>
    </header>
    <div class="queue-stats" id="queue-stats"></div>
    <ul class="escalation-list" id="escalation-list" role="list"></ul>
    <div class="queue-empty" id="queue-empty" hidden>No alerts match the current filter.</div>
  `;

  const list = container.querySelector("#escalation-list");
  const filterSelect = container.querySelector("#queue-filter");
  const sortSelect = container.querySelector("#queue-sort");
  const emptyMessage = container.querySelector("#queue-empty");
  const statsContainer = container.querySelector("#queue-stats");

  let currentFilter = "all";
  let currentSort = "escalation_severity_overdue";

  function render() {
    let filtered = alerts.filter((alert) => {
      if (currentFilter === "all") return true;
      if (currentFilter === "critical") return alert.severity === "CRITICAL";
      if (currentFilter === "warning") return alert.escalationLevel === "L1";
      if (currentFilter === "breached") return alert.alertType?.endsWith("_BREACH");
      if (currentFilter === "escalated") return ["L2", "L3"].includes(alert.escalationLevel);
      if (currentFilter === "command") return alert.escalationLevel === "L4";
      if (currentFilter === "investigation") return alert.alertType?.startsWith("INVESTIGATION_");
      if (currentFilter === "acknowledged") return alert.acknowledged;
      if (currentFilter === "unacknowledged") return !alert.acknowledged;
      return true;
    });

    filtered = sortAlerts(filtered, currentSort);

    list.innerHTML = "";
    emptyMessage.hidden = filtered.length > 0;

    filtered.forEach((alert) => {
      const li = createAlertListItem(alert);
      list.appendChild(li);
    });

    updateStats(filtered);
  }

  function createAlertListItem(alert) {
    const li = document.createElement("li");
    li.className = `escalation-item escalation-${alert.escalationLevel.toLowerCase()} severity-${alert.severity.toLowerCase()} ${alert.acknowledged ? "acknowledged" : ""} ${alert.resolved ? "resolved" : ""}`;
    li.dataset.alertId = alert.id;

    const timeAgo = formatTimeAgo(alert.createdAt);
    const overdueInfo = getOverdueInfo(alert);

    li.innerHTML = `
      <div class="escalation-main">
        <div class="escalation-badges">
          <span class="severity-badge severity-${alert.severity.toLowerCase()}">${alert.severity}</span>
          <span class="escalation-badge escalation-${alert.escalationLevel.toLowerCase()}">${alert.escalationLevel}</span>
          ${alert.acknowledged ? '<span class="ack-badge">ACK</span>' : ''}
          ${alert.resolved ? '<span class="resolved-badge">RESOLVED</span>' : ''}
        </div>
        <h3 class="escalation-title">${escapeHtml(alert.title)}</h3>
        <p class="escalation-message">${escapeHtml(alert.message)}</p>
        <div class="escalation-meta">
          <span class="escalation-time">${timeAgo}</span>
          ${overdueInfo ? `<span class="escalation-overdue">${overdueInfo}</span>` : ""}
          <span class="escalation-type">${formatAlertType(alert.alertType)}</span>
        </div>
      </div>
      <div class="escalation-actions">
        ${!alert.acknowledged ? `<button type="button" class="btn btn-sm btn-ack" data-action="acknowledge" aria-label="Acknowledge alert">ACKNOWLEDGE</button>` : ""}
        <button type="button" class="btn btn-sm btn-view" data-action="view" aria-label="View incident">VIEW INCIDENT</button>
      </div>
    `;

    li.querySelector("[data-action='acknowledge']")?.addEventListener("click", (e) => {
      e.stopPropagation();
      onAcknowledge(alert.id);
    });

    li.querySelector("[data-action='view']")?.addEventListener("click", (e) => {
      e.stopPropagation();
      onViewIncident(alert.incidentId);
    });

    li.addEventListener("click", () => onAlertClick(alert));

    return li;
  }

  function updateStats(filtered) {
    const critical = filtered.filter(a => a.severity === "CRITICAL" && a.active).length;
    const breached = filtered.filter(a => a.alertType?.endsWith("_BREACH") && a.active).length;
    const unack = filtered.filter(a => !a.acknowledged && a.active).length;

    statsContainer.innerHTML = `
      <span class="stat critical">🔴 ${critical} Critical</span>
      <span class="stat breached">⚠ ${breached} Breached</span>
      <span class="stat unack">📢 ${unack} Unacknowledged</span>
      <span class="stat total">📋 ${filtered.length} Total</span>
    `;
  }

  filterSelect.addEventListener("change", (e) => {
    currentFilter = e.target.value;
    render();
  });

  sortSelect.addEventListener("change", (e) => {
    currentSort = e.target.value;
    render();
  });

  render();

  return {
    element: container,
    refresh: render,
    setAlerts: (newAlerts) => {
      alerts = newAlerts;
      render();
    }
  };
}

function sortAlerts(alerts, sortBy) {
  const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const escalationOrder = { L4: 0, L3: 1, L2: 2, L1: 3, L0: 4 };

  return [...alerts].sort((a, b) => {
    if (sortBy === "escalation_severity_overdue") {
      const escDiff = escalationOrder[a.escalationLevel] - escalationOrder[b.escalationLevel];
      if (escDiff !== 0) return escDiff;
      const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (sevDiff !== 0) return sevDiff;
      return getOverdueMs(b) - getOverdueMs(a);
    }
    if (sortBy === "severity_escalation_overdue") {
      const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (sevDiff !== 0) return sevDiff;
      const escDiff = escalationOrder[a.escalationLevel] - escalationOrder[b.escalationLevel];
      if (escDiff !== 0) return escDiff;
      return getOverdueMs(b) - getOverdueMs(a);
    }
    if (sortBy === "overdue_escalation_severity") {
      const overdueDiff = getOverdueMs(b) - getOverdueMs(a);
      if (overdueDiff !== 0) return overdueDiff;
      const escDiff = escalationOrder[a.escalationLevel] - escalationOrder[b.escalationLevel];
      if (escDiff !== 0) return escDiff;
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    if (sortBy === "created_desc") {
      return new Date(b.createdAt) - new Date(a.createdAt);
    }
    if (sortBy === "created_asc") {
      return new Date(a.createdAt) - new Date(b.createdAt);
    }
    return 0;
  });
}

function getOverdueMs(alert) {
  if (alert.alertType?.endsWith("_BREACH")) {
    const match = alert.message.match(/(\d+)\s*minutes?\s*OVERDUE/i);
    if (match) return parseInt(match[1]) * 60000;
  }
  return 0;
}

function getOverdueInfo(alert) {
  if (alert.alertType?.endsWith("_BREACH")) {
    const match = alert.message.match(/(\d+)\s*minutes?\s*OVERDUE/i);
    if (match) return `${match[1]}m overdue`;
  }
  return null;
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

function formatAlertType(type) {
  return type
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}