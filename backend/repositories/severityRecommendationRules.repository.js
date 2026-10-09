const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "severity_recommendation_rules",
  jsonKey: "severityRecommendationRules",
  columns: [
    { name: "incident_type", value: (item) => item.incidentType || item.incident_type || "" },
    { name: "category", value: (item) => item.category || null },
    { name: "recommended_severity", value: (item) => item.recommendedSeverity || item.recommended_severity || "MEDIUM" },
    { name: "keywords", value: (item) => JSON.stringify(item.keywords || []) },
    { name: "priority", value: (item) => Number(item.priority || 0) },
    { name: "active", value: (item) => Boolean(item.active !== undefined ? item.active : true) }
  ],
  serialize: (record) => record,
  deserialize: (row) => ({
    ...row.data,
    id: row.id,
    incidentType: row.data?.incident_type || row.incident_type || "",
    incident_type: row.data?.incident_type || row.incident_type || "",
    category: row.data?.category || row.category || null,
    recommendedSeverity: row.data?.recommended_severity || row.recommended_severity || "MEDIUM",
    recommended_severity: row.data?.recommended_severity || row.recommended_severity || "MEDIUM",
    keywords: row.data?.keywords || row.keywords || [],
    priority: row.data?.priority ?? row.priority ?? 0,
    active: row.data?.active ?? row.active ?? true
  })
});