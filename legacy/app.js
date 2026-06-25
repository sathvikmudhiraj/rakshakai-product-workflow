const state = {
  incidents: [],
  selectedIncidentId: null,
  user: null,
  pendingReportFile: null,
  alertFilter: "all",
  alerts: [],
  cameraSources: [],
  responseUnits: [],
  dispatchEvents: [],
  liveVisionStream: null,
  liveVisionTimer: null,
  liveVisionBusy: false,
  liveVisionAnalysisPaused: false,
  mapNavigation: {
    start: null,
    destination: null,
    route: null,
    manualStartMode: false
  },
  sosLiveVisionAllowed: location.pathname === "/rakshak/live-vision"
};
const satelliteMaps = [];
let gisMap = null;
let gisRouteLayer = null;
let gisStartMarker = null;
let gisDestinationMarker = null;
const TILE_SIZE = 256;
const MIN_MAP_ZOOM = 2;
const MAX_MAP_ZOOM = 19;
const FALLBACK_PLACES = [
  { name: "New Delhi", lat: 28.6139, lng: 77.209 },
  { name: "Delhi", lat: 28.6139, lng: 77.209 },
  { name: "Mumbai", lat: 19.076, lng: 72.8777 },
  { name: "Bengaluru", lat: 12.9716, lng: 77.5946 },
  { name: "Bangalore", lat: 12.9716, lng: 77.5946 },
  { name: "Hyderabad", lat: 17.385, lng: 78.4867 },
  { name: "Chennai", lat: 13.0827, lng: 80.2707 },
  { name: "Kolkata", lat: 22.5726, lng: 88.3639 },
  { name: "Pune", lat: 18.5204, lng: 73.8567 },
  { name: "Ahmedabad", lat: 23.0225, lng: 72.5714 },
  { name: "Jaipur", lat: 26.9124, lng: 75.7873 },
  { name: "Lucknow", lat: 26.8467, lng: 80.9462 }
];
const TILE_SOURCES = {
  streets: {
    label: "OpenStreetMap",
    url: (zoom, x, y) => `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`
  },
  satellite: {
    label: "Satellite",
    url: (zoom, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`
  }
};
const ALERT_ZONE_COORDS = {
  "Red Zone": { lat: 28.6139, lng: 77.2295 },
  "Main Entry": { lat: 28.6164, lng: 77.2257 },
  "Gate A": { lat: 28.6164, lng: 77.2257 },
  "Food Court": { lat: 28.6108, lng: 77.2266 },
  "Medical Camp": { lat: 28.6087, lng: 77.2323 },
  "Parking Zone B": { lat: 28.6205, lng: 77.2325 },
  "Transit Hub": { lat: 28.6079, lng: 77.2215 },
  "All Zones": { lat: 28.6139, lng: 77.2295 },
  "zone-1": { lat: 28.6, lng: 77.2 }
};
const API_ORIGIN = ["localhost", "127.0.0.1"].includes(location.hostname) && location.port !== "5000"
  ? `${location.protocol}//${location.hostname}:5000`
  : "";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const setText = (selector, value) => {
  const el = $(selector);
  if (el) el.textContent = value;
};

async function api(path, options = {}) {
  const token = localStorage.getItem("rakshakai_session_token") || sessionStorage.getItem("rakshakai_session_token");
  const res = await fetch(`${API_ORIGIN}${path}`, {
    method: options.method || "GET",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (data.sessionToken) localStorage.setItem("rakshakai_session_token", data.sessionToken);
  if (path === "/api/logout") localStorage.removeItem("rakshakai_session_token");
  if (!res.ok) {
    const error = new Error(data.error || "Request failed");
    error.status = res.status;
    throw error;
  }
  return data;
}

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function setView(view) {
  if (document.body.dataset.view === "live-vision" && view !== "live-vision") stopLiveVision();
  const nav = [...$$(".nav-item")].find((button) => button.dataset.view === view);
  const citizenSosVision = view === "live-vision" && normalizeRole(state.user?.role) === "citizen" && state.sosLiveVisionAllowed;
  if (nav?.hidden && !citizenSosVision) {
    view = landingForRole(state.user?.role);
  }
  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $$("[data-panel]").forEach((p) => p.classList.toggle("active", p.dataset.panel === view));
  $("#viewTitle").textContent = {
    dashboard: "Public Safety Command Center",
    gis: "GIS Monitoring",
    cctv: "CCTV Monitoring",
    "live-vision": "Rakshak Live Vision",
    missing: "Missing Person Tracking",
    alerts: "Emergency Alert Center",
    history: "Incident History",
    settings: "System Settings"
  }[view] || "RakshakAI";
  document.body.dataset.view = view;
  requestAnimationFrame(() => {
    renderSatelliteMaps();
    if (view === "gis" && gisMap) {
      gisMap.invalidateSize();
    }
  });
}

function rolesFor(button) {
  return String(button.dataset.roles || "")
    .split(",")
    .map((role) => normalizeRole(role))
    .filter(Boolean);
}

function canSee(button, role) {
  const roles = rolesFor(button);
  return roles.length === 0 || roles.includes(normalizeRole(role));
}

function normalizeRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "police officer" || normalized === "police") return "police";
  if (normalized === "admin") return "admin";
  if (normalized === "citizen") return "citizen";
  return normalized;
}

function isOperatorRole() {
  return ["police", "admin"].includes(normalizeRole(state.user?.role));
}

function isAdminRole() {
  return normalizeRole(state.user?.role) === "admin";
}

function landingForRole(role) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "citizen") return location.pathname === "/rakshak/live-vision" ? "live-vision" : "missing";
  if (normalizedRole === "admin") return "dashboard";
  return "dashboard";
}

function applyRoleAccess() {
  const role = state.user?.role;
  const normalizedRole = normalizeRole(role);
  $$(".nav-item").forEach((button) => {
    button.hidden = !canSee(button, role);
  });
  $("#runAiScan").classList.toggle("restricted-hidden", !isOperatorRole());
  $("#assignIncident").classList.toggle("restricted-hidden", !isAdminRole());
  $("#routeIncident").classList.toggle("restricted-hidden", !isAdminRole());
  $("#closeIncident").classList.toggle("restricted-hidden", !isAdminRole());
  $("#createIncident").classList.toggle("restricted-hidden", true);
  $("#sendAlert").classList.toggle("restricted-hidden", !isOperatorRole());
  $("#clearAlerts").classList.toggle("restricted-hidden", !isOperatorRole());
  $("#clearHistory").classList.toggle("restricted-hidden", !isOperatorRole());
  $("#manualAlertForm").classList.toggle("restricted-hidden", !isOperatorRole());
  $$("[data-route-controls]").forEach((element) => {
    element.classList.toggle("restricted-hidden", normalizedRole === "citizen");
  });
  const sosButton = $("#startSosVision");
  if (sosButton) sosButton.classList.toggle("restricted-hidden", !["citizen", "police", "admin"].includes(normalizedRole));
  const caseQueuePanel = $("#caseQueuePanel");
  if (caseQueuePanel) caseQueuePanel.classList.toggle("restricted-hidden", normalizedRole === "citizen");
  const emergencyMode = $("#emergencyMode");
  if (emergencyMode) {
    emergencyMode.checked = normalizedRole === "citizen" || emergencyMode.checked;
    emergencyMode.disabled = normalizedRole === "citizen";
  }
  document.body.dataset.role = normalizedRole || "guest";
}

function setAuthMode(mode = "login", message = "") {
  const isRegister = mode === "register";
  $("[data-auth-panel='login']").classList.toggle("app-hidden", isRegister);
  $("[data-auth-panel='register']").classList.toggle("app-hidden", !isRegister);
  $("#loginError").textContent = !isRegister ? message : "";
  $("#registerError").textContent = isRegister ? message : "";
}

function showPortal(message = "", mode = "login") {
  $("#portalLogin").classList.remove("app-hidden");
  $("#appShell").classList.add("app-hidden");
  setAuthMode(mode, message);
}

function showApp() {
  $("#portalLogin").classList.add("app-hidden");
  $("#appShell").classList.remove("app-hidden");
}

function setLayer(layer) {
  if (layer === "satellite") {
    satelliteMaps.forEach((map) => setBaseLayer(map, map.baseLayer === "satellite" ? "streets" : "satellite"));
  }
  $$(".event-map").forEach((map) => {
    map.classList.toggle("heatmap-active", layer === "heatmap");
  });
}

function latLngToTile(lat, lng, zoom) {
  const limitedLat = Math.max(Math.min(lat, 85.05112878), -85.05112878);
  const latRad = (limitedLat * Math.PI) / 180;
  const scale = 2 ** zoom;
  return {
    x: ((lng + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale
  };
}

function satelliteUrl(zoom, x, y) {
  const scale = 2 ** zoom;
  const wrappedX = ((x % scale) + scale) % scale;
  return TILE_SOURCES.streets.url(zoom, wrappedX, y);
}

function makeMapControl(label, className, title, action) {
  const button = node("button", `map-control ${className}`, label);
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    action();
  });
  return button;
}

function makeZoomSlider(instance) {
  const slider = document.createElement("input");
  slider.className = "map-zoom-slider";
  slider.type = "range";
  slider.min = String(MIN_MAP_ZOOM);
  slider.max = String(MAX_MAP_ZOOM);
  slider.step = "1";
  slider.value = String(instance.zoom);
  slider.title = "Map zoom level";
  slider.setAttribute("aria-label", "Map zoom level");
  slider.addEventListener("input", (event) => {
    event.stopPropagation();
    zoomMapTo(instance, Number(event.currentTarget.value));
  });
  return slider;
}

function makeMapSearch(instance) {
  const form = node("form", "map-search");
  const input = document.createElement("input");
  const button = node("button", "", "Go");
  input.type = "search";
  input.placeholder = "Search place";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Search place on map");
  button.type = "submit";
  button.setAttribute("aria-label", "Navigate map to place");
  form.append(input, button);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await navigateMapToPlace(instance, input.value);
  });
  return form;
}

function setPanMode(instance, enabled) {
  instance.panEnabled = true;
  instance.map.classList.add("pan-enabled");
  instance.panButton?.classList.add("active");
  instance.panButton?.setAttribute("aria-pressed", "true");
}

function tileUrlFor(instance, zoom, x, y) {
  const scale = 2 ** zoom;
  const wrappedX = ((x % scale) + scale) % scale;
  return TILE_SOURCES[instance.baseLayer].url(zoom, wrappedX, y);
}

function renderSatelliteMap(instance) {
  const width = instance.map.clientWidth;
  const height = instance.map.clientHeight;
  if (!width || !height) return;

  const renderId = ++instance.renderId;
  const zoom = instance.zoom;
  const scale = 2 ** zoom;
  const source = TILE_SOURCES[instance.baseLayer];
  const leftPx = instance.center.x * TILE_SIZE - width / 2;
  const topPx = instance.center.y * TILE_SIZE - height / 2;
  const startX = Math.floor(leftPx / TILE_SIZE);
  const endX = Math.floor((leftPx + width) / TILE_SIZE);
  const startY = Math.floor(topPx / TILE_SIZE);
  const endY = Math.floor((topPx + height) / TILE_SIZE);

  instance.layer.textContent = "";
  instance.map.classList.remove("tiles-ready", "tiles-failed");
  instance.map.dataset.baseLayer = instance.baseLayer;
  if (instance.zoomSlider) instance.zoomSlider.value = String(zoom);
  if (instance.zoomBadge) instance.zoomBadge.textContent = `z${zoom}`;
  const place = instance.placeLabel ? ` - ${instance.placeLabel}` : "";
  instance.status.textContent = `Loading ${source.label} tiles - zoom ${zoom}${place}`;

  let requested = 0;
  let loaded = 0;
  let failed = 0;

  const updateStatus = () => {
    if (renderId !== instance.renderId) return;
    if (loaded > 0) {
      instance.map.classList.add("tiles-ready");
      instance.map.classList.remove("tiles-failed");
      instance.status.textContent = `${source.label} tiles - zoom ${zoom}${place}`;
    }
    if (requested > 0 && loaded + failed === requested && loaded === 0) {
      instance.map.classList.remove("tiles-ready");
      instance.map.classList.add("tiles-failed");
      instance.status.textContent = "Offline fallback map";
    }
    if (requested > 0 && loaded + failed === requested && loaded > 0 && failed > 0) {
      instance.status.textContent = `${source.label} tiles loaded - ${loaded}/${requested}`;
    }
  };

  for (let tileX = startX; tileX <= endX; tileX += 1) {
    for (let tileY = startY; tileY <= endY; tileY += 1) {
      if (tileY < 0 || tileY >= scale) continue;
      requested += 1;
      const img = new Image();
      img.className = "satellite-tile";
      img.alt = "";
      img.decoding = "async";
      img.loading = "eager";
      img.draggable = false;
      img.style.left = `${tileX * TILE_SIZE - leftPx}px`;
      img.style.top = `${tileY * TILE_SIZE - topPx}px`;
      img.onload = () => {
        loaded += 1;
        updateStatus();
      };
      img.onerror = () => {
        failed += 1;
        updateStatus();
      };
      img.src = tileUrlFor(instance, zoom, tileX, tileY);
      instance.layer.append(img);
    }
  }

  if (requested === 0) {
    instance.map.classList.add("tiles-failed");
    instance.status.textContent = "Offline fallback map";
  }
}

function renderSatelliteMaps() {
  satelliteMaps.forEach(renderSatelliteMap);
}

function panSatelliteMap(instance, dx, dy) {
  const step = 0.45;
  moveMapCenter(instance, dx * step, dy * step);
  renderSatelliteMap(instance);
}

function zoomSatelliteMap(instance, delta) {
  zoomMapTo(instance, instance.zoom + delta);
}

function zoomMapTo(instance, zoom) {
  const nextZoom = Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, Math.round(zoom)));
  if (nextZoom === instance.zoom) return;
  const factor = 2 ** (nextZoom - instance.zoom);
  instance.center.x *= factor;
  instance.center.y *= factor;
  instance.zoom = nextZoom;
  clampMapCenter(instance);
  renderSatelliteMap(instance);
}

function clampMapCenter(instance) {
  const scale = 2 ** instance.zoom;
  instance.center.x = ((instance.center.x % scale) + scale) % scale;
  instance.center.y = Math.max(0, Math.min(scale, instance.center.y));
}

function moveMapCenter(instance, tileDx, tileDy) {
  instance.center.x += tileDx;
  instance.center.y += tileDy;
  clampMapCenter(instance);
}

function setBaseLayer(instance, baseLayer) {
  instance.baseLayer = TILE_SOURCES[baseLayer] ? baseLayer : "streets";
  renderSatelliteMap(instance);
}

function fallbackGeocode(query) {
  const normalized = query.toLowerCase();
  return FALLBACK_PLACES.find((place) => normalized.includes(place.name.toLowerCase()) || place.name.toLowerCase().includes(normalized));
}

async function geocodePlace(query) {
  const fallback = fallbackGeocode(query);
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Search failed");
    const [result] = await res.json();
    if (result) {
      return { name: result.display_name.split(",").slice(0, 2).join(","), lat: Number(result.lat), lng: Number(result.lon) };
    }
  } catch (error) {
    if (fallback) return fallback;
    throw error;
  }
  return fallback || null;
}

async function navigateMapToPlace(instance, query) {
  const placeName = String(query || "").trim();
  if (!placeName) return;
  instance.status.textContent = `Searching ${placeName}`;
  try {
    const place = await geocodePlace(placeName);
    if (!place) {
      instance.status.textContent = `Place not found: ${placeName}`;
      return;
    }
    instance.zoom = Math.max(instance.zoom, 13);
    instance.center = latLngToTile(place.lat, place.lng, instance.zoom);
    instance.placeLabel = place.name;
    if (instance.map.id === "gisMap") {
      state.mapNavigation.destination = { lat: place.lat, lng: place.lng, label: place.name };
      state.mapNavigation.route = null;
      updateMapRouteUI("Destination selected. Click Navigate to calculate a route.");
    }
    renderSatelliteMap(instance);
  } catch (error) {
    instance.status.textContent = `Search unavailable. Try Delhi, Mumbai, Bengaluru`;
  }
}

function tileToLatLng(x, y, zoom) {
  const scale = 2 ** zoom;
  const lng = (x / scale) * 360 - 180;
  const latitudeRadians = Math.atan(Math.sinh(Math.PI - (2 * Math.PI * y) / scale));
  return { lat: (latitudeRadians * 180) / Math.PI, lng };
}

function updateMapRouteUI(message = "") {
  const { start, destination, route } = state.mapNavigation;
  setText("#routeDistance", route ? `${(route.distanceMeters / 1000).toFixed(1)} km` : "--");
  setText("#routeEta", route ? `${Math.max(1, Math.round(route.durationSeconds / 60))} min` : "--");
  setText("#routeStatus", route ? "Route ready" : "No route selected");
  setText(
    "#routeDetails",
    route
      ? `${start?.label || "Start"} to ${destination?.label || "Destination"} via ${route.provider || "route service"}`
      : "No route selected"
  );
  const steps = $("#routeSteps");
  if (steps) {
    steps.textContent = "";
    const items = route
      ? [`Start from ${start?.label || "selected start"}`, `Continue to ${destination?.label || "selected destination"}`, "Arrive at destination"]
      : ["No route calculated yet"];
    items.forEach((item) => steps.append(node("li", "", item)));
  }
  if (message) setText("#mapNavigationStatus", message);
}

function gisMapInstance() {
  return gisMap;
}

function updateLeafletRouteLayers() {
  if (!gisMap || !gisRouteLayer) return;
  gisRouteLayer.clearLayers();
  gisStartMarker = null;
  gisDestinationMarker = null;
  const { start, destination, route } = state.mapNavigation;
  if (start) {
    gisStartMarker = L.marker([start.lat, start.lng], { title: "Route start" })
      .bindTooltip("Start")
      .addTo(gisRouteLayer);
  }
  if (destination) {
    gisDestinationMarker = L.marker([destination.lat, destination.lng], { title: "Route destination" })
      .bindTooltip("Destination")
      .addTo(gisRouteLayer);
  }
  if (route?.coordinates?.length) {
    const points = route.coordinates.map(([lng, lat]) => [lat, lng]);
    const line = L.polyline(points, { color: "#087d78", weight: 6, opacity: 0.9 }).addTo(gisRouteLayer);
    gisMap.fitBounds(line.getBounds(), { padding: [36, 36] });
  }
}

