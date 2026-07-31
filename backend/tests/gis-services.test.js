const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeNominatimResults } = require("../services/geocoding.service");
const {
  approximateRouteResponse,
  normalizeOsrmRoutes,
  routesAreNearDuplicates
} = require("../services/routeNormalization.service");

const start = { lat: 17.53307, lng: 78.26852 };
const destination = { lat: 18.0458792, lng: 78.2651993 };

test("Medak and cathedral provider results normalize without relabelling or swapping coordinates", () => {
  const results = normalizeNominatimResults([
    {
      place_id: 1,
      display_name: "Medak, Medak mandal, Medak, Telangana, 502110, India",
      name: "Medak",
      lat: "18.0458792",
      lon: "78.2651993",
      category: "place",
      type: "town",
      importance: 0.44,
      address: { town: "Medak", state_district: "Medak", state: "Telangana", postcode: "502110", country: "India" }
    },
    {
      place_id: 2,
      display_name: "CSI Cathedral, Cathedral Road, Medak, Telangana, India",
      name: "CSI Cathedral",
      lat: "18.0461",
      lon: "78.2642",
      category: "amenity",
      type: "place_of_worship",
      importance: 0.51,
      address: { town: "Medak", state: "Telangana", country: "India" }
    },
    {
      place_id: 3,
      display_name: "Acchannapally Thanda, Telangana, India",
      name: "Acchannapally Thanda",
      lat: "17.9375",
      lon: "78.2117",
      category: "place",
      type: "village",
      address: { village: "Acchannapally Thanda", state: "Telangana", country: "India" }
    }
  ]);
  assert.equal(results.length, 3);
  assert.equal(results[0].type, "town");
  assert.equal(results[0].lat, 18.0458792);
  assert.equal(results[0].lng, 78.2651993);
  assert.equal(results[1].type, "place_of_worship");
  assert.equal(results[1].label, "CSI Cathedral, Cathedral Road, Medak, Telangana, India");
  assert.equal(results[2].label.startsWith("Acchannapally Thanda"), true);
  assert.equal(results[2].label.includes("Medak town"), false);
});

test("valid provider zero results stay distinct from provider exceptions", () => {
  assert.deepEqual(normalizeNominatimResults([]), []);
  assert.throws(() => {
    throw Object.assign(new Error("Place search provider timed out"), { code: "GEOCODER_TIMEOUT" });
  }, (error) => error.code === "GEOCODER_TIMEOUT");
});

function osrmRoute({ distance, duration, coordinates }) {
  return {
    distance,
    duration,
    geometry: { type: "LineString", coordinates },
    legs: [{ steps: [{ distance: 100, duration: 12, name: "Main Road", maneuver: { type: "turn", modifier: "left", location: coordinates[1] } }] }]
  };
}

test("OSRM normalization keeps up to three distinct real routes and recommends lowest duration", () => {
  const direct = [[start.lng, start.lat], [78.267, 17.8], [destination.lng, destination.lat]];
  const duplicate = direct.map((point) => [...point]);
  const shorter = [[start.lng, start.lat], [78.24, 17.75], [destination.lng, destination.lat]];
  const alternate = [[start.lng, start.lat], [78.31, 17.82], [destination.lng, destination.lat]];
  const routes = normalizeOsrmRoutes({
    routes: [
      osrmRoute({ distance: 58000, duration: 4300, coordinates: direct }),
      osrmRoute({ distance: 58100, duration: 4310, coordinates: duplicate }),
      osrmRoute({ distance: 54000, duration: 4700, coordinates: shorter }),
      osrmRoute({ distance: 62000, duration: 5100, coordinates: alternate })
    ]
  }, start, destination);
  assert.equal(routes.length, 3);
  assert.equal(routes[0].label, "Recommended");
  assert.equal(routes[0].durationMinutes, 4300 / 60);
  assert.equal(routes[1].label, "Shortest");
  assert.equal(routes[2].label, "Alternate");
  assert.deepEqual(routes[0].geometry.coordinates, direct);
  assert.equal(routesAreNearDuplicates(
    osrmRoute({ distance: 58000, duration: 4300, coordinates: direct }),
    osrmRoute({ distance: 58100, duration: 4310, coordinates: duplicate })
  ), true);
});

test("one provider route stays one route and approximate fallback has no ETA", () => {
  const coordinates = [[start.lng, start.lat], [destination.lng, destination.lat]];
  const routes = normalizeOsrmRoutes({ routes: [osrmRoute({ distance: 57000, duration: 4800, coordinates })] }, start, destination);
  assert.equal(routes.length, 1);
  const fallback = approximateRouteResponse(start, destination);
  assert.equal(fallback.provider, "haversine");
  assert.equal(fallback.routes.length, 1);
  assert.equal(fallback.routes[0].label, "Air-line estimate");
  assert.equal(fallback.routes[0].durationMinutes, null);
  assert.match(fallback.routes[0].warnings.join(" "), /Road distance and travel time are unavailable/);
});
