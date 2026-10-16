const crypto = require("node:crypto");

function uid(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function now() {
  return new Date().toISOString();
}

const SEVERITY_LEVELS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const ESCALATION_LEVELS = ["L0", "L1", "L2", "L3", "L4"];

function normalized(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function getSeverityRecommendation(incident, rules) {
  if (!rules || !rules.length) return "MEDIUM";

  const searchText = [
    incident.title,
    incident.type,
    incident.category,
    incident.description,
    incident.threatType
  ].filter(Boolean).join(" ").toLowerCase();

  const incidentType = normalized(incident.type || incident.category || "general");

  const matchingRules = rules
    .filter((rule) => rule.active)
    .filter((rule) => {
      if (rule.incidentType && normalized(rule.incidentType) === incidentType) return true;
      if (rule.keywords && rule.keywords.length) {
        return rule.keywords.some((keyword) => searchText.includes(String(keyword).toLowerCase()));
      }
      return false;
    })
    .sort((a, b) => b.priority - a.priority);

  if (matchingRules.length) {
    return matchingRules[0].recommendedSeverity;
  }

  return "MEDIUM";
}

function calculateSlaDeadlines(incident, slaConfig) {
  const config = slaConfig?.find((c) => c.severity === incident.severity) || slaConfig?.find((c) => c.severity === "MEDIUM");
  if (!config) {
    return {
      assignmentDeadline: null,
      responseDeadline: null
    };
  }

  const createdAt = new Date(incident.createdAt || incident.updatedAt || now()).getTime();
  const assignmentDeadline = new Date(createdAt + config.assignmentSlaMinutes * 60 * 1000).toISOString();
  const responseDeadline = new Date(createdAt + config.responseSlaMinutes * 60 * 1000).toISOString();

  return {
    assignmentDeadline,
    responseDeadline,
    assignmentSlaMinutes: config.assignmentSlaMinutes,
    responseSlaMinutes: config.responseSlaMinutes
  };
}

function getEscalationLevel(incident, slaConfig, currentTime = Date.now()) {
  if (!incident.assignmentDeadline && !incident.responseDeadline) return "L0";

  const config = slaConfig?.find((c) => c.severity === incident.severity) || slaConfig?.find((c) => c.severity === "MEDIUM");
  if (!config) return "L0";

  const assignmentDeadline = incident.assignmentDeadline ? new Date(incident.assignmentDeadline).getTime() : null;
  const responseDeadline = incident.responseDeadline ? new Date(incident.responseDeadline).getTime() : null;

  const hasAssignedUnit = Boolean(incident.assignedUnitId);
  const isEnRoute = incident.status === "En Route";
  const isOnScene = incident.status === "On Scene";

  let level = "L0";

  if (assignmentDeadline) {
    const assignmentWarningTime = assignmentDeadline - config.warningBeforeAssignmentMinutes * 60 * 1000;

    if (!hasAssignedUnit) {
      if (currentTime >= assignmentDeadline) {
        level = "L2";
      } else if (currentTime >= assignmentWarningTime) {
        level = "L1";
      }
    } else if (!isEnRoute && !isOnScene) {
      const responseWarningTime = responseDeadline - config.warningBeforeResponseMinutes * 60 * 1000;
      if (responseDeadline && currentTime >= responseDeadline) {
        level = "L2";
      } else if (responseDeadline && currentTime >= responseWarningTime) {
        level = "L1";
      }
    }
  }

  if (level === "L2") {
    const assignmentBreach = !hasAssignedUnit && assignmentDeadline && currentTime >= assignmentDeadline
      ? Date.parse(incident.assignmentBreachedAt || incident.escalationL2At || incident.assignmentDeadline)
      : NaN;
    const responseBreach = hasAssignedUnit && !isOnScene && responseDeadline && currentTime >= responseDeadline
      ? Date.parse(incident.responseBreachedAt || incident.escalationL2At || incident.responseDeadline)
      : NaN;
    const breachAt = [assignmentBreach, responseBreach].filter(Number.isFinite).sort((a, b) => a - b)[0];
    if (Number.isFinite(breachAt)) {
      const l3At = breachAt + Number(config.escalationL3IntervalMinutes || 0) * 60 * 1000;
      const l4At = l3At + Number(config.escalationL4IntervalMinutes || 0) * 60 * 1000;
      if (currentTime >= l4At) level = "L4";
      else if (currentTime >= l3At) level = "L3";
    }
  }

  const storedLevel = ESCALATION_LEVELS.includes(incident.escalationLevel) ? incident.escalationLevel : "L0";
  return ESCALATION_LEVELS.indexOf(storedLevel) > ESCALATION_LEVELS.indexOf(level) ? storedLevel : level;
}

function shouldGenerateEscalationAlert(incident, alertType, escalationLevel, existingAlerts) {
  const uniqueKey = `${incident.id}:${alertType}:${escalationLevel}`;
  return !existingAlerts.some((alert) => alert.uniqueKey === uniqueKey);
}

function createEscalationAlert(incident, alertType, escalationLevel, title, message, severity) {
  const uniqueKey = `${incident.id}:${alertType}:${escalationLevel}`;
  return {
    id: uid("esc_alert"),
    incidentId: incident.id,
    alertType,
    severity,
    escalationLevel,
    title,
    message,
    uniqueKey,
    acknowledged: false,
    resolved: false,
    active: true,
    createdAt: now(),
    updatedAt: now()
  };
}

function getAssignmentSlaStatus(incident, slaConfig, currentTime = Date.now()) {
  if (!incident.assignmentDeadline) return { status: "NO_DEADLINE", overdue: false };

  const deadline = new Date(incident.assignmentDeadline).getTime();
  const config = slaConfig?.find((c) => c.severity === incident.severity) || slaConfig?.find((c) => c.severity === "MEDIUM");
  const warningTime = deadline - (config?.warningBeforeAssignmentMinutes || 1) * 60 * 1000;

  const hasAssignedUnit = Boolean(incident.assignedUnitId);

  if (hasAssignedUnit) {
    return { status: "ASSIGNED", overdue: false, remainingMs: 0 };
  }

  if (currentTime >= deadline) {
    const overdueMs = currentTime - deadline;
    return { status: "BREACHED", overdue: true, overdueMs, overdueMinutes: Math.ceil(overdueMs / 60000) };
  }

  if (currentTime >= warningTime) {
    const remainingMs = deadline - currentTime;
    return { status: "WARNING", overdue: false, remainingMs, remainingMinutes: Math.ceil(remainingMs / 60000) };
  }

  const remainingMs = deadline - currentTime;
  return { status: "WITHIN_SLA", overdue: false, remainingMs, remainingMinutes: Math.ceil(remainingMs / 60000) };
}

function getResponseSlaStatus(incident, slaConfig, currentTime = Date.now()) {
  if (!incident.responseDeadline) return { status: "NO_DEADLINE", overdue: false };

  const deadline = new Date(incident.responseDeadline).getTime();
  const config = slaConfig?.find((c) => c.severity === incident.severity) || slaConfig?.find((c) => c.severity === "MEDIUM");
  const warningTime = deadline - (config?.warningBeforeResponseMinutes || 5) * 60 * 1000;

  const isEnRoute = incident.status === "En Route";
  const isOnScene = incident.status === "On Scene";

  if (isOnScene) {
    return { status: "ON_SCENE", overdue: false, remainingMs: 0 };
  }

  if (isEnRoute) {
    if (currentTime >= deadline) {
      const overdueMs = currentTime - deadline;
      return { status: "BREACHED", overdue: true, overdueMs, overdueMinutes: Math.ceil(overdueMs / 60000) };
    }
    if (currentTime >= warningTime) {
      const remainingMs = deadline - currentTime;
      return { status: "WARNING", overdue: false, remainingMs, remainingMinutes: Math.ceil(remainingMs / 60000) };
    }
    const remainingMs = deadline - currentTime;
    return { status: "EN_ROUTE", overdue: false, remainingMs, remainingMinutes: Math.ceil(remainingMs / 60000) };
  }

  const hasAssignedUnit = Boolean(incident.assignedUnitId);
  if (!hasAssignedUnit) {
    return { status: "NO_TEAM", overdue: false };
  }

  if (currentTime >= deadline) {
    const overdueMs = currentTime - deadline;
    return { status: "BREACHED", overdue: true, overdueMs, overdueMinutes: Math.ceil(overdueMs / 60000) };
  }

  if (currentTime >= warningTime) {
    const remainingMs = deadline - currentTime;
    return { status: "WARNING", overdue: false, remainingMs, remainingMinutes: Math.ceil(remainingMs / 60000) };
  }

  const remainingMs = deadline - currentTime;
  return { status: "WITHIN_SLA", overdue: false, remainingMs, remainingMinutes: Math.ceil(remainingMs / 60000) };
}

function requiresInvestigation(incident, investigationCategories) {
  if (!investigationCategories || !investigationCategories.length) return false;

  const incidentType = normalized(incident.type || incident.category || "");
  const incidentTitle = (incident.title || "").toLowerCase();

  return investigationCategories.some((cat) =>
    cat.active &&
    cat.requiresInvestigation &&
    cat.incidentTypes.some((type) =>
      normalized(type) === incidentType ||
      incidentTitle.includes(normalized(type))
    )
  );
}

function getInvestigationInactivityThreshold(incident, slaConfig) {
  const config = slaConfig?.find((c) => c.severity === incident.severity) || slaConfig?.find((c) => c.severity === "MEDIUM");
  return config?.investigationInactivityThresholdHours || 24;
}

function isInvestigationInactive(incident, slaConfig, currentTime = Date.now()) {
  if (!incident.investigationRequired || incident.investigationStatus === "NOT_REQUIRED" || incident.investigationStatus === "COMPLETED") {
    return false;
  }

  if (!incident.lastInvestigationUpdateAt && !incident.investigationStartedAt) {
    return false;
  }

  const lastUpdate = incident.lastInvestigationUpdateAt
    ? new Date(incident.lastInvestigationUpdateAt).getTime()
    : new Date(incident.investigationStartedAt || incident.createdAt).getTime();

  const thresholdHours = getInvestigationInactivityThreshold(incident, slaConfig);
  const thresholdMs = thresholdHours * 60 * 60 * 1000;

  return (currentTime - lastUpdate) >= thresholdMs;
}

function isInvestigationOfficerMissing(incident) {
  if (!incident.investigationRequired) return false;
  if (incident.investigationStatus === "NOT_REQUIRED" || incident.investigationStatus === "COMPLETED") return false;
  return !incident.investigatingOfficerId;
}

module.exports = {
  SEVERITY_LEVELS,
  ESCALATION_LEVELS,
  getSeverityRecommendation,
  calculateSlaDeadlines,
  getEscalationLevel,
  shouldGenerateEscalationAlert,
  createEscalationAlert,
  getAssignmentSlaStatus,
  getResponseSlaStatus,
  requiresInvestigation,
  getInvestigationInactivityThreshold,
  isInvestigationInactive,
  isInvestigationOfficerMissing
};