async function navigateLeafletMapToPlace(query) {
  const placeName = String(query || "").trim();
  if (!placeName || !gisMap) return;
  setText("#mapNavigationStatus", `Searching ${placeName}...`);
  try {
    const place = await geocodePlace(placeName);
    if (!place) {
      setText("#mapNavigationStatus", `Place not found: ${placeName}`);
      return;
    }
    state.mapNavigation.destination = { lat: place.lat, lng: place.lng, label: place.name };
    state.mapNavigation.route = null;
    gisMap.setView([place.lat, place.lng], Math.max(gisMap.getZoom(), 13));
    updateLeafletRouteLayers();
    updateMapRouteUI("Destination selected. Click Navigate to calculate a route.");
  } catch (error) {
    setText("#mapNavigationStatus", "Search unavailable. Try Delhi, Mumbai, or Bengaluru.");
  }
}

function initLeafletGisMap() {
  const container = $("#gisMap");
  if (!container) {
    console.error("GIS map container not found");
    return;
  }
  if (gisMap) return;
  if (typeof L === "undefined") {
    console.error("Leaflet failed to load: L is not defined");
    setText("#mapNavigationStatus", "Map library failed to load. Refresh the page.");
    return;
  }
  if (container._leaflet_id) {
    container._leaflet_id = null;
  }

  const lat = Number(container.dataset.mapLat || 28.6139);
  const lng = Number(container.dataset.mapLng || 77.2295);
  const zoom = Number(container.dataset.mapZoom || 12);
  gisMap = L.map(container, { zoomControl: true }).setView([lat, lng], zoom);
  window.gisMap = gisMap;
  gisRouteLayer = L.layerGroup().addTo(gisMap);

  const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  });
  tiles.on("loading", () => {
    container.classList.remove("tiles-ready", "tiles-failed");
    setText("#mapNavigationStatus", "Loading map tiles...");
  });
  tiles.on("load", () => {
    container.classList.add("tiles-ready");
    container.classList.remove("tiles-failed");
    setText("#mapNavigationStatus", "Map ready. Search or click the map to choose a destination.");
  });
  tiles.on("tileerror", () => {
    container.classList.add("tiles-failed");
    setText("#mapNavigationStatus", "Some map tiles could not load. Check the internet connection.");
  });
  tiles.addTo(gisMap);

  const search = node("form", "map-search");
  const input = document.createElement("input");
  const button = node("button", "", "Go");
  input.type = "search";
  input.placeholder = "Search place";
  input.setAttribute("aria-label", "Search place on map");
  button.type = "submit";
  search.append(input, button);
  search.addEventListener("submit", async (event) => {
    event.preventDefault();
    await navigateLeafletMapToPlace(input.value);
  });
  container.append(search);
  L.DomEvent.disableClickPropagation(search);
  L.DomEvent.disableScrollPropagation(search);

  gisMap.on("click", ({ latlng }) => {
    if (state.mapNavigation.manualStartMode) {
      state.mapNavigation.start = { lat: latlng.lat, lng: latlng.lng, label: "Selected map start" };
      state.mapNavigation.manualStartMode = false;
      $("#setMapStart").classList.remove("active");
      updateMapRouteUI("Start point selected. Click the map again to choose a destination.");
    } else {
      state.mapNavigation.destination = { lat: latlng.lat, lng: latlng.lng, label: "Selected map destination" };
      state.mapNavigation.route = null;
      updateMapRouteUI("Destination selected. Click Navigate to calculate a route.");
    }
    updateLeafletRouteLayers();
  });

  requestAnimationFrame(() => gisMap.invalidateSize());
}

async function calculateMapRoute() {
  if (!isOperatorRole()) {
    updateMapRouteUI("Route navigation is available to Police Officer and Admin users.");
    return;
  }
  const destination = state.mapNavigation.destination;
  if (!destination) {
    updateMapRouteUI("Search or click the map to choose a destination first.");
    return;
  }
  const instance = gisMapInstance();
  if (!instance) {
    updateMapRouteUI("GIS map is not initialized.");
    return;
  }
  const center = instance.getCenter();
  const start = state.mapNavigation.start || {
    lat: center.lat,
    lng: center.lng,
    label: "Current map center"
  };
  state.mapNavigation.start = start;
  setText("#routeStatus", "Calculating route...");
  setText("#mapNavigationStatus", "Calculating route...");
  $("#navigateMap").disabled = true;
  $("#recalculateRoute").disabled = true;
  try {
    const query = new URLSearchParams({
      fromLat: start.lat,
      fromLng: start.lng,
      toLat: destination.lat,
      toLng: destination.lng
    });
    const result = await api(`/api/route?${query}`);
    state.mapNavigation.route = result.route;
    updateLeafletRouteLayers();
    updateMapRouteUI("Route calculated successfully.");
  } catch (error) {
    state.mapNavigation.route = null;
    updateMapRouteUI(`Route could not be calculated: ${error.message}`);
  } finally {
    $("#navigateMap").disabled = false;
    $("#recalculateRoute").disabled = false;
  }
}

function clearMapRoute() {
  state.mapNavigation = { start: null, destination: null, route: null, manualStartMode: false };
  $("#setMapStart").classList.remove("active");
  updateLeafletRouteLayers();
  updateMapRouteUI("Route cleared. Search or click the map to choose a destination.");
}

function resetMap(instance) {
  instance.zoom = instance.homeZoom;
  instance.center = { ...instance.homeCenter };
  renderSatelliteMap(instance);
}

function showWorldMap(instance) {
  instance.zoom = 3;
  instance.center = latLngToTile(20.5937, 78.9629, instance.zoom);
  renderSatelliteMap(instance);
}

function togglePanMode(instance) {
  setPanMode(instance, true);
}

function enableMapInteractions(instance) {
  const drag = { active: false, lastX: 0, lastY: 0, moved: false };

  instance.map.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".map-control, .map-zoom-slider, .map-search")) return;
    setPanMode(instance, true);
    drag.active = true;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.moved = false;
    instance.map.classList.add("map-dragging");
    instance.map.setPointerCapture?.(event.pointerId);
  });

  instance.map.addEventListener("pointermove", (event) => {
    if (!drag.active) return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    if (Math.abs(dx) + Math.abs(dy) > 1) {
      drag.moved = true;
      moveMapCenter(instance, -dx / TILE_SIZE, -dy / TILE_SIZE);
      renderSatelliteMap(instance);
    }
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
  });

  const stopDrag = (event) => {
    if (!drag.active) return;
    const moved = drag.moved;
    drag.active = false;
    instance.map.classList.remove("map-dragging");
    instance.map.releasePointerCapture?.(event.pointerId);
    if (!moved && instance.map.id === "gisMap" && !event.target.closest(".map-control, .map-zoom-slider, .map-search")) {
      const rect = instance.map.getBoundingClientRect();
      const tileX = instance.center.x + (event.clientX - rect.left - rect.width / 2) / TILE_SIZE;
      const tileY = instance.center.y + (event.clientY - rect.top - rect.height / 2) / TILE_SIZE;
      const point = tileToLatLng(tileX, tileY, instance.zoom);
      if (state.mapNavigation.manualStartMode) {
        state.mapNavigation.start = { ...point, label: "Selected map start" };
        state.mapNavigation.manualStartMode = false;
        $("#setMapStart").classList.remove("active");
        updateMapRouteUI("Start point selected. Choose a destination.");
      } else {
        state.mapNavigation.destination = { ...point, label: "Selected map destination" };
        state.mapNavigation.route = null;
        updateMapRouteUI("Destination selected. Click Navigate to calculate a route.");
      }
    }
  };

  instance.map.addEventListener("pointerup", stopDrag);
  instance.map.addEventListener("pointercancel", stopDrag);
  instance.map.addEventListener("pointerleave", stopDrag);

  instance.map.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomSatelliteMap(instance, event.deltaY < 0 ? 1 : -1);
    },
    { passive: false }
  );

  instance.map.addEventListener("dblclick", (event) => {
    event.preventDefault();
    zoomSatelliteMap(instance, 1);
  });
}

