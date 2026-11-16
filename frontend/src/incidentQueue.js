const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
const DEMO_INCIDENT_SOURCES = new Set([
  "command center demo",
  "fixture seed",
  "demo seed",
  "synthetic test",
  "synthetic unit test"
]);

function normalizedIncidentSource(value) {
  return String(value || "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function isDemoIncident(incident) {
  if (!incident) return false;
  if (incident.isDemo === true || incident.isFixture === true) return true;
  if ([incident.isDemo, incident.isFixture].some((value) => ["true", "1"].includes(String(value || "").toLowerCase()))) return true;
  return [incident.sourceType, incident.source, incident.displaySource, incident.sourceLabel]
    .map(normalizedIncidentSource)
    .some((source) => DEMO_INCIDENT_SOURCES.has(source)
      || /^(?:command center demo|fixture seed|demo seed|synthetic (?:unit )?test)(?:\s|$)/.test(source));
}

export function operatorVisibleIncidents(incidents, { includeDemo = false } = {}) {
  if (includeDemo) return [...incidents];
  return incidents.filter((incident) => !isDemoIncident(incident));
}

export function prioritizeIncidents(incidents) {
  return [...incidents].sort((a, b) => (severityOrder[String(a.severity || "").toLowerCase()] ?? 4) - (severityOrder[String(b.severity || "").toLowerCase()] ?? 4));
}

export function selectedVisibleIncident(incidents, selectedId) {
  return incidents.find((incident) => incident.id === selectedId) || incidents[0] || null;
}

export function criticalQueueFilters() {
  return { search: "", severity: "critical", status: "all", source: "all", assignment: "all" };
}
