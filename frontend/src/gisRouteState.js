export function emptyRouteNavigationState(overrides = {}) {
  return {
    start: null,
    destination: null,
    searchPreview: null,
    route: null,
    routeOptions: [],
    routes: [],
    selectedRouteId: null,
    selectionMode: null,
    routeLoading: false,
    locationLoading: false,
    currentLocation: null,
    ...overrides
  };
}

export function normalizeRouteResponse(response) {
  if (!response) return { provider: "", isApproximate: false, selectedRouteId: null, routes: [] };
  const rawRoutes = Array.isArray(response.routes) && response.routes.length
    ? response.routes
    : Array.isArray(response.routeOptions) && response.routeOptions.length
      ? response.routeOptions
      : [response];
  const routes = rawRoutes.map((route, index) => {
    const geometry = route?.geometry?.type === "LineString"
      ? route.geometry
      : {
          type: "LineString",
          coordinates: Array.isArray(route.geometry)
            ? route.geometry.map(([lat, lng]) => [lng, lat])
            : Array.isArray(route.coordinates) ? route.coordinates : []
        };
    return {
      ...route,
      id: route.id || `route_${index + 1}`,
      provider: route.provider || response.provider,
      isApproximate: Boolean(route.isApproximate ?? route.approximate ?? response.isApproximate),
      approximate: Boolean(route.isApproximate ?? route.approximate ?? response.isApproximate),
      warnings: Array.isArray(route.warnings) ? route.warnings : route.warning ? [route.warning] : [],
      geometry
    };
  });
  const selectedRouteId = routes.some((route) => route.id === response.selectedRouteId)
    ? response.selectedRouteId
    : routes[0]?.id || null;
  return { ...response, routes, routeOptions: routes, selectedRouteId };
}

export function selectedRoute(navigation) {
  const routes = navigation?.routes || navigation?.routeOptions || [];
  return routes.find((route) => route.id === navigation?.selectedRouteId) || null;
}

export function hasUsableRealRoute(route) {
  const coordinates = route?.geometry?.coordinates;
  return Boolean(
    route
    && !route.isApproximate
    && route.provider === "osrm"
    && Number(route.distanceKm) > 0
    && Number(route.durationMinutes) > 0
    && route.geometry?.type === "LineString"
    && Array.isArray(coordinates)
    && coordinates.length >= 2
  );
}

export function applyRouteResponse(navigation, response) {
  const normalized = normalizeRouteResponse(response);
  const next = {
    ...navigation,
    routes: normalized.routes,
    routeOptions: normalized.routes,
    selectedRouteId: normalized.selectedRouteId,
    routeLoading: false
  };
  next.route = selectedRoute(next);
  return next;
}

export function selectRouteId(navigation, routeId) {
  if (!(navigation.routes || []).some((route) => route.id === routeId)) return navigation;
  const next = { ...navigation, selectedRouteId: routeId };
  next.route = selectedRoute(next);
  return next;
}

export function clearCalculatedRoutes(navigation) {
  return { ...navigation, route: null, routeOptions: [], routes: [], selectedRouteId: null };
}
