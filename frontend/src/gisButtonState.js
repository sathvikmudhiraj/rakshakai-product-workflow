export function gisRouteButtonStates({
  start = null,
  destination = null,
  route = null,
  routeLoading = false,
  locationLoading = false,
  selectionMode = null,
  baseLayer = "streets",
  hasRouteWork = false,
  routePointError = ""
} = {}) {
  const hasStart = Boolean(start);
  const hasDestination = Boolean(destination);
  const hasPoints = hasStart && hasDestination && !routePointError;
  const hasCalculatedRoute = hasPoints && Boolean(route);
  const hasRealRoute = hasCalculatedRoute
    && !route.isApproximate
    && route.provider === "osrm"
    && Number(route.distanceKm) > 0
    && Number(route.durationMinutes) > 0
    && route.geometry?.type === "LineString"
    && Array.isArray(route.geometry.coordinates)
    && route.geometry.coordinates.length >= 2;
  const calculateReason = routePointError || (!hasStart && !hasDestination
    ? "Choose a route start and destination before calculating."
    : !hasStart
      ? "Choose a route start before calculating."
      : !hasDestination
        ? "Choose a destination before calculating."
        : "");
  const calculatedRouteReason = !hasCalculatedRoute ? "Calculate a route before using this action." : "";
  return {
    street: {
      disabled: false,
      label: "Street View",
      icon: "street",
      title: "Show street map tiles.",
      pressed: baseLayer === "streets",
      active: baseLayer === "streets"
    },
    satellite: {
      disabled: false,
      label: "Satellite View",
      icon: "satellite",
      title: "Show satellite map tiles.",
      pressed: baseLayer === "satellite",
      active: baseLayer === "satellite"
    },
    location: {
      disabled: routeLoading || locationLoading,
      label: locationLoading ? "Getting location..." : "Use My Location",
      icon: "location",
      title: locationLoading ? "Getting your current location." : "Use your current location as the route start.",
      reason: routeLoading ? "Wait for route calculation to finish." : locationLoading ? "Getting your current location." : ""
    },
    fit: {
      disabled: false,
      label: "Fit Map",
      icon: "fit",
      title: "Fit the map to valid local operational markers."
    },
    reset: {
      disabled: false,
      label: "Reset Map",
      icon: "reset",
      title: "Return to the local operational center and clear stale route markers."
    },
    start: {
      disabled: false,
      label: "Set Start",
      icon: "start",
      title: "Click, then choose the route start on the map.",
      pressed: selectionMode === "start",
      active: selectionMode === "start"
    },
    destination: {
      disabled: false,
      label: "Set Destination",
      icon: "pin",
      title: "Click, then choose the destination on the map.",
      pressed: selectionMode === "destination",
      active: selectionMode === "destination"
    },
    calculate: {
      disabled: !hasPoints || routeLoading,
      label: routeLoading ? "Calculating..." : route ? "Calculate Again" : "Calculate Route",
      icon: "route",
      title: route ? "Calculate the route again." : "Calculate the route between start and destination.",
      reason: routeLoading ? "Route calculation is already in progress." : calculateReason,
      loading: routeLoading
    },
    recalculate: {
      disabled: !hasCalculatedRoute || routeLoading,
      label: "Recalculate",
      icon: "refresh",
      title: "Recalculate the current route.",
      reason: routeLoading ? "Route calculation is already in progress." : calculatedRouteReason,
      loading: routeLoading
    },
    external: {
      disabled: !hasRealRoute || routeLoading,
      label: route?.isApproximate ? "Open in External Maps" : "Open Full Route",
      icon: "external",
      title: route?.isApproximate ? "Internal navigation is unavailable for an air-line estimate." : "Open the selected real route in a full navigation view.",
      reason: routeLoading
        ? "Route calculation is already in progress."
        : route?.isApproximate
          ? "A real road route is required for internal navigation."
          : !hasRealRoute ? calculatedRouteReason : ""
    },
    clear: {
      disabled: !hasRouteWork || routeLoading,
      label: "Clear Route",
      icon: "trash",
      title: "Clear route points, lines, options, and warnings.",
      reason: routeLoading ? "Wait for route calculation to finish." : !hasRouteWork ? "Choose a point or calculate a route before clearing." : ""
    },
    clearStart: {
      disabled: !hasStart || routeLoading,
      label: "Clear Start",
      title: "Clear the selected route start.",
      reason: routeLoading ? "Wait for route calculation to finish." : !hasStart ? "Choose a start point before clearing it." : ""
    },
    clearDestination: {
      disabled: !hasDestination || routeLoading,
      label: "Clear Destination",
      title: "Clear the selected destination.",
      reason: routeLoading ? "Wait for route calculation to finish." : !hasDestination ? "Choose a destination before clearing it." : ""
    },
    swap: {
      disabled: !hasPoints || routeLoading,
      label: "Swap",
      title: "Swap start and destination.",
      reason: routeLoading ? "Wait for route calculation to finish." : !hasPoints ? "Choose both route points before swapping." : ""
    }
  };
}
