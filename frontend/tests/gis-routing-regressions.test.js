import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  applyRouteResponse,
  clearCalculatedRoutes,
  emptyRouteNavigationState,
  hasUsableRealRoute,
  normalizeRouteResponse,
  selectedRoute
} from "../src/gisRouteState.js";
import { gisRouteButtonStates } from "../src/gisButtonState.js";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexHtml = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(frontendRoot, "src", "app.js"), "utf8");

test("route panel distinguishes an empty ETA from an approximate route", () => {
  const begin = appSource.indexOf("function updateNavigationPanel(message = ");
  const end = appSource.indexOf("function renderRouteOptionsPanel()", begin);
  assert.ok(begin >= 0 && end > begin);
  const output = {};
  let route = null;
  const context = vm.createContext({
    state: { mapNavigation: {} }, selectedRoute: () => route,
    routePointValidation: () => ({ valid: false, message: "Select points" }),
    routeDisplayMeta: () => ({ title: "No route", status: "Not calculated", type: "--" }),
    setText: (key, value) => { output[key] = value; },
    $: () => null, renderRoutePointCards() {}, updateGisButtonStates() {}, renderDispatchPanels() {}
  });
  vm.runInContext(appSource.slice(begin, end), context);
  context.updateNavigationPanel();
  assert.equal(output["#routeDistance"], "--");
  assert.equal(output["#routeEta"], "--");
  route = { isApproximate: true, distanceKm: 2, durationMinutes: null };
  context.updateNavigationPanel();
  assert.equal(output["#routeDistance"], "Straight-line 2.00 km");
  assert.equal(output["#routeEta"], "Unavailable");
});

function slice(appJs, beginMarker, endMarker) {
  const begin = appJs.indexOf(beginMarker);
  const end = appJs.indexOf(endMarker, begin);
  assert.ok(begin >= 0 && end > begin, `slice markers not found: ${beginMarker}`);
  return appJs.slice(begin, end);
}

function runRouteManagementSlice(state) {
  const source = [
    slice(appSource, "function clearRouteResult() {", "function applyGisButtonState("),
    slice(appSource, "function clearMapRoute() {", "function setLiveVisionStatus(")
  ].join("\n");
  const context = vm.createContext({
    state,
    clearCalculatedRoutes,
    validMapPoint: (point) => (point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)) ? { lat: Number(point.lat), lng: Number(point.lng) } : null),
    updateNavigationPanel: (message = "") => { state.lastMessage = message; },
    renderSatelliteMaps: () => { state.rerenders = (state.rerenders || 0) + 1; },
    unitLabel: (unit) => unit?.name || "Unit",
    window: { confirm: () => true }
  });
  vm.runInContext(source, context);
  return context;
}

test("GIS map defaults to the Street Map road basemap with Satellite optional", () => {
  const gisMapTag = indexHtml.match(/<div id="gisMap"[^>]*>/)?.[0] || "";
  assert.match(gisMapTag, /data-map-layer="streets"/);
  assert.doesNotMatch(gisMapTag, /data-map-layer="satellite"/);
  assert.match(indexHtml, /id="satelliteMapLayer"[^>]*>Satellite View</);
  assert.match(indexHtml, /id="streetMapLayer"[^>]*>Street Map</);
  assert.doesNotMatch(indexHtml, />Street View</);
  assert.match(appSource, /TILE_SOURCES\[baseLayer\] \? baseLayer : "streets"/);
});

test("Street Map and Satellite View stay separate togglable states", () => {
  const states = gisRouteButtonStates({ baseLayer: "streets" });
  assert.equal(states.street.label, "Street Map");
  assert.equal(states.street.active, true);
  assert.equal(states.street.pressed, true);
  assert.equal(states.satellite.label, "Satellite View");
  assert.equal(states.satellite.active, false);
  const satellite = gisRouteButtonStates({ baseLayer: "satellite" });
  assert.equal(satellite.street.active, false);
  assert.equal(satellite.satellite.active, true);
});

