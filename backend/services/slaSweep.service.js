const ESCALATION_LEVELS = ["L0", "L1", "L2", "L3", "L4"];

async function runSlaSweep({
  db,
  currentTime = Date.now(),
  uid,
  normalizedIncidentValue,
  getAssignmentSlaStatus,
  getResponseSlaStatus,
  getEscalationLevel,
  requiresInvestigation,
  isInvestigationOfficerMissing,
  isInvestigationInactive
}) {
  const currentIso = new Date(currentTime).toISOString();
  const createdAlerts = [];
  const resolvedAlerts = [];
  const results = [];
  let changed = false;
  const levelIndex = (level) => ESCALATION_LEVELS.indexOf(level);
  const terminalStatuses = new Set(["closed", "resolved", "rejected / false alarm"]);
  db.escalationAlerts ||= [];
  db.incidentTimeline ||= [];

  const addTimeline = (incident, eventType, description, metadata = {}) => {
    db.incidentTimeline.unshift({
      id: uid("timeline"), incidentId: incident.id, eventType,
      actorId: null, actorName: "SLA Scheduler", actorRole: "System",
      description, metadata, createdAt: currentIso
    });
    changed = true;
  };

  const resolveAlert = (incident, alert, reason) => {
    if (!alert.active) return;
    Object.assign(alert, {
      active: false, resolved: true, resolvedAt: currentIso,
      resolvedBy: "system:sla-scheduler", updatedAt: currentIso
    });
    resolvedAlerts.push(alert);
    addTimeline(incident, "ESCALATION_ALERT_RESOLVED", `${alert.title}: ${reason}`, {
      alertId: alert.id, alertType: alert.alertType,
      escalationLevel: alert.escalationLevel, reason
    });
  };

  for (const incident of db.incidents || []) {
    const resolvedAtStart = resolvedAlerts.length;
    const alertsAtStart = createdAlerts.length;
    const incidentAlerts = () => db.escalationAlerts.filter((alert) => alert.incidentId === incident.id);
    if (terminalStatuses.has(normalizedIncidentValue(incident.status))) {
      incidentAlerts().filter((alert) => alert.active)
        .forEach((alert) => resolveAlert(incident, alert, `Incident status is ${incident.status}`));
      results.push({ incidentId: incident.id, skipped: "terminal", alertsCreated: 0, alertsResolved: resolvedAlerts.length - resolvedAtStart });
      continue;
    }

    const slaConfig = db.slaConfig || [];
    const assignmentStatus = getAssignmentSlaStatus(incident, slaConfig, currentTime);
    const responseStatus = getResponseSlaStatus(incident, slaConfig, currentTime);
    const newLevel = getEscalationLevel(incident, slaConfig, currentTime);
    const investigationRequired = requiresInvestigation(incident, db.investigationCategories || []);

    if (investigationRequired && !incident.investigationRequired) {
      incident.investigationRequired = true;
      incident.investigationStatus = "NOT_STARTED";
      incident.updatedAt = currentIso;
      addTimeline(incident, "INVESTIGATION_REQUIRED", "Serious incident entered investigation monitoring");
    }

    const ioMissing = isInvestigationOfficerMissing(incident);
    const investigationInactive = isInvestigationInactive(incident, slaConfig, currentTime);
    const queueAlert = (alertType, escalationLevel, title, message) => {
      const uniqueKey = `${incident.id}:${alertType}:${escalationLevel}`;
      if (db.escalationAlerts.some((alert) => alert.uniqueKey === uniqueKey)) return;
      const alert = {
        id: uid("esc_alert"), incidentId: incident.id, alertType,
        severity: incident.severity, escalationLevel, title, message, uniqueKey,
        acknowledged: false, resolved: false, active: true,
        createdAt: currentIso, updatedAt: currentIso
      };
      db.escalationAlerts.unshift(alert);
      createdAlerts.push(alert);
      addTimeline(incident, "ESCALATION_ALERT_CREATED", alert.title, {
        alertId: alert.id, alertType, escalationLevel
      });
    };

    if (assignmentStatus.status === "WARNING" && !incident.assignedUnitId) {
      queueAlert("ASSIGNMENT_WARNING", "L1", `${incident.severity} INCIDENT - TEAM ASSIGNMENT DEADLINE APPROACHING`, `Incident ${incident.id} (${incident.title}) has no response team assigned. Assignment deadline in ${assignmentStatus.remainingMinutes} minutes.`);
    }
    if (assignmentStatus.status === "BREACHED" && !incident.assignedUnitId) {
      queueAlert("ASSIGNMENT_BREACH", "L2", "SLA BREACH - NO RESPONSE TEAM ASSIGNED", `Incident ${incident.id} (${incident.title}) assignment SLA breached by ${assignmentStatus.overdueMinutes} minutes. No response team assigned.`);
    }
    if (responseStatus.status === "WARNING" && incident.assignedUnitId && !["En Route", "On Scene"].includes(incident.status)) {
      queueAlert("RESPONSE_WARNING", "L1", "RESPONSE SLA WARNING - TEAM NOT EN ROUTE", `Incident ${incident.id} (${incident.title}) assigned team has not moved to En Route. Response deadline in ${responseStatus.remainingMinutes} minutes.`);
    }
    if (responseStatus.status === "BREACHED" && incident.assignedUnitId && incident.status !== "On Scene") {
      queueAlert("RESPONSE_BREACH", "L2", "RESPONSE SLA BREACHED", `Incident ${incident.id} (${incident.title}) response SLA breached by ${responseStatus.overdueMinutes} minutes. Team status: ${incident.status}.`);
    }

    const previousLevel = ESCALATION_LEVELS.includes(incident.escalationLevel) ? incident.escalationLevel : "L0";
    for (let index = levelIndex(previousLevel) + 1; index <= levelIndex(newLevel); index += 1) {
      const level = ESCALATION_LEVELS[index];
      queueAlert(`ESCALATION_${level}`, level, `ESCALATION ${level} - ${incident.severity} INCIDENT`, `Incident ${incident.id} (${incident.title}) escalated to ${level}. Immediate supervisory attention required.`);
    }
    if (investigationRequired && ioMissing) {
      queueAlert("INVESTIGATION_MISSING_IO", "L2", "INVESTIGATION ACTION OVERDUE - NO INVESTIGATING OFFICER", `Incident ${incident.id} (${incident.title}) requires investigation but no Investigating Officer has been assigned.`);
    }
    if (investigationRequired && investigationInactive) {
      queueAlert("INVESTIGATION_INACTIVE", "L2", `NO INVESTIGATION UPDATE - ${incident.severity} INCIDENT`, `Incident ${incident.id} (${incident.title}) has had no investigation update. Supervisor attention required.`);
    }

    const activeConditions = {
      ASSIGNMENT_WARNING: assignmentStatus.status === "WARNING" && !incident.assignedUnitId,
      ASSIGNMENT_BREACH: assignmentStatus.status === "BREACHED" && !incident.assignedUnitId,
      RESPONSE_WARNING: responseStatus.status === "WARNING" && Boolean(incident.assignedUnitId) && !["En Route", "On Scene"].includes(incident.status),
      RESPONSE_BREACH: responseStatus.status === "BREACHED" && Boolean(incident.assignedUnitId) && incident.status !== "On Scene",
      INVESTIGATION_MISSING_IO: investigationRequired && ioMissing,
      INVESTIGATION_INACTIVE: investigationRequired && investigationInactive
    };
    const violationActive = activeConditions.ASSIGNMENT_WARNING || activeConditions.ASSIGNMENT_BREACH || activeConditions.RESPONSE_WARNING || activeConditions.RESPONSE_BREACH;
    incidentAlerts().filter((alert) => alert.active).forEach((alert) => {
      const conditionActive = alert.alertType.startsWith("ESCALATION_") ? violationActive : activeConditions[alert.alertType];
      if (conditionActive === false) resolveAlert(incident, alert, "Operational condition corrected");
    });

    if (levelIndex(newLevel) > levelIndex(previousLevel)) {
      incident.escalationLevel = newLevel;
      incident.lastEscalatedAt = currentIso;
      if (levelIndex(previousLevel) < 2 && levelIndex(newLevel) >= 2) incident.escalationL2At ||= incident.assignmentDeadline || incident.responseDeadline || currentIso;
      if (levelIndex(previousLevel) < 3 && levelIndex(newLevel) >= 3) incident.escalationL3At ||= currentIso;
      if (levelIndex(previousLevel) < 4 && levelIndex(newLevel) >= 4) incident.escalationL4At ||= currentIso;
      incident.updatedAt = currentIso;
      addTimeline(incident, "ESCALATION_LEVEL_CHANGED", `Escalation advanced from ${previousLevel} to ${newLevel}`, { previousLevel, newLevel });
    }
    if (assignmentStatus.status === "BREACHED" && !incident.assignmentBreached) {
      incident.assignmentBreached = true;
      incident.assignmentBreachedAt = incident.assignmentDeadline || currentIso;
      incident.updatedAt = currentIso;
      changed = true;
    }
    if (responseStatus.status === "BREACHED" && !incident.responseBreached) {
      incident.responseBreached = true;
      incident.responseBreachedAt = incident.responseDeadline || currentIso;
      incident.updatedAt = currentIso;
      changed = true;
    }
    if (ioMissing && incident.investigationStatus === "NOT_STARTED") {
      incident.supervisorReviewRequired = true;
      incident.updatedAt = currentIso;
      changed = true;
    }
    if (investigationInactive && incident.investigationStatus === "ACTIVE") {
      incident.supervisorReviewRequired = true;
      incident.updatedAt = currentIso;
      changed = true;
    }
    results.push({
      incidentId: incident.id, assignmentStatus: assignmentStatus.status,
      responseStatus: responseStatus.status, escalationLevel: newLevel,
      alertsCreated: createdAlerts.length - alertsAtStart,
      alertsResolved: resolvedAlerts.length - resolvedAtStart
    });
  }

  return { checked: (db.incidents || []).length, escalated: createdAlerts.length, resolved: resolvedAlerts.length, createdAlerts, resolvedAlerts, results, changed, db };
}

module.exports = { runSlaSweep };
