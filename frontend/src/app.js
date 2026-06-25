import "./styles.css";
import { api } from "./services/api.js";
import { beepCooldownReady, duplicateObservation, shouldPlayAlertBeep, surveillanceSeverity } from "./liveVisionPolicy.js";

const state = {
  incidents: [],
  selectedIncidentId: null,
  user: null,
  pendingReportFile: null,
  alertFilter: "all",
  alerts: [],
  reports: [],
  responseUnits: [],
  zones: [],
  cameraSources: [],
  liveVisionStream: null,
  liveVisionTimer: null,
  liveVisionBusy: false,
  liveVisionAnalysisPaused: false,
  liveVisionIntervalMs: Math.max(800, Math.min(1500, Number(import.meta.env.VITE_AI_FRAME_INTERVAL_MS) || 1000)),
  liveVisionLastAnalyzedAt: null,
  liveVisionLastBeepAt: NaN,
  liveVisionMuted: false,
  liveVisionNotifications: [],
  liveVisionRecentObjects: [],
  mapNavigation: { start: null, destination: null, route: null, manualStartMode: false },
  sosLiveVisionAllowed: location.pathname === "/rakshak/live-vision"
};
const satelliteMaps = [];
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

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const setText = (selector, value) => {
  const el = $(selector);
  if (el) el.textContent = value;
};

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

const DISPLAY_LABELS = {
  under_review: "Under Review",
  "under review": "Under Review",
  active: "Active Search",
  resolved: "Resolved",
  closed: "Closed",
  rejected: "Rejected / False Report",
  false_alarm: "Rejected / False Report",
  "false alarm": "Rejected / False Report",
  missing_person: "Missing Person",
  "missing person": "Missing Person",
  missing_object: "Missing Object",
  "missing object": "Missing Object",
  emergency_report: "Emergency Report",
  "emergency report": "Emergency Report"
};

function titleCase(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(value, fallback = "Not provided") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const key = raw.toLowerCase().replace(/-/g, "_");
  return DISPLAY_LABELS[key] || DISPLAY_LABELS[key.replace(/_/g, " ")] || titleCase(raw);
}

function displayLocation(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Not provided";
  return raw
    .replace(/\bpatancheru\b/gi, "Patancheru")
    .replace(/\bbanglore\b/gi, "Bangalore")
    .replace(/\bmissing person\b/gi, "Missing Person")
    .replace(/\bmissing object\b/gi, "Missing Object");
}

