const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "police_beats",
  jsonKey: "policeBeats",
  columns: [
    { name: "station_id", value: (item) => item.stationId || item.station_id || "" },
    { name: "beat_code", value: (item) => item.beatCode || item.beat_code || item.beat || "" },
    { name: "name", value: (item) => item.name || item.beatCode || item.beat_code || item.beat || "" },
    { name: "description", value: (item) => item.description || null },
    { name: "jurisdiction", value: (item) => item.jurisdiction || item.zone || "" },
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
    stationId: row.data?.station_id || row.station_id || "",
    station_id: row.data?.station_id || row.station_id || "",
    beatCode: row.data?.beat_code || row.beat_code || "",
    beat_code: row.data?.beat_code || row.beat_code || "",
    name: row.data?.name || row.name || "",
    description: row.data?.description || null,
    jurisdiction: row.data?.jurisdiction || row.jurisdiction || "",
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