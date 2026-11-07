const EARTH_RADIUS_KM = 6371.0088;
const MAX_OSRM_WAYPOINT_SNAP_KM = 2;
const WAYPOINT_SNAP_WARNING_METERS = 500;

function haversineDistanceKm(start, destination) {
  const radians = (value) => Number(value) * Math.PI / 180;
  const latDelta = radians(destination.lat - start.lat);
  const lngDelta = radians(destination.lng - start.lng);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(start.lat)) * Math.cos(radians(destination.lat)) * Math.sin(lngDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

function validCoordinate(coordinate) {
  return Array.isArray(coordinate)
    && coordinate.length >= 2
    && Number.isFinite(Number(coordinate[0]))
    && Number.isFinite(Number(coordinate[1]));
}

function geometryCells(route) {
  const coordinates = route?.geometry?.coordinates || [];
  return new Set(coordinates.filter(validCoordinate).map(([lng, lat]) => `${Number(lng).toFixed(4)},${Number(lat).toFixed(4)}`));
}

function geometryOverlap(first, second) {
  const a = geometryCells(first);
  const b = geometryCells(second);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((cell) => {
    if (b.has(cell)) shared += 1;
  });
  return shared / Math.min(a.size, b.size);
}

function relativeDifference(first, second) {
  return Math.abs(Number(first) - Number(second)) / Math.max(Number(first), Number(second), 1);
}

function routesAreNearDuplicates(first, second) {
  return geometryOverlap(first, second) >= 0.85
    && relativeDifference(first.distance, second.distance) <= 0.03
    && relativeDifference(first.duration, second.duration) <= 0.05;
}

function providerSteps(route) {
  return (route.legs || []).flatMap((leg) => leg.steps || []).map((step) => ({
    distanceMeters: Number(step.distance),
    durationSeconds: Number(step.duration),
    name: String(step.name || ""),
    maneuver: {
      type: String(step.maneuver?.type || ""),
      modifier: String(step.maneuver?.modifier || ""),
      location: Array.isArray(step.maneuver?.location) ? step.maneuver.location.map(Number) : []
    }
  }));
}

function osrmWaypointSnapKm(data, index) {
  const distance = Number(data?.waypoints?.[index]?.distance);
  return Number.isFinite(distance) && distance >= 0 ? distance / 1000 : null;
}

function osrmSnapWarnings(data) {
  const waypoints = data?.waypoints || [];
  return waypoints.flatMap((waypoint, index) => {
    const distance = Number(waypoint?.distance);
    if (!Number.isFinite(distance) || distance <= WAYPOINT_SNAP_WARNING_METERS) return [];
    const point = index === 0 ? "start" : index === waypoints.length - 1 ? "destination" : `waypoint ${index + 1}`;
    return [`Selected ${point} is ${Math.round(distance)} m from the nearest routable road.`];
  });
}

function normalizeOsrmRoutes(data, start, destination) {
  const startSnapKm = osrmWaypointSnapKm(data, 0);
  const destinationSnapKm = osrmWaypointSnapKm(data, (data?.waypoints || []).length - 1);
  const validRoutes = (data?.routes || []).filter((route) => {
    const coordinates = route?.geometry?.coordinates;
    if (!Number.isFinite(Number(route.distance)) || Number(route.distance) <= 0) return false;
    if (!Number.isFinite(Number(route.duration)) || Number(route.duration) <= 0) return false;
    if (route?.geometry?.type !== "LineString" || !Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.every(validCoordinate)) return false;
    const endpoint = coordinates.at(-1);
    const endpointMatchesDestination = destinationSnapKm === null
      ? haversineDistanceKm({ lat: Number(endpoint[1]), lng: Number(endpoint[0]) }, destination) <= 0.5
      : destinationSnapKm <= MAX_OSRM_WAYPOINT_SNAP_KM;
    const routeStart = coordinates[0];
    const startMatchesOrigin = startSnapKm === null
      ? haversineDistanceKm({ lat: Number(routeStart[1]), lng: Number(routeStart[0]) }, start) <= 0.5
      : startSnapKm <= MAX_OSRM_WAYPOINT_SNAP_KM;
    return endpointMatchesDestination && startMatchesOrigin;
  }).sort((a, b) => Number(a.duration) - Number(b.duration) || Number(a.distance) - Number(b.distance));

  const distinct = [];
  validRoutes.forEach((route) => {
    if (distinct.length < 3 && !distinct.some((candidate) => routesAreNearDuplicates(candidate, route))) distinct.push(route);
  });
  if (!distinct.length) return [];

  const recommended = distinct[0];
  const meaningfullyShortest = distinct
    .slice(1)
    .filter((route) => Number(route.distance) <= Number(recommended.distance) * 0.95)
    .sort((a, b) => Number(a.distance) - Number(b.distance))[0];
  const warnings = osrmSnapWarnings(data);

  return distinct.map((route, index) => ({
    id: `route_${index + 1}`,
    label: index === 0 ? "Recommended" : route === meaningfullyShortest ? "Shortest" : "Alternate",
    distanceKm: Number(route.distance) / 1000,
    durationMinutes: Number(route.duration) / 60,
    geometry: {
      type: "LineString",
      coordinates: route.geometry.coordinates.map((coordinate) => coordinate.map(Number))
    },
    steps: providerSteps(route),
    isRecommended: index === 0,
    isApproximate: false,
    warnings
  }));
}

function approximateRouteResponse(start, destination, warning = "Road distance and travel time are unavailable.") {
  const calculatedAt = new Date().toISOString();
  const route = {
    id: "approximate",
    label: "Air-line estimate",
    distanceKm: Number(haversineDistanceKm(start, destination).toFixed(2)),
    durationMinutes: null,
    geometry: {
      type: "LineString",
      coordinates: [[start.lng, start.lat], [destination.lng, destination.lat]]
    },
    steps: [],
    isRecommended: false,
    isApproximate: true,
    warnings: ["Road distance and travel time are unavailable.", ...(warning && !/road distance and travel time/i.test(warning) ? [warning] : [])],
    calculatedAt,
    requestedStart: start,
    requestedDestination: destination
  };
  return {
    provider: "haversine",
    isApproximate: true,
    approximate: true,
    selectedRouteId: route.id,
    routes: [route],
    // Compatibility fields for existing internal dispatch consumers.
    ...route,
    routeType: "approximate_fallback",
    routeLabel: route.label,
    warning: route.warnings.join(" "),
    routeOptions: [route],
    alternateRoutes: [],
    alternativesSupported: false,
    alternativeMessage: "Road-route alternatives are unavailable while the routing service is degraded."
  };
}

module.exports = {
  approximateRouteResponse,
  geometryOverlap,
  haversineDistanceKm,
  normalizeOsrmRoutes,
  routesAreNearDuplicates
};