function initSatelliteMaps() {
  $$("[data-satellite-map]").forEach((map) => {
    const zoom = Number(map.dataset.mapZoom || 16);
    const center = latLngToTile(Number(map.dataset.mapLat || 28.6129), Number(map.dataset.mapLng || 77.2295), zoom);
    const layer = node("div", "satellite-tiles");
    const marker = node("span", "map-marker");
    const status = node("span", "map-status", "Loading map tiles");
    const attribution = node("span", "map-attribution");
    const controls = node("div", "map-controls");
    const instance = { map, layer, status, zoom, center, homeZoom: zoom, homeCenter: { ...center }, renderId: 0, baseLayer: "streets" };
    const search = makeMapSearch(instance);
    const zoomBadge = node("span", "map-zoom-badge", `z${zoom}`);
    const zoomSlider = makeZoomSlider(instance);
    const panButton = makeMapControl("PAN", "pan-hand", "Hand drag mode", () => togglePanMode(instance));

    instance.zoomBadge = zoomBadge;
    instance.zoomSlider = zoomSlider;
    instance.panButton = panButton;

    attribution.innerHTML = '<strong>Leaflet</strong> | &copy; OpenStreetMap';

    controls.append(
      panButton,
      makeMapControl("+", "zoom-in", "Zoom in", () => zoomSatelliteMap(instance, 1)),
      zoomBadge,
      zoomSlider,
      makeMapControl("-", "zoom-out", "Zoom out", () => zoomSatelliteMap(instance, -1)),
      makeMapControl("H", "zoom-home", "Reset to event area", () => resetMap(instance)),
      makeMapControl("W", "zoom-world", "Zoom out to India overview", () => showWorldMap(instance))
    );

    map.prepend(layer);
    map.append(marker, search, status, attribution, controls);
    satelliteMaps.push(instance);
    setPanMode(instance, true);
    enableMapInteractions(instance);
    if ("ResizeObserver" in window) {
      new ResizeObserver(() => renderSatelliteMap(instance)).observe(map);
    } else {
      window.addEventListener("resize", () => renderSatelliteMap(instance));
    }
    renderSatelliteMap(instance);
  });
}

function sevClass(sev) {
  return sev === "critical" ? "critical" : sev === "high" ? "high" : sev === "medium" ? "medium" : "low";
}

