export const GIS_OPERATIONAL_CENTER = Object.freeze({ lat: 17.5109, lng: 78.3276 });
export const GIS_OPERATIONAL_ZOOM = 12;
export const STREET_TILE_LOAD_TIMEOUT_MS = 5000;

export function activateLeafletBaseLayer(map, tileLayers, activeKey) {
  Object.entries(tileLayers).forEach(([key, layer]) => {
    const active = key === activeKey;
    const attached = map.hasLayer(layer);
    if (active && !attached) layer.addTo(map);
    if (!active && attached) layer.remove();
  });
}

export function beginBaseLayerSwitch(instance) {
  instance.baseLayerSwitchId = (instance.baseLayerSwitchId || 0) + 1;
  return instance.baseLayerSwitchId;
}

export function isCurrentBaseLayerSwitch(instance, switchId, layer) {
  return switchId === instance.baseLayerSwitchId && layer === instance.baseLayer;
}

export function streetTileLoadOutcome(hasUsableTile) {
  return hasUsableTile ? "ready" : "unavailable";
}

export function preserveLeafletViewport(map, action) {
  const center = map.getCenter();
  const zoom = map.getZoom();
  action();
  map.setView(center, zoom, { animate: false });
  return { center, zoom };
}
