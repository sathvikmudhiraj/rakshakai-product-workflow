const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

export function prioritizeIncidents(incidents) {
  return [...incidents].sort((a, b) => (severityOrder[String(a.severity || "").toLowerCase()] ?? 4) - (severityOrder[String(b.severity || "").toLowerCase()] ?? 4));
}

export function selectedVisibleIncident(incidents, selectedId) {
  return incidents.find((incident) => incident.id === selectedId) || incidents[0] || null;
}

export function criticalQueueFilters() {
  return { search: "", severity: "critical", status: "all", source: "all", assignment: "all" };
}