function statusClass(value) {
  return `status-${String(value || "under_review").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

const ACTIVE_REPORT_STATUSES = new Set(["under_review", "active", "verified", "assigned", "en_route", "on_scene", "submitted_for_review", "possible_match"]);

function isActiveReport(report) {
  const status = String(report?.status || "").toLowerCase().replace(/\s+/g, "_");
  return ACTIVE_REPORT_STATUSES.has(status) && !["resolved", "closed", "rejected", "false_alarm", "duplicate"].includes(status);
}

function incidentTitle(incident) {
  return incident?.displayTitle || displayValue(incident?.title || incident?.type, "Incident");
}

function incidentSource(incident) {
  return incident?.displaySource || displayValue(incident?.source || incident?.sourceType, "Command Center");
}

function incidentSafetyLabel(incident) {
  if (!incidentCoordinates(incident, "location", null)) return "Location missing — verify before dispatch";
  return incident?.locationSafetyLabel || (incident.locationStatus === "Verified" ? "Ready for dispatch" : "Location approximate");
}

function isDispatchableIncident(incident) {
  return Boolean(incident?.dispatchable && incidentCoordinates(incident, "location", null));
}

function setView(view) {
  if (document.body.dataset.view === "live-vision" && view !== "live-vision") stopLiveVision();
  const nav = [...$$(".nav-item")].find((button) => button.dataset.view === view);
  if (nav?.hidden) {
    const permission = $("#permissionMessage");
    if (permission && state.user?.role === "Citizen") {
      permission.textContent = "You do not have permission to view operational AI monitoring.";
      permission.classList.remove("restricted-hidden");
    }
    view = landingForRole(state.user?.role);
  } else {
    $("#permissionMessage")?.classList.add("restricted-hidden");
  }
  $$(".nav-item").forEach((b) => {
    const isActive = b.dataset.view === view;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-current", isActive ? "page" : "false");
  });
  $$("[data-panel]").forEach((p) => p.classList.toggle("active", p.dataset.panel === view));
  $("#viewTitle").textContent = {
    dashboard: "Sector 7 Safety Grid",
    "incident-command": "Incident Command",
    gis: "GIS Monitoring",
    cctv: "CCTV Monitoring",
    "live-vision": "Rakshak Live Vision",
    missing: "Missing & Found Report Center",
    alerts: "Emergency Alert Center",
    history: "Incident History",
    settings: "System Settings"
  }[view] || "RakshakAI";
  document.body.dataset.view = view;
  if (view === "incident-command") renderIncidentCommand();
  requestAnimationFrame(renderSatelliteMaps);
}

function rolesFor(button) {
  return String(button.dataset.roles || "")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
}

function canSee(button, role) {
  const roles = rolesFor(button);
  return roles.length === 0 || roles.includes(role);
}

function isOperatorRole() {
  return ["Police Officer", "Admin"].includes(state.user?.role);
}

function isAdminRole() {
  return state.user?.role === "Admin";
}

function landingForRole(role) {
  if (role === "Citizen") return "missing";
  if (role === "Admin") return "dashboard";
  return "dashboard";
}

function applyRoleAccess() {
  const role = state.user?.role;
  $$(".nav-item").forEach((button) => {
    button.hidden = !canSee(button, role);
  });
  $("#runAiScan").classList.toggle("restricted-hidden", !isOperatorRole());
  $("#assignIncident").classList.toggle("restricted-hidden", !isOperatorRole());
  $("#routeIncident").classList.toggle("restricted-hidden", !isOperatorRole());
  $("#closeIncident").classList.toggle("restricted-hidden", !isOperatorRole());
  $("#createIncident").classList.toggle("restricted-hidden", !isOperatorRole());
  $("#sendAlert").classList.toggle("restricted-hidden", !isOperatorRole());
  $("#clearAlerts").classList.toggle("restricted-hidden", !isOperatorRole());
  $("#clearHistory").classList.toggle("restricted-hidden", !isOperatorRole());
  $("#manualAlertForm").classList.toggle("restricted-hidden", !isOperatorRole());
  const caseQueuePanel = $("#caseQueuePanel");
  if (caseQueuePanel) caseQueuePanel.classList.remove("restricted-hidden");
  $(".live-pill")?.classList.toggle("restricted-hidden", role === "Citizen");
  const emergencyMode = $("#emergencyMode");
  if (emergencyMode) {
    emergencyMode.checked = role === "Citizen" || emergencyMode.checked;
    emergencyMode.disabled = role === "Citizen";
  }
  document.body.dataset.role = role || "guest";
}

function setAuthMode(mode = "login", message = "") {
  const isRegister = mode === "register";
  const isSuccess = /successfully|account created|submitted/i.test(message);
  $("[data-auth-panel='login']").classList.toggle("app-hidden", isRegister);
  $("[data-auth-panel='register']").classList.toggle("app-hidden", !isRegister);
  $("#loginError").classList.toggle("success", !isRegister && isSuccess);
  $("#registerError").classList.toggle("success", isRegister && isSuccess);
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

function tileToLatLng(x, y, zoom) {
  const scale = 2 ** zoom;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat, lng };
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
  const button = node("button", "", "Search");
  const results = node("div", "map-search-results");
  input.type = "search";
  input.placeholder = "Search address, landmark, or city";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Search place on map");
  button.type = "submit";
  button.setAttribute("aria-label", "Search map");
  results.hidden = true;
  form.append(input, button, results);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    button.disabled = true;
    results.hidden = true;
    instance.status.textContent = `Searching for ${query}`;
    try {
      const places = await geocodePlaces(query);
      results.textContent = "";
      if (!places.length) {
        results.append(node("p", "map-search-empty", "No places found"));
      } else {
        places.forEach((place) => {
          const option = node("button", "map-search-result");
          option.type = "button";
          option.append(
            node("strong", "", place.shortName || place.name),
            node("small", "", place.displayName || place.name),
            node("small", place.confidence === "low" ? "location-warning" : "", `${place.type || "place"} · ${place.confidence || "unknown"} confidence`)
          );
          option.addEventListener("click", () => {
            selectMapPlace(instance, place);
            input.value = place.shortName || place.name;
            results.hidden = true;
          });
          results.append(option);
        });
      }
      results.hidden = false;
      instance.status.textContent = `${places.length} search result${places.length === 1 ? "" : "s"}`;
    } catch {
      instance.status.textContent = "Place search is temporarily unavailable";
    } finally {
      button.disabled = false;
    }
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
  clearDynamicMapMarkers(instance);

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
  renderNavigationOverlay(instance);
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
  updateMapAttribution(instance);
  if (instance.map.id === "gisMap") {
    setText("#toggleMapLayer", instance.baseLayer === "satellite" ? "Street View" : "Satellite View");
  }
  renderSatelliteMap(instance);
}

function updateMapAttribution(instance) {
  if (!instance.attribution) return;
  instance.attribution.innerHTML = instance.baseLayer === "satellite"
    ? 'Tiles &copy; Esri, Maxar, Earthstar Geographics'
    : '&copy; OpenStreetMap contributors';
}

function fallbackGeocode(query) {
  const normalized = query.toLowerCase();
  return FALLBACK_PLACES.find((place) => normalized.includes(place.name.toLowerCase()) || place.name.toLowerCase().includes(normalized));
}

async function geocodePlaces(query) {
  const fallback = fallbackGeocode(query);
  try {
    const data = await api(`/api/maps/search?q=${encodeURIComponent(query)}`);
    if (data.results?.length) return data.results;
  } catch (error) {
    if (fallback) return [{ ...fallback, shortName: fallback.name, displayName: fallback.name, type: "local fallback", confidence: "low", locationStatus: "Approximate" }];
    throw error;
  }
  return fallback ? [{ ...fallback, shortName: fallback.name, displayName: fallback.name, type: "local fallback", confidence: "low", locationStatus: "Approximate" }] : [];
}

function selectMapPlace(instance, place) {
  const point = validMapPoint(place);
  if (!point) return updateNavigationPanel("The selected search result has invalid coordinates.");
  instance.zoom = Math.max(instance.zoom, 14);
  instance.center = latLngToTile(point.lat, point.lng, instance.zoom);
  instance.placeLabel = place.shortName || place.name;
  state.mapNavigation.destination = {
    ...point,
    label: place.displayName || place.name,
    type: place.type,
    confidence: place.confidence,
    locationStatus: place.locationStatus || (place.confidence === "low" ? "Approximate" : "Verified")
  };
  state.mapNavigation.route = null;
  updateNavigationPanel(place.confidence === "low"
    ? "Low-confidence search result selected. Verify the location before dispatch."
    : "Destination selected. Click Navigate to calculate a route.");
  renderSatelliteMap(instance);
}

async function reverseGeocodePoint(point) {
  const data = await api(`/api/maps/reverse?lat=${encodeURIComponent(point.lat)}&lng=${encodeURIComponent(point.lng)}`);
  return data.place || null;
}

function pointToMapPixel(instance, point) {
  const tile = latLngToTile(point.lat, point.lng, instance.zoom);
  return {
    x: (tile.x - instance.center.x) * TILE_SIZE + instance.map.clientWidth / 2,
    y: (tile.y - instance.center.y) * TILE_SIZE + instance.map.clientHeight / 2
  };
}

function renderNavigationOverlay(instance) {
  if (!instance.navigationLayer) return;
  instance.navigationLayer.textContent = "";
  const { start, destination, route } = state.mapNavigation;
  if (route?.geometry?.length) {
    const points = route.geometry.map(([lat, lng]) => pointToMapPixel(instance, { lat, lng }));
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
    polyline.setAttribute("class", "route-line");
    instance.navigationLayer.append(polyline);
  }
  [
    [start, "route-marker start-marker", "S"],
    [destination, "route-marker destination-marker", "D"]
  ].forEach(([point, className, label]) => {
    if (!point) return;
    const pixel = pointToMapPixel(instance, point);
    const marker = node("span", className, label);
    marker.style.left = `${pixel.x}px`;
    marker.style.top = `${pixel.y}px`;
    instance.map.append(marker);
    instance.dynamicMarkers.push(marker);
  });
  if (!["gisMap", "commandMap"].includes(instance.map.id)) return;
  state.zones.forEach((zone) => {
    if (!Number.isFinite(Number(zone.lat)) || !Number.isFinite(Number(zone.lng))) return;
    const pixel = pointToMapPixel(instance, zone);
    const marker = node("span", `operational-marker zone-marker zone-${zone.severity || "safe"}`, "Z");
    marker.style.left = `${pixel.x}px`;
    marker.style.top = `${pixel.y}px`;
    marker.title = `${zone.name}: ${zone.currentDensity}% density`;
    instance.map.append(marker);
    instance.dynamicMarkers.push(marker);
  });
  state.incidents.forEach((incident) => {
    const point = incidentCoordinates(incident, "location", null);
    if (!point) return;
    const pixel = pointToMapPixel(instance, point);
    const selected = incident.id === state.selectedIncidentId ? " selected" : "";
    const marker = node("span", `operational-marker incident-marker ${sevClass(incident.severity)}${selected}`, "!");
    marker.style.left = `${pixel.x}px`;
    marker.style.top = `${pixel.y}px`;
    marker.title = `${incident.type} - ${incident.zone}`;
    marker.addEventListener("pointerdown", (event) => event.stopPropagation());
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedIncidentId = incident.id;
      focusIncidentOnCommandMap(incident);
      renderIncidentCommand();
    });
    instance.map.append(marker);
    instance.dynamicMarkers.push(marker);
  });
  if (instance.map.id === "commandMap") {
    state.responseUnits.forEach((unit) => {
      if (!Number.isFinite(Number(unit.lat)) || !Number.isFinite(Number(unit.lng))) return;
      const pixel = pointToMapPixel(instance, unit);
      const marker = node("span", "operational-marker unit-marker", unit.status === "available" ? "U" : "B");
      marker.style.left = `${pixel.x}px`;
      marker.style.top = `${pixel.y}px`;
      marker.title = `${unit.unitCode}: ${unit.status}`;
      marker.addEventListener("pointerdown", (event) => event.stopPropagation());
      instance.map.append(marker);
      instance.dynamicMarkers.push(marker);
    });
  }
}

function clearDynamicMapMarkers(instance) {
  (instance.dynamicMarkers || []).forEach((marker) => marker.remove());
  instance.dynamicMarkers = [];
}

function updateNavigationPanel(message = "") {
  const { start, destination, route } = state.mapNavigation;
  setText("#routeDistance", route ? `${route.distanceKm} km` : "--");
  setText("#routeEta", route?.durationMinutes ? `${route.durationMinutes} min` : "--");
  setText("#routeProvider", route ? (route.approximate ? "Approximate distance" : "OSRM driving route") : "No route");
  setText("#routePoints", `${start?.label || "Start not selected"} to ${destination?.label || "destination not selected"}`);
  setText("#routeStartCoordinates", start ? `Start: ${start.lat.toFixed(5)}, ${start.lng.toFixed(5)}` : "Start: --");
  setText("#routeDestinationCoordinates", destination ? `Destination: ${destination.lat.toFixed(5)}, ${destination.lng.toFixed(5)}` : "Destination: --");
  setText("#routeCalculatedAt", route?.calculatedAt ? `Calculated: ${new Date(route.calculatedAt).toLocaleString()}` : "Calculated: --");
  const steps = $("#routeSteps");
  if (steps) {
    steps.textContent = "";
    (route?.steps?.length ? route.steps : ["Choose a start and destination to begin."]).forEach((step) => {
      steps.append(node("li", "", step));
    });
  }
  if (message) setText("#mapNavigationStatus", message);
  const externalRoute = $("#openExternalRoute");
  if (externalRoute) externalRoute.disabled = !(start && destination);
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

  const stopDrag = async (event) => {
    if (!drag.active) return;
    const wasMoved = drag.moved;
    drag.active = false;
    instance.map.classList.remove("map-dragging");
    instance.map.releasePointerCapture?.(event.pointerId);
    if (!wasMoved && instance.map.id === "gisMap" && !event.target.closest(".map-control, .map-zoom-slider, .map-search")) {
      const rect = instance.map.getBoundingClientRect();
      const tileX = instance.center.x + (event.clientX - rect.left - rect.width / 2) / TILE_SIZE;
      const tileY = instance.center.y + (event.clientY - rect.top - rect.height / 2) / TILE_SIZE;
      const point = tileToLatLng(tileX, tileY, instance.zoom);
      const selectingStart = state.mapNavigation.manualStartMode;
      const validPoint = validMapPoint(point);
      if (!validPoint) return updateNavigationPanel("The selected map point is invalid.");
      if (state.mapNavigation.manualStartMode) {
        state.mapNavigation.start = { ...validPoint, label: "Manual start point" };
        state.mapNavigation.manualStartMode = false;
        $("#setMapStart").classList.remove("active");
        updateNavigationPanel("Manual start point selected.");
      } else {
        state.mapNavigation.destination = null;
        updateNavigationPanel("Checking the selected coordinates...");
      }
      state.mapNavigation.route = null;
      renderSatelliteMap(instance);
      try {
        const place = await reverseGeocodePoint(validPoint);
        const confirmed = window.confirm(`Use this location?\n\nCoordinates: ${validPoint.lat.toFixed(5)}, ${validPoint.lng.toFixed(5)}\nAddress: ${place?.displayName || place?.name || "Address unavailable"}`);
        if (!confirmed) {
          updateNavigationPanel("Map location selection cancelled.");
          renderSatelliteMap(instance);
          return;
        }
        const target = selectingStart
          ? state.mapNavigation.start
          : (state.mapNavigation.destination = { ...validPoint, label: place?.displayName || place?.name || "Selected map point", locationStatus: "Approximate" });
        if (place && target) {
          target.label = place.displayName || place.name;
          instance.placeLabel = place.shortName || place.name;
          updateNavigationPanel(selectingStart
            ? "Start location identified. Choose a destination."
            : "Destination identified. Click Navigate to calculate a route.");
          renderSatelliteMap(instance);
        }
      } catch {
        if (!selectingStart) updateNavigationPanel("Address verification failed. Select the point again when geocoding is available.");
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
    const navigationLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    navigationLayer.setAttribute("class", "route-overlay");
    const status = node("span", "map-status", "Loading map tiles");
    const attribution = node("span", "map-attribution");
    const controls = node("div", "map-controls");
    const instance = { map, layer, navigationLayer, status, attribution, zoom, center, homeZoom: zoom, homeCenter: { ...center }, renderId: 0, baseLayer: "streets", dynamicMarkers: [] };
    const search = makeMapSearch(instance);
    const zoomBadge = node("span", "map-zoom-badge", `z${zoom}`);
    const zoomSlider = makeZoomSlider(instance);
    const panButton = makeMapControl("PAN", "pan-hand", "Hand drag mode", () => togglePanMode(instance));

    instance.zoomBadge = zoomBadge;
    instance.zoomSlider = zoomSlider;
    instance.panButton = panButton;

    updateMapAttribution(instance);

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
    map.append(navigationLayer);
    map.append(search, status, attribution, controls);
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

function renderTimeline(items = []) {
  const list = $("#timeline");
  list.textContent = "";
  (items.length ? items : ["Waiting for command action"]).forEach((item, index, arr) => {
    const li = node("li", index === arr.length - 1 ? "active" : "done");
    li.append(node("span"), document.createTextNode(item));
    list.append(li);
  });
}

function activeIncident() {
  return state.incidents.find((x) => x.id === state.selectedIncidentId) || state.incidents[0];
}

function responseUnit(incident) {
  const unit = incident?.assignedUnit || incident?.recommendedUnit;
  return unit?.unitCode || unit?.name || unit || "nearest unit";
}

function incidentCoordinates(incident, key, fallback) {
  const point = incident?.[key];
  const nested = validMapPoint(point);
  if (nested) return nested;
  if (key === "location") return validMapPoint(incident) || fallback;
  if (key === "unitLocation") {
    const unit = incident?.assignedUnit || incident?.recommendedUnit;
    return validMapPoint(unit) || fallback;
  }
  return fallback;
}

function validMapPoint(point) {
  if (point?.lat === null || point?.lat === undefined || point?.lat === "" || typeof point?.lat === "boolean") return null;
  const rawLng = point?.lng ?? point?.lon;
  if (rawLng === null || rawLng === undefined || rawLng === "" || typeof rawLng === "boolean") return null;
  const lat = Number(point.lat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function routeIntro(incident) {
  if (!incident) return "Open an incident to enable emergency response actions.";
  const unit = responseUnit(incident);
  const eta = incident.etaMinutes ? `${incident.etaMinutes} min ETA` : "ETA pending";
  if (!incidentCoordinates(incident, "location", null)) return "Location missing — verify before dispatch.";
  if (!isDispatchableIncident(incident)) return `${incidentSafetyLabel(incident)}. Dispatch is blocked until verification is complete.`;
  return `Selected ${incident.priority || "P2"} case: ${incident.zone}. Recommended ${unit}, ${eta}.`;
}

function setResponseControls(incident) {
  const enabled = Boolean(incident);
  ["#assignIncident", "#routeIncident", "#closeIncident"].forEach((selector) => {
    const button = $(selector);
    if (button) button.disabled = !enabled;
  });
  const assignButton = $("#assignIncident");
  const routeButton = $("#routeIncident");
  if (assignButton) assignButton.disabled = !(enabled && isDispatchableIncident(incident) && !incident?.assignedUnitId);
  if (routeButton) routeButton.disabled = !(enabled && incidentCoordinates(incident, "location", null));
  const unit = responseUnit(incident);
  setText("#assignIncident", enabled ? `Assign ${unit}` : "Assign Unit");
  setText("#routeIncident", enabled ? "Suggest Route" : "Route Locked");
  setText("#closeIncident", enabled ? "Close Incident" : "Close Incident");
}

function commandMapInstance() {
  return satelliteMaps.find((instance) => instance.map.id === "commandMap");
}

function focusIncidentOnCommandMap(incident) {
  const point = incidentCoordinates(incident, "location", null);
  const instance = commandMapInstance();
  if (!point || !instance) return;
  instance.zoom = Math.max(instance.zoom, 15);
  instance.center = latLngToTile(point.lat, point.lng, instance.zoom);
  instance.placeLabel = incident.address || incident.title || "Selected incident";
  renderSatelliteMap(instance);
}

function renderIncidents(incidents) {
  state.incidents = incidents;
  if (!incidents.length) {
    state.selectedIncidentId = null;
    const wrap = $("#incidentList");
    wrap.textContent = "";
    const empty = node("article", "empty-state");
    empty.append(node("strong", "", "No active incidents"));
    empty.append(node("small", "", "Open an incident to test assignment, routing, and closure."));
    wrap.append(empty);
    renderTimeline(["Waiting for active incident"]);
    setResponseControls(null);
    setText("#routeSummary", routeIntro(null));
    return;
  }
  if (!incidents.some((incident) => incident.id === state.selectedIncidentId)) state.selectedIncidentId = incidents[0]?.id;
  const wrap = $("#incidentList");
  wrap.textContent = "";
  incidents.forEach((incident) => {
    const card = node("article", `incident ${incident.id === state.selectedIncidentId ? "active" : ""}`);
    const btn = node("button", "incident-select");
    btn.type = "button";
    const severity = node("span", `severity ${sevClass(incident.severity)}`, incident.severity);
    const title = node("strong", "", incidentTitle(incident));
    const owner = incident.assignedUnit ? `assigned ${incident.assignedUnit}` : `recommend ${responseUnit(incident)}`;
    const eta = incident.etaMinutes ? `${incident.etaMinutes} min ETA` : "ETA pending";
    const source = incidentSource(incident);
    btn.append(
      severity,
      title,
      node("small", "", `${incident.zone || "Location pending"} - ${displayValue(incident.status)} - ${owner}`),
      node("small", "incident-meta", `${incident.priority || "P2"} - ${source} - ${eta}`),
      node("small", "incident-action", incident.dispatchSafetyLabel || incidentSafetyLabel(incident))
    );
    btn.addEventListener("click", () => {
      state.selectedIncidentId = incident.id;
      focusIncidentOnCommandMap(incident);
      renderIncidents(state.incidents);
      renderTimeline(incident.timeline);
      setText("#routeSummary", routeIntro(incident));
    });
    const navigate = node("button", "ghost incident-navigate", "Navigate to Incident");
    navigate.type = "button";
    navigate.disabled = !incidentCoordinates(incident, "location", null);
    navigate.addEventListener("click", () => navigateToIncident(incident));
    card.append(btn, navigate);
    wrap.append(card);
  });
  const selected = activeIncident();
  renderTimeline(selected?.timeline);
  setResponseControls(selected);
  setText("#routeSummary", routeIntro(selected));
}

async function commandAction(action) {
  const incident = activeIncident();
  if (!incident) return;
  if (action === "navigate") return navigateToIncident(incident);
  if (action === "confirm-location") {
    await api(`/api/incidents/${incident.id}/confirm-location`, { method: "POST" });
  } else if (action === "edit-location") {
    const current = incidentCoordinates(incident, "location", null);
    const lat = window.prompt("Incident latitude (-90 to 90)", current?.lat ?? "");
    if (lat === null) return;
    const lng = window.prompt("Incident longitude (-180 to 180)", current?.lng ?? "");
    if (lng === null) return;
    const point = validMapPoint({ lat, lng });
    if (!point) throw new Error("Enter valid latitude and longitude values.");
    let place = null;
    try { place = await reverseGeocodePoint(point); } catch {}
    const address = window.prompt("Confirm the resolved incident address", place?.displayName || place?.name || incident.address || "");
    if (address === null) return;
    if (!window.confirm(`Save incident location?\n\n${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}\n${address || "Address not supplied"}`)) return;
    await api(`/api/incidents/${incident.id}/location`, {
      method: "PATCH",
      body: { ...point, address, locationStatus: "Verified", confirmed: true }
    });
    state.mapNavigation.route = null;
  } else if (action === "recheck-address") {
    const point = incidentCoordinates(incident, "location", null);
    if (!point) throw new Error("Add valid incident coordinates before rechecking the address.");
    const place = await reverseGeocodePoint(point);
    if (!window.confirm(`Use this resolved address?\n\n${place.displayName || place.name}\n${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`)) return;
    await api(`/api/incidents/${incident.id}/location`, {
      method: "PATCH",
      body: { ...point, address: place.displayName || place.name, locationStatus: "Verified", confirmed: true }
    });
    state.mapNavigation.route = null;
  } else if (action === "assign") {
    await api(`/api/incidents/${incident.id}/assign-nearest`, { method: "POST" });
  } else {
    await api(`/api/incidents/${incident.id}/status`, { method: "PATCH", body: { status: action } });
  }
  await refresh();
}

function renderIncidentCommandDetail(incident) {
  const panel = $("#commandIncidentDetail");
  if (!panel) return;
  panel.textContent = "";
  if (!incident) {
    panel.className = "command-detail-empty";
    panel.textContent = "Select an incident to view command actions.";
    return;
  }
  panel.className = "command-detail";
  const title = node("div", "command-detail-title");
  const heading = node("div");
  heading.append(node("h3", "", incident.title || incident.type), node("small", "", `${incident.category || incident.type} · ${incident.source || incident.sourceType}`));
  title.append(heading, node("span", `severity ${sevClass(incident.severity)}`, incident.severity));
  const grid = node("div", "command-detail-grid");
  [
    ["Status", incident.status],
    ["Location", incident.locationStatus || "Needs Confirmation"],
    ["Address", incident.address || incident.zone],
    ["Reported by", incident.reportedBy || incident.sourceName],
    ["Assigned unit", incident.assignedUnit?.unitCode || "Not assigned"],
    ["Distance", incident.distanceKm ? `${incident.distanceKm} km` : "Pending"],
    ["ETA", incident.etaMinutes ? `${incident.etaMinutes} min` : "Pending"]
  ].forEach(([label, value]) => {
    const item = node("div");
    item.append(node("span", "", label), node("strong", "", value || "--"));
    grid.append(item);
  });
  const actions = node("div", "command-action-grid");
  const addAction = (label, action, className = "ghost") => {
    const button = node("button", className, label);
    button.type = "button";
    button.addEventListener("click", () => commandAction(action).catch((error) => alert(error.message)));
    actions.append(button);
  };
  addAction("Navigate", "navigate");
  if (incident.locationStatus !== "Verified" && incidentCoordinates(incident, "location", null)) addAction("Confirm Location", "confirm-location", "primary");
  addAction("Edit Location", "edit-location");
  if (incidentCoordinates(incident, "location", null)) addAction("Recheck Address", "recheck-address");
  if (incident.status === "New") addAction("Verify", "Verified", "primary");
  if (incident.status === "Verified" && incident.locationStatus === "Verified" && !incident.assignedUnitId) addAction("Assign Nearest Unit", "assign", "primary");
  if (incident.assignedUnitId && incident.status === "Assigned") addAction("Mark En Route", "En Route");
  if (incident.status === "En Route") addAction("Mark On Scene", "On Scene");
  if (incident.status === "On Scene") addAction("Resolve", "Resolved");
  if (incident.status === "Resolved") addAction("Close", "Closed");
  if (["New", "Verified", "Assigned", "En Route", "On Scene"].includes(incident.status)) {
    addAction("Reject False Alarm", "Rejected / False Alarm");
  }
  const timeline = node("ol", "command-timeline");
  (incident.timeline?.length ? incident.timeline : ["Incident awaiting command action"]).forEach((event) => timeline.append(node("li", "", event)));
  if (incident.locationStatus === "Approximate") panel.append(node("p", "location-warning", "Location is approximate. Verify before dispatch."));
  if (incident.locationStatus === "Needs Confirmation") panel.append(node("p", "location-warning", "Location needs confirmation. Automatic dispatch is blocked."));
  panel.append(title, grid, actions, timeline);
}

function renderIncidentCommandDetailSafe(incident) {
  const panel = $("#commandIncidentDetail");
  if (!panel) return;
  panel.textContent = "";
  if (!incident) {
    panel.className = "command-detail-empty";
    panel.textContent = "Select an incident to view command actions.";
    return;
  }
  panel.className = "command-detail";
  const title = node("div", "command-detail-title");
  const heading = node("div");
  heading.append(node("h3", "", incidentTitle(incident)), node("small", "", `${displayValue(incident.category || incident.type)} · ${incidentSource(incident)}`));
  title.append(heading, node("span", `severity ${sevClass(incident.severity)}`, incident.severity));
  const grid = node("div", "command-detail-grid");
  [
    ["Status", displayValue(incident.status)],
    ["Dispatch", incident.dispatchSafetyLabel || (isDispatchableIncident(incident) ? "Ready for dispatch" : "Not dispatchable")],
    ["Location", incidentSafetyLabel(incident)],
    ["Address", incident.address || incident.zone],
    ["Reported by", incident.reportedBy || incident.sourceName],
    ["Assigned unit", incident.assignedUnit?.unitCode || "Not assigned"],
    ["Distance", isDispatchableIncident(incident) && incident.distanceKm ? `${incident.distanceKm} km` : "Pending"],
    ["ETA", isDispatchableIncident(incident) && incident.etaMinutes ? `${incident.etaMinutes} min` : "Pending"]
  ].forEach(([label, value]) => {
    const item = node("div");
    item.append(node("span", "", label), node("strong", "", value || "--"));
    grid.append(item);
  });
  const actions = node("div", "command-action-grid");
  const addAction = (label, action, className = "ghost") => {
    const button = node("button", className, label);
    button.type = "button";
    button.addEventListener("click", () => commandAction(action).catch((error) => alert(error.message)));
    actions.append(button);
  };
  addAction("Navigate", "navigate");
  if (incident.locationStatus !== "Verified" && incidentCoordinates(incident, "location", null)) addAction("Confirm Location", "confirm-location", "primary");
  addAction("Edit Location", "edit-location");
  if (incidentCoordinates(incident, "location", null)) addAction("Recheck Address", "recheck-address");
  if (incident.status === "New") addAction("Verify", "Verified", "primary");
  if (incident.status === "Verification Required" && incidentCoordinates(incident, "location", null)) addAction("Verify", "Verified", "primary");
  if (incident.status === "Verified" && isDispatchableIncident(incident) && !incident.assignedUnitId) addAction("Assign Nearest Unit", "assign", "primary");
  if (incident.assignedUnitId && incident.status === "Assigned") addAction("Mark En Route", "En Route");
  if (incident.status === "En Route") addAction("Mark On Scene", "On Scene");
  if (incident.status === "On Scene") addAction("Resolve", "Resolved");
  if (incident.status === "Resolved") addAction("Close", "Closed");
  if (["New", "Verification Required", "Verified", "Assigned", "En Route", "On Scene"].includes(incident.status)) {
    addAction("Reject False Alarm", "Rejected / False Alarm");
  }
  const timeline = node("ol", "command-timeline");
  (incident.timeline?.length ? incident.timeline : ["Incident awaiting command action"]).forEach((event) => timeline.append(node("li", "", event)));
  panel.append(node("p", isDispatchableIncident(incident) ? "dispatch-ready" : "location-warning", isDispatchableIncident(incident) ? "Ready for dispatch" : "Not dispatchable"));
  if (incident.source === "AI" || incident.status === "Verification Required") panel.append(node("p", "review-warning", "Human review required"));
  if (incident.locationStatus === "Approximate") panel.append(node("p", "location-warning", "Location is approximate. Verify before dispatch."));
  if (incident.locationStatus === "Needs Confirmation" || !incidentCoordinates(incident, "location", null)) {
    panel.append(node("p", "location-warning", "Location missing — verify before dispatch"));
  }
  panel.append(title, grid, actions, timeline);
}

async function reviewCommandItem(kind, id, action) {
  if (kind === "alert") {
    await api(`/api/alerts/${id}/review`, { method: "POST", body: { action } });
    const notification = state.liveVisionNotifications.find((item) => item.alertId === id);
    if (notification) {
      notification.reviewed = true;
      renderLiveVisionNotifications();
    }
  } else {
    await api(`/api/reports/${id}/create-incident`, { method: "POST", body: {} });
  }
  await refresh();
}

function renderIncidentCommand() {
  const queue = $("#commandIncidentQueue");
  const review = $("#commandReviewQueue");
  if (!queue || !review) return;
  const active = state.incidents.filter((incident) => !["Closed", "Resolved", "Rejected / False Alarm"].includes(incident.status));
  const pendingAlerts = state.alerts.filter((item) => item.status === "Pending Review");
  const pendingReports = state.reports.filter((item) => ["submitted_for_review", "possible_match"].includes(String(item.status || "").toLowerCase()));
  const availableUnits = state.responseUnits.filter((unit) => unit.status === "available");
  const etaValues = active.map((item) => Number(item.etaMinutes)).filter((value) => value > 0);
  setText("#commandActiveMetric", active.length);
  setText("#commandReviewMetric", pendingAlerts.length + pendingReports.length);
  setText("#commandUnitsMetric", availableUnits.length);
  setText("#commandEtaMetric", etaValues.length ? `${Math.round(etaValues.reduce((a, b) => a + b, 0) / etaValues.length)} min` : "--");

  queue.textContent = "";
  if (!active.length) {
    queue.append(node("div", "command-detail-empty", "No active incidents. Review pending intelligence to create one."));
  } else {
    active.forEach((incident) => {
      const row = node("button", `command-incident-row ${incident.id === state.selectedIncidentId ? "active" : ""}`);
      row.type = "button";
      const identity = node("div");
      identity.append(node("strong", "", incidentTitle(incident)), node("small", "", incidentSafetyLabel(incident)));
      row.append(identity, node("span", `severity ${sevClass(incident.severity)}`, incident.severity), node("span", "", displayValue(incident.status)), node("span", "", incident.assignedUnit?.unitCode || "Unassigned"));
      row.addEventListener("click", () => {
        state.selectedIncidentId = incident.id;
        focusIncidentOnCommandMap(incident);
        renderIncidentCommand();
      });
      queue.append(row);
    });
  }
  if (!active.some((incident) => incident.id === state.selectedIncidentId)) state.selectedIncidentId = active[0]?.id || null;
  renderIncidentCommandDetailSafe(active.find((incident) => incident.id === state.selectedIncidentId));

  review.textContent = "";
  const addReviewCard = (kind, item) => {
    const card = node("article", "command-review-card");
    const reviewTitle = kind === "alert"
      ? "AI Vision Detection"
      : `${displayValue(item.reportType || item.category)} Report: ${displayValue(item.name, "Submitted Report")}`;
    const reviewStatus = kind === "alert" ? "Needs Human Review" : "Under Review";
    card.append(
      node("span", "eyebrow", kind === "alert" ? "AI Alert" : "Citizen Report"),
      node("strong", "", reviewTitle),
      node("small", "", `${reviewStatus} · ${kind === "alert" ? incidentSource(item) : displayLocation(item.address || item.lastSeenLocation)}`),
      node("small", "", item.message || item.description || item.address || item.zone || "No additional details")
    );
    if (kind === "alert" && item.detections?.length) {
      const detected = item.detections[0];
      card.append(node("small", "", `${detected.label} · ${Math.round((detected.confidence || item.confidence || 0) * 100)}% · ${item.alertClassification || item.severity || "observation"} · Unreviewed`));
    }
    const actions = node("div", "command-review-actions");
    const add = (label, action, style = "ghost") => {
      const button = node("button", style, label);
      button.type = "button";
      button.addEventListener("click", () => reviewCommandItem(kind, item.id, action).catch((error) => alert(error.message)));
      actions.append(button);
    };
    add("Create Incident", "create_incident", "primary");
    if (kind === "alert") {
      add("Observation", "observation");
      add("False Alarm", "dismiss");
    }
    card.append(actions);
    review.append(card);
  };
  pendingAlerts.forEach((item) => addReviewCard("alert", item));
  pendingReports.forEach((item) => addReviewCard("report", item));
  if (!pendingAlerts.length && !pendingReports.length) review.append(node("div", "command-detail-empty", "No alerts or reports are waiting for review."));
  renderSatelliteMaps();
}

function cameraCard(camera) {
  const card = node("article", `camera-feed-card ${camera.health === "offline" ? "offline" : camera.health === "warning" ? "warning-feed" : ""}`);
  const feed = node("div", "camera-feed");
  feed.style.backgroundImage = `url("/assets/${camera.scene}")`;
  feed.append(node("span", "feed-label", camera.name));
  feed.append(node("span", camera.health === "offline" ? "offline-banner" : "live-dot", camera.health === "offline" ? "DISCONNECTED" : "LIVE"));
  if (camera.health !== "offline") feed.append(node("span", "scan-line"));

  if (camera.aiStatus.includes("Crowd")) feed.append(node("span", "detect-box crowd"));
  if (camera.aiStatus.includes("Motion")) feed.append(node("span", "detect-box motion"));
  feed.append(node("strong", "", camera.rtspConfigured ? `${camera.aiStatus} - ${camera.rtspUrlMasked}` : camera.aiStatus));
  const meta = node("div", "camera-config");
  const status = camera.sourceStatusLabel || (camera.health === "offline" ? "Offline" : "Demo Feed");
  meta.append(node("strong", "", camera.name));
  meta.append(node("small", "", `Location: ${camera.zone || "Unknown zone"}`));
  meta.append(node("span", `source-badge ${camera.sourceStatus || "demo"}`, status));
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
  const largeGrid = $("#cameraGridLarge");
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
    return { title: "Upload Video Mode", description: "Analyze uploaded evidence or recorded footage", action: "Coming Soon", view: null };
  }
  return { title: "CCTV Mode", description: "Monitor fixed surveillance cameras", action: "View CCTV", view: "cctv" };
}

function aiDetectionLabel(result) {
  const labels = {
    object_detected: "Object Detected",
    missing_person_possible_match: "Possible Match - Human Verification Required",
    missing_object_possible_match: "Possible Missing Object Match - Human Verification Required",
    abandoned_object: "Abandoned Object Alert",
    suspicious_object: "Suspicious Object Alert",
    damaged_object_possible: "Possible Damaged Object",
    missing_object_damaged_possible_match: "Possible Partial Damage"
  };
  return labels[result?.threatType]
    || (result?.threatDetected ? "Threat detected" : "No threat detected");
}

function objectConditionDetail(result) {
  const condition = result?.objectCondition;
  if (!condition) return "";
  const objectLabel = result.objectMatch?.label || result.detections?.[0]?.label || "Object";
  const damageLevel = condition.damageLevel
    ? condition.damageLevel.replace(/_/g, " ")
    : "damage level unknown";
  return `${objectLabel} - ${damageLevel} - ${Math.round((condition.confidence || result.confidence || 0) * 100)}% - Human verification required`;
}

function surveillanceAnalysisDetail(result) {
  const person = result?.personAnalysis?.[0];
  if (person) {
    return `${person.trackingId || "Person"} · upper ${person.upperClothingColor} · lower ${person.lowerClothingColor} · ${person.message}`;
  }
  const vehicle = result?.vehicleAnalysis?.[0];
  if (vehicle) {
    return `${vehicle.dominantColor} ${vehicle.vehicleType} · model unsupported · ${vehicle.plate?.status || "plate OCR unavailable"} · Human verification required`;
  }
  const object = result?.objectAnalysis?.[0];
  if (object) {
    return `${object.dominantColor} ${object.label} · ${object.shape} · approximate ${object.approximateSizePixels?.width || 0}×${object.approximateSizePixels?.height || 0}px`;
  }
  return "";
}

function sourceCard(source) {
  const meta = sourceModeMeta(source.type);
  const card = node("article", "source-card");
  card.append(node("span", `source-badge ${source.status || "demo"}`, source.statusLabel || source.status || "Demo Feed"));
  card.append(node("strong", "", meta.title));
  card.append(node("small", "", meta.description));
  card.append(node("small", "", `${source.name} - ${source.zone || "Unassigned"} - ${source.incidentCount || 0} incident(s)`));
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
    if (phone.latestDetection) {
      setText("#liveDetectionState", aiDetectionLabel(phone.latestDetection));
      setText("#liveDetectionDetail", objectConditionDetail(phone.latestDetection) || phone.latestDetection.message);
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
    if (file.type.startsWith("video/")) {
      if (file.size > 600000) return reject(new Error("Upload a video smaller than 600 KB."));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read the selected video."));
      reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result });
      reader.readAsDataURL(file);
      return;
    }
    if (!file.type.startsWith("image/")) return reject(new Error("Upload an image or short video evidence file."));
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
  if (fileData.type.startsWith("video/")) {
    preview.innerHTML = `<span>Video evidence attached for staff review: ${fileData.name}</span>`;
  } else {
    preview.innerHTML = `<img src="${fileData.dataUrl}" alt="Uploaded report evidence preview" /><span>Image evidence attached for staff review</span>`;
  }
}

function reportCard(report) {
  const card = node("article", "case-card report-card");
  if (report.image) {
    const img = document.createElement("img");
    img.className = "case-photo";
    img.src = report.image;
    img.alt = `${displayValue(report.name, "Submitted report")} uploaded photo`;
    card.append(img);
  } else {
    card.append(node("span", "case-photo placeholder", "No photo uploaded"));
  }
  const details = node("div", "case-details");
  const name = displayValue(report.name, "Unnamed Report");
  const type = displayValue(report.reportType || report.category, "Report");
  const status = displayValue(report.status, "Under Review");
  const location = displayLocation(report.lastSeenLocation || report.address);
  const fileText = report.imageName ? `Evidence uploaded: ${report.imageName}` : "No photo uploaded";
  const header = node("div", "case-card-head");
  header.append(node("strong", "case-name", `Name: ${name}`), node("span", `case-status ${statusClass(report.status)}`, status));
  details.append(header);
  details.append(reportField("Type", type));
  details.append(reportField("Status", status));
  details.append(reportField("Location", location));
  details.append(reportField("File", fileText, report.imageName ? "case-file" : ""));
  if (isOperatorRole() && report.matchConfidence) {
    details.append(reportField("Review Note", `${report.matchConfidence}% possible match - human verification required`));
  }
  card.append(details);
  return card;
}

function reportField(label, value, className = "") {
  const row = node("div", `case-row ${className}`.trim());
  row.append(node("span", "case-row-label", `${label}:`), node("span", "case-row-value", value));
  return row;
}

function alertCounts(alerts) {
  const open = alerts.filter((alert) => alert.status !== "closed");
  return {
    all: open.length,
    critical: open.filter((alert) => alert.severity === "critical").length,
    high: open.filter((alert) => alert.severity === "high").length,
    medium: open.filter((alert) => alert.severity === "medium").length,
    low: open.filter((alert) => alert.severity === "low").length
  };
}

function alertLocation(alert) {
  const location = alert.location || ALERT_ZONE_COORDS[alert.zone] || ALERT_ZONE_COORDS["All Zones"];
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
  const acknowledgedBy = Array.isArray(alert.acknowledgedBy) ? alert.acknowledgedBy : [];
  const alreadyAcknowledged = acknowledgedBy.some((item) => item.userId === state.user?.id);
  meta.append(node("span", `severity ${sevClass(alert.severity)}`, alert.severity || "low"));
  meta.append(node("span", "alert-type", alert.type || "Alert"));
  const title = node("strong", "", alert.message || "Emergency alert");
  const detailGrid = node("div", "alert-detail-grid");
  detailGrid.append(node("small", "", alertTime(alert.timestamp)));
  detailGrid.append(node("small", "", `Zone: ${alert.zone || "All Zones"}`));
  detailGrid.append(node("small", "", `Location: ${alertLocation(alert)}`));
  if (alert.assignedUnit) detailGrid.append(node("small", "", `Assigned: ${alert.assignedUnit}`));
  if (acknowledgedBy.length) detailGrid.append(node("small", "", `Acknowledged: ${acknowledgedBy.length}`));
  content.append(meta, title, detailGrid);
  const status = node("span", "alert-status", alertStatusLabel(alert.status));
  const actions = node("div", "alert-card-actions");
  actions.append(status);
  if (alert.status !== "closed") {
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
  const openAlerts = alerts.filter((alert) => alert.status !== "closed");
  const filtered = state.alertFilter === "all" ? openAlerts : openAlerts.filter((alert) => alert.severity === state.alertFilter);
  grid.textContent = "";
  if (!filtered.length) {
    const empty = node("article", "alert-empty");
    empty.append(node("strong", "", "No alerts in this filter"));
    empty.append(node("small", "", "New incident, AI scan, or test alert notifications will appear here."));
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
  const title = node("strong", "", incident.type || "Closed incident");
  const meta = node("div", "history-meta");
  meta.append(node("span", `severity ${sevClass(incident.severity)}`, incident.severity || "low"));
  meta.append(node("small", "", `${incident.zone || "Unknown zone"} - ${incident.assignedUnit || incident.recommendedUnit || "No unit"}`));
  meta.append(node("small", "", `Resolved in ${durationLabel(incident.openedAt, incident.closedAt)}`));
  if (incident.closedAt) meta.append(node("small", "", `Closed: ${alertTime(incident.closedAt)}`));
  const timeline = node("small", "history-timeline", (incident.timeline || []).slice(-2).join(" | ") || "No timeline available");
  card.append(title, meta, timeline);
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
  const assigned = incidents.filter((incident) => incident.assignedUnit).length;
  const avgMinutes = incidents.length
    ? Math.round(
        incidents.reduce((sum, incident) => {
          const start = new Date(incident.openedAt).getTime();
          const end = new Date(incident.closedAt || incident.openedAt).getTime();
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

async function suggestPoliceRoute() {
  const incident = activeIncident();
  if (!incident) {
    setText("#routeSummary", "Open an incident before requesting a route.");
    return;
  }
  await navigateToIncident(incident);
}

function browserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Location is not supported by this browser."));
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude, label: "Current device location" }),
      () => reject(new Error("Location permission denied. Select a manual start point on the map.")),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  });
}

async function resolveRouteStart() {
  const incident = activeIncident();
  const unitPoint = incidentCoordinates(incident, "unitLocation", null);
  if (unitPoint) return { ...unitPoint, label: `${responseUnit(incident)} location` };
  if (state.mapNavigation.start) return state.mapNavigation.start;
  throw new Error("Select Use My Location or Set Start before calculating this route.");
}

function gisMapInstance() {
  return satelliteMaps.find((instance) => instance.map.id === "gisMap");
}

function focusRouteOnMap(start, destination) {
  const instance = gisMapInstance();
  if (!instance) return;
  const midpoint = { lat: (start.lat + destination.lat) / 2, lng: (start.lng + destination.lng) / 2 };
  const span = Math.max(Math.abs(start.lat - destination.lat), Math.abs(start.lng - destination.lng));
  instance.zoom = span < 0.01 ? 15 : span < 0.05 ? 13 : span < 0.2 ? 11 : span < 1 ? 8 : 5;
  instance.center = latLngToTile(midpoint.lat, midpoint.lng, instance.zoom);
  instance.placeLabel = "Active route";
  renderSatelliteMap(instance);
}

async function calculateMapRoute() {
  if (!isOperatorRole()) return updateNavigationPanel("Operational navigation is available to Police and Admin users.");
  const destination = state.mapNavigation.destination;
  if (!destination) return updateNavigationPanel("Choose an incident, search result, or map destination first.");
  setText("#mapNavigationStatus", "Calculating route...");
  $("#navigateMap").disabled = true;
  try {
    const start = state.mapNavigation.start || (await resolveRouteStart());
    state.mapNavigation.start = start;
    const route = await api("/api/maps/route", {
      method: "POST",
      body: { start, destination, mode: "driving" }
    });
    state.mapNavigation.route = route;
    focusRouteOnMap(start, destination);
    updateNavigationPanel(route.approximate ? "Approximate distance only, not driving route." : "Verified OSRM driving route ready.");
    setText("#routeSummary", route.approximate
      ? `${route.distanceKm} km straight-line estimate to ${destination.label || "destination"}. No driving ETA is available.`
      : `${route.distanceKm} km, about ${route.durationMinutes} min to ${destination.label || "destination"}.`);
  } catch (error) {
    updateNavigationPanel(error.message.includes("permission") ? error.message : "Route could not be calculated. Choose a manual start point and retry.");
  } finally {
    $("#navigateMap").disabled = false;
  }
}

async function useCurrentLocation() {
  setText("#mapNavigationStatus", "Requesting current location...");
  try {
    const point = await browserLocation();
    state.mapNavigation.start = point;
    state.mapNavigation.route = null;
    const instance = gisMapInstance();
    if (instance) {
      instance.zoom = Math.max(instance.zoom, 14);
      instance.center = latLngToTile(point.lat, point.lng, instance.zoom);
      instance.placeLabel = point.label;
      renderSatelliteMap(instance);
    }
    updateNavigationPanel("Current location selected as route start.");
  } catch (error) {
    updateNavigationPanel(error.message);
  }
}

async function navigateToIncident(incident) {
  const destination = incidentCoordinates(incident, "location", null);
  if (!destination) {
    setText("#routeSummary", "This incident has no coordinates.");
    return;
  }
  state.selectedIncidentId = incident.id;
  state.mapNavigation.destination = {
    ...destination,
    label: incident.address || incident.title || incident.type || "Incident",
    locationStatus: incident.locationStatus
  };
  const unitPoint = incidentCoordinates(incident, "unitLocation", null);
  state.mapNavigation.start = unitPoint ? { ...unitPoint, label: `${responseUnit(incident)} location` } : null;
  setView("gis");
  updateNavigationPanel("Incident destination selected. Calculating route...");
  await calculateMapRoute();
}

function clearMapRoute() {
  state.mapNavigation = { start: null, destination: null, route: null, manualStartMode: false };
  $("#setMapStart").classList.remove("active");
  updateNavigationPanel("Route cleared. Search or click the map to choose a destination.");
  renderSatelliteMaps();
}

function openExternalRoute() {
  const { start, destination } = state.mapNavigation;
  if (!start || !destination) return updateNavigationPanel("Choose a start and destination first.");
  const url = new URL("https://www.openstreetmap.org/directions");
  url.searchParams.set("engine", "fossgis_osrm_car");
  url.searchParams.set("route", `${start.lat},${start.lng};${destination.lat},${destination.lng}`);
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

function setLiveVisionStatus(title, detail = "") {
  setText("#liveDetectionState", title);
  setText("#liveDetectionDetail", detail);
}

function renderDetectionBoxes(detections = [], frameWidth = 1, frameHeight = 1) {
  const layer = $("#liveDetectionBoxes");
  if (!layer) return;
  layer.textContent = "";
  detections.filter((item) => Array.isArray(item.box) && item.box.length === 4).forEach((item) => {
    const [x, y, width, height] = item.box.map(Number);
    if (![x, y, width, height].every(Number.isFinite)) return;
    const normalized = Math.max(x, y, width, height) <= 1;
    const left = normalized ? x * 100 : (x / frameWidth) * 100;
    const top = normalized ? y * 100 : (y / frameHeight) * 100;
    const boxWidth = normalized ? width * 100 : (width / frameWidth) * 100;
    const boxHeight = normalized ? height * 100 : (height / frameHeight) * 100;
    const box = node("div", "detection-box");
    box.style.left = `${Math.max(0, Math.min(100, left))}%`;
    box.style.top = `${Math.max(0, Math.min(100, top))}%`;
    box.style.width = `${Math.max(0, Math.min(100 - left, boxWidth))}%`;
    box.style.height = `${Math.max(0, Math.min(100 - top, boxHeight))}%`;
    box.append(node("span", "", `${item.label} ${Math.round((item.confidence || 0) * 100)}%`));
    layer.append(box);
  });
}

function liveVisionError(message = "") {
  const el = $("#liveVisionError");
  if (el) el.textContent = message;
}

function scheduleNextLiveVisionFrame() {
  if (state.liveVisionAnalysisPaused || !state.liveVisionStream) return;
  if (state.liveVisionTimer) clearTimeout(state.liveVisionTimer);
  state.liveVisionTimer = setTimeout(captureLiveVisionFrame, state.liveVisionIntervalMs);
}

function playLiveVisionBeep(result) {
  const now = Date.now();
  if (state.liveVisionMuted || !shouldPlayAlertBeep(result) || !beepCooldownReady(state.liveVisionLastBeepAt, now, 10000)) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = surveillanceSeverity(result) === "critical" ? 880 : 660;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.3);
  oscillator.addEventListener("ended", () => context.close());
  state.liveVisionLastBeepAt = now;
}

function renderLiveVisionNotifications() {
  const wrap = $("#liveNotificationHistory");
  if (!wrap) return;
  wrap.textContent = "";
  if (!state.liveVisionNotifications.length) {
    wrap.append(node("div", "empty-state", "No detections recorded in this camera session."));
    return;
  }
  state.liveVisionNotifications.forEach((item) => {
    const card = node("article", `live-notification notification-${item.severity}`);
    card.append(
      node("span", `severity ${item.severity}`, item.severity),
      node("strong", "", item.title),
      node("small", "", `${item.object} · ${Math.round(item.confidence * 100)}% · ${new Date(item.timestamp).toLocaleTimeString()}`),
      node("small", "", item.reviewed ? "Reviewed" : "Unreviewed · Human verification required")
    );
    wrap.append(card);
  });
}

function recordLiveVisionNotification(result) {
  const detection = result.detections?.[0];
  if (!detection || result.duplicateSuppressed) return;
  const now = Date.now();
  state.liveVisionRecentObjects = state.liveVisionRecentObjects.filter((item) => now - item.timestampMs <= 8000);
  if (duplicateObservation(state.liveVisionRecentObjects, detection, now, 8000)) return;
  state.liveVisionRecentObjects.push({ label: detection.label, box: detection.box, timestampMs: now });
  state.liveVisionNotifications.unshift({
    alertId: result.alert?.id || null,
    title: result.alert?.message || result.message || "AI observation",
    severity: surveillanceSeverity(result),
    object: detection.label,
    confidence: Number(detection.confidence) || 0,
    timestamp: result.performance?.analyzedAt || new Date().toISOString(),
    reviewed: Boolean(result.alert?.reviewedAt)
  });
  state.liveVisionNotifications = state.liveVisionNotifications.slice(0, 50);
  renderLiveVisionNotifications();
}

function updateLiveVisionPerformance(result) {
  const analyzedAt = result.performance?.analyzedAt || new Date().toISOString();
  const analyzedMs = new Date(analyzedAt).getTime();
  const previous = state.liveVisionLastAnalyzedAt;
  const fps = Number.isFinite(previous) && analyzedMs > previous ? 1000 / (analyzedMs - previous) : 0;
  state.liveVisionLastAnalyzedAt = analyzedMs;
  setText("#liveVisionFps", fps.toFixed(1));
  setText("#liveInferenceMs", `${Math.round(result.performance?.inferenceMs || 0)} ms`);
  setText("#liveLastAnalyzed", `Last analyzed: ${new Date(analyzedAt).toLocaleString()}`);
}

function stopLiveVisionAnalysis(message = "") {
  if (state.liveVisionTimer) {
    clearTimeout(state.liveVisionTimer);
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
  if (!state.user) {
    stopLiveVisionAnalysis("Session expired or authentication missing. Please login again.");
    return;
  }
  if (state.liveVisionTimer) clearTimeout(state.liveVisionTimer);
  state.liveVisionAnalysisPaused = false;
  setLiveVisionStatus("Scanning", `Analyzing one frame every ${(state.liveVisionIntervalMs / 1000).toFixed(1)} seconds.`);
  captureLiveVisionFrame();
}

function stopLiveVision() {
  stopLiveVisionAnalysis();
  renderDetectionBoxes([]);
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
  setText("#liveVisionFps", "0.0");
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
  if (!video?.videoWidth || !video?.videoHeight) {
    scheduleNextLiveVisionFrame();
    return;
  }
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
        sourceId: "phone_001",
        sourceName: "Rakshak Live Vision",
        zone: "Mobile Source",
        timestamp: new Date().toISOString(),
        sosMode: $("#emergencyMode").checked,
        imageBase64: image
      }
    });
    renderDetectionBoxes(result.detections, canvas.width, canvas.height);
    updateLiveVisionPerformance(result);
    recordLiveVisionNotification(result);
    playLiveVisionBeep(result);
    const videoWrap = $("#liveVisionVideo")?.closest(".live-video-wrap");
    videoWrap?.classList.toggle("critical-pulse", surveillanceSeverity(result) === "critical" && Boolean(result.alert));
    if (!result.configured) {
      setText("#liveSourceHealth", "AI Offline");
      setText("#liveAiHealthDetail", "AI service not connected. Configure AI_SERVICE_URL to enable real detection.");
      setLiveVisionStatus("AI service not connected", "Configure AI_SERVICE_URL to enable real detection.");
    } else if (result.serviceError) {
      setText("#liveSourceHealth", "AI Offline");
      setText("#liveAiHealthDetail", "The configured AI service is unreachable.");
      setLiveVisionStatus("AI service unavailable", result.message);
    } else {
      setText("#liveSourceHealth", "Detection Active");
      setText("#liveAiHealthDetail", "Frames are analyzed by the configured AI service.");
      const label = aiDetectionLabel(result);
      const conditionDetail = objectConditionDetail(result);
      const analysisDetail = surveillanceAnalysisDetail(result);
      setLiveVisionStatus(label, conditionDetail || analysisDetail || `${result.message} - ${Math.round((result.confidence || 0) * 100)}% confidence`);
    }
    if (result.alert) {
      setText("#liveLatestAlert", result.alert.message);
      setText("#liveLatestAlertDetail", alertTime(result.alert.lastDetectedAt || result.alert.createdAt));
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
    scheduleNextLiveVisionFrame();
  }
}

async function refresh() {
  const me = await api("/api/me");
  state.user = me.user;
  applyRoleAccess();
  const operator = isOperatorRole();
  const admin = isAdminRole();
  const [dashboard, reports, zones, incidents, alerts, cameras, sources, units, devices, audits, integrations, aiHealth] = await Promise.all([
    operator ? api("/api/dashboard") : Promise.resolve({ summary: {} }),
    api("/api/reports"),
    operator ? api("/api/zones") : Promise.resolve({ zones: [] }),
    operator ? api("/api/incidents/live") : Promise.resolve({ incidents: [] }),
    operator ? api("/api/alerts") : Promise.resolve({ alerts: [] }),
    operator ? api("/api/camera-feeds") : Promise.resolve({ cameras: [] }),
    operator ? api("/api/camera-sources") : Promise.resolve({ sources: [] }),
    operator ? api("/api/response-units") : Promise.resolve({ units: [] }),
    admin ? api("/api/devices/health") : Promise.resolve({ devices: [] }),
    admin ? api("/api/audit-logs") : Promise.resolve({ auditLogs: [] }),
    admin ? api("/api/integrations/status") : Promise.resolve({ integrations: [] }),
    operator ? api("/api/ai/health").catch(() => ({ configured: true, status: "unreachable" })) : Promise.resolve({ configured: false, status: "restricted" })
  ]);
  const aiConnected = aiHealth.status === "connected";
  setText("#liveSourceHealth", aiConnected ? "AI Connected" : "AI Offline");
  setText("#liveAiHealthDetail", aiConnected
    ? "Real AI detection service is connected."
    : aiHealth.status === "not_configured"
      ? "AI service not connected. Configure AI_SERVICE_URL to enable real detection."
      : "The configured AI service is unreachable.");
  setText("#currentUser", me.user ? `${me.user.role}: ${me.user.name}` : "Not signed in");
  const localMissingPersons = reports.reports.filter((report) => report.reportType === "missing_person" && isActiveReport(report)).length;
  setText("#missingMetric", localMissingPersons);
  if (operator) {
    const summary = dashboard.summary || {};
    const activeCameras = summary.activeCameras ?? summary.camerasOnline ?? summary.onlineSources ?? 0;
    const onlineSources = summary.onlineSources ?? summary.healthyCameras ?? summary.camerasOnline ?? activeCameras;
    setText("#missingMetric", summary.missingPersons ?? localMissingPersons);
    setText("#crowdMetric", `${summary.crowdDensity ?? 0}%`);
    setText("#crowdStatus", summary.crowdStatus || "Stable");
    setText("#cameraMetric", activeCameras);
    setText("#cameraStatus", `${onlineSources} sources ready`);
    setText("#alertMetric", summary.openAlerts ?? summary.criticalAlerts ?? 0);
    setText("#zoneMetric", zones.zones.length);
    setText("#responseMetric", summary.responseUnits ?? summary.unitsAvailable ?? 0);
    setText("#responseStatus", `${summary.nearbyUnits ?? summary.unitsAvailable ?? 0} nearby`);
    setText("#queueCount", `${summary.activeIncidents ?? 0} active`);
    setText("#systemHealthTitle", aiConnected ? "Systems operational" : "AI connection pending");
    setText("#systemHealthDetail", aiConnected
      ? "AI, GIS, cameras, and dispatch are ready"
      : "Core operations remain available while AI reconnects");
  }
  renderIncidents(incidents.incidents);
  state.reports = reports.reports;
  state.alerts = alerts.alerts;
  state.responseUnits = units.units;
  state.zones = zones.zones;
  renderSatelliteMaps();
  renderCameras(cameras.cameras);
  renderSources(sources.sources);
  $("#zoneTable").textContent = "";
  zones.zones.forEach((z) => $("#zoneTable").append(node("div", "", `${z.name}: ${z.currentDensity}% (${z.severity})`)));
  $("#caseList").textContent = "";
  reports.reports.forEach((r) => $("#caseList").append(reportCard(r)));
  renderAlerts(alerts.alerts);
  renderIncidentCommand();
  $("#deviceList").textContent = "";
  devices.devices.forEach((d) => $("#deviceList").append(node("article", "", `${d.name} - ${d.status} - ${d.zone}`)));
  $("#auditList").textContent = "";
  audits.auditLogs.slice(0, 6).forEach((a) => $("#auditList").append(node("article", "", `${a.action} - ${a.actorName}`)));
  renderIntegrations(integrations.integrations);
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
$$("[data-view-jump]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.viewJump)));
$("#refreshCommand")?.addEventListener("click", () => refresh().catch((error) => alert(error.message)));
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
$("#liveVisionInterval").value = String(state.liveVisionIntervalMs);
$("#liveVisionInterval").addEventListener("change", (event) => {
  state.liveVisionIntervalMs = Math.max(800, Math.min(1500, Number(event.currentTarget.value) || 1000));
  if (state.liveVisionStream && !state.liveVisionAnalysisPaused) {
    setLiveVisionStatus("Scanning", `Analyzing one frame every ${(state.liveVisionIntervalMs / 1000).toFixed(1)} seconds.`);
    scheduleNextLiveVisionFrame();
  }
});
$("#toggleLiveVisionMute").addEventListener("click", (event) => {
  state.liveVisionMuted = !state.liveVisionMuted;
  event.currentTarget.textContent = state.liveVisionMuted ? "Unmute alerts" : "Mute alerts";
  event.currentTarget.classList.toggle("active", state.liveVisionMuted);
});
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
$("#createIncident").addEventListener("click", async () => { await api("/api/incidents/sample", { method: "POST" }); await refresh(); });
$("#assignIncident").addEventListener("click", async () => {
  const incident = activeIncident();
  if (!incident) return;
  await navigateToIncident(incident);
  if (!state.mapNavigation.route) return;
  await api(`/api/incidents/${incident.id}/assign-unit`, { method: "PATCH", body: { assignedUnit: responseUnit(incident) } });
  await refresh();
});
$("#routeIncident").addEventListener("click", async () => { try { await suggestPoliceRoute(); } catch (error) { $("#routeSummary").textContent = `Route unavailable: ${error.message}`; } });
$("#navigateMap").addEventListener("click", calculateMapRoute);
$("#toggleMapLayer").addEventListener("click", () => {
  const instance = gisMapInstance();
  if (instance) setBaseLayer(instance, instance.baseLayer === "satellite" ? "streets" : "satellite");
});
$("#useMyLocation").addEventListener("click", useCurrentLocation);
$("#recalculateRoute").addEventListener("click", calculateMapRoute);
$("#openExternalRoute").addEventListener("click", openExternalRoute);
$("#clearMapRoute").addEventListener("click", clearMapRoute);
$("#setMapStart").addEventListener("click", () => {
  state.mapNavigation.manualStartMode = !state.mapNavigation.manualStartMode;
  $("#setMapStart").classList.toggle("active", state.mapNavigation.manualStartMode);
  updateNavigationPanel(state.mapNavigation.manualStartMode ? "Click the map to choose a manual start point." : "Manual start selection cancelled.");
});
$("#closeIncident").addEventListener("click", async () => { const i = activeIncident(); if (i) await api(`/api/incidents/${i.id}/status`, { method: "PATCH", body: { status: "closed" } }); state.selectedIncidentId = null; await refresh(); });
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
    form.elements.message.value = "Crowd control announcement required near main entry";
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
  if (!button) return;
  await api(`/api/alerts/${button.dataset.alertAck}/ack`, { method: "PATCH" });
  await refresh();
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
    status.textContent = "Enter the missing person or object name and last seen location.";
    return;
  }
  button.disabled = true;
  button.textContent = "Submitting...";
  try {
    const created = await api("/api/report-missing", {
      method: "POST",
      body: {
        reportType: data.get("reportType"),
        category: data.get("reportType"),
        name: personName,
        age: data.get("age"),
        description: data.get("description"),
        lastSeenLocation,
        address: lastSeenLocation,
        lat: data.get("lat") || null,
        lng: data.get("lng") || null,
        urgency: data.get("urgency"),
        image: state.pendingReportFile?.dataUrl || null,
        imageName: state.pendingReportFile?.name || null
      }
    });
    if (created.report) {
      $("#caseList").prepend(reportCard(created.report));
      const currentMetric = Number($("#missingMetric").textContent);
      if (Number.isFinite(currentMetric)) setText("#missingMetric", currentMetric + 1);
    }
    state.pendingReportFile = null;
    form.reset();
    form.personName.value = "Aarav Sharma";
    form.age.value = "8";
    form.lastSeen.value = "Gate A, Sector 7";
    updateReportFilePreview(null);
    status.classList.add("success");
    status.textContent = created.message || `Report submitted for review: ${displayValue(created.report?.name || personName)}.`;
    await refresh().catch((refreshError) => {
      console.warn("Report saved, but dashboard refresh failed.", refreshError);
    });
  } catch (error) {
    status.classList.add("error");
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Submit Report for Review";
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

$("#changePasswordForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $("#changePasswordStatus");
  const button = form.querySelector("button[type='submit']");
  const data = new FormData(form);
  const currentPassword = String(data.get("currentPassword") || "");
  const newPassword = String(data.get("newPassword") || "");
  const confirmPassword = String(data.get("confirmPassword") || "");
  status.className = "form-status";
  status.textContent = "";
  if (newPassword !== confirmPassword) {
    status.classList.add("error");
    status.textContent = "New passwords do not match.";
    return;
  }
  button.disabled = true;
  button.textContent = "Updating...";
  try {
    const result = await api("/api/change-password", {
      method: "POST",
      body: { currentPassword, newPassword }
    });
    form.reset();
    state.user = null;
    applyRoleAccess();
    showPortal(result.message || "Password changed successfully. Please sign in again.");
  } catch (error) {
    status.classList.add("error");
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Update Password";
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

checkSession()
  .then(async (hasSession) => {
    if (hasSession) {
      await refresh();
      setView(location.pathname === "/rakshak/live-vision" ? "live-vision" : landingForRole(state.user.role));
    }
  })
  .catch((error) => {
    $("#currentUser").textContent = "API unavailable";
    showPortal(error.code === "API_UNAVAILABLE"
      ? error.message
      : "Unable to restore your session. Please log in again.");
    console.error(error);
  });
