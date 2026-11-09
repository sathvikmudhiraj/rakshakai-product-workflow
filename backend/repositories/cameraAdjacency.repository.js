const { createRepository, dateValue } = require("./base.repository");

module.exports = createRepository({
  table: "camera_adjacency",
  jsonKey: "cameraAdjacency",
  columns: [
    { name: "camera_a_id", value: (item) => item.cameraAId },
    { name: "camera_b_id", value: (item) => item.cameraBId },
    { name: "distance_meters", value: (item) => item.distanceMeters },
    { name: "expected_min_travel_seconds", value: (item) => item.expectedMinTravelSeconds },
    { name: "expected_max_travel_seconds", value: (item) => item.expectedMaxTravelSeconds },
    { name: "direction", value: (item) => item.direction || null },
    { name: "route_type", value: (item) => item.routeType || null },
    { name: "is_bidirectional", value: (item) => item.isBidirectional ?? true },
    { name: "created_at", value: (item) => dateValue(item.createdAt) },
    { name: "updated_at", value: (item) => dateValue(item.updatedAt || item.createdAt) }
  ],
  deserialize: (row) => ({
    id: row.id,
    cameraAId: row.camera_a_id,
    cameraBId: row.camera_b_id,
    distanceMeters: row.distance_meters,
    expectedMinTravelSeconds: row.expected_min_travel_seconds,
    expectedMaxTravelSeconds: row.expected_max_travel_seconds,
    direction: row.direction,
    routeType: row.route_type,
    isBidirectional: row.is_bidirectional,
    data: row.data || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  })
});