import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const appSource = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const begin = appSource.indexOf("async function calculateMapRoute() {");
const end = appSource.indexOf("async function useCurrentLocation()", begin);

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("a slower route response cannot replace the route for a newer destination", async () => {
  assert.ok(begin >= 0 && end > begin);
  const start = { lat: 17.4, lng: 78.4, label: "Start" };
  const firstDestination = { lat: 17.9, lng: 79.5, label: "First destination" };
  const secondDestination = { lat: 18.0, lng: 79.6, label: "Second destination" };
  const pending = [];
  const context = vm.createContext({
    state: { mapNavigation: { start, destination: firstDestination, routeLoading: false, routes: [], route: null }, dispatchSupportRoutes: [] },
    routeRequestGeneration: 0,
    isOperatorRole: () => true,
    routePointValidation: () => ({ valid: true, start: context.state.mapNavigation.start, destination: context.state.mapNavigation.destination }),
    clearRouteResult: () => {
      context.routeRequestGeneration += 1;
      Object.assign(context.state.mapNavigation, { routes: [], routeOptions: [], selectedRouteId: null, route: null, routeLoading: false });
    },
    api: () => { const request = deferred(); pending.push(request); return request.promise; },
    samePoint: (a, b) => Boolean(a && b && a.lat === b.lat && a.lng === b.lng),
    applyRouteResponse: (navigation, response) => ({ ...navigation, route: response.route, routes: [response.route], routeLoading: false }),
    selectedRoute: (navigation) => navigation.route,
    updateGisButtonStates() {},
    updateNavigationPanel(message) { if (message) context.state.message = message; },
    logRouteDevelopment() {},
    fitCalculatedRoutesOnMap() {},
    renderSatelliteMaps() {},
    setText() {},
    $: () => null
  });
  vm.runInContext(appSource.slice(begin, end), context);

  const oldRequest = context.calculateMapRoute();
  context.state.mapNavigation.destination = secondDestination;
  context.clearRouteResult();
  const latestRequest = context.calculateMapRoute();
  assert.equal(pending.length, 2);

  const latestRoute = { id: "route-new", label: "Second destination route", distanceKm: 21, durationMinutes: 25, isApproximate: false };
  pending[1].resolve({ provider: "osrm", route: latestRoute });
  await latestRequest;
  assert.equal(context.state.mapNavigation.route.id, "route-new");

  pending[0].resolve({ provider: "osrm", route: { id: "route-old", distanceKm: 4, durationMinutes: 6 } });
  await oldRequest;
  assert.equal(context.state.mapNavigation.destination.label, "Second destination");
  assert.equal(context.state.mapNavigation.route.id, "route-new");
  assert.equal(context.state.mapNavigation.routeLoading, false);
});

test("reverse-geocode results are guarded by the current request generation and point", () => {
  const clickHandler = appSource.slice(
    appSource.indexOf("async function selectNavigationPointFromMap(event)"),
    appSource.indexOf("instance.selectNavigationPointFromMap = selectNavigationPointFromMap")
  );
  assert.match(clickHandler, /const lookupGeneration = \+\+reverseGeocodeGeneration/);
  assert.match(clickHandler, /if \(lookupGeneration !== reverseGeocodeGeneration\) return true/);
  assert.match(clickHandler, /place && target && samePoint\(target, chosen\)/);
});
