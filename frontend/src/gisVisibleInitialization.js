export function mapContainerHasVisibleSize(map) {
  if (!map || Number(map.clientWidth) <= 0 || Number(map.clientHeight) <= 0) return false;
  const panel = map.closest?.("[data-panel]");
  return !panel || panel.classList.contains("active");
}

export function mapStateForElement(registry, map, createState) {
  const existing = registry.find((instance) => instance.map === map);
  if (existing) return existing;
  const instance = createState(map);
  registry.push(instance);
  return instance;
}

export function initializeLeafletOnce(instance, createLeaflet) {
  if (instance.leafletMap) return instance.leafletMap;
  if (!instance.leafletInitializationAllowed || !mapContainerHasVisibleSize(instance.map)) return null;
  instance.leafletMap = createLeaflet();
  return instance.leafletMap;
}

export function bindInstanceOnce(instance, key, bind) {
  instance.boundCapabilities ||= new Set();
  if (instance.boundCapabilities.has(key)) return false;
  bind();
  instance.boundCapabilities.add(key);
  return true;
}

export function activeBaseTileLayerCount(instance) {
  if (!instance.leafletMap || !instance.leafletTileLayers) return 0;
  return Object.values(instance.leafletTileLayers)
    .filter((layer) => instance.leafletMap.hasLayer(layer))
    .length;
}