test("destination change, start change, and reset clear the previous route", () => {
  const state = {
    mapNavigation: emptyRouteNavigationState({
      start: { lat: 17.51, lng: 78.32 },
      destination: { lat: 17.53, lng: 78.38 },
      searchPreview: null
    }),
    dispatchSupportRoutes: [{ stationName: "Old station", route: { id: "route_1" } }]
  };
  state.mapNavigation = applyRouteResponse(state.mapNavigation, {
    provider: "osrm",
    isApproximate: false,
    routes: [{ id: "route_1", provider: "osrm", distanceKm: 5, durationMinutes: 8, geometry: { type: "LineString", coordinates: [[78.32, 17.51], [78.38, 17.53]] } }]
  });
  assert.equal(selectedRoute(state.mapNavigation)?.distanceKm, 5);

  const context = runRouteManagementSlice(state);

  context.setRouteStart({ lat: 17.52, lng: 78.33 }, "New start");
  assert.equal(state.mapNavigation.route, null);
  assert.equal(state.mapNavigation.routes.length, 0);
  assert.equal(state.mapNavigation.selectedRouteId, null);
  assert.equal(state.dispatchSupportRoutes.length, 0);

  state.mapNavigation = applyRouteResponse(state.mapNavigation, {
    provider: "osrm",
    routes: [{ id: "route_1", provider: "osrm", distanceKm: 6, durationMinutes: 9, geometry: { type: "LineString", coordinates: [[78.33, 17.52], [78.38, 17.53]] } }]
  });
  context.setRouteDestination({ lat: 17.54, lng: 78.39 }, "New destination");
  assert.equal(state.mapNavigation.route, null);
  assert.equal(state.mapNavigation.routes.length, 0);
});

test("clear start, clear destination, clear route, and swap keep route state consistent", () => {
  const state = {
    mapNavigation: emptyRouteNavigationState({
      start: { lat: 17.51, lng: 78.32 },
      destination: { lat: 17.53, lng: 78.38 }
    }),
    dispatchSupportRoutes: [{ stationName: "Stale support" }]
  };
  state.mapNavigation = applyRouteResponse(state.mapNavigation, {
    provider: "osrm",
    routes: [
      { id: "route_1", provider: "osrm", distanceKm: 5, durationMinutes: 8, geometry: { type: "LineString", coordinates: [[78.32, 17.51], [78.38, 17.53]] } },
      { id: "route_2", provider: "osrm", distanceKm: 7, durationMinutes: 11, geometry: { type: "LineString", coordinates: [[78.32, 17.51], [78.40, 17.55]] } }
    ]
  });
  const context = runRouteManagementSlice(state);

  context.clearRouteStart();
  assert.equal(state.mapNavigation.start, null);
  assert.equal(state.mapNavigation.destination?.lat, 17.53);
  assert.equal(state.mapNavigation.route, null);
  assert.equal(state.dispatchSupportRoutes.length, 0);

  state.mapNavigation.destination = { lat: 17.53, lng: 78.38 };
  context.clearRouteDestination();
  assert.equal(state.mapNavigation.destination, null);
  assert.equal(state.mapNavigation.start, null);
  assert.equal(state.mapNavigation.route, null);

  state.mapNavigation.start = { lat: 17.51, lng: 78.32 };
  state.mapNavigation.destination = { lat: 17.53, lng: 78.38 };
  state.mapNavigation = applyRouteResponse(state.mapNavigation, {
    provider: "osrm",
    routes: [{ id: "route_1", provider: "osrm", distanceKm: 5, durationMinutes: 8, geometry: { type: "LineString", coordinates: [[78.32, 17.51], [78.38, 17.53]] } }]
  });
  context.clearMapRoute();
  assert.equal(state.mapNavigation.route, null);
  assert.equal(state.mapNavigation.routes.length, 0);
  assert.equal(state.mapNavigation.selectedRouteId, null);
  assert.equal(state.mapNavigation.start?.lat, 17.51);
  assert.equal(state.mapNavigation.destination?.lat, 17.53);

  context.swapRoutePoints();
  assert.equal(state.mapNavigation.start?.lat, 17.53);
  assert.equal(state.mapNavigation.destination?.lat, 17.51);
  assert.equal(state.mapNavigation.route, null);
  assert.match(state.lastMessage, /swapped/i);
});

