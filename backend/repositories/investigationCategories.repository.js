const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "investigation_categories",
  jsonKey: "investigationCategories",
  columns: [
    { name: "category_name", value: (item) => item.categoryName || item.category_name || "" },
    { name: "incident_types", value: (item) => item.incidentTypes || item.incident_types || [] },
    { name: "requires_investigation", value: (item) => Boolean(item.requiresInvestigation !== undefined ? item.requiresInvestigation : true) },
    { name: "investigation_deadline_hours", value: (item) => item.investigationDeadlineHours || item.investigation_deadline_hours || null },
    { name: "active", value: (item) => Boolean(item.active !== undefined ? item.active : true) }
  ],
  serialize: (record) => record,
  deserialize: (row) => ({
    ...row.data,
    id: row.id,
    categoryName: row.data?.category_name || row.category_name || "",
    category_name: row.data?.category_name || row.category_name || "",
    incidentTypes: row.data?.incident_types || row.incident_types || [],
    incident_types: row.data?.incident_types || row.incident_types || [],
    requiresInvestigation: row.data?.requires_investigation ?? row.requires_investigation ?? true,
    requires_investigation: row.data?.requires_investigation ?? row.requires_investigation ?? true,
    investigationDeadlineHours: row.data?.investigation_deadline_hours ?? row.investigation_deadline_hours ?? null,
    investigation_deadline_hours: row.data?.investigation_deadline_hours ?? row.investigation_deadline_hours ?? null,
    active: row.data?.active ?? row.active ?? true
  })
});
