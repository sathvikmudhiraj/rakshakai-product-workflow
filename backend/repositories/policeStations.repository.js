const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "police_stations",
  jsonKey: "policeStations",
  columns: [
    { name: "station_code", value: (item) => item.stationCode || item.stationId || "" },
    { name: "name", value: (item) => item.name || item.stationName || "Police Station" },
    { name: "jurisdiction", value: (item) => item.jurisdiction || item.zone || "" },
    { name: "sector_coverage", value: (item) => {
      const value = item.sectorCoverage || item.sector_coverage;
      if (Array.isArray(value)) return JSON.stringify(value);
      if (typeof value === "string" && value.trim()) return JSON.stringify(value.split(",").map((part) => part.trim()).filter(Boolean));
      return "[]";
    } },
    { name: "latitude", value: (item) => item.latitude ?? item.lat ?? null },
    { name: "longitude", value: (item) => item.longitude ?? item.lng ?? null },
    { name: "operational", value: (item) => item.operational !== undefined ? Boolean(item.operational) : true },
    { name: "created_at", value: (item) => dateValue(item.createdAt) },
    { name: "updated_at", value: (item) => dateValue(item.updatedAt || item.lastUpdated) }
  ],
  serialize: (record) => record,
  deserialize: (row) => ({
    ...row.data,
    id: row.id,
    stationId: row.data?.station_code || row.station_code || "",
    stationCode: row.data?.station_code || row.station_code || "",
    stationName: row.data?.name || row.name || "Police Station",
    name: row.data?.name || row.name || "Police Station",
    jurisdiction: row.data?.jurisdiction || row.jurisdiction || "",
    sectorCoverage: row.data?.sector_coverage || row.sector_coverage || [],
    latitude: row.data?.latitude ?? row.latitude ?? null,
    longitude: row.data?.longitude ?? row.longitude ?? null,
    lat: row.data?.latitude ?? row.latitude ?? null,
    lng: row.data?.longitude ?? row.longitude ?? null,
    operational: row.data?.operational ?? row.operational ?? true,
    createdAt: row.data?.createdAt || row.created_at || null,
    updatedAt: row.data?.updatedAt || row.updated_at || null,
    lastUpdated: row.data?.lastUpdated || row.updated_at || null
  })
});