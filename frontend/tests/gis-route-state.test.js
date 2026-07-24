import test from "node:test";
import assert from "node:assert/strict";
import { confirmPreviewDestination, previewPlace } from "../src/gisPlaceSelection.js";
import {
  applyRouteResponse,
  clearCalculatedRoutes,
  emptyRouteNavigationState,
  hasUsableRealRoute,
  selectRouteId,
  selectedRoute
} from "../src/gisRouteState.js";
import { gisRouteButtonStates } from "../src/gisButtonState.js";

const realRoutes = [
  {
    id: "route_1",
    label: "Recommended",
    provider: "osrm",
    distanceKm: 57,
    durationMinutes: 74,
    isApproximate: false,
    geometry: { type: "LineString", coordinates: [[78.26, 17.53], [78.27, 18.04]] }
  },
  {
    id: "route_2",
    label: "Alternate",
    provider: "osrm",
    distanceKm: 61,
    durationMinutes: 81,
    isApproximate: false,
    geometry: { type: "LineString", coordinates: [[78.26, 17.53], [78.30, 18.04]] }
  }
];

test("search candidate remains preview P until explicit confirmation makes destination D", () => {
  const initial = emptyRouteNavigationState();
  const previewed = previewPlace(initial, { id: "medak", label: "Medak, Telangana, India", lat: 17.9375095, lng: 78.211745 });
  assert.equal(previewed.destination, null);
  assert.equal(previewed.searchPreview.label, "Medak, Telangana, India");
  const confirmed = confirmPreviewDestination(previewed);
  assert.equal(confirmed.searchPreview, null);
  assert.equal(confirmed.destination.label, "Medak, Telangana, India");
});

test("selectedRouteId drives selected geometry, distance, ETA, and real-route gating", () => {
  let navigation = applyRouteResponse(
    emptyRouteNavigationState({ start: { lat: 17.53, lng: 78.26 }, destination: { lat: 18.04, lng: 78.27 } }),
    { provider: "osrm", isApproximate: false, selectedRouteId: "route_1", routes: realRoutes }
  );
  assert.equal(selectedRoute(navigation).distanceKm, 57);
  navigation = selectRouteId(navigation, "route_2");
  assert.deepEqual(selectedRoute(navigation).geometry, realRoutes[1].geometry);
  assert.equal(selectedRoute(navigation).distanceKm, 61);
  assert.equal(selectedRoute(navigation).durationMinutes, 81);
  assert.equal(hasUsableRealRoute(selectedRoute(navigation)), true);
});

test("recalculate and Clear Route remove stale alternatives and selectedRouteId", () => {
  const populated = applyRouteResponse(emptyRouteNavigationState(), { provider: "osrm", routes: realRoutes, selectedRouteId: "route_2" });
  const cleared = clearCalculatedRoutes(populated);
  assert.equal(cleared.selectedRouteId, null);
  assert.deepEqual(cleared.routes, []);
  assert.deepEqual(cleared.routeOptions, []);
  assert.equal(cleared.route, null);
});

test("approximate fallback disables full navigation while a real OSRM route enables it", () => {
  const points = { start: { lat: 17.53, lng: 78.26 }, destination: { lat: 18.04, lng: 78.27 } };
  const approximate = {
    id: "approximate",
    provider: "haversine",
    isApproximate: true,
    distanceKm: 45.37,
    durationMinutes: null,
    geometry: { type: "LineString", coordinates: [[78.26, 17.53], [78.27, 18.04]] }
  };
  assert.equal(gisRouteButtonStates({ ...points, route: approximate }).external.disabled, true);
  assert.equal(gisRouteButtonStates({ ...points, route: realRoutes[0] }).external.disabled, false);
});