test("stale route line state is cleared with the route reset", () => {
  const state = {
    mapNavigation: emptyRouteNavigationState({
      start: { lat: 17.51, lng: 78.32 },
      destination: { lat: 17.53, lng: 78.38 }
    }),
    dispatchSupportRoutes: [{ stationName: "Stale" }]
  };
  const context = runRouteManagementSlice(state);
  context.clearRouteResult();
  assert.equal(state.dispatchSupportRoutes.length, 0);
  assert.equal(state.mapNavigation.route, null);
});

test("straight-line fallback is clearly labeled and carries no road ETA", () => {
  const response = normalizeRouteResponse({
    provider: "haversine",
    isApproximate: true,
    routeType: "approximate_fallback",
    distanceKm: 45.37,
    durationMinutes: null,
    warnings: ["Road distance and travel time are unavailable."],
    routes: [{
      id: "approximate",
      label: "Air-line estimate",
      isApproximate: true,
      distanceKm: 45.37,
      durationMinutes: null,
      geometry: { type: "LineString", coordinates: [[78.32, 17.51], [78.38, 17.53]] }
    }]
  });
  assert.equal(response.routes[0].isApproximate, true);
  assert.equal(response.routes[0].durationMinutes, null);
  assert.equal(hasUsableRealRoute(response.routes[0]), false);

  const routeDisplayMetaSource = slice(appSource, "function routeDisplayMeta(route) {", "function mapStatusKind(");
  const context = vm.createContext({});
  vm.runInContext(routeDisplayMetaSource, context);
  const approximateMeta = context.routeDisplayMeta({ isApproximate: true, provider: "haversine", distanceKm: 45.37, warnings: ["Road distance and travel time are unavailable."] });
  assert.equal(approximateMeta.title, "Air-line estimate");
  assert.equal(approximateMeta.status, "Straight-line distance only");
  assert.equal(approximateMeta.type, "Haversine estimate");
  assert.equal(approximateMeta.badge, "Straight-line estimate");
  const realMeta = context.routeDisplayMeta({ provider: "osrm", isApproximate: false, distanceKm: 5, durationMinutes: 8 });
  assert.equal(realMeta.badge, "Real road route");
  assert.equal(context.routeDisplayMeta(null).title, "No route");
});

test("OSRM road routes keep road distance and ETA separate from Haversine fallback", () => {
  const roadRoute = {
    id: "route_1",
    provider: "osrm",
    isApproximate: false,
    distanceKm: 57,
    durationMinutes: 74,
    geometry: { type: "LineString", coordinates: [[78.26, 17.53], [78.27, 18.04]] }
  };
  assert.equal(hasUsableRealRoute(roadRoute), true);
  const navigation = applyRouteResponse(emptyRouteNavigationState(), { provider: "osrm", isApproximate: false, routes: [roadRoute] });
  assert.equal(selectedRoute(navigation).distanceKm, 57);
  assert.equal(selectedRoute(navigation).durationMinutes, 74);
  assert.equal(gisRouteButtonStates({ start: { lat: 17.53, lng: 78.26 }, destination: { lat: 18.04, lng: 78.27 }, route: roadRoute }).external.disabled, false);
  assert.match(appSource, /Road routing unavailable - straight-line estimate shown/);
  assert.match(appSource, /ETA are unavailable/);
});
