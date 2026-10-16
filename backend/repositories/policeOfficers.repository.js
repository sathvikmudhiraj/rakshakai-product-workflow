const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "police_officers",
  jsonKey: "policeOfficers",
  columns: [
    { name: "badge_id", value: (item) => item.badgeId || item.badge_id || null },
    { name: "station_id", value: (item) => item.stationId || item.station_id || "" },
    { name: "beat_id", value: (item) => item.beatId || item.beat_id || null },
    { name: "rank_id", value: (item) => item.rankId || item.rank_id || "" },
    { name: "beat", value: (item) => item.beat || null },
    { name: "jurisdiction", value: (item) => item.jurisdiction || "" },
    { name: "active", value: (item) => item.active !== undefined ? Boolean(item.active) : true },
    { name: "duty_status", value: (item) => item.dutyStatus || item.duty_status || "on_duty" },
    { name: "availability_status", value: (item) => item.availabilityStatus || item.availability_status || "available" },
    { name: "assigned_incident_id", value: (item) => item.assignedIncidentId || item.assigned_incident_id || null },
    { name: "created_at", value: (item) => dateValue(item.createdAt) },
    { name: "updated_at", value: (item) => dateValue(item.updatedAt || item.lastUpdated) }
  ],
  serialize: (record) => record,
  deserialize: (row) => ({
    ...row.data,
    user_id: row.id,
    id: row.id,
    badgeId: row.data?.badge_id || row.badge_id || null,
    badge_id: row.data?.badge_id || row.badge_id || null,
    stationId: row.data?.station_id || row.station_id || "",
    station_id: row.data?.station_id || row.station_id || "",
    beatId: row.data?.beat_id || row.beat_id || null,
    beat_id: row.data?.beat_id || row.beat_id || null,
    rankId: row.data?.rank_id || row.rank_id || "",
    rank_id: row.data?.rank_id || row.rank_id || "",
    beat: row.data?.beat || row.beat || null,
    jurisdiction: row.data?.jurisdiction || row.jurisdiction || "",
    active: row.data?.active ?? row.active ?? true,
    dutyStatus: row.data?.duty_status || row.duty_status || "on_duty",
    availabilityStatus: row.data?.availability_status || row.availability_status || "available",
    assignedIncidentId: row.data?.assigned_incident_id || row.assigned_incident_id || null,
    createdAt: row.data?.createdAt || row.created_at || null,
    updatedAt: row.data?.updatedAt || row.updated_at || null,
    lastUpdated: row.data?.lastUpdated || row.updated_at || null
  })
});
