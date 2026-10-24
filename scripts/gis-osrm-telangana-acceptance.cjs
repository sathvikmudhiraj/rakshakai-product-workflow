// Telangana OSRM graph acceptance.
// Validates real road routing, /nearest snapping, alternatives, and outside-coverage fail-safe
// against a local (never public) OSRM MLD graph.
//
// Usage:
//   node scripts/gis-osrm-telangana-acceptance.cjs
//   OSRM_ACCEPTANCE_URL=http://127.0.0.1:5005 node scripts/gis-osrm-telangana-acceptance.cjs
//
// The default URL targets the temporary staging validation server started on 127.0.0.1:5005
// (localhost-only). It is NOT the compose service, which must stay internal to the compose network.

const assert = require("node:assert/strict");

const base = process.env.OSRM_ACCEPTANCE_URL || "http://127.0.0.1:5005";

// Geographically separated Telangana points (lon,lat) on real roads.
const cities = {
  hyderabad: [78.4867, 17.385],
  patancheru: [78.1788, 17.5304],
  secunderabad: [78.5011, 17.4399],
  shamshabad: [78.39, 17.24],
  sangareddy: [78.086, 17.6256],
  warangal: [79.5941, 17.9689],
  karimnagar: [79.1288, 18.4386],
  nizamabad: [78.0941, 18.6725],
  khammam: [80.1514, 17.2473],
  mahbubnagar: [77.9854, 16.7488],
};

// Pairs spanning Hyderabad region and distant Telangana districts.
const routePairs = [
  ["hyderabad", "warangal"],
  ["secunderabad", "nizamabad"],
  ["shamshabad", "khammam"],
  ["sangareddy", "mahbubnagar"],
  ["patancheru", "karimnagar"],
  ["warangal", "nizamabad"],
  ["mahbubnagar", "khammam"],
];

async function getJson(path) {
  const response = await fetch(`${base}${path}`);
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function main() {
  const results = { route: [], nearest: [], alternatives: [], outsideCoverage: [] };

  for (const [fromKey, toKey] of routePairs) {
    const from = cities[fromKey];
    const to = cities[toKey];
    const { status, body } = await getJson(
      `/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&steps=true&alternatives=true`
    );
    assert.equal(status, 200, `${fromKey}->${toKey}: HTTP ${status}`);
    assert.equal(body.code, "Ok", `${fromKey}->${toKey}: OSRM code ${body.code}`);
    const routes = body.routes || [];
    assert.ok(routes.length >= 1, `${fromKey}->${toKey}: no routes`);
    for (const route of routes) {
      assert.ok(route.distance > 0, `${fromKey}->${toKey}: distance not positive`);
      assert.ok(route.duration > 0, `${fromKey}->${toKey}: duration not positive`);
      assert.equal(route.geometry?.type, "LineString", `${fromKey}->${toKey}: geometry missing`);
      assert.ok(route.geometry.coordinates.length > 10, `${fromKey}->${toKey}: geometry too sparse`);
      assert.ok(route.legs?.[0]?.steps?.length > 0, `${fromKey}->${toKey}: steps missing`);
    }
    results.route.push({
      pair: `${fromKey}->${toKey}`,
      routes: routes.length,
      distanceKm: Math.round(routes[0].distance / 10) / 100,
      durationMin: Math.round(routes[0].duration / 60),
    });
    if (routes.length > 1) {
      results.alternatives.push({ pair: `${fromKey}->${toKey}`, routes: routes.length });
    }
  }

  for (const [key, coords] of Object.entries(cities)) {
    const { status, body } = await getJson(`/nearest/v1/driving/${coords[0]},${coords[1]}?number=1`);
    assert.equal(status, 200, `nearest ${key}: HTTP ${status}`);
    assert.equal(body.code, "Ok", `nearest ${key}: OSRM code ${body.code}`);
    const distance = body.waypoints?.[0]?.distance ?? Number.POSITIVE_INFINITY;
    assert.ok(distance <= 500, `nearest ${key}: snapped ${distance}m away, not road-covered`);
    results.nearest.push({ city: key, snapMeters: Math.round(distance) });
  }

  // Clearly outside Telangana. Must NOT fabricate road routes.
  // Pairs require a connected local street network, so fragments of national trunk
  // corridors (kept whole by complete_ways extraction) cannot satisfy them.
  const outsidePairs = [
    ["kolkata", [88.3639, 22.5726], [88.436, 22.58]],
    ["chennai", [80.2707, 13.0827], [80.22, 13.03]],
    ["bengaluru", [77.5946, 12.9716], [77.642, 12.84]],
    ["delhi-jaipur", [77.209, 28.6139], [75.7873, 26.9124]],
  ];
  for (const [label, from, to] of outsidePairs) {
    const outside = await getJson(
      `/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`
    );
    const routes = outside.body?.routes || [];
    // A real road route must not exist. OSRM may answer NoRoute/NoSegment, or (when both
    // endpoints snap to a stray trunk-fragment node) a degenerate zero-length route that
    // the backend's normalizeOsrmRoutes validity filter must reject.
    const realRoute = routes.find((route) => route.distance > 0 && route.duration > 0);
    assert.ok(
      !realRoute,
      `outside-coverage ${label}: fabricated road route (${realRoute?.distance}m) outside coverage`
    );
    results.outsideCoverage.push({
      pair: label,
      code: outside.body?.code,
      degenerate: realRoute ? false : routes.length > 0,
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
