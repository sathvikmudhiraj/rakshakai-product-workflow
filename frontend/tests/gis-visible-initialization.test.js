import test from "node:test";
import assert from "node:assert/strict";
import {
  activeBaseTileLayerCount,
  bindInstanceOnce,
  initializeLeafletOnce,
  mapStateForElement
} from "../src/gisVisibleInitialization.js";

const OPERATIONAL_CENTER = { lat: 17.5109, lng: 78.3276 };
const OPERATIONAL_ZOOM = 12;

function mapElement({ active = true, width = 900, height = 600 } = {}) {
  return {
    clientWidth: width,
    clientHeight: height,
    closest: () => ({ classList: { contains: (name) => name === "active" && active } })
  };
}

test("hidden or zero-size GIS containers do not initialize Leaflet", () => {
  let createCount = 0;
  for (const map of [
    mapElement({ active: false }),
    mapElement({ width: 0 }),
    mapElement({ height: 0 })
  ]) {
    const instance = { map, leafletInitializationAllowed: true };
    assert.equal(initializeLeafletOnce(instance, () => {
      createCount += 1;
      return {};
    }), null);
  }
  assert.equal(createCount, 0);
});

test("visible GIS entry initializes once and repeated entry reuses map state and Leaflet", () => {
  const registry = [];
  const map = mapElement();
  let stateCreations = 0;
  let leafletCreations = 0;
  const createState = () => {
    stateCreations += 1;
    return {
      map,
      leafletInitializationAllowed: true,
      center: { ...OPERATIONAL_CENTER },
      zoom: OPERATIONAL_ZOOM
    };
  };

  const first = mapStateForElement(registry, map, createState);
  const firstLeaflet = initializeLeafletOnce(first, () => {
    leafletCreations += 1;
    return { center: { ...first.center }, zoom: first.zoom };
  });
  const repeated = mapStateForElement(registry, map, createState);
  const repeatedLeaflet = initializeLeafletOnce(repeated, () => {
    leafletCreations += 1;
    return {};
  });

  assert.equal(registry.length, 1);
  assert.equal(stateCreations, 1);
  assert.equal(leafletCreations, 1);
  assert.equal(repeated, first);
  assert.equal(repeatedLeaflet, firstLeaflet);
  assert.deepEqual(firstLeaflet.center, OPERATIONAL_CENTER);
  assert.equal(firstLeaflet.zoom, 12);
});

test("one base tile layer stays active", () => {
  const streets = {};
  const satellite = {};
  const attached = new Set([streets]);
  const instance = {
    leafletMap: { hasLayer: (layer) => attached.has(layer) },
    leafletTileLayers: { streets, satellite }
  };
  assert.equal(activeBaseTileLayerCount(instance), 1);
  attached.delete(streets);
  attached.add(satellite);
  assert.equal(activeBaseTileLayerCount(instance), 1);
});

test("controls and listeners bind only once per map instance", () => {
  const instance = {};
  let controlBindings = 0;
  let listenerBindings = 0;
  bindInstanceOnce(instance, "controls", () => { controlBindings += 1; });
  bindInstanceOnce(instance, "controls", () => { controlBindings += 1; });
  bindInstanceOnce(instance, "leaflet-interactions", () => { listenerBindings += 1; });
  bindInstanceOnce(instance, "leaflet-interactions", () => { listenerBindings += 1; });
  assert.equal(controlBindings, 1);
  assert.equal(listenerBindings, 1);
});
