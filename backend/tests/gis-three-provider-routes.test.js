const test = require("node:test");
const assert = require("node:assert/strict");
process.env.DATABASE_URL = "";
process.env.GIS_ROUTING_PROVIDER = "self_hosted";
process.env.OSRM_BASE_URL = "http://127.0.0.1:1";
const { __testables: { buildRoute } } = require("../server");

test("three distinct mock OSRM routes retain provider distance, duration, geometry and steps", async () => {
  const start = {lat: 17.5, lng: 78.3}, destination = {lat: 17.55, lng: 78.4};
  const originalFetch = global.fetch;
  let requested;
  try {
    global.fetch = async (url) => {
      requested = new URL(url);
      const routes = [[8400,960], [9100,1080], [9800,1200]].map(([distance,duration], i) => ({
        distance, duration, geometry: { type: "LineString", coordinates: [[78.3,17.5],[78.31 + i*0.02,17.51 + i*0.01],[78.4,17.55]] },
        legs: [{steps: [{name: `Road ${i+1}`, distance, duration, maneuver: {type: "turn", location: [78.4,17.55]}}]}]
      }));
      return {ok: true, json: async () => ({code: "Ok", routes})};
    };
    const response = await buildRoute(start, destination);
    assert.equal(requested.searchParams.get("alternatives"), "true");
    assert.equal(requested.searchParams.get("steps"), "true");
    assert.equal(requested.searchParams.get("overview"), "full");
    assert.equal(requested.searchParams.get("geometries"), "geojson");
    assert.deepEqual(response.routes.map((route) => [route.distanceKm,route.durationMinutes,route.steps[0].name]), [[8.4,16,"Road 1"],[9.1,18,"Road 2"],[9.8,20,"Road 3"]]);
    assert.equal(response.selectedRouteId, "route_1");
    const { applyRouteResponse, emptyRouteNavigationState, selectRouteId, selectedRoute } = await import("../../frontend/src/gisRouteState.js");
    const state = applyRouteResponse(emptyRouteNavigationState(), response);
    assert.equal(selectedRoute(selectRouteId(state,"route_2")).distanceKm, 9.1);
    assert.equal(selectedRoute(selectRouteId(state,"route_3")).steps[0].name, "Road 3");
  } finally { global.fetch = originalFetch; }
});