function displayIncidentType(value) {
  return String(value || "Incident")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function incidentTime(value) {
  return value ? alertTime(value) : "Not recorded";
}

function renderTimeline(incident, events = state.dispatchEvents) {
  const list = $("#timeline");
  list.textContent = "";
  if (!incident) {
    const li = node("li", "active");
    li.append(node("span"), document.createTextNode("Select an active incident to view dispatch activity."));
    list.append(li);
    setText("#selectedIncidentLabel", "No case selected");
    return;
  }
  setText("#selectedIncidentLabel", incident.id);
  const items = events.length ? events.map((event) => `${incidentTime(event.createdAt)} · ${event.message}`) : [
    `Case created ${incidentTime(incident.openedAt || incident.timestamp)}`,
    ...(incident.timeline || []),
    ...(Number(incident.occurrenceCount) > 1
      ? [`Latest detection ${incidentTime(incident.lastDetectedAt)} · ${incident.occurrenceCount} total occurrences`]
      : [])
  ];
  if (!events.length) items.splice(0, items.length, "No dispatch activity recorded for this incident.");
  Array.from(new Set(items)).forEach((item, index, arr) => {
    const li = node("li", index === arr.length - 1 ? "active" : "done");
    li.append(node("span"), document.createTextNode(item));
    list.append(li);
  });
}

function activeIncident() {
  return state.incidents.find((x) => x.id === state.selectedIncidentId) || null;
}

function responseUnit(incident) {
  return incident?.assignedUnit || incident?.recommendedUnit || null;
}

function unitLabel(unit) {
  return unit ? `${unit.unitCode} · ${unit.name}` : "Not selected";
}

function routeIntro(incident) {
  if (!incident) return "Select an active incident to view dispatch activity.";
  const eta = incident.etaMinutes ? `${incident.etaMinutes} min ETA` : "ETA pending";
  const distance = Number.isFinite(Number(incident.distanceKm)) ? `${incident.distanceKm} km` : "distance pending";
  return `${incident.title}: ${unitLabel(responseUnit(incident))}, ${eta}, ${distance}.`;
}

function setResponseControls(incident) {
  const enabled = Boolean(incident);
  ["#assignIncident", "#routeIncident", "#closeIncident"].forEach((selector) => {
    const button = $(selector);
    if (button) button.disabled = !enabled;
  });
  const unit = responseUnit(incident);
  setText("#assignIncident", enabled ? `Assign ${unit?.unitCode || "Unit"}` : "Assign Unit");
  setText("#routeIncident", enabled ? "Recommend Unit" : "Recommendation Locked");
  setText("#closeIncident", "Close Incident");
}

async function loadIncidentTimeline(incident) {
  if (!incident) {
    state.dispatchEvents = [];
    renderTimeline(null);
    return;
  }
  const result = await api(`/api/incidents/${incident.id}/timeline`);
  state.dispatchEvents = result.events || [];
  renderTimeline(incident, state.dispatchEvents);
}

function focusIncidentOnMap(incident) {
  if (!incident || !Number.isFinite(Number(incident.lat)) || !Number.isFinite(Number(incident.lng))) return;
  const unit = incident.assignedUnit || incident.recommendedUnit;
  state.mapNavigation.start = unit && Number.isFinite(Number(unit.lat)) && Number.isFinite(Number(unit.lng))
    ? { lat: Number(unit.lat), lng: Number(unit.lng), label: unit.unitCode }
    : state.mapNavigation.start;
  state.mapNavigation.destination = {
    lat: Number(incident.lat),
    lng: Number(incident.lng),
    label: incident.title
  };
  state.mapNavigation.route = null;
  setView("gis");
  requestAnimationFrame(() => {
    if (gisMap) {
      gisMap.setView([Number(incident.lat), Number(incident.lng)], 15);
      updateLeafletRouteLayers();
      updateMapRouteUI(`Focused on ${incident.title}.`);
    }
  });
}

function renderIncidents(incidents) {
  state.incidents = incidents;
  if (!incidents.length) {
    state.selectedIncidentId = null;
    const wrap = $("#incidentList");
    wrap.textContent = "";
    const empty = node("article", "empty-state");
    empty.append(node("strong", "", "No active incidents."));
    empty.append(node("small", "", "Emergency response queue is clear."));
    wrap.append(empty);
    renderTimeline(null);
    setResponseControls(null);
    setText("#routeSummary", routeIntro(null));
    return;
  }
  if (!incidents.some((incident) => incident.id === state.selectedIncidentId)) state.selectedIncidentId = null;
  const wrap = $("#incidentList");
  wrap.textContent = "";
  incidents.forEach((incident) => {
    const card = node("article", `incident ${incident.id === state.selectedIncidentId ? "active" : ""}`);
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Select incident ${incident.id}`);
    const severity = node("span", `severity ${sevClass(incident.severity)}`, incident.severity);
    const header = node("div", "incident-card-head");
    const heading = node("div", "incident-heading");
    heading.append(
      node("small", "incident-id", `Incident ID · ${incident.id}`),
      node("strong", "incident-title", incident.title || displayIncidentType(incident.type))
    );
    header.append(heading, severity);

    const facts = node("dl", "incident-facts");
    [
      ["Source", incident.sourceName || incident.source || "Command center"],
      ["Zone", incident.zone || "Unassigned"],
      ["Status", displayIncidentType(incident.status)],
      ["Occurrences", String(Math.max(1, Number(incident.occurrenceCount) || 1))],
      ["Confidence", incident.confidence ? `${Math.round(incident.confidence * 100)}%` : "Not supplied"],
      ["Created", incidentTime(incident.createdAt)],
      ["Last detected", incidentTime(incident.lastDetectedAt)],
      ["Recommended unit", unitLabel(incident.recommendedUnit)],
      ["Assigned unit", unitLabel(incident.assignedUnit)],
      ["ETA", incident.etaMinutes ? `${incident.etaMinutes} min` : "Pending"],
      ["Distance", Number.isFinite(Number(incident.distanceKm)) ? `${incident.distanceKm} km` : "Pending"]
    ].forEach(([label, value]) => {
      const fact = node("div");
      fact.append(node("dt", "", label), node("dd", "", value));
      facts.append(fact);
    });

    const actions = node("div", "incident-card-actions");
    const mapButton = node("button", "ghost", "View on Map");
    const recommendButton = node("button", "ghost", "Recommend Unit");
    const assignButton = node("button", "primary", incident.assignedUnit ? `Assigned ${incident.assignedUnit.unitCode}` : "Assign Unit");
    const statusFlow = { Assigned: "En Route", "En Route": "On Scene", "On Scene": "Resolved" };
    const nextStatus = statusFlow[incident.status];
    const statusButton = node("button", "ghost", nextStatus ? `Mark ${nextStatus}` : "Status Pending");
    statusButton.disabled = !nextStatus;
    const closeButton = node("button", "ghost danger-action", "Close Incident");
    [mapButton, recommendButton, assignButton, statusButton, closeButton].forEach((button) => { button.type = "button"; });
    [recommendButton, assignButton, closeButton].forEach((button) => button.classList.toggle("restricted-hidden", !isAdminRole()));
    mapButton.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedIncidentId = incident.id;
      focusIncidentOnMap(incident);
    });
    recommendButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      await api(`/api/incidents/${incident.id}/recommend-unit`, { method: "POST" });
      state.selectedIncidentId = incident.id;
      await refresh();
    });
    assignButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      await api(`/api/incidents/${incident.id}/assign-unit`, { method: "POST", body: { unitId: incident.recommendedUnitId } });
      state.selectedIncidentId = incident.id;
      await refresh();
    });
    statusButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (!nextStatus) return;
      await api(`/api/incidents/${incident.id}/status`, { method: "PATCH", body: { status: nextStatus } });
      state.selectedIncidentId = incident.id;
      await refresh();
    });
    closeButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      await api(`/api/incidents/${incident.id}/close`, { method: "POST" });
      if (state.selectedIncidentId === incident.id) state.selectedIncidentId = null;
      await refresh();
    });
    actions.append(mapButton, recommendButton, assignButton, statusButton, closeButton);
    card.append(
      header,
      facts,
      actions
    );
    const selectIncident = () => {
      state.selectedIncidentId = incident.id;
      renderIncidents(state.incidents);
    };
    card.addEventListener("click", selectIncident);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectIncident();
      }
    });
    wrap.append(card);
  });
  const selected = activeIncident();
  if (selected) loadIncidentTimeline(selected).catch(() => renderTimeline(selected, []));
  else renderTimeline(null);
  setResponseControls(selected);
  setText("#routeSummary", routeIntro(selected));
}

function cameraCard(camera) {
  const card = node("article", `camera-feed-card ${camera.health === "offline" ? "offline" : camera.health === "warning" ? "warning-feed" : camera.aiStatus.includes("match") ? "matching" : ""}`);
  const feed = node("div", "camera-feed");
  feed.style.backgroundImage = `url("assets/${camera.scene}")`;
  feed.append(node("span", "feed-label", camera.name));
  feed.append(node("span", camera.health === "offline" ? "offline-banner" : "live-dot", camera.health === "offline" ? "DISCONNECTED" : "LIVE"));
  if (camera.health !== "offline") feed.append(node("span", "scan-line"));
  if (camera.aiStatus.includes("Face")) feed.append(node("span", "detect-box face"));
  if (camera.aiStatus.includes("Crowd")) feed.append(node("span", "detect-box crowd"));
  if (camera.aiStatus.includes("Motion")) feed.append(node("span", "detect-box motion"));
  feed.append(node("strong", "", camera.rtspConfigured ? `${camera.aiStatus} - ${camera.rtspUrlMasked}` : camera.aiStatus));
  const meta = node("div", "camera-config");
  const status = camera.sourceStatusLabel || (camera.health === "offline" ? "Offline" : "Online");
  meta.append(node("strong", "", camera.name));
  meta.append(node("small", "", `Location: ${camera.zone || "Unknown zone"}`));
  meta.append(node("span", `source-badge ${camera.sourceStatus || "online"}`, status));
  if (isAdminRole() && !camera.externalConfig) {
    const form = node("form", "rtsp-form");
    form.dataset.cameraConfig = camera.id;
    const input = document.createElement("input");
    input.name = "rtspUrl";
    input.placeholder = "Optional RTSP URL";
    input.value = camera.rtspUrl || "";
    const save = node("button", "ghost", "Save");
    save.type = "submit";
    const test = node("button", "ghost", "Test");
    test.type = "button";
    test.dataset.cameraTest = camera.id;
    form.append(input, save, test);
    meta.append(form);
  }
  card.append(feed, meta);
  return card;
}

function renderCameras(cameras) {
  const dashboardGrid = $("#dashboardCameraGrid");
  const largeGrid = $("#cameraGridLarge");
  if (dashboardGrid) {
    dashboardGrid.textContent = "";
    cameras.slice(0, 4).forEach((camera) => dashboardGrid.append(cameraCard(camera)));
  }
  if (largeGrid) {
    largeGrid.textContent = "";
    cameras.forEach((camera) => largeGrid.append(cameraCard(camera)));
  }
}

function sourceModeMeta(type) {
  if (type === "phone_camera") {
    return { title: "Phone Camera Mode", description: "Use mobile browser camera for live safety monitoring", action: "Open Live Vision", view: "live-vision" };
  }
  if (type === "upload") {
    return { title: "Upload Video Mode", description: "Submit recorded evidence for case review", action: "Upload Evidence", view: "missing" };
  }
  return { title: "CCTV Mode", description: "Monitor fixed surveillance cameras", action: "View CCTV", view: "cctv" };
}

function sourceCard(source) {
  const meta = sourceModeMeta(source.type);
  const card = node("article", "source-card");
  card.append(node("span", `source-badge ${source.status || "offline"}`, source.statusLabel || source.status || "Offline"));
  card.append(node("strong", "", meta.title));
  card.append(node("small", "", meta.description));
  card.append(node("small", "", `${source.name} · ${source.zone || "Unassigned"}`));
  const metrics = node("div", "source-card-metrics");
  metrics.append(
    node("span", "", `Latest detection · ${source.latestDetection ? alertTime(source.latestDetection.timestamp) : "None"}`),
    node("span", "", `Incident count · ${source.incidentCount || 0}`)
  );
  card.append(metrics);
  if (source.latestDetection) {
    card.append(node("small", "source-detection", `${source.latestDetection.message} (${Math.round((source.latestDetection.confidence || 0) * 100)}%)`));
  } else {
    card.append(node("small", "source-detection", "No detections yet"));
  }
  if (source.latestAlertTime) card.append(node("small", "", `Latest alert: ${alertTime(source.latestAlertTime)}`));
  const action = node("button", meta.view ? "primary" : "ghost", meta.action);
  action.type = "button";
  action.disabled = !meta.view;
  if (meta.view) action.addEventListener("click", () => setView(meta.view));
  card.append(action);
  return card;
}

function renderSources(sources = []) {
  state.cameraSources = sources;
  ["#sourceSelector", "#sourceSelectorCctv"].forEach((selector) => {
    const wrap = $(selector);
    if (!wrap) return;
    wrap.textContent = "";
    const primary = ["cctv", "phone_camera", "upload"]
      .map((type) => sources.find((source) => source.type === type))
      .filter(Boolean);
    if (!primary.length) {
      const empty = node("article", "empty-state");
      empty.append(node("strong", "", "No camera sources configured"));
      empty.append(node("small", "", "CCTV, phone camera, and upload sources will appear here."));
      wrap.append(empty);
      return;
    }
    primary.forEach((source) => wrap.append(sourceCard(source)));
  });
  const phone = sources.find((source) => source.type === "phone_camera");
  if (phone) {
    setText("#liveSourceHealth", phone.statusLabel || "Available");
    if (phone.latestDetection) {
      setText("#liveDetectionState", phone.latestDetection.threatDetected ? "Threat detected" : "No threat detected");
      setText("#liveDetectionDetail", phone.latestDetection.message);
    }
    if (phone.latestAlertTime) {
      setText("#liveLatestAlert", alertTime(phone.latestAlertTime));
      setText("#liveLatestAlertDetail", `${phone.incidentCount || 0} incident(s) from Live Vision`);
    }
  }
}

function resizeReportImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (!file.type.startsWith("image/")) return reject(new Error("Upload an image file for the missing person photo."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not preview the selected image."));
      img.onload = () => {
        const maxSize = 640;
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({ name: file.name, type: "image/jpeg", dataUrl: canvas.toDataURL("image/jpeg", 0.78) });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function updateReportFilePreview(fileData) {
  const fileName = $("#fileName");
  const preview = $("#filePreview");
  if (!fileData) {
    fileName.textContent = "No file selected";
    preview.hidden = true;
    preview.textContent = "";
    return;
  }
  fileName.textContent = fileData.name;
  preview.hidden = false;
  preview.innerHTML = `<img src="${fileData.dataUrl}" alt="Uploaded missing person preview" /><span>Photo attached for AI face matching</span>`;
}

function reportCard(report) {
  const card = node("article", "case-card");
  if (report.image) {
    const img = document.createElement("img");
    img.className = "case-photo";
    img.src = report.image;
    img.alt = `${report.name} uploaded photo`;
    card.append(img);
  } else {
    card.append(node("span", "case-photo placeholder", "No Photo"));
  }
  const details = node("div", "case-details");
  details.append(node("strong", "", report.name));
  details.append(node("small", "", `${report.status} - ${report.matchConfidence || 0}% match`));
  details.append(node("small", "", report.lastSeenLocation));
  if (report.imageName) details.append(node("small", "case-file", `File: ${report.imageName}`));
  card.append(details);
  return card;
}

function alertCounts(alerts) {
  const open = alerts.filter((alert) => !["closed", "resolved"].includes(String(alert.status).toLowerCase()));
  return {
    all: open.length,
    critical: open.filter((alert) => alert.severity === "critical").length,
    high: open.filter((alert) => alert.severity === "high").length,
    medium: open.filter((alert) => alert.severity === "medium").length,
    low: open.filter((alert) => alert.severity === "low").length
  };
}

function alertLocation(alert) {
  const location = Number.isFinite(Number(alert.lat)) && Number.isFinite(Number(alert.lng))
    ? { lat: Number(alert.lat), lng: Number(alert.lng) }
    : ALERT_ZONE_COORDS[alert.zone] || ALERT_ZONE_COORDS["All Zones"];
  return `${Number(location.lat).toFixed(4)}, ${Number(location.lng).toFixed(4)}`;
}

function zoneLocation(zone) {
  return ALERT_ZONE_COORDS[zone] || ALERT_ZONE_COORDS["All Zones"];
}

function alertTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString([], { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function alertStatusLabel(status) {
  const value = String(status || "active").toLowerCase();
  if (value === "open") return "ACTIVE";
  return value.toUpperCase();
}

function renderAlertFilters(alerts) {
  const filters = $("#alertFilters");
  if (!filters) return;
  const counts = alertCounts(alerts);
  const items = [
    ["all", "All"],
    ["critical", "Critical"],
    ["high", "High"],
    ["medium", "Medium"]
  ];
  filters.textContent = "";
  items.forEach(([key, label]) => {
    const button = node("button", state.alertFilter === key ? "active" : "", `${label} (${counts[key]})`);
    button.type = "button";
    button.dataset.alertFilter = key;
    filters.append(button);
  });
}

function alertCard(alert) {
  const card = node("article", `alert-card alert-${sevClass(alert.severity)}`);
  const icon = node("span", "alert-icon", "!");
  const content = node("div", "alert-content");
  const meta = node("div", "alert-card-meta");
  const alreadyAcknowledged = Boolean(alert.acknowledged);
  meta.append(node("span", `severity ${sevClass(alert.severity)}`, alert.severity || "low"));
  meta.append(node("span", "alert-type", displayIncidentType(alert.threatType || "Alert")));
  const title = node("strong", "", alert.title || "Emergency alert");
  const detailGrid = node("div", "alert-detail-grid");
  detailGrid.append(node("small", "", alertTime(alert.lastDetectedAt || alert.createdAt)));
  detailGrid.append(node("small", "", `Zone: ${alert.zone || "All Zones"}`));
  detailGrid.append(node("small", "", `Location: ${alertLocation(alert)}`));
  detailGrid.append(node("small", "", `Occurrences: ${alert.occurrenceCount || 1}`));
  if (alert.confidence) detailGrid.append(node("small", "", `Confidence: ${Math.round(alert.confidence * 100)}%`));
  content.append(meta, title, detailGrid);
  const status = node("span", "alert-status", alertStatusLabel(alert.status));
  const actions = node("div", "alert-card-actions");
  actions.append(status);
  [["map", "View on Map"], ["navigate", "Navigate"], ["incident", "View Incident"]].forEach(([actionName, label]) => {
    const button = node("button", "ghost alert-ack", label);
    button.type = "button";
    button.dataset.alertAction = actionName;
    button.dataset.alertId = alert.id;
    actions.append(button);
  });
  if (isAdminRole() && alert.incidentId) {
    const assign = node("button", "primary alert-ack", "Assign Unit");
    assign.type = "button";
    assign.dataset.alertAction = "assign";
    assign.dataset.alertId = alert.id;
    actions.append(assign);
  }
  if (!["closed", "resolved"].includes(String(alert.status).toLowerCase())) {
    const acknowledge = node("button", "ghost alert-ack", alreadyAcknowledged ? "Acknowledged" : "Acknowledge");
    acknowledge.type = "button";
    acknowledge.dataset.alertAck = alert.id;
    acknowledge.disabled = alreadyAcknowledged;
    actions.append(acknowledge);
  }
  card.append(icon, content, actions);
  return card;
}

function renderAlerts(alerts = []) {
  state.alerts = alerts;
  renderAlertFilters(alerts);
  const grid = $("#alertGrid");
  if (!grid) return;
  const openAlerts = alerts.filter((alert) => !["closed", "resolved"].includes(String(alert.status).toLowerCase()));
  const filtered = state.alertFilter === "all" ? openAlerts : openAlerts.filter((alert) => alert.severity === state.alertFilter);
  grid.textContent = "";
  if (!filtered.length) {
    const empty = node("article", "alert-empty");
    empty.append(node("strong", "", "No active alerts."));
    grid.append(empty);
    return;
  }
  filtered.forEach((alert) => grid.append(alertCard(alert)));
}

function durationLabel(start, end) {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end || Date.now()).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return "Duration unknown";
  const minutes = Math.max(1, Math.round((endTime - startTime) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours} hr ${mins} min` : `${hours} hr`;
}

function historyCard(incident) {
  const card = node("article", "history-card");
  const title = node("strong", "", incident.title || incident.type || "Closed incident");
  const meta = node("div", "history-meta");
  meta.append(node("span", `severity ${sevClass(incident.severity)}`, incident.severity || "low"));
  meta.append(node("small", "", `${incident.zone || "Unknown zone"} - ${unitLabel(incident.assignedUnit || incident.recommendedUnit)}`));
  meta.append(node("small", "", `Resolved in ${durationLabel(incident.createdAt, incident.closedAt || incident.resolvedAt)}`));
  if (incident.closedAt) meta.append(node("small", "", `Closed: ${alertTime(incident.closedAt)}`));
  card.append(title, meta);
  return card;
}

function renderHistory(incidents = []) {
  const list = $("#historyList");
  const stats = $("#historyStats");
  if (!list || !stats) return;
  setText("#historyCount", `${incidents.length} closed`);
  list.textContent = "";
  stats.textContent = "";
  if (!incidents.length) {
    const empty = node("article", "empty-state");
    empty.append(node("strong", "", "No closed incidents yet"));
    empty.append(node("small", "", "Closed live incidents will appear here for review."));
    list.append(empty);
  } else {
    incidents.forEach((incident) => list.append(historyCard(incident)));
  }
  const critical = incidents.filter((incident) => incident.severity === "critical").length;
  const assigned = incidents.filter((incident) => incident.assignedUnitId).length;
  const avgMinutes = incidents.length
    ? Math.round(
        incidents.reduce((sum, incident) => {
          const start = new Date(incident.createdAt).getTime();
          const end = new Date(incident.closedAt || incident.resolvedAt || incident.createdAt).getTime();
          return sum + (Number.isFinite(start) && Number.isFinite(end) ? Math.max(1, (end - start) / 60000) : 0);
        }, 0) / incidents.length
      )
    : 0;
  [
    ["Closed Cases", incidents.length],
    ["Critical Resolved", critical],
    ["Unit Assigned", assigned],
    ["Avg Resolution", incidents.length ? `${avgMinutes} min` : "--"]
  ].forEach(([label, value]) => {
    const stat = node("article", "");
    stat.append(node("span", "", label), node("strong", "", value));
    stats.append(stat);
  });
}

function renderIntegrations(integrations = []) {
  const list = $("#integrationList");
  if (!list) return;
  list.textContent = "";
  integrations.forEach((integration) => {
    const card = node("article", `integration-card ${integration.configured ? "configured" : "pending"}`);
    card.append(node("span", "integration-state", integration.configured ? "READY" : "SETUP"));
    card.append(node("strong", "", integration.name));
    card.append(node("small", "", integration.detail));
    list.append(card);
  });
}

function renderStaffUsers(users = []) {
  const list = $("#staffUserList");
  if (!list) return;
  list.textContent = "";
  const staff = users.filter((user) => ["Police Officer", "Admin"].includes(user.role));
  if (!staff.length) {
    const empty = node("article", "empty-state");
    empty.append(node("strong", "", "No staff accounts configured."));
    list.append(empty);
    return;
  }
  staff.forEach((user) => {
    const card = node("article", "staff-user-card");
    card.append(node("strong", "", user.name), node("small", "", user.email), node("span", "source-badge online", user.role));
    list.append(card);
  });
}

async function suggestPoliceRoute() {
  const routeSummary = $("#routeSummary");
  const incident = activeIncident();
  if (!incident) {
    routeSummary.textContent = "Select an active incident before requesting a unit recommendation.";
    return;
  }
  routeSummary.textContent = `Finding the nearest available unit for ${incident.title}...`;
  const result = await api(`/api/incidents/${incident.id}/recommend-unit`, { method: "POST" });
  state.selectedIncidentId = incident.id;
  routeSummary.textContent = `${result.unit.unitCode} recommended: ${result.incident.distanceKm} km, ${result.incident.etaMinutes} min ETA.`;
  await refresh();
}

function setLiveVisionStatus(title, detail = "") {
  setText("#liveDetectionState", title);
  setText("#liveDetectionDetail", detail);
}

function liveVisionError(message = "") {
  const el = $("#liveVisionError");
  if (el) el.textContent = message;
}

function hasStoredSession() {
  return Boolean(localStorage.getItem("rakshakai_session_token") || sessionStorage.getItem("rakshakai_session_token"));
}

function stopLiveVisionAnalysis(message = "") {
  if (state.liveVisionTimer) {
    clearInterval(state.liveVisionTimer);
    state.liveVisionTimer = null;
  }
  state.liveVisionBusy = false;
  state.liveVisionAnalysisPaused = true;
  if (message) {
    liveVisionError(message);
    setLiveVisionStatus("Scan interrupted", message);
  }
}

function startLiveVisionAnalysis() {
  if (!state.liveVisionStream) return;
  if (!state.user && !hasStoredSession()) {
    stopLiveVisionAnalysis("Session expired or authentication missing. Please login again.");
    return;
  }
  if (state.liveVisionTimer) clearInterval(state.liveVisionTimer);
  state.liveVisionAnalysisPaused = false;
  setLiveVisionStatus("Scanning", "Capturing one frame every 2 seconds.");
  state.liveVisionTimer = setInterval(captureLiveVisionFrame, 2000);
  captureLiveVisionFrame();
}

function stopLiveVision() {
  stopLiveVisionAnalysis();
  if (state.liveVisionStream) {
    state.liveVisionStream.getTracks().forEach((track) => track.stop());
    state.liveVisionStream = null;
  }
  const video = $("#liveVisionVideo");
  const placeholder = $("#liveVisionPlaceholder");
  if (video) {
    video.pause();
    video.srcObject = null;
    video.removeAttribute("src");
  }
  if (placeholder) placeholder.textContent = "Camera inactive";
  if (placeholder) placeholder.hidden = false;
  $("#startLiveVision").disabled = false;
  $("#stopLiveVision").disabled = true;
  setLiveVisionStatus("Idle", "Start camera to begin frame analysis.");
}

async function startLiveVision() {
  liveVisionError("");
  if (!navigator.mediaDevices?.getUserMedia) {
    liveVisionError("Camera API is not supported in this browser.");
    setText("#liveSourceHealth", "Unavailable");
    return;
  }
  try {
    $("#startLiveVision").disabled = true;
    setLiveVisionStatus("Requesting camera", "Waiting for permission...");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    state.liveVisionStream = stream;
    const video = $("#liveVisionVideo");
    video.srcObject = stream;
    await video.play();
    $("#stopLiveVision").disabled = false;
    $("#liveVisionPlaceholder").hidden = true;
    setText("#liveSourceHealth", "Online");
    startLiveVisionAnalysis();
  } catch (error) {
    stopLiveVision();
    const denied = error.name === "NotAllowedError" || error.name === "SecurityError";
    liveVisionError(denied ? "Camera permission denied. Allow camera access and retry." : "Camera unavailable. Check device camera and retry.");
    setText("#liveSourceHealth", denied ? "Permission denied" : "Unavailable");
  }
}

async function captureLiveVisionFrame() {
  if (state.liveVisionBusy || state.liveVisionAnalysisPaused || !state.liveVisionStream) return;
  const video = $("#liveVisionVideo");
  const canvas = $("#liveVisionCanvas");
  if (!video?.videoWidth || !video?.videoHeight) return;
  state.liveVisionBusy = true;
  try {
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/jpeg", $("#emergencyMode").checked ? 0.82 : 0.68);
    const result = await api("/api/rakshak/analyze-frame", {
      method: "POST",
      body: {
        sourceType: "phone_camera",
        sourceName: "Rakshak Live Vision",
        timestamp: new Date().toISOString(),
        sosMode: $("#emergencyMode").checked,
        image
      }
    });
    if (result.mode === "service-unavailable") {
      setLiveVisionStatus("AI service unavailable", result.error || "Configure AI_SERVICE_URL to analyze live frames.");
    } else {
      setLiveVisionStatus(result.threatDetected ? "Threat detected" : "No threat detected", `${result.message} - ${Math.round((result.confidence || 0) * 100)}% confidence`);
    }
    if (result.incident) {
      setText("#liveLatestAlert", result.alert?.message || displayIncidentType(result.incident.type));
      setText("#liveLatestAlertDetail", `${result.incident.occurrenceCount || 1} occurrence(s) · ${alertTime(result.incident.lastDetectedAt || result.incident.timestamp)}`);
      await refresh();
    }
  } catch (error) {
    if (error.status === 401 || /Authentication required/i.test(error.message)) {
      stopLiveVisionAnalysis("Session expired or authentication missing. Please login again.");
    } else {
      liveVisionError(`Frame analysis unavailable: ${error.message}`);
      setLiveVisionStatus("Scan interrupted", "The camera remains active; analysis will retry.");
    }
  } finally {
    state.liveVisionBusy = false;
  }
}

async function refresh() {
  const me = await api("/api/me");
  state.user = me.user;
  applyRoleAccess();
  const operator = isOperatorRole();
  const admin = isAdminRole();
  const [dashboard, reports, zones, incidents, alerts, cameras, sources, units, devices, audits, integrations, staffUsers] = await Promise.all([
    operator ? api("/api/dashboard/summary") : Promise.resolve({ summary: {} }),
    api("/api/reports"),
    operator ? api("/api/zones") : Promise.resolve({ zones: [] }),
    operator ? api("/api/incidents") : Promise.resolve({ incidents: [] }),
    operator ? api("/api/alerts") : Promise.resolve({ alerts: [] }),
    operator ? api("/api/camera-feeds") : Promise.resolve({ cameras: [] }),
    operator ? api("/api/camera-sources") : Promise.resolve({ sources: [] }),
    operator ? api("/api/response-units") : Promise.resolve({ units: [] }),
    admin ? api("/api/devices/health") : Promise.resolve({ devices: [] }),
    admin ? api("/api/audit-logs") : Promise.resolve({ auditLogs: [] }),
    admin ? api("/api/integrations/status") : Promise.resolve({ integrations: [] }),
    admin ? api("/api/admin/users") : Promise.resolve({ users: [] })
  ]);
  setText("#currentUser", me.user ? `${me.user.role}: ${me.user.name}` : "Not signed in");
  setText("#activeIncidentMetric", dashboard.summary.activeIncidents ?? "--");
  setText("#criticalAlertMetric", dashboard.summary.criticalAlerts ?? "--");
  setText("#cameraMetric", dashboard.summary.camerasOnline ?? "--");
  setText("#cameraStatus", "Enabled sources reporting online");
  setText("#unitsAvailableMetric", dashboard.summary.unitsAvailable ?? "--");
  setText("#avgEtaMetric", dashboard.summary.averageEtaMinutes === null ? "--" : `${dashboard.summary.averageEtaMinutes} min`);
  setText("#queueCount", `${dashboard.summary.activeIncidents ?? 0} active`);
  state.responseUnits = units.units;
  renderIncidents(incidents.incidents);
  if (operator && !state.responseUnits.length) setText("#routeSummary", "No response units configured. Add units to enable dispatch.");
  renderCameras(cameras.cameras);
  renderSources(sources.sources);
  $("#zoneTable").textContent = "";
  zones.zones.forEach((z) => $("#zoneTable").append(node("div", "", `${z.name}: ${z.currentDensity}% (${z.severity})`)));
  $("#caseList").textContent = "";
  reports.reports.forEach((r) => $("#caseList").append(reportCard(r)));
  renderAlerts(alerts.alerts);
  $("#deviceList").textContent = "";
  devices.devices.forEach((d) => $("#deviceList").append(node("article", "", `${d.name} - ${d.status} - ${d.zone}`)));
  $("#auditList").textContent = "";
  audits.auditLogs.slice(0, 6).forEach((a) => $("#auditList").append(node("article", "", `${a.action} - ${a.actorName}`)));
  renderIntegrations(integrations.integrations);
  renderStaffUsers(staffUsers.users);
  if (isOperatorRole()) {
    const history = await api("/api/incidents/history");
    renderHistory(history.incidents);
  } else {
    renderHistory([]);
  }
}

async function checkSession() {
  const me = await api("/api/me");
  if (!me.user) {
    showPortal();
    return false;
  }
  state.user = me.user;
  showApp();
  return true;
}

$$(".nav-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
$$("[data-layer]").forEach((button) => button.addEventListener("click", () => setLayer(button.dataset.layer)));
$$("[data-view-jump]").forEach((button) =>
  button.addEventListener("click", () => {
    if (button.dataset.viewJump === "live-vision" && normalizeRole(state.user?.role) === "citizen") {
      state.sosLiveVisionAllowed = true;
      $("#emergencyMode").checked = true;
    }
    setView(button.dataset.viewJump);
  })
);
$("#navigateMap").addEventListener("click", calculateMapRoute);
$("#recalculateRoute").addEventListener("click", calculateMapRoute);
$("#clearMapRoute").addEventListener("click", clearMapRoute);
$("#setMapStart").addEventListener("click", () => {
  if (!isOperatorRole()) {
    updateMapRouteUI("Route navigation is available to Police Officer and Admin users.");
    return;
  }
  state.mapNavigation.manualStartMode = !state.mapNavigation.manualStartMode;
  $("#setMapStart").classList.toggle("active", state.mapNavigation.manualStartMode);
  updateMapRouteUI(
    state.mapNavigation.manualStartMode
      ? "Click the map to choose a start point."
      : "Start point selection cancelled."
  );
});
$("#cameraGridLarge").addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-camera-config]");
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Saving";
  try {
    await api(`/api/camera-sources/${form.dataset.cameraConfig}/config`, {
      method: "PATCH",
      body: { rtspUrl: new FormData(form).get("rtspUrl") }
    });
    await refresh();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Save";
  }
});
$("#cameraGridLarge").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-camera-test]");
  if (!button) return;
  button.disabled = true;
  button.textContent = "Testing";
  try {
    const result = await api(`/api/camera-sources/${button.dataset.cameraTest}/test`, { method: "POST" });
    alert(result.message);
    await refresh();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Test";
  }
});
$("#startLiveVision").addEventListener("click", startLiveVision);
$("#stopLiveVision").addEventListener("click", stopLiveVision);
$("#retryLiveVision").addEventListener("click", async () => {
  liveVisionError("");
  try {
    const me = await api("/api/me");
    state.user = me.user;
    if (!state.user) {
      stopLiveVisionAnalysis("Session expired or authentication missing. Please login again.");
      return;
    }
    if (state.liveVisionStream) {
      startLiveVisionAnalysis();
      return;
    }
    await startLiveVision();
  } catch (error) {
    stopLiveVisionAnalysis("Session expired or authentication missing. Please login again.");
  }
});
window.addEventListener("beforeunload", stopLiveVision);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && document.body.dataset.view === "live-vision") stopLiveVision();
});
$("#runAiScan").addEventListener("click", async () => { await api("/api/ai/run-scan", { method: "POST" }); setLayer("heatmap"); await refresh(); });
$("#createIncident").addEventListener("click", () => alert("Create incidents through connected alerts, reports, or POST /api/incidents."));
$("#assignIncident").addEventListener("click", async () => { const i = activeIncident(); if (i) await api(`/api/incidents/${i.id}/assign-unit`, { method: "POST", body: { unitId: i.recommendedUnitId } }); await refresh(); });
$("#routeIncident").addEventListener("click", async () => { try { await suggestPoliceRoute(); } catch (error) { $("#routeSummary").textContent = `Route unavailable: ${error.message}`; } });
$("#closeIncident").addEventListener("click", async () => { const i = activeIncident(); if (i) await api(`/api/incidents/${i.id}/close`, { method: "POST" }); state.selectedIncidentId = null; await refresh(); });
$("#manualAlertForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = $("#manualAlertError");
  error.textContent = "";
  const data = new FormData(form);
  const zone = String(data.get("zone") || "All Zones").trim();
  const lat = Number(data.get("lat"));
  const lng = Number(data.get("lng"));
  const location = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : zoneLocation(zone);
  try {
    await api("/api/send-alert", {
      method: "POST",
      body: {
        type: data.get("type"),
        severity: data.get("severity"),
        zone,
        message: data.get("message"),
        location
      }
    });
    state.alertFilter = "all";
    form.reset();
    form.elements.type.value = "Emergency Broadcast";
    form.elements.severity.value = "critical";
    form.elements.zone.value = "All Zones";
    await refresh();
  } catch (submitError) {
    error.textContent = submitError.message;
  }
});
$("#alertFilters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-alert-filter]");
  if (!button) return;
  state.alertFilter = button.dataset.alertFilter;
  renderAlerts(state.alerts);
});
$("#alertGrid").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-alert-ack]");
  if (button) {
    await api(`/api/alerts/${button.dataset.alertAck}/acknowledge`, { method: "POST" });
    await refresh();
    return;
  }
  const actionButton = event.target.closest("[data-alert-action]");
  if (!actionButton) return;
  const alertRecord = state.alerts.find((item) => item.id === actionButton.dataset.alertId);
  if (!alertRecord) return;
  const incident = state.incidents.find((item) => item.id === alertRecord.incidentId);
  if (actionButton.dataset.alertAction === "map" || actionButton.dataset.alertAction === "navigate") {
    focusIncidentOnMap(incident || {
      id: alertRecord.incidentId,
      title: alertRecord.title,
      lat: alertRecord.lat,
      lng: alertRecord.lng
    });
    if (actionButton.dataset.alertAction === "navigate") {
      setText("#mapNavigationStatus", "Destination selected. Choose a start point or use the map center, then click Navigate.");
    }
    return;
  }
  if (actionButton.dataset.alertAction === "incident" && incident) {
    state.selectedIncidentId = incident.id;
    setView("dashboard");
    renderIncidents(state.incidents);
    return;
  }
  if (actionButton.dataset.alertAction === "assign" && incident) {
    if (!incident.recommendedUnitId) await api(`/api/incidents/${incident.id}/recommend-unit`, { method: "POST" });
    const current = await api(`/api/incidents/${incident.id}`);
    await api(`/api/incidents/${incident.id}/assign-unit`, { method: "POST", body: { unitId: current.incident.recommendedUnitId } });
    state.selectedIncidentId = incident.id;
    await refresh();
  }
});
$("#clearAlerts").addEventListener("click", async () => {
  if (!confirm("Clear all active alerts? This will mark them as closed.")) return;
  await api("/api/alerts/clear", { method: "PATCH" });
  state.alertFilter = "all";
  await refresh();
});
$("#clearHistory").addEventListener("click", async () => {
  if (!confirm("Clear closed incident history? Active incidents will stay.")) return;
  await api("/api/incidents/history", { method: "DELETE" });
  await refresh();
});
$("#staffAccountForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $("#staffAccountStatus");
  const submit = form.querySelector("button[type='submit']");
  status.className = "form-status";
  status.textContent = "";
  submit.disabled = true;
  try {
    const data = new FormData(form);
    const result = await api("/api/admin/users", {
      method: "POST",
      body: {
        name: data.get("name"),
        email: data.get("email"),
        password: data.get("password"),
        role: data.get("role")
      }
    });
    status.classList.add("success");
    status.textContent = `${result.user.role} account created for ${result.user.name}.`;
    form.reset();
    await refresh();
  } catch (error) {
    status.classList.add("error");
    status.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});
