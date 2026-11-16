export function createSlaStatusDisplay(incident, slaConfig) {
  const container = document.createElement("div");
  container.className = "sla-status-container";

  const assignmentStatus = getAssignmentSlaStatus(incident, slaConfig);
  const responseStatus = getResponseSlaStatus(incident, slaConfig);

  let statusHtml = "";
  let statusClass = "sla-within";

  if (assignmentStatus.status === "BREACHED") {
    statusHtml = `ASSIGNMENT SLA BREACHED — ${assignmentStatus.overdueMinutes}m OVERDUE`;
    statusClass = "sla-breached";
  } else if (assignmentStatus.status === "WARNING") {
    statusHtml = `ASSIGNMENT DUE IN ${formatCountdown(assignmentStatus.remainingMs)}`;
    statusClass = "sla-warning";
  } else if (assignmentStatus.status === "ASSIGNED") {
    if (responseStatus.status === "BREACHED") {
      statusHtml = `RESPONSE SLA BREACHED — ${responseStatus.overdueMinutes}m OVERDUE`;
      statusClass = "sla-breached";
    } else if (responseStatus.status === "WARNING") {
      statusHtml = `RESPONSE DUE IN ${formatCountdown(responseStatus.remainingMs)}`;
      statusClass = "sla-warning";
    } else if (responseStatus.status === "EN_ROUTE") {
      statusHtml = `EN ROUTE — RESPONSE DUE IN ${formatCountdown(responseStatus.remainingMs)}`;
      statusClass = "sla-within";
    } else if (responseStatus.status === "ON_SCENE") {
      statusHtml = "ON SCENE";
      statusClass = "sla-complete";
    } else if (assignmentStatus.status === "WITHIN_SLA") {
      statusHtml = `WITHIN SLA — ASSIGNMENT IN ${formatCountdown(assignmentStatus.remainingMs)}`;
      statusClass = "sla-within";
    } else {
      statusHtml = "ASSIGNED — AWAITING EN ROUTE";
      statusClass = "sla-within";
    }
  } else if (assignmentStatus.status === "WITHIN_SLA") {
    statusHtml = `WITHIN SLA — ASSIGNMENT IN ${formatCountdown(assignmentStatus.remainingMs)}`;
    statusClass = "sla-within";
  } else if (assignmentStatus.status === "NO_DEADLINE") {
    statusHtml = "SLA NOT STARTED";
    statusClass = "sla-none";
  }

  container.innerHTML = `
    <div class="sla-status ${statusClass}">
      <span class="sla-status-text">${statusHtml}</span>
    </div>
    <div class="sla-deadlines" aria-hidden="true">
      ${incident.assignmentDeadline ? `<span class="deadline">Assign by: ${formatDeadline(incident.assignmentDeadline)}</span>` : ""}
      ${incident.responseDeadline ? `<span class="deadline">Response by: ${formatDeadline(incident.responseDeadline)}</span>` : ""}
    </div>
  `;

  return container;
}

export function createSeverityBadge(severity) {
  const badge = document.createElement("span");
  badge.className = `severity-badge severity-${severity.toLowerCase()}`;
  badge.textContent = severity;
  return badge;
}

export function createEscalationBadge(level) {
  const badge = document.createElement("span");
  badge.className = `escalation-badge escalation-${level.toLowerCase()}`;
  badge.textContent = level;
  return badge;
}

function getAssignmentSlaStatus(incident, slaConfig) {
  if (!incident.assignmentDeadline) return { status: "NO_DEADLINE", overdue: false };

  const deadline = new Date(incident.assignmentDeadline).getTime();
  const config = slaConfig?.find((c) => c.severity === incident.severity) || slaConfig?.find((c) => c.severity === "MEDIUM");
  const warningTime = deadline - (config?.warningBeforeAssignmentMinutes || 1) * 60 * 1000;
  const now = Date.now();

  const hasAssignedUnit = Boolean(incident.assignedUnitId);

  if (hasAssignedUnit) {
    return { status: "ASSIGNED", overdue: false, remainingMs: 0 };
  }

  if (now >= deadline) {
    return { status: "BREACHED", overdue: true, overdueMs: now - deadline, overdueMinutes: Math.ceil((now - deadline) / 60000) };
  }

  if (now >= warningTime) {
    return { status: "WARNING", overdue: false, remainingMs: deadline - now, remainingMinutes: Math.ceil((deadline - now) / 60000) };
  }

  return { status: "WITHIN_SLA", overdue: false, remainingMs: deadline - now, remainingMinutes: Math.ceil((deadline - now) / 60000) };
}

function getResponseSlaStatus(incident, slaConfig) {
  if (!incident.responseDeadline) return { status: "NO_DEADLINE", overdue: false };

  const deadline = new Date(incident.responseDeadline).getTime();
  const config = slaConfig?.find((c) => c.severity === incident.severity) || slaConfig?.find((c) => c.severity === "MEDIUM");
  const warningTime = deadline - (config?.warningBeforeResponseMinutes || 5) * 60 * 1000;
  const now = Date.now();

  const isEnRoute = incident.status === "En Route";
  const isOnScene = incident.status === "On Scene";

  if (isOnScene) {
    return { status: "ON_SCENE", overdue: false, remainingMs: 0 };
  }

  if (isEnRoute) {
    if (now >= deadline) {
      return { status: "BREACHED", overdue: true, overdueMs: now - deadline, overdueMinutes: Math.ceil((now - deadline) / 60000) };
    }
    if (now >= warningTime) {
      return { status: "WARNING", overdue: false, remainingMs: deadline - now, remainingMinutes: Math.ceil((deadline - now) / 60000) };
    }
    return { status: "EN_ROUTE", overdue: false, remainingMs: deadline - now, remainingMinutes: Math.ceil((deadline - now) / 60000) };
  }

  const hasAssignedUnit = Boolean(incident.assignedUnitId);
  if (!hasAssignedUnit) {
    return { status: "NO_TEAM", overdue: false };
  }

  if (now >= deadline) {
    return { status: "BREACHED", overdue: true, overdueMs: now - deadline, overdueMinutes: Math.ceil((now - deadline) / 60000) };
  }

  if (now >= warningTime) {
    return { status: "WARNING", overdue: false, remainingMs: deadline - now, remainingMinutes: Math.ceil((deadline - now) / 60000) };
  }

  return { status: "WITHIN_SLA", overdue: false, remainingMs: deadline - now, remainingMinutes: Math.ceil((deadline - now) / 60000) };
}

function formatCountdown(ms) {
  if (ms <= 0) return "00:00";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatDeadline(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}