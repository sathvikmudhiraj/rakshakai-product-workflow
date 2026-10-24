import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const begin = source.indexOf("  async function selectNavigationPointFromMap(event)");
const end = source.indexOf("  instance.selectNavigationPointFromMap =", begin);

function buildContext({ snap, setRouteStart, setRouteDestination, updateNavigationPanel } = {}) {
  const state = { mapNavigation: { selectionMode: "start" } };
  const element = { classList: { remove() {} }, setAttribute() {} };
  const context = vm.createContext({
    state, instance: { map: { id: "gisMap", ...element } },
    blockedMapSelectionTarget: () => false,
    pointFromMapEvent: (event) => event.latlng || { lat: 17.5109, lng: 78.3276 },
    snapRoutePointToRoad: snap || (async () => ({ unavailable: true })),
    setRouteStart: setRouteStart || ((point) => { state.mapNavigation.start = point; }),
    setRouteDestination: setRouteDestination || ((point) => { state.mapNavigation.destination = point; }),
    updateNavigationPanel: updateNavigationPanel || (() => {}),
    renderSatelliteMap() {},
    reverseGeocodePoint: async () => null, $: () => element
  });
  vm.runInContext(source.slice(begin, end), context);
  context.messages = [];
  if (!updateNavigationPanel) {
    vm.runInContext("updateNavigationPanel = (message) => { messages.push(message || ''); }", context);
  }
  return context;
}

function mapClickEvent() {
  return { latlng: { lat: 17.5109, lng: 78.3276 }, originalEvent: { preventDefault() {}, stopPropagation() {} } };
}

for (const kind of ["Leaflet", "native"]) {
  test(`${kind} map click selects a point and exits mode without a DOM method error`, async () => {
    assert.ok(begin >= 0 && end > begin);
    const context = buildContext();
    const state = context.state;
    let prevented = 0;
    let stopped = 0;
    let selected = 0;
    context.setRouteStart = (point) => { selected++; state.mapNavigation.start = point; };
    context.setRouteDestination = (point) => { selected++; state.mapNavigation.destination = point; };
    const domEvent = { preventDefault() { prevented++; }, stopPropagation() { stopped++; } };
    const event = kind === "Leaflet"
      ? { latlng: { lat: 17.5109, lng: 78.3276 }, originalEvent: domEvent }
      : domEvent;
    for (const mode of ["start", "destination"]) {
      state.mapNavigation.selectionMode = mode;
      assert.equal(await context.selectNavigationPointFromMap(event), true);
      assert.equal(state.mapNavigation.selectionMode, null);
      assert.equal(state.mapNavigation[mode].lat, 17.5109);
      assert.equal(state.mapNavigation[mode].lng, 78.3276);
      assert.equal(await context.selectNavigationPointFromMap(event), false);
    }
    assert.equal(selected, 2);
    assert.equal(prevented, 2);
    assert.equal(stopped, 2);
  });
}

test("map click in selection mode snaps to the nearest routable road", async () => {
  const context = buildContext({
    snap: async () => ({ snapped: { lat: 17.5119, lng: 78.3276 }, distanceMeters: 111 })
  });
  const state = context.state;
  state.mapNavigation.selectionMode = "start";
  assert.equal(await context.selectNavigationPointFromMap(mapClickEvent()), true);
  assert.equal(state.mapNavigation.start.lat, 17.5119);
  assert.equal(state.mapNavigation.selectionMode, null);
  assert.match(context.messages.join(" "), /Snapped to the nearest routable road/);
});

test("map click far from any road keeps selection mode and reports no routable road", async () => {
  const context = buildContext({
    snap: async () => ({ noNearbyRoad: true })
  });
  const state = context.state;
  state.mapNavigation.selectionMode = "destination";
  assert.equal(await context.selectNavigationPointFromMap(mapClickEvent()), true);
  assert.equal(state.mapNavigation.destination, undefined);
  assert.equal(state.mapNavigation.selectionMode, "destination");
  assert.match(context.messages.join(" "), /No routable road found near this location/);
});

test("map click uses raw coordinates when road snap is unavailable", async () => {
  const context = buildContext({
    snap: async () => ({ unavailable: true })
  });
  const state = context.state;
  state.mapNavigation.selectionMode = "start";
  assert.equal(await context.selectNavigationPointFromMap(mapClickEvent()), true);
  assert.equal(state.mapNavigation.start.lat, 17.5109);
  assert.equal(state.mapNavigation.start.lng, 78.3276);
  assert.match(context.messages.join(" "), /Road snap is unavailable/);
});