$("#personFile").addEventListener("change", async (event) => {
  try {
    state.pendingReportFile = await resizeReportImage(event.currentTarget.files[0]);
    updateReportFilePreview(state.pendingReportFile);
  } catch (error) {
    state.pendingReportFile = null;
    updateReportFilePreview(null);
    alert(error.message);
  }
});
$("#missingForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#registerReportBtn");
  const status = $("#missingFormStatus");
  const data = new FormData(form);
  const personName = String(data.get("personName") || "").trim();
  const lastSeenLocation = String(data.get("lastSeen") || "").trim();
  status.className = "form-status";
  status.textContent = "";
  if (!personName || !lastSeenLocation) {
    status.classList.add("error");
    status.textContent = "Enter the missing person name and last seen location.";
    return;
  }
  button.disabled = true;
  button.textContent = "Registering...";
  try {
    const created = await api("/api/report-missing", {
      method: "POST",
      body: {
        name: personName,
        age: data.get("age"),
        lastSeenLocation,
        image: state.pendingReportFile?.dataUrl || null,
        imageName: state.pendingReportFile?.name || null
      }
    });
    if (created.report) {
      $("#caseList").prepend(reportCard(created.report));
    }
    state.pendingReportFile = null;
    form.reset();
    updateReportFilePreview(null);
    status.classList.add("success");
    status.textContent = `Report registered for ${created.report?.name || personName}. Incident and alert created.`;
    await refresh().catch((refreshError) => {
      console.warn("Report saved, but dashboard refresh failed.", refreshError);
    });
  } catch (error) {
    status.classList.add("error");
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Register Report";
  }
});
$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#loginError").textContent = "";
  const data = new FormData(event.currentTarget);
  try {
    const login = await api("/api/login", {
      method: "POST",
      body: { email: data.get("email"), password: data.get("password") }
    });
    state.user = login.user;
    showApp();
    await refresh();
    setView(location.pathname === "/rakshak/live-vision" ? "live-vision" : landingForRole(state.user.role));
  } catch (error) {
    showPortal(error.message);
  }
});

