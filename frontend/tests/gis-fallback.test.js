import test from "node:test";
import assert from "node:assert/strict";
import {
  GIS_OPERATIONAL_CENTER,
  GIS_OPERATIONAL_ZOOM,
  STREET_TILE_LOAD_TIMEOUT_MS,
  activateLeafletBaseLayer,
  beginBaseLayerSwitch,
  isCurrentBaseLayerSwitch,
  preserveLeafletViewport,
  streetTileLoadOutcome
} from "../src/gisBaseLayerLifecycle.js";

function fakeLeaflet() {
  const attached = new Set();
  const overlays = new Set(["markers", "routes"]);
  const map = {
    center: { ...GIS_OPERATIONAL_CENTER },
    zoom: GIS_OPERATIONAL_ZOOM,
    hasLayer: (layer) => attached.has(layer),
    getCenter() { return { ...this.center }; },
    getZoom() { return this.zoom; },
    setView(center, zoom) { this.center = { lat: center.lat, lng: center.lng }; this.zoom = zoom; }
  };
  const layers = Object.fromEntries(["streets", "satellite"].map((key) => {
    const layer = {
      key,
      addTo(target) { attached.add(layer); return target; },
      remove() { attached.delete(layer); }
    };
    return [key, layer];
  }));
  return { map, layers, attached, overlays };
}

test("Satellite failure switches to exactly one Street layer and repeated switching stays singular", () => {
  const fixture = fakeLeaflet();
  fixture.layers.satellite.addTo(fixture.map);
  activateLeafletBaseLayer(fixture.map, fixture.layers, "streets");
  activateLeafletBaseLayer(fixture.map, fixture.layers, "streets");
  assert.deepEqual([...fixture.attached].map((layer) => layer.key), ["streets"]);
  activateLeafletBaseLayer(fixture.map, fixture.layers, "satellite");
  assert.deepEqual([...fixture.attached].map((layer) => layer.key), ["satellite"]);
});

test("fallback preserves zoom 12 and operational-center coordinates", () => {
  const fixture = fakeLeaflet();
  fixture.layers.satellite.addTo(fixture.map);
  const viewport = preserveLeafletViewport(fixture.map, () => {
    activateLeafletBaseLayer(fixture.map, fixture.layers, "streets");
    fixture.map.center = { lat: 0, lng: 0 };
    fixture.map.zoom = 2;
  });
  assert.deepEqual(viewport.center, GIS_OPERATIONAL_CENTER);
  assert.equal(viewport.zoom, 12);
  assert.deepEqual(fixture.map.center, GIS_OPERATIONAL_CENTER);
  assert.equal(fixture.map.zoom, 12);
});

test("stale Satellite timeout cannot affect the current Street switch", () => {
  const instance = { baseLayer: "satellite", baseLayerSwitchId: 0 };
  const satelliteSwitch = beginBaseLayerSwitch(instance);
  instance.baseLayer = "streets";
  const streetSwitch = beginBaseLayerSwitch(instance);
  assert.equal(isCurrentBaseLayerSwitch(instance, satelliteSwitch, "satellite"), false);
  assert.equal(isCurrentBaseLayerSwitch(instance, streetSwitch, "streets"), true);
});

test("base-layer switching leaves operational markers and routes intact", () => {
  const fixture = fakeLeaflet();
  fixture.layers.satellite.addTo(fixture.map);
  activateLeafletBaseLayer(fixture.map, fixture.layers, "streets");
  assert.deepEqual([...fixture.overlays], ["markers", "routes"]);
});

test("Street loading has a bounded timeout and explicit error outcome", () => {
  assert.equal(STREET_TILE_LOAD_TIMEOUT_MS, 5000);
  assert.equal(streetTileLoadOutcome(false), "unavailable");
  assert.equal(streetTileLoadOutcome(true), "ready");
});
