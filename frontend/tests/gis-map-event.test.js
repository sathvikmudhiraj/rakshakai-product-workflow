import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const begin = source.indexOf("  async function selectNavigationPointFromMap(event)");
const end = source.indexOf("  instance.selectNavigationPointFromMap =", begin);

for (const kind of ["Leaflet", "native"]) {
  test(`${kind} map click selects a point and exits mode without a DOM method error`, async () => {
    assert.ok(begin >= 0 && end > begin);
    const state = { mapNavigation: { selectionMode: "start" } };
    let prevented = 0;
    let stopped = 0;
    let selected = 0;
    const element = { classList: { remove() {} }, setAttribute() {} };
    const context = vm.createContext({
      state, instance: { map: { id: "gisMap", ...element } },
      blockedMapSelectionTarget: () => false,
      pointFromMapEvent: (event) => event.latlng || { lat: 17.5109, lng: 78.3276 },
      setRouteStart: (point) => { selected++; state.mapNavigation.start = point; },
      setRouteDestination: (point) => { selected++; state.mapNavigation.destination = point; },
      updateNavigationPanel() {}, renderSatelliteMap() {},
      reverseGeocodePoint: async () => null, $: () => element
    });
    vm.runInContext(source.slice(begin, end), context);
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