$("#registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#registerError").textContent = "";
  const data = new FormData(event.currentTarget);
  try {
    const created = await api("/api/register", {
      method: "POST",
      body: {
        name: data.get("name"),
        email: data.get("email"),
        password: data.get("password"),
        role: data.get("role")
      }
    });
    state.user = created.user;
    showApp();
    await refresh();
    setView(location.pathname === "/rakshak/live-vision" ? "live-vision" : landingForRole(state.user.role));
  } catch (error) {
    showPortal(error.message, "register");
  }
});

$$("[data-demo-login]").forEach((button) => {
  button.addEventListener("click", () => {
    setAuthMode("login");
    $("#loginForm input[name='email']").value = button.dataset.demoLogin;
    $("#loginForm input[name='password']").value = "demo123";
  });
});

$$("[data-auth-mode]").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
});

$$("[data-password-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = button.closest(".password-field")?.querySelector("input");
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.setAttribute("aria-label", show ? "Hide password" : "Show password");
    button.setAttribute("aria-pressed", String(show));
  });
});

$("#logoutButton").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  state.user = null;
  applyRoleAccess();
  showPortal("Logged out successfully.");
});

initSatelliteMaps();
initLeafletGisMap();

checkSession()
  .then(async (hasSession) => {
    if (hasSession) {
      await refresh();
      setView(location.pathname === "/rakshak/live-vision" ? "live-vision" : landingForRole(state.user.role));
    }
  })
  .catch((error) => {
    $("#currentUser").textContent = "API unavailable";
    showPortal("Start the server with npm.cmd start.");
    console.error(error);
  });
