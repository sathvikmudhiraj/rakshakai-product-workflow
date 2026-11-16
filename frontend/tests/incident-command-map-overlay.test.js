import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");

function sourceSlice(beginMarker, endMarker) {
  const begin = app.indexOf(beginMarker);
  const end = app.indexOf(endMarker, begin);
  assert.ok(begin >= 0 && end > begin, `Missing source markers: ${beginMarker}`);
  return app.slice(begin, end);
}

function runOverlay({ mapId = "commandMap", layers = {}, routes = [], supports = [], assigned = null, selectedUnitId = null } = {}) {
  const routeLayer = { items: [], clearLayers() { this.items = []; } };
  const markerLayer = { clearLayers() {} };
  const navRoute = routes[0] || null;
  const state = {
    mapNavigation: { currentLocation: null, routes, selectedRouteId: navRoute?.id || null, route: navRoute },
    mapLayers: { incidents: false, responseUnits: false, policeStations: false, dangerZones: false, heatOverlay: false, labels: false, ...layers },
    dispatchSupportRoutes: supports,
    selectedUnitId,
    selectedIncidentId: "incident-a",
    incidents: [{ id: "incident-a", assignedUnitId: assigned }],
    zones: [], incidentsForMap: [], incidents: [], policeStations: [], responseUnits: []
  };
  state.incidents = assigned ? [{ id: "incident-a", assignedUnitId: assigned }] : [];
  const source = sourceSlice("function renderNavigationOverlay(instance) {", '  if (!["gisMap", "commandMap"].includes(instance.map.id)) return;') + "\n}";
  const context = vm.createContext({
    state,
    selectedGisLocation: null,
    selectedGisLocationGeneration: 0,
    validMapPoint: (point) => point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)) ? { lat: Number(point.lat), lng: Number(point.lng) } : null,
    selectedRoute: (navigation) => navigation.route,
    routePointValidation: () => ({ valid: false, start: null, destination: null }),
    activeRouteWorkflow: () => false,
    canonicalRoutePoint: () => null,
    samePoint: () => false,
    addLeafletMarker() {},
    L: { polyline(points, options) { return { points, options, addTo(layer) { layer.items.push(this); return this; }, on() {} }; } }
  });
  vm.runInContext(source, context);
  context.renderNavigationOverlay({ map: { id: mapId }, leafletMap: {}, leafletMarkerLayer: markerLayer, leafletRouteLayer: routeLayer });
  return { state, routeLayer };
}

const line = (id, approximate = false) => ({ id, isApproximate: approximate, geometry: { coordinates: [[78.32, 17.51], [78.38, 17.53]] } });

test("dispatch-support geometry is hidden when incident and response overlays are off", () => {
  const { routeLayer } = runOverlay({
    layers: { incidents: false, responseUnits: false, policeStations: false },
    supports: [{ stationName: "Synthetic support", route: line("support", true) }]
  });
  assert.equal(routeLayer.items.filter((item) => item.options.className.includes("station-support")).length, 0);
});

test("dispatch-support geometry remains visible when a relevant operational overlay is enabled", () => {
  for (const key of ["responseUnits", "policeStations"]) {
    const { routeLayer } = runOverlay({ layers: { [key]: true }, supports: [{ route: line("support") }] });
    assert.equal(routeLayer.items.filter((item) => item.options.className.includes("station-support")).length, 1, key);
  }
});

test("valid GIS route geometry remains independent of disabled incident/unit overlays", () => {
  const { routeLayer } = runOverlay({ mapId: "gisMap", routes: [line("gis-route")], layers: { incidents: false, responseUnits: false, policeStations: false } });
  assert.equal(routeLayer.items.filter((item) => item.options.className.includes("selected")).length, 1);
});

test("switching incidents replaces support routes and clears routes from the previous incident", () => {
  const source = sourceSlice("function selectCommandIncident(incident) {", "function renderIncidentCommand() {");
  const state = { selectedIncidentId: "incident-a", dispatchRecommendation: { incidentId: "incident-a" }, dispatchSupportRoutes: [{ stationName: "old", route: { id: "old" } }], dispatchCandidates: [1], dispatchAlternativesVisible: true };
  const context = vm.createContext({ state, normalizeRouteForMap: (route) => route && { ...route, normalized: true } });
  vm.runInContext(source, context);
  context.selectCommandIncident({ id: "incident-b", dispatchRecommendation: { incidentId: "incident-b", primaryCandidates: [2], stationSupport: { allocations: [{ stationName: "new", route: { id: "new" } }] } } });
  assert.equal(state.selectedIncidentId, "incident-b");
  assert.deepEqual(Array.from(state.dispatchSupportRoutes, (entry) => entry.stationName), ["new"]);
  assert.deepEqual(Array.from(state.dispatchCandidates), [2]);
  assert.equal(state.dispatchAlternativesVisible, false);
  context.selectCommandIncident({ id: "incident-c" });
  assert.equal(state.dispatchRecommendation, null);
  assert.equal(state.dispatchSupportRoutes.length, 0);
});

test("leaving Incident Command does not erase the independent GIS route state", () => {
  const setView = sourceSlice("function setView(view, options = {}) {", "function settingsSectionFromLocation()");
  assert.doesNotMatch(setView, /previousView === "incident-command"[\s\S]{0,180}dispatchSupportRoutes\s*=\s*\[\]/);
  assert.match(app, /function resetGisNavigationState\(message = "", \{ preserveRoute = false, preserveSupportRoutes = false \} = \{\}\)/);
});

test("map-view route reset can preserve active dispatch-support routes", () => {
  const resetSource = sourceSlice("function resetGisNavigationState(message = ", "function routeDisplayMeta(");
  const route = { id: "support-route" };
  const state = { dispatchSupportRoutes: [route], mapNavigation: { locationTracking: false } };
  const context = vm.createContext({
    state, browserLocationWatchId: null, backendUnitTrackingActive: false,
    selectedGisLocation: { label: "Synthetic selected location" }, selectedGisLocationGeneration: 0,
    renderSelectedGisLocation() {}, gisMapInstance: () => null,
    emptyMapNavigationState: () => ({ reset: true }), releaseLocationTracking() {}, stopLocationTracking() {}, clearGisSelectionUi() {}, satelliteMaps: [], removeNavigationLayerArtifacts() {}, setMapStatus() {}
  });
  vm.runInContext(resetSource, context);
  context.resetGisNavigationState("switch to GIS", { preserveSupportRoutes: true });
  assert.equal(state.mapNavigation.reset, true);
  assert.equal(state.dispatchSupportRoutes[0], route);
  context.resetGisNavigationState("new session");
  assert.equal(state.dispatchSupportRoutes.length, 0);
});
