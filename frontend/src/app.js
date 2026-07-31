import "./styles.css";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "./services/api.js";
import { gisRouteButtonStates } from "./gisButtonState.js";
import {
  applyRouteResponse,
  clearCalculatedRoutes,
  emptyRouteNavigationState,
  hasUsableRealRoute,
  selectRouteId,
  selectedRoute
} from "./gisRouteState.js";
import { cancelPlacePreview, confirmPreviewDestination, previewPlace } from "./gisPlaceSelection.js";
import { renderPlaceSearchCandidates } from "./gisPlaceSearchUi.js";
import {
  bindInstanceOnce,
  initializeLeafletOnce,
  mapContainerHasVisibleSize,
  mapStateForElement
} from "./gisVisibleInitialization.js";
import {
  STREET_TILE_LOAD_TIMEOUT_MS,
  beginBaseLayerSwitch,
  isCurrentBaseLayerSwitch,
  preserveLeafletViewport,
  streetTileLoadOutcome
} from "./gisBaseLayerLifecycle.js";
import { beepCooldownReady, duplicateObservation, shouldPlayAlertBeep, surveillanceSeverity } from "./liveVisionPolicy.js";
import { isOperatorRole as isOperatorRoleRoleAccess, loadAiVisionData, resolveViewAccess } from "./roleAccess.js";

const VIEW_TITLES = {
  dashboard: "Sector 7 Safety Grid",
  "incident-command": "Incident Command",
  gis: "GIS Monitoring",
  cctv: "CCTV Monitoring",
  "live-vision": "Rakshak Live Vision",
  "video-evidence": "Video Evidence Upload",
  missing: "Missing & Found Report Center",
  alerts: "Emergency Alert Center",
  history: "Incident History",
  "police-management": "Police Management",
  settings: "System Settings"
};

const state = {
  incidents: [],
  selectedIncidentId: null,
  user: null,
  pendingReportFile: null,
  alertFilter: "all",
  auditFilter: "all",
  alerts: [],
  reports: [],
  responseUnits: [],
  responseUnitSummary: {},
  policeStations: [],
  mapDefaultCenter: { lat: 17.5109, lng: 78.3276 },
  selectedUnitId: null,
  dispatchCandidates: [],
  dispatchWarnings: [],
  zones: [],
  cameraSources: [],
  cameraFilters: { kind: "all", sourceType: "all", status: "all" },
  videoEvidence: { evidence: [], observations: [] },
  activeEvidenceId: null,
  policeUsers: [],
  dashboardSummary: {},
  activeDashboardKpi: null,
  activeCommandKpi: null,
  commandFilters: { search: "", severity: "all", status: "all", source: "all", assignment: "all" },
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
  liveVisionObservations: [],
  liveVisionLastFrame: null,
  mapNavigation: emptyRouteNavigationState(),
  mapLayers: { incidents: true, responseUnits: true, dangerZones: false, heatOverlay: false, policeStations: false, labels: false },
  sosLiveVisionAllowed: location.pathname === "/rakshak/live-vision"
};
const satelliteMaps = [];
let loginSubmissionInFlight = false;
let registerSubmissionInFlight = false;
let browserNavigationRestoreInProgress = false;
const TILE_SIZE = 256;
const MIN_MAP_ZOOM = 2;
const MAX_MAP_ZOOM = 19;
const DEFAULT_MAP_CENTER = { lat: 17.5109, lng: 78.3276 };
const GIS_HOME_ZOOM = 12;
const LOCAL_OPERATIONAL_BOUNDS = { minLat: 16.8, maxLat: 18.1, minLng: 77.8, maxLng: 79.1 };
const FALLBACK_PLACES = [
  { name: "Patancheru", lat: 17.5285, lng: 78.2636 },
  { name: "Patancheru Police Station", lat: 17.5285, lng: 78.2636 },
  { name: "BHEL", lat: 17.4933, lng: 78.3915 },
  { name: "BHEL Township", lat: 17.4933, lng: 78.3915 },
  { name: "Ramachandrapuram", lat: 17.4933, lng: 78.3915 },
  { name: "Hyderabad", lat: 17.385, lng: 78.4867 },
  { name: "Hyderabad Central Control", lat: 17.385, lng: 78.4867 }
];
const TILE_SOURCES = {
  streets: {
    label: "OpenStreetMap",
    urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    url: (zoom, x, y) => `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`
  },
  satellite: {
    label: "Satellite",
    urlTemplate: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    url: (zoom, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`
  }
};
const ALERT_ZONE_COORDS = {
  "Red Zone": { lat: 17.5312, lng: 78.2662 },
  "Main Entry": { lat: 17.5285, lng: 78.2636 },
  "Gate A": { lat: 17.5285, lng: 78.2636 },
  "Food Court": { lat: 17.5218, lng: 78.2815 },
  "Medical Camp": { lat: 17.4933, lng: 78.3915 },
  "Parking Zone B": { lat: 17.4889, lng: 78.3973 },
  "Transit Hub": { lat: 17.5004, lng: 78.3798 },
  "Industrial Area": { lat: 17.5285, lng: 78.2636 },
  "BHEL Township": { lat: 17.4933, lng: 78.3915 },
  "All Zones": DEFAULT_MAP_CENTER,
  "zone-1": DEFAULT_MAP_CENTER
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

const ACTIVE_REPORT_STATUSES = new Set(["under_review", "active", "verified", "assigned", "in_progress", "en_route", "on_scene", "submitted_for_review", "possible_match"]);

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

async function withButtonBusy(button, label, task) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    return await task();
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

function dispatchErrorMessage(error) {
  const message = String(error?.message || "Dispatch failed");
  if (/location missing|valid incident coordinates|incident location/i.test(message)) return "Incident location missing";
  if (/GPS, search, map click, or manual coordinates/i.test(message)) return "Confirm incident location with GPS, search, map click, or manual coordinates before dispatch";
  if (/confirm.*location|location approximate|not dispatchable/i.test(message)) return "Confirm incident location before dispatch";
  if (/stale gps|location is stale|stale/i.test(message)) return "Available units have stale GPS";
  if (/no available unit|not available/i.test(message)) return "No available units";
  if (/route service|verified driving route|route unavailable|driving route/i.test(message)) return "Route service unavailable";
  return message;
}

function setView(view, options = {}) {
  const previousView = document.body.dataset.view;
  if (document.body.dataset.view === "live-vision" && view !== "live-vision") stopLiveVision();
  const nav = [...$$(".nav-item")].find((button) => button.dataset.view === view);
  if (nav?.hidden) landingForRole(state.user?.role);
  view = resolveViewAccess({ view, role: state.user?.role, document, viewTitles: VIEW_TITLES });
  if (previousView === "gis" && view !== "gis" && activeRouteWorkflow()) {
    resetGisNavigationState("GIS route markers cleared after leaving route workflow.");
  }
  if (view === "gis" && previousView !== "gis" && !options.preserveGisNavigation) {
    resetGisNavigationState("GIS map ready. Route markers cleared.");
  }
  if (view === "gis" && previousView !== "gis") {
    let layoutAttempts = 0;
    const initializeVisibleGisMap = () => {
      const instance = gisMapInstance();
      if (!instance || !mapContainerHasVisibleSize(instance.map)) {
        layoutAttempts += 1;
        if (layoutAttempts < 3) requestAnimationFrame(initializeVisibleGisMap);
        return;
      }
      instance.leafletInitializationAllowed = true;
      initializeLeafletInstance(instance, instance.homeLatLng);
      instance.leafletMap?.invalidateSize(false);
      resetGisMapToOperationalCenter("GIS map ready. Route markers cleared.");
    };
    requestAnimationFrame(initializeVisibleGisMap);
    return;
  }
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
  return isOperatorRoleRoleAccess(state.user?.role);
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
  $("#clearAlerts").classList.toggle("restricted-hidden", !isAdminRole());
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

function removeHeatLayers(map) {
  map.querySelectorAll(".heat").forEach((layer) => layer.remove());
}

function renderHeatOverlay(instance) {
  removeHeatLayers(instance.map);
  if (!state.mapLayers.heatOverlay || instance.heatVisible === false) return;
  const heat = node("span", "heat heat-two");
  heat.setAttribute("aria-hidden", "true");
  (instance.leafletMap?.getPanes().overlayPane || instance.map).append(heat);
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

function instanceCenterLatLng(instance) {
  return tileToLatLng(instance.center.x, instance.center.y, instance.zoom);
}

function setMapView(instance, point, zoom = instance.zoom, label = instance.placeLabel) {
  const validPoint = validMapPoint(point);
  if (!validPoint) return;
  const nextZoom = Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, Math.round(Number(zoom) || GIS_HOME_ZOOM)));
  const current = instance.leafletMap?.getCenter?.();
  const leafletAlreadySynced = current
    && Math.abs(current.lat - validPoint.lat) < 0.000001
    && Math.abs(current.lng - validPoint.lng) < 0.000001
    && instance.leafletMap.getZoom() === nextZoom;
  instance.zoom = nextZoom;
  instance.center = latLngToTile(validPoint.lat, validPoint.lng, instance.zoom);
  instance.placeLabel = label || instance.placeLabel;
  if (instance.leafletMap && !leafletAlreadySynced) {
    instance.syncingLeafletView = true;
    instance.leafletMap.setView([validPoint.lat, validPoint.lng], instance.zoom, { animate: false });
    queueMicrotask(() => {
      instance.syncingLeafletView = false;
    });
  }
}

function syncLeafletMapToState(instance) {
  if (!instance.leafletMap) return;
  const center = instanceCenterLatLng(instance);
  setMapView(instance, center, instance.zoom, instance.placeLabel);
}

function syncInstanceFromLeaflet(instance) {
  if (!instance.leafletMap || instance.syncingLeafletView) return;
  const center = instance.leafletMap.getCenter();
  instance.zoom = instance.leafletMap.getZoom();
  instance.center = latLngToTile(center.lat, center.lng, instance.zoom);
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
        results.append(node("p", "map-search-empty", "No places found for this query."));
      } else {
        renderPlaceSearchCandidates({
          container: results,
          places,
          onPreview: (place) => {
            const previewed = selectMapPlace(instance, place);
            if (!previewed) return false;
            input.value = place.label || place.displayName || place.name;
            return true;
          },
          onConfirm: (place) => {
            if (confirmMapPlace(instance, place)) results.hidden = true;
          },
          onCancel: (place) => {
            cancelMapPlace(instance, place);
          }
        });
      }
      results.hidden = false;
      instance.status.textContent = `${places.length} search result${places.length === 1 ? "" : "s"}`;
    } catch (error) {
      results.textContent = "";
      results.append(node("p", "map-search-empty location-warning", error.message || "Place search provider is unavailable. Try again."));
      results.hidden = false;
      instance.status.textContent = "Place search provider is unavailable";
    } finally {
      button.disabled = false;
    }
  });
  return form;
}

function syncMapLayerControls() {
  satelliteMaps.forEach((instance) => {
    instance.map.classList.toggle("labels-visible", state.mapLayers.labels);
    instance.map.querySelectorAll("[data-map-layer-toggle]").forEach((checkbox) => {
      checkbox.checked = Boolean(state.mapLayers[checkbox.dataset.mapLayerToggle]);
    });
  });
}

function setMapLayerVisibility(key, visible) {
  state.mapLayers[key] = Boolean(visible);
  if (key === "heatOverlay") {
    satelliteMaps.forEach((instance) => {
      instance.heatVisible = Boolean(visible);
      instance.map.classList.toggle("heatmap-hidden", !visible);
      if (!visible) removeHeatLayers(instance.map);
    });
  }
  syncMapLayerControls();
  renderSatelliteMaps();
}

function makeMapLayersControl(instance) {
  const panel = node("fieldset", "map-layer-control");
  panel.append(node("legend", "", "Map Layers"));
  [
    ["incidents", "Incidents"],
    ["responseUnits", "Response Units"],
    ["dangerZones", "Danger Zones"],
    ["heatOverlay", "Heat Overlay"],
    ["policeStations", "Police Stations"],
    ["labels", "Labels"]
  ].forEach(([key, labelText]) => {
    const label = node("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.mapLayerToggle = key;
    checkbox.checked = Boolean(state.mapLayers[key]);
    checkbox.setAttribute("aria-label", `Toggle ${labelText}`);
    label.append(checkbox, node("span", "", labelText));
    checkbox.addEventListener("change", (event) => {
      event.stopPropagation();
      setMapLayerVisibility(key, event.currentTarget.checked);
    });
    panel.append(label);
  });
  instance.map.classList.toggle("labels-visible", state.mapLayers.labels);
  instance.map.classList.toggle("heatmap-hidden", !state.mapLayers.heatOverlay);
  return panel;
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
  if (!instance.leafletMap) initializeLeafletInstance(instance, instance.homeLatLng);
  if (instance.leafletMap) return renderLeafletMap(instance);
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
      instance.status.textContent = `${source.label} tiles failed to load`;
      if (instance.map.id === "gisMap") updateNavigationPanel(`${source.label} tiles failed to load. Check network access and CSP image sources.`);
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
    instance.status.textContent = `${source.label} tiles unavailable`;
    if (instance.map.id === "gisMap") updateNavigationPanel(`${source.label} tiles are unavailable for this view.`);
  }
  renderHeatOverlay(instance);
  renderNavigationOverlay(instance);
}

function syncLeafletBaseLayer(instance) {
  if (!instance.leafletMap || !instance.leafletTileLayers) return;
  Object.entries(instance.leafletTileLayers).forEach(([key, layer]) => {
    const hasLayer = instance.leafletMap.hasLayer(layer);
    if (key === instance.baseLayer && !hasLayer) layer.addTo(instance.leafletMap);
    if (key !== instance.baseLayer && hasLayer) layer.remove();
  });
}

function leafletLayerState(instance, key = instance.baseLayer) {
  instance.leafletTileState ||= {};
  instance.leafletTileState[key] ||= { requested: 0, loaded: 0, failed: 0, loading: false, failedCompletely: false };
  return instance.leafletTileState[key];
}

function resetLeafletLayerState(instance, key) {
  instance.leafletTileState ||= {};
  instance.leafletTileState[key] = { requested: 0, loaded: 0, failed: 0, loading: true, failedCompletely: false, visibleLoaded: 0 };
  return instance.leafletTileState[key];
}

function clearSatelliteVisibilityTimer(instance) {
  if (!instance.satelliteVisibilityTimer) return;
  window.clearTimeout(instance.satelliteVisibilityTimer);
  instance.satelliteVisibilityTimer = null;
}

function clearBaseLayerLoadTimer(instance) {
  if (!instance.baseLayerLoadTimer) return;
  window.clearTimeout(instance.baseLayerLoadTimer);
  instance.baseLayerLoadTimer = null;
}

function nextBaseLayerSwitch(instance) {
  clearBaseLayerLoadTimer(instance);
  return beginBaseLayerSwitch(instance);
}

function scheduleStreetLoadOutcome(instance, switchId = instance.baseLayerSwitchId) {
  clearBaseLayerLoadTimer(instance);
  instance.baseLayerLoadTimer = window.setTimeout(() => {
    instance.baseLayerLoadTimer = null;
    if (!isCurrentBaseLayerSwitch(instance, switchId, "streets")) return;
    const tileState = leafletLayerState(instance, "streets");
    if (streetTileLoadOutcome(hasVisibleUsableLeafletTiles(instance, "streets")) === "ready") {
      updateLeafletLayerStatus(instance);
      return;
    }
    tileState.loading = false;
    tileState.failedCompletely = true;
    instance.activeBaseLayer = null;
    syncLayerButtons(instance);
    instance.map.classList.remove("tiles-ready");
    instance.map.classList.add("tiles-failed");
    instance.status.textContent = "Street map unavailable";
    if (instance.map.id === "gisMap") updateNavigationPanel("Street map unavailable. Check network access and CSP image sources.");
  }, STREET_TILE_LOAD_TIMEOUT_MS);
}

function visibleLeafletTileReport(instance, key = instance.baseLayer) {
  const layer = instance.leafletTileLayers?.[key];
  const layerContainer = layer?.getContainer?.();
  const host = layerContainer || instance.leafletHost;
  const mapRect = instance.leafletHost?.getBoundingClientRect();
  const tiles = host ? Array.from(host.querySelectorAll("img.leaflet-tile, img.leaflet-tile-loaded")) : [];
  const usableTiles = tiles.filter((tile) => {
    const rect = tile.getBoundingClientRect();
    const style = window.getComputedStyle(tile);
    const opacity = Number.parseFloat(style.opacity || "1");
    const overlapsViewport = mapRect
      && rect.right > mapRect.left
      && rect.left < mapRect.right
      && rect.bottom > mapRect.top
      && rect.top < mapRect.bottom;
    const hiddenByFilter = /brightness\(\s*0\s*\)|opacity\(\s*0\s*\)/i.test(style.filter || "");
    const masked = style.maskImage && style.maskImage !== "none";
    return tile.isConnected
      && tile.complete
      && tile.naturalWidth > 0
      && tile.naturalHeight > 0
      && rect.width > 0
      && rect.height > 0
      && overlapsViewport
      && style.display !== "none"
      && style.visibility !== "hidden"
      && opacity > 0.01
      && !hiddenByFilter
      && !masked
      && (style.mixBlendMode === "normal" || style.mixBlendMode === "plus-lighter");
  });
  return { tiles, usableTiles, mapRect };
}

function hasVisibleUsableLeafletTiles(instance, key = instance.baseLayer) {
  const layer = instance.leafletTileLayers?.[key];
  return Boolean(
    instance.leafletMap
      && layer
      && instance.leafletMap.hasLayer(layer)
      && visibleLeafletTileReport(instance, key).usableTiles.length > 0
  );
}

function centerMapTopElement(instance) {
  const rect = instance.map.getBoundingClientRect();
  return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function logLeafletTileDiagnostics(instance, key = instance.baseLayer) {
  if (!import.meta.env.DEV) return;
  const report = visibleLeafletTileReport(instance, key);
  const sample = report.tiles.slice(0, 4).map((tile) => {
    const rect = tile.getBoundingClientRect();
    const style = window.getComputedStyle(tile);
    return {
      src: tile.currentSrc || tile.src,
      naturalWidth: tile.naturalWidth,
      naturalHeight: tile.naturalHeight,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      filter: style.filter,
      zIndex: style.zIndex,
      connected: tile.isConnected
    };
  });
  const topElement = centerMapTopElement(instance);
  console.debug("[RakshakAI GIS] tile diagnostics", {
    layer: key,
    requested: leafletLayerState(instance, key).requested,
    loaded: leafletLayerState(instance, key).loaded,
    failed: leafletLayerState(instance, key).failed,
    visibleLoaded: report.usableTiles.length,
    topElement: topElement ? `${topElement.tagName.toLowerCase()}.${topElement.className || ""}` : "none",
    sample
  });
}

function scheduleSatelliteVisibilityFallback(instance) {
  if (instance.baseLayer !== "satellite" || instance.satelliteFallbackInProgress || instance.satelliteVisibilityTimer) return;
  instance.satelliteVisibilityTimer = window.setTimeout(() => {
    instance.satelliteVisibilityTimer = null;
    if (instance.baseLayer !== "satellite") return;
    logLeafletTileDiagnostics(instance, "satellite");
    if (!hasVisibleUsableLeafletTiles(instance, "satellite")) {
      fallbackSatelliteToStreet(instance);
    } else {
      updateLeafletLayerStatus(instance);
    }
  }, 1800);
}

function updateLeafletLayerStatus(instance, message = "") {
  const source = TILE_SOURCES[instance.baseLayer];
  const place = instance.placeLabel ? ` - ${instance.placeLabel}` : "";
  const tileState = leafletLayerState(instance);
  const hasVisibleTiles = hasVisibleUsableLeafletTiles(instance, instance.baseLayer);
  tileState.visibleLoaded = visibleLeafletTileReport(instance, instance.baseLayer).usableTiles.length;
  instance.map.dataset.baseLayer = instance.baseLayer;
  if (tileState.loaded > 0 && hasVisibleTiles && !tileState.failedCompletely) {
    clearSatelliteVisibilityTimer(instance);
    clearBaseLayerLoadTimer(instance);
    instance.activeBaseLayer = instance.baseLayer;
    if (instance.baseLayer === "streets") instance.activeBaseLayer = "streets";
    syncLayerButtons(instance);
    instance.map.classList.add("tiles-ready");
    instance.map.classList.remove("tiles-failed");
    instance.status.textContent = `${source.label} tiles - zoom ${instance.zoom}${place}`;
    return;
  }
  instance.map.classList.remove("tiles-ready");
  if (instance.baseLayer === "satellite" && tileState.loaded > 0 && !hasVisibleTiles) {
    scheduleSatelliteVisibilityFallback(instance);
  }
  if (tileState.failedCompletely) {
    instance.map.classList.add("tiles-failed");
    instance.status.textContent = message || `${source.label} tiles failed to load`;
    return;
  }
  instance.map.classList.remove("tiles-failed");
  instance.status.textContent = message || `Loading ${source.label} imagery - zoom ${instance.zoom}${place}`;
}

function syncLayerButtons(instance) {
  if (instance.map.id !== "gisMap") return;
  const activeLayer = instance.activeBaseLayer || null;
  $("#streetMapLayer")?.classList.toggle("active", activeLayer === "streets");
  $("#streetMapLayer")?.setAttribute("aria-pressed", activeLayer === "streets" ? "true" : "false");
  $("#satelliteMapLayer")?.classList.toggle("active", activeLayer === "satellite");
  $("#satelliteMapLayer")?.setAttribute("aria-pressed", activeLayer === "satellite" ? "true" : "false");
}

function fallbackSatelliteToStreet(instance, reason = "Satellite imagery unavailable") {
  if (instance.baseLayer !== "satellite" || instance.satelliteFallbackInProgress) return;
  instance.satelliteFallbackInProgress = true;
  clearSatelliteVisibilityTimer(instance);
  const switchId = nextBaseLayerSwitch(instance);
  instance.baseLayer = "streets";
  instance.activeBaseLayer = null;
  resetLeafletLayerState(instance, "streets");
  if (instance.leafletMap) {
    const viewport = preserveLeafletViewport(instance.leafletMap, () => syncLeafletBaseLayer(instance));
    instance.zoom = viewport.zoom;
    instance.center = latLngToTile(viewport.center.lat, viewport.center.lng, viewport.zoom);
  } else syncLeafletBaseLayer(instance);
  instance.leafletTileLayers?.streets?.redraw();
  syncLayerButtons(instance);
  updateMapAttribution(instance);
  updateLeafletLayerStatus(instance, `${reason}; switched to Street View.`);
  scheduleStreetLoadOutcome(instance, switchId);
  if (instance.map.id === "gisMap") {
    updateNavigationPanel(`${reason}; switched to Street View.`);
  }
  requestAnimationFrame(() => {
    instance.satelliteFallbackInProgress = false;
  });
}

function handleLeafletTileEvent(instance, key, type) {
  const tileState = leafletLayerState(instance, key);
  if (type === "tileloadstart") {
    tileState.requested += 1;
    tileState.loading = true;
  } else if (type === "tileload") {
    tileState.loaded += 1;
    tileState.loading = false;
    tileState.failedCompletely = false;
  } else if (type === "tileerror") {
    tileState.failed += 1;
  } else if (type === "load") {
    tileState.loading = false;
    tileState.failedCompletely = tileState.requested > 0 && tileState.loaded === 0 && tileState.failed >= tileState.requested;
  }
  if (key !== instance.baseLayer) return;
  if (type === "tileload" || type === "load") {
    const switchId = instance.baseLayerSwitchId;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!isCurrentBaseLayerSwitch(instance, switchId, key)) return;
      updateLeafletLayerStatus(instance);
    }));
  }
  if (key === "satellite" && tileState.failedCompletely) {
    fallbackSatelliteToStreet(instance);
    return;
  }
  if (key === "satellite" && tileState.loaded > 0 && !hasVisibleUsableLeafletTiles(instance, "satellite")) {
    scheduleSatelliteVisibilityFallback(instance);
  }
  updateLeafletLayerStatus(instance);
}

function renderLeafletMap(instance) {
  if (instance.renderingLeafletMap || !mapContainerHasVisibleSize(instance.map)) return;
  instance.renderingLeafletMap = true;
  try {
    instance.leafletMap.invalidateSize(false);
    syncLeafletMapToState(instance);
    syncLeafletBaseLayer(instance);
    const size = instance.leafletMap.getSize();
    const sizeKey = `${size.x}x${size.y}:${instance.baseLayer}:${instance.zoom}`;
    if (instance.lastLeafletRenderKey !== sizeKey) {
      instance.lastLeafletRenderKey = sizeKey;
      instance.leafletTileLayers?.[instance.baseLayer]?.redraw();
    }
    if (instance.zoomSlider) instance.zoomSlider.value = String(instance.zoom);
    if (instance.zoomBadge) instance.zoomBadge.textContent = `z${instance.zoom}`;
    updateLeafletLayerStatus(instance);
    updateMapAttribution(instance);
    renderHeatOverlay(instance);
    renderNavigationOverlay(instance);
  } finally {
    instance.renderingLeafletMap = false;
  }
}

function renderSatelliteMaps() {
  satelliteMaps.forEach(renderSatelliteMap);
}

function scheduleMapResizeRender() {
  window.clearTimeout(scheduleMapResizeRender.timer);
  scheduleMapResizeRender.timer = window.setTimeout(renderSatelliteMaps, 120);
}

function scheduleLeafletRender(instance) {
  if (instance.leafletRenderScheduled) return;
  instance.leafletRenderScheduled = true;
  requestAnimationFrame(() => {
    instance.leafletRenderScheduled = false;
    renderSatelliteMap(instance);
  });
}

function zoomSatelliteMap(instance, delta) {
  zoomMapTo(instance, instance.zoom + delta);
}

function zoomMapTo(instance, zoom) {
  const nextZoom = Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, Math.round(zoom)));
  if (nextZoom === instance.zoom) return;
  if (instance.leafletMap) {
    instance.leafletMap.setZoom(nextZoom, { animate: false });
    syncInstanceFromLeaflet(instance);
    renderSatelliteMap(instance);
    return;
  }
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
  clearSatelliteVisibilityTimer(instance);
  const nextLayer = TILE_SOURCES[baseLayer] ? baseLayer : "streets";
  if (instance.baseLayer === nextLayer && instance.leafletMap?.hasLayer(instance.leafletTileLayers?.[nextLayer])) {
    updateLeafletLayerStatus(instance);
    return;
  }
  const switchId = nextBaseLayerSwitch(instance);
  instance.baseLayer = nextLayer;
  instance.activeBaseLayer = null;
  updateMapAttribution(instance);
  syncLayerButtons(instance);
  if (instance.leafletMap) {
    resetLeafletLayerState(instance, instance.baseLayer);
    syncLeafletBaseLayer(instance);
    instance.leafletTileLayers?.[instance.baseLayer]?.redraw();
    updateLeafletLayerStatus(instance, `Loading ${TILE_SOURCES[instance.baseLayer].label} imagery...`);
    if (instance.baseLayer === "satellite") scheduleSatelliteVisibilityFallback(instance);
    else scheduleStreetLoadOutcome(instance, switchId);
  }
  if (instance.map.id === "gisMap") {
    updateNavigationPanel(`Loading ${TILE_SOURCES[instance.baseLayer].label} imagery...`);
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
  const data = await api(`/api/maps/search?q=${encodeURIComponent(query)}`);
  return Array.isArray(data.results) ? data.results : [];
}

function selectMapPlace(instance, place) {
  const point = validMapPoint(place);
  if (!point) {
    updateNavigationPanel("The selected search result has invalid coordinates.");
    return false;
  }
  const fullLabel = place.label || place.displayName || place.name;
  setMapView(instance, point, Math.max(instance.zoom, 14), fullLabel);
  state.mapNavigation.selectionMode = null;
  $("#setMapStart")?.classList.remove("active");
  $("#setMapDestination")?.classList.remove("active");
  state.mapNavigation = previewPlace(state.mapNavigation, {
    ...place,
    ...point,
    label: fullLabel,
    type: place.type,
    provider: place.provider,
    locationStatus: "Provider result"
  });
  renderSatelliteMap(instance);
  updateNavigationPanel(`Preview shown for ${fullLabel}. Confirm it to set destination D.`);
  return true;
}

function confirmMapPlace(instance, place) {
  const preview = state.mapNavigation.searchPreview;
  if (!preview || preview.id !== place.id) {
    updateNavigationPanel("Preview this candidate before selecting it.");
    return false;
  }
  state.mapNavigation = confirmPreviewDestination(state.mapNavigation);
  updateNavigationPanel(`Destination selected: ${state.mapNavigation.destination.label}. Click Calculate Route.`);
  renderSatelliteMap(instance);
  return true;
}

function cancelMapPlace(instance, place) {
  const preview = state.mapNavigation.searchPreview;
  if (!preview || preview.id !== place.id) return false;
  state.mapNavigation = cancelPlacePreview(state.mapNavigation);
  updateNavigationPanel("Destination preview cancelled.");
  renderSatelliteMap(instance);
  return true;
}

function clearRouteResult() {
  state.mapNavigation = clearCalculatedRoutes(state.mapNavigation);
}

function clearSearchPreview() {
  state.mapNavigation.searchPreview = null;
}

function setSearchPreview(point, label = "Search preview", metadata = {}) {
  const preview = canonicalRoutePoint({ ...point, ...metadata, label }, label);
  state.mapNavigation.searchPreview = preview;
  return preview;
}

function setNavigationSelectionMode(mode) {
  state.mapNavigation.selectionMode = state.mapNavigation.selectionMode === mode ? null : mode;
  $("#setMapStart")?.classList.toggle("active", state.mapNavigation.selectionMode === "start");
  $("#setMapStart")?.setAttribute("aria-pressed", state.mapNavigation.selectionMode === "start" ? "true" : "false");
  $("#setMapDestination")?.classList.toggle("active", state.mapNavigation.selectionMode === "destination");
  $("#setMapDestination")?.setAttribute("aria-pressed", state.mapNavigation.selectionMode === "destination" ? "true" : "false");
  const message = state.mapNavigation.selectionMode === "start"
    ? "Click the map to choose the route start."
    : state.mapNavigation.selectionMode === "destination"
      ? "Click the map to choose the destination."
      : "Map selection cancelled.";
  gisMapInstance()?.map.classList.toggle("selection-active", Boolean(state.mapNavigation.selectionMode));
  updateNavigationPanel(message);
}

function canonicalRoutePoint(point, fallbackLabel = "Route point") {
  const validPoint = validMapPoint(point);
  if (!validPoint) return null;
  return {
    ...point,
    ...validPoint,
    label: point?.label || point?.displayName || point?.name || fallbackLabel
  };
}

function setRouteStart(point, label = "Route start") {
  const canonicalPoint = canonicalRoutePoint({ ...point, label }, label);
  if (!canonicalPoint) return false;
  state.mapNavigation.start = canonicalPoint;
  clearRouteResult();
  return true;
}

function setRouteDestination(point, label = "Destination", metadata = {}) {
  const canonicalPoint = canonicalRoutePoint({ ...point, ...metadata, label }, label);
  if (!canonicalPoint) return false;
  state.mapNavigation.destination = canonicalPoint;
  clearSearchPreview();
  clearRouteResult();
  return true;
}

function samePoint(a, b) {
  return Boolean(a && b && Math.abs(Number(a.lat) - Number(b.lat)) < 0.00001 && Math.abs(Number(a.lng) - Number(b.lng)) < 0.00001);
}

function isLocalOperationalPoint(point) {
  const validPoint = validMapPoint(point);
  return Boolean(validPoint
    && validPoint.lat >= LOCAL_OPERATIONAL_BOUNDS.minLat
    && validPoint.lat <= LOCAL_OPERATIONAL_BOUNDS.maxLat
    && validPoint.lng >= LOCAL_OPERATIONAL_BOUNDS.minLng
    && validPoint.lng <= LOCAL_OPERATIONAL_BOUNDS.maxLng);
}

function isDefaultFallbackPoint(point) {
  const validPoint = validMapPoint(point);
  return Boolean(validPoint && samePoint(validPoint, DEFAULT_MAP_CENTER));
}

function resetGisMapToOperationalCenter(message = "Map reset to Patancheru/BHEL operational area.") {
  const instance = gisMapInstance();
  if (!instance) return;
  setMapView(instance, DEFAULT_MAP_CENTER, GIS_HOME_ZOOM, "Operational center");
  renderSatelliteMap(instance);
  updateNavigationPanel(message);
}

function resetGisMapView() {
  resetGisNavigationState("");
  resetGisMapToOperationalCenter("Map reset to local operational center. Route markers cleared.");
}

function validOperationalMapPoints() {
  const items = [
    ...(state.mapLayers.incidents ? state.incidents.filter(isIncidentVisibleOnMap).map((incident) => incidentCoordinates(incident, "location", null)) : []),
    ...(state.mapLayers.responseUnits ? state.responseUnits.filter(isResponseUnitVisibleOnMap) : []),
    ...(state.mapLayers.policeStations ? state.policeStations : []),
    ...(state.mapLayers.dangerZones ? state.zones : []),
    ...(activeRouteWorkflow() ? [state.mapNavigation.start, state.mapNavigation.destination] : [])
  ];
  return items
    .map(validMapPoint)
    .filter((point) => isLocalOperationalPoint(point) && !isDefaultFallbackPoint(point));
}

function fitGisMapToOperationalMarkers() {
  const instance = gisMapInstance();
  if (!instance) return;
  const points = validOperationalMapPoints();
  if (!points.length) return resetGisMapToOperationalCenter("No valid local operational markers found. Map reset to the operational center.");
  fitGisMapToPoints(points, "Operational markers");
  updateNavigationPanel("Map fitted to valid local operational markers.");
}

function fitGisMapToPoints(points, label = "Operational markers") {
  const instance = gisMapInstance();
  if (!instance) return;
  const localPoints = points
    .map(validMapPoint)
    .filter((point) => point && isLocalOperationalPoint(point) && !isDefaultFallbackPoint(point));
  if (!localPoints.length) return resetGisMapToOperationalCenter("No valid local operational markers found. Map reset to the operational center.");
  const lats = localPoints.map((point) => point.lat);
  const lngs = localPoints.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  const span = Math.max(maxLat - minLat, maxLng - minLng);
  const zoom = span < 0.02 ? 14 : span < 0.08 ? 13 : span < 0.2 ? 12 : 11;
  setMapView(instance, center, zoom, label);
  renderSatelliteMap(instance);
}

function selectUnitAsRouteStart(unit) {
  const point = validMapPoint(unit);
  if (!point) return updateNavigationPanel(`${unitLabel(unit)} does not have a valid route location.`);
  const currentStart = state.mapNavigation.start;
  if (currentStart && !samePoint(currentStart, point)) {
    const confirmed = window.confirm(`Replace current route start with ${unitLabel(unit)}?`);
    if (!confirmed) return updateNavigationPanel("Route start was not changed.");
  }
  state.selectedUnitId = unit.id;
  clearSearchPreview();
  setRouteStart(point, `${unitLabel(unit)} location`);
  fitGisMapToPoints([point, ...validOperationalMapPoints()], `${unitLabel(unit)} route start`);
  updateNavigationPanel(`${unitLabel(unit)} selected as route start.`);
}

function routePointValidation() {
  const rawStart = state.mapNavigation.start;
  const rawDestination = state.mapNavigation.destination;
  const start = canonicalRoutePoint(rawStart, "Route start");
  const destination = canonicalRoutePoint(rawDestination, "Destination");
  const errors = [];
  if (!rawStart && !rawDestination) errors.push("Choose a route start and destination before calculating.");
  else {
    if (!rawStart) errors.push("Choose a route start before calculating.");
    else if (!start) errors.push("Route start has invalid coordinates.");
    if (!rawDestination) errors.push("Choose a destination before calculating.");
    else if (!destination) errors.push("Destination has invalid coordinates.");
  }
  if (start && destination && samePoint(start, destination)) errors.push("Route start and destination cannot be the same point.");
  return {
    valid: errors.length === 0,
    start,
    destination,
    errors,
    message: errors.length
      ? errors.join(" ")
      : "Start and destination selected. Click Calculate Route."
  };
}

function hasRoutePoints() {
  return routePointValidation().valid;
}

function hasRouteWork() {
  const { start, destination, searchPreview, route, routes, currentLocation, selectionMode } = state.mapNavigation;
  return Boolean(start || destination || searchPreview || route || routes?.length || currentLocation || selectionMode);
}

function applyGisButtonState(button, config = {}) {
  if (!button) return;
  const label = config.label || button.textContent;
  button.disabled = Boolean(config.disabled);
  button.textContent = "";
  if (config.icon) {
    const icon = node("span", `gis-button-icon gis-icon-${config.icon}`);
    icon.setAttribute("aria-hidden", "true");
    button.append(icon);
  }
  button.append(node("span", "gis-button-label", label));
  button.classList.toggle("loading", Boolean(config.loading));
  button.classList.toggle("active", Boolean(config.active));
  if (config.pressed !== undefined) button.setAttribute("aria-pressed", config.pressed ? "true" : "false");
  const hint = config.disabled && config.reason ? config.reason : config.title || label;
  button.title = hint;
  button.setAttribute("aria-label", config.disabled && config.reason ? `${label}. ${config.reason}` : hint);
  if (config.disabled && config.reason) button.dataset.disabledReason = config.reason;
  else delete button.dataset.disabledReason;
}

function updateGisButtonStates() {
  const routeValidation = routePointValidation();
  const states = gisRouteButtonStates({
    ...state.mapNavigation,
    start: routeValidation.start,
    destination: routeValidation.destination,
    routePointError: routeValidation.valid ? "" : routeValidation.message,
    baseLayer: gisMapInstance()?.baseLayer || "streets",
    hasRouteWork: hasRouteWork()
  });
  applyGisButtonState($("#streetMapLayer"), states.street);
  applyGisButtonState($("#satelliteMapLayer"), states.satellite);
  applyGisButtonState($("#useMyLocation"), states.location);
  applyGisButtonState($("#fitGisMap"), states.fit);
  applyGisButtonState($("#resetGisMap"), states.reset);
  applyGisButtonState($("#setMapStart"), states.start);
  applyGisButtonState($("#setMapDestination"), states.destination);
  applyGisButtonState($("#navigateMap"), states.calculate);
  applyGisButtonState($("#recalculateRoute"), states.recalculate);
  applyGisButtonState($("#openExternalRoute"), states.external);
  applyGisButtonState($("#clearMapRoute"), states.clear);
  applyGisButtonState($("#clearRouteStart"), states.clearStart);
  applyGisButtonState($("#clearRouteDestination"), states.clearDestination);
  applyGisButtonState($("#swapRoutePoints"), states.swap);
}

function renderRoutePointCards() {
  const panel = $("#routePointCards");
  if (!panel) return;
  const routeValidation = routePointValidation();
  const rawPoints = { start: state.mapNavigation.start, destination: state.mapNavigation.destination };
  const canonicalPoints = { start: routeValidation.start, destination: routeValidation.destination };
  panel.textContent = "";
  [
    ["START", "Choose Set Start, Use My Location, or select a response unit.", "start"],
    ["DESTINATION", "Choose Set Destination, search, or navigate from an incident.", "destination"]
  ].forEach(([label, empty, type]) => {
    const point = canonicalPoints[type];
    const rawPoint = rawPoints[type];
    const invalid = Boolean(rawPoint && !point);
    const card = node("article", `route-point-card ${point ? "selected" : "empty"} ${invalid ? "invalid" : ""}`);
    const source = point?.locationStatus || point?.confidence || point?.type || (type === "start" && point ? "Route start" : point ? "Route destination" : "");
    card.append(
      node("span", "", label),
      node("strong", "", point?.label || rawPoint?.label || "Not selected"),
      node("small", "", point
        ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
        : invalid
          ? `${label.toLowerCase()} has invalid coordinates.`
          : empty)
    );
    if (source) card.append(node("small", "route-point-source", `Source: ${source}`));
    panel.append(card);
  });
}

async function reverseGeocodePoint(point) {
  const data = await api(`/api/maps/reverse?lat=${encodeURIComponent(point.lat)}&lng=${encodeURIComponent(point.lng)}`);
  return data.place || null;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function addLeafletMarker(instance, point, className, label, kind, title, onClick = null) {
  const validPoint = validMapPoint(point);
  if (!validPoint) return null;
  const size = className.includes("marker-cluster") ? [34, 34] : className.includes("station-marker") ? [32, 32] : className.includes("unit-marker") ? [30, 30] : [28, 28];
  const icon = L.divIcon({
    className: "rakshak-leaflet-marker",
    html: `<span class="${escapeHtml(className)}" data-marker-kind="${escapeHtml(kind)}" aria-label="${escapeHtml(title)}">${escapeHtml(label)}</span>`,
    iconSize: size,
    iconAnchor: [size[0] / 2, size[1] / 2]
  });
  const marker = L.marker([validPoint.lat, validPoint.lng], {
    icon,
    title,
    keyboard: true,
    riseOnHover: true
  }).addTo(instance.leafletMarkerLayer);
  marker.bindTooltip(title, { direction: "top", opacity: 0.95 });
  marker.bindPopup(`<strong>${escapeHtml(kind)}</strong><br>${escapeHtml(title)}<br><small>${validPoint.lat.toFixed(5)}, ${validPoint.lng.toFixed(5)}</small>`);
  if (onClick) marker.on("click", onClick);
  return marker;
}

const HIDDEN_INCIDENT_STATUSES = new Set(["closed", "rejected / false alarm", "archived"]);
const RESOLVED_INCIDENT_MAP_RETENTION_MINUTES = Math.max(0, Number(import.meta.env.VITE_RESOLVED_INCIDENT_MAP_RETENTION_MINUTES) || 0);

function resolvedIncidentStillRetained(incident) {
  if (!RESOLVED_INCIDENT_MAP_RETENTION_MINUTES) return false;
  const timestamp = Date.parse(incident.resolvedAt || incident.updatedAt || incident.lastDetectedAt || incident.createdAt || "");
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= RESOLVED_INCIDENT_MAP_RETENTION_MINUTES * 60 * 1000;
}

function isIncidentVisibleOnMap(incident) {
  const status = String(incident?.status || "").toLowerCase();
  if (HIDDEN_INCIDENT_STATUSES.has(status)) return false;
  if (status === "resolved" && !resolvedIncidentStillRetained(incident)) return false;
  return Boolean(incidentCoordinates(incident, "location", null));
}

function isResponseUnitVisibleOnMap(unit) {
  const status = unitDispatchStatus(unit);
  if (unit.id === state.selectedUnitId) return true;
  if (activeIncident()?.assignedUnitId === unit.id || unit.assignedIncidentId || unit.currentIncidentId) return true;
  return ["available", "busy", "assigned", "responding", "en route"].includes(status);
}

function unitMapLabel(unit) {
  const status = unitDispatchStatus(unit);
  if (unit.id === state.selectedUnitId || activeIncident()?.assignedUnitId === unit.id || ["assigned", "responding", "en route"].includes(status)) return "R";
  if (status === "busy") return "B";
  if (status === "available") return "A";
  return "U";
}

function markerStatusClass(value) {
  return String(value || "unknown").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function activeRouteWorkflow() {
  const nav = state.mapNavigation;
  return Boolean(nav.route || nav.routeLoading || nav.selectionMode || nav.start || nav.destination || nav.searchPreview);
}

function markerDescriptorKey(descriptor) {
  return `${descriptor.type}:${descriptor.id}:${descriptor.point.lat.toFixed(5)}:${descriptor.point.lng.toFixed(5)}`;
}

function dedupeMarkerDescriptors(descriptors) {
  const seen = new Set();
  return descriptors.filter((descriptor) => {
    const key = markerDescriptorKey(descriptor);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clusterMarkerDescriptors(descriptors) {
  const clusters = [];
  dedupeMarkerDescriptors(descriptors).forEach((descriptor) => {
    const cluster = clusters.find((item) => Math.hypot(item.point.lat - descriptor.point.lat, item.point.lng - descriptor.point.lng) <= 0.004);
    if (cluster) {
      cluster.items.push(descriptor);
      cluster.point = {
        lat: cluster.items.reduce((sum, item) => sum + item.point.lat, 0) / cluster.items.length,
        lng: cluster.items.reduce((sum, item) => sum + item.point.lng, 0) / cluster.items.length
      };
    } else {
      clusters.push({ point: descriptor.point, items: [descriptor] });
    }
  });
  return clusters;
}

function addLeafletMarkerCluster(instance, cluster) {
  const title = `${cluster.items.length} map records: ${cluster.items.map((item) => item.label).join(", ")}`;
  const marker = addLeafletMarker(instance, cluster.point, "operational-marker marker-cluster", String(cluster.items.length), "Cluster", title);
  if (!marker) return null;
  const rows = cluster.items
    .map((item) => `<li><strong>${escapeHtml(item.kind)}</strong>: ${escapeHtml(item.label)}<br><small>${escapeHtml(item.status || "Active")} - ${item.point.lat.toFixed(5)}, ${item.point.lng.toFixed(5)}</small></li>`)
    .join("");
  marker.bindPopup(`<strong>${cluster.items.length} map records</strong><ul class="map-cluster-list">${rows}</ul>`);
  return marker;
}

function renderOperationalMarkerDescriptors(instance, descriptors) {
  clusterMarkerDescriptors(descriptors).forEach((cluster) => {
    if (cluster.items.length > 1) {
      addLeafletMarkerCluster(instance, cluster);
      return;
    }
    const descriptor = cluster.items[0];
    addLeafletMarker(instance, descriptor.point, descriptor.className, descriptor.markerLabel, descriptor.kind, descriptor.title, descriptor.onClick);
    if (descriptor.assertBounds) assertMarkerWithinMapBounds(instance, descriptor.point, descriptor.assertBounds);
  });
}

function assertMarkerWithinMapBounds(instance, point, label) {
  if (!import.meta.env.DEV || !instance.leafletMap) return;
  const bounds = instance.leafletMap.getBounds();
  const inside = bounds.contains([point.lat, point.lng]);
  console.assert(inside, "[GIS marker bounds]", {
    label,
    marker: { lat: point.lat, lng: point.lng },
    center: instance.leafletMap.getCenter(),
    zoom: instance.leafletMap.getZoom(),
    bounds: {
      south: bounds.getSouth(),
      west: bounds.getWest(),
      north: bounds.getNorth(),
      east: bounds.getEast()
    }
  });
}

function renderNavigationOverlay(instance) {
  if (!instance.leafletMap || !instance.leafletMarkerLayer || !instance.leafletRouteLayer) return;
  instance.leafletMarkerLayer.clearLayers();
  instance.leafletRouteLayer.clearLayers();
  const { currentLocation, searchPreview, routes = [], selectedRouteId } = state.mapNavigation;
  const route = selectedRoute(state.mapNavigation);
  const routeValidation = routePointValidation();
  const start = routeValidation.start;
  const destination = routeValidation.destination;
  const routeWorkflow = activeRouteWorkflow();
  [...routes].sort((first, second) => Number(first.id === selectedRouteId) - Number(second.id === selectedRouteId)).forEach((option) => {
    const points = (option.geometry?.coordinates || [])
      .map(([lng, lat]) => validMapPoint({ lat, lng }))
      .filter(Boolean)
      .map((point) => [point.lat, point.lng]);
    if (points.length < 2) return;
    const selected = option.id === selectedRouteId;
    const line = L.polyline(points, {
      className: `route-line leaflet-route-line ${selected ? "selected" : "alternate"} ${option.isApproximate ? "approximate" : ""}`,
      color: option.isApproximate ? "#9a6700" : selected ? "#087d78" : "#728895",
      weight: selected ? 7 : 4,
      opacity: selected ? 1 : 0.58,
      dashArray: option.isApproximate ? "10 8" : null
    }).addTo(instance.leafletRouteLayer);
    line.on("click", () => {
      state.mapNavigation = selectRouteId(state.mapNavigation, option.id);
      updateNavigationPanel(`${option.label} selected.`);
      renderSatelliteMaps();
    });
  });
  [
    [routeWorkflow ? start : null, "route-marker start-marker", "S"],
    [routeWorkflow ? destination : null, "route-marker destination-marker", "D"],
    [instance.map.id === "gisMap" && currentLocation && !samePoint(currentLocation, start) ? currentLocation : null, "route-marker current-location-marker", "You"]
  ].forEach(([point, className, label]) => {
    if (!point) return;
    const kind = label === "S" ? "Route start" : label === "D" ? "Destination" : "Current location";
    addLeafletMarker(instance, point, className, label, kind, `${kind}: ${point.label || `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`}`);
  });
  const preview = canonicalRoutePoint(searchPreview, "Search preview");
  if (instance.map.id === "gisMap" && preview) {
    addLeafletMarker(instance, preview, "route-marker search-preview-marker", "P", "Search preview", `${preview.label || "Search preview"} - preview only`);
  }
  if (!["gisMap", "commandMap"].includes(instance.map.id)) return;
  const descriptors = [];
  if (state.mapLayers.dangerZones) state.zones.forEach((zone) => {
    const point = validMapPoint(zone);
    if (!point) return;
    descriptors.push({
      type: "zone",
      id: zone.id || zone.name,
      label: zone.name || zone.id || "Zone",
      markerLabel: "Z",
      kind: "Danger zone",
      status: `${displayValue(zone.severity, "safe")} - ${zone.currentDensity ?? "--"}% density`,
      point,
      className: `operational-marker zone-marker zone-${zone.severity || "safe"}`,
      title: `Zone ${zone.name || zone.id}: ${zone.isDemo ? "demo" : "operational"} - ${displayValue(zone.severity, "safe")} - ${zone.currentDensity ?? "--"}% density`
    });
  });
  if (state.mapLayers.incidents) state.incidents.forEach((incident) => {
    if (!isIncidentVisibleOnMap(incident)) return;
    const point = incidentCoordinates(incident, "location", null);
    if (!point) return;
    const selected = incident.id === state.selectedIncidentId ? " selected" : "";
    const title = `Incident ${incident.id}: ${incidentTitle(incident)} - severity ${displayValue(incident.severity)} - status ${displayValue(incident.status)} - source ${incidentSource(incident)} - ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}${isOperatorRole() ? " - Click to set as destination" : ""}`;
    descriptors.push({
      type: "incident",
      id: incident.id,
      label: incidentTitle(incident),
      markerLabel: "!",
      kind: "Incident",
      status: displayValue(incident.status),
      point,
      className: `operational-marker incident-marker ${sevClass(incident.severity)}${selected}`,
      title,
      assertBounds: `incident ${incident.id}`,
      onClick: () => {
        state.selectedIncidentId = incident.id;
        if (instance.map.id === "gisMap" && isOperatorRole()) {
          clearSearchPreview();
          setRouteDestination(point, incident.address || incidentTitle(incident), {
            locationStatus: incident.locationStatus || "Verified",
            source: incident.source || incident.sourceType
          });
          updateNavigationPanel(`${incidentTitle(incident)} selected as destination.`);
          renderSatelliteMaps();
          return;
        }
        focusIncidentOnCommandMap(incident);
        renderIncidentCommand();
      }
    });
  });
  if (["gisMap", "commandMap"].includes(instance.map.id)) {
    if (state.mapLayers.policeStations) state.policeStations.forEach((station) => {
      const point = validMapPoint(station);
      if (!point) return;
      const title = `${station.stationName || station.name}: ${station.badge || (station.isDemo ? "DEMO STATION" : "REAL STATION")} - ${station.jurisdiction || "Jurisdiction unavailable"} - updated ${station.lastUpdated ? alertTime(station.lastUpdated) : "unknown"}`;
      descriptors.push({
        type: "station",
        id: station.id || station.stationId || station.name,
        label: station.stationName || station.name || "Police station",
        markerLabel: "PS",
        kind: "Station",
        status: station.operational === false ? "Inactive" : "Operational",
        point,
        className: `operational-marker station-marker ${station.isDemo ? "demo" : "real"}`,
        title,
        onClick: () => {
          const currentStart = state.mapNavigation.start;
          if (currentStart && !samePoint(currentStart, point) && !window.confirm(`Replace current route start with ${station.stationName || station.name || "this station"}?`)) {
            updateNavigationPanel("Route start was not changed.");
            return;
          }
          setRouteStart(point, `${station.stationName || station.name} station/base`);
          updateNavigationPanel(`${station.stationName || "Station"} selected as route start.`);
          renderSatelliteMaps();
        }
      });
    });
    if (state.mapLayers.responseUnits) state.responseUnits.forEach((unit) => {
      const point = validMapPoint(unit);
      if (!point || !isResponseUnitVisibleOnMap(unit)) return;
      const status = unitDispatchStatus(unit);
      const assigned = activeIncident()?.assignedUnitId === unit.id ? " assigned" : "";
      const selected = state.selectedUnitId === unit.id ? " selected" : "";
      const title = `${unitLabel(unit)}: ${displayValue(status)} - ${unitTypeLabel(unit)} - ${unit.sourceBadge || unit.sourceLabel || displayValue(unit.source)} - ${unit.currentAddress || unit.zone || "Location unavailable"} - updated ${unit.lastLocationUpdatedAt ? alertTime(unit.lastLocationUpdatedAt) : "unknown"}`;
      descriptors.push({
        type: "unit",
        id: unit.id || unit.unitCode || unit.name,
        label: unitLabel(unit),
        markerLabel: unitMapLabel(unit),
        kind: "Response unit",
        status: displayValue(status),
        point,
        className: `operational-marker unit-marker unit-${markerStatusClass(status)}${assigned}${selected}`,
        title,
        onClick: () => selectUnitAsRouteStart(unit)
      });
    });
  }
  renderOperationalMarkerDescriptors(instance, descriptors);
}

function clearDynamicMapMarkers(instance) {
  (instance.dynamicMarkers || []).forEach((marker) => marker.remove());
  instance.dynamicMarkers = [];
  instance.leafletMarkerLayer?.clearLayers();
  instance.leafletRouteLayer?.clearLayers();
}

function emptyMapNavigationState() {
  return emptyRouteNavigationState();
}

function removeNavigationLayerArtifacts(instance) {
  if (!instance) return;
  clearDynamicMapMarkers(instance);
  if (instance.navigationLayer) instance.navigationLayer.textContent = "";
}

function clearGisSelectionUi() {
  $("#setMapStart")?.classList.remove("active");
  $("#setMapStart")?.setAttribute("aria-pressed", "false");
  $("#setMapDestination")?.classList.remove("active");
  $("#setMapDestination")?.setAttribute("aria-pressed", "false");
  gisMapInstance()?.map.classList.remove("selection-active");
}

function resetGisNavigationState(message = "", { preserveRoute = false } = {}) {
  if (!preserveRoute) state.mapNavigation = emptyMapNavigationState();
  else state.mapNavigation.selectionMode = null;
  clearGisSelectionUi();
  satelliteMaps.forEach(removeNavigationLayerArtifacts);
  if (message) setMapStatus(message);
}

function routeDisplayMeta(route) {
  if (!route) return {
    title: "No route",
    status: "Not calculated",
    type: "--",
    badge: "",
    warning: ""
  };
  const approximate = Boolean(route.isApproximate || route.approximate || route.routeType === "approximate_fallback");
  return {
    title: approximate ? "Air-line estimate" : route.label || route.routeLabel || "Recommended",
    status: approximate ? "Straight-line distance only" : "Real road route calculated",
    type: approximate ? "Haversine estimate" : `${route.provider || "OSRM"} road routing`,
    badge: approximate ? "Straight-line estimate" : "Real road route",
    warning: (route.warnings || (route.warning ? [route.warning] : [])).join(" ")
  };
}

function mapStatusKind(message = "") {
  const text = message.toLowerCase();
  if (/denied|unavailable|could not|failed|error/.test(text)) return "error";
  if (/approximate|fallback|warning|verify|confirm|degraded|low-confidence/.test(text)) return "warning";
  if (/ready|selected|calculated|active|fitted|cleared|reset/.test(text)) return "success";
  return "neutral";
}

function setMapStatus(message) {
  const status = $("#mapNavigationStatus");
  if (!status || !message) return;
  status.textContent = message;
  status.classList.remove("neutral", "success", "warning", "error");
  status.classList.add(mapStatusKind(message));
}

function updateNavigationPanel(message = "") {
  const { start, destination, routeLoading } = state.mapNavigation;
  const route = selectedRoute(state.mapNavigation);
  const routeValidation = routePointValidation();
  const displayStart = routeValidation.start || start;
  const displayDestination = routeValidation.destination || destination;
  const meta = routeDisplayMeta(route);
  setText("#routeDistance", route ? `${route.isApproximate ? "Straight-line " : ""}${Number(route.distanceKm).toFixed(2)} km` : "--");
  setText("#routeEta", Number(route?.durationMinutes) > 0 ? `${Math.round(route.durationMinutes)} min` : "Unavailable");
  setText("#routeProvider", meta.title);
  setText("#routePoints", `${displayStart?.label || "Start not selected"} to ${displayDestination?.label || "destination not selected"}`);
  setText("#routeStartCoordinates", `Status: ${routeLoading ? "Calculating" : meta.status}`);
  setText("#routeDestinationCoordinates", `Type: ${meta.type}`);
  setText("#routeCalculatedAt", route?.calculatedAt ? `Calculated: ${new Date(route.calculatedAt).toLocaleString()}` : "Calculated: --");
  const steps = $("#routeSteps");
  if (steps) {
    steps.textContent = "";
    const emptyMessage = routeLoading
      ? "Calculating route..."
      : routeValidation.valid
        ? "Start and destination selected. Click Calculate Route."
        : routeValidation.message;
    if (route) {
      steps.append(node("li", `route-badge ${route.approximate ? "warning" : "success"}`, meta.badge));
      if (meta.warning) steps.append(node("li", "route-warning-item", meta.warning));
    }
    (route?.steps?.length ? route.steps : [emptyMessage]).forEach((step) => {
      const maneuver = typeof step === "string"
        ? step
        : [step.maneuver?.type || "Continue", step.maneuver?.modifier, step.name ? `on ${step.name}` : ""].filter(Boolean).join(" ");
      steps.append(node("li", "", maneuver));
    });
  }
  if (message) setMapStatus(message);
  renderRoutePointCards();
  updateGisButtonStates();
  renderDispatchPanels();
}

function renderRouteOptionsPanel() {
  const panel = $("#routeOptionsPanel");
  if (!panel) return;
  panel.textContent = "";
  const route = selectedRoute(state.mapNavigation);
  const options = state.mapNavigation.routes || [];
  if (!route || !options.length) {
    panel.append(node("div", "empty-state", "Calculate a route to compare options."));
    return;
  }
  const routeMeta = routeDisplayMeta(route);
  if (routeMeta.warning) panel.append(node("p", route.approximate ? "location-warning" : "dispatch-ready", routeMeta.warning));
  if (route.isApproximate) {
    panel.append(node("div", "empty-state", "Road-route comparison is unavailable for a straight-line estimate."));
    return;
  }
  if (!route.isApproximate) panel.append(node("p", "dispatch-ready", `${options.length} real route option${options.length === 1 ? "" : "s"} returned by OSRM.`));
  options.forEach((option, index) => {
    const active = state.mapNavigation.selectedRouteId === option.id;
    const card = node("button", `route-option-card ${active ? "active" : ""}`);
    card.type = "button";
    const badgeText = option.isApproximate ? "Estimate only" : option.provider || "OSRM";
    card.append(
      node("span", `route-option-selected ${active ? "active" : ""}`, active ? "Selected" : "Option"),
      node("strong", "", option.isApproximate ? "Air-line estimate" : option.label),
      node("span", "", `${option.isApproximate ? "Straight-line " : ""}${Number(option.distanceKm).toFixed(2)} km · ${Number(option.durationMinutes) > 0 ? `${Math.round(option.durationMinutes)} min` : "ETA unavailable"}`),
      node("small", `route-option-badge ${option.isApproximate ? "warning" : "success"}`, badgeText)
    );
    card.addEventListener("click", () => {
      state.mapNavigation = selectRouteId(state.mapNavigation, option.id);
      updateNavigationPanel(`${option.label || "Route"} selected.`);
      renderSatelliteMaps();
    });
    panel.append(card);
  });
}

function unitCard(unit, compact = false) {
  const status = unitDispatchStatus(unit);
  const card = node("button", `unit-card status-${status} ${state.selectedUnitId === unit.id ? "active" : ""}`);
  card.type = "button";
  const point = validMapPoint(unit);
  card.append(
    node("strong", "", `${unitLabel(unit)} - ${displayValue(unit.name, "Response unit")}`),
    node("span", "", `${displayValue(status)} - ${unitTypeLabel(unit)} - ${unit.sourceBadge || unit.sourceLabel || displayValue(unit.source)}`),
    node("small", "", unit.currentAddress || unit.address || unit.zone || "Location address unavailable"),
    node("small", "", `Station: ${unit.stationName || unit.station || "Not linked"} - Beat: ${unit.beat || unit.sector || "Unassigned"}`),
    node("small", "", `Updated: ${unit.lastLocationUpdatedAt ? alertTime(unit.lastLocationUpdatedAt) : "unknown"}${unit.locationFreshness ? ` - ${unit.locationFreshness}` : ""}`)
  );
  if (unit.isDemo || unit.sourceNotes) card.append(node("small", unit.isDemo ? "location-warning" : "", unit.sourceNotes || "Simulated unit for demo"));
  if (point) {
    card.addEventListener("click", () => {
      selectUnitAsRouteStart(unit);
    });
  }
  return card;
}

function renderUnitPanel(selector) {
  const panel = $(selector);
  if (!panel) return;
  panel.textContent = "";
  const units = state.responseUnits || [];
  const summary = state.responseUnitSummary?.total !== undefined ? state.responseUnitSummary : unitSummary(units);
  panel.append(node("strong", "unit-section-title", "Response Summary"));
  const summaryRow = node("div", "unit-summary-grid");
  [
    ["Total", summary.total ?? units.length],
    ["Available", summary.available ?? 0],
    ["Assigned", summary.assigned ?? 0],
    ["Busy", summary.busy ?? 0],
    ["Offline", summary.offline ?? 0],
    ["Stale", summary.stale ?? 0]
  ].forEach(([label, value]) => {
    const item = node("span");
    item.append(node("small", "", label), node("strong", "", String(value)));
    summaryRow.append(item);
  });
  panel.append(summaryRow);
  const selected = units.find((unit) => unit.id === state.selectedUnitId)
    || units.find((unit) => activeIncident()?.assignedUnitId === unit.id)
    || null;
  panel.append(node("strong", "unit-section-title", "Selected Unit"));
  if (selected) {
    const selectedWrap = node("div", "selected-unit-section");
    selectedWrap.append(unitCard(selected));
    panel.append(selectedWrap);
  } else {
    panel.append(node("div", "empty-state compact", "No response unit selected."));
  }
  panel.append(node("strong", "unit-section-title", "All Response Units"));
  const list = node("div", "unit-mini-list");
  units.slice(0, 12).forEach((unit) => list.append(unitCard(unit, true)));
  panel.append(list);
}

function renderDispatchCandidatePanel() {
  const panel = $("#dispatchCandidatePanel");
  if (!panel) return;
  panel.textContent = "";
  const warnings = state.dispatchWarnings || [];
  warnings.forEach((warning) => panel.append(node("p", "location-warning", warning)));
  if (!state.dispatchCandidates?.length) {
    panel.append(node("div", "empty-state", "Assign nearest unit to view ranked candidates."));
    return;
  }
  panel.append(node("strong", "dispatch-candidate-title", "Candidate Ranking"));
  state.dispatchCandidates.slice(0, 5).forEach((candidate) => {
    const card = node("article", `candidate-card ${candidate.rank === 1 ? "selected" : ""}`);
    card.append(
      node("span", "source-badge ready", `#${candidate.rank}`),
      node("strong", "", `${candidate.unitCode || candidate.name} - ${candidate.etaMinutes} min`),
      node("small", "", `${candidate.distanceKm} km - ${candidate.routeLabel || "Route"}${candidate.approximate ? " - approximate" : ""}`),
      node("small", "", candidate.selectionReason || "Ranked by ETA, distance, beat match, and load.")
    );
    panel.append(card);
  });
}

function renderDispatchPanels() {
  renderRouteOptionsPanel();
  renderUnitPanel("#gisUnitPanel");
  renderUnitPanel("#commandUnitPanel");
  renderDispatchCandidatePanel();
}

function applyDispatchResult(result) {
  if (!result) return;
  const incident = result.incident || activeIncident();
  const unit = result.unit || incident?.assignedUnit;
  const route = normalizeRouteForMap(result.route);
  state.dispatchCandidates = result.candidates || state.dispatchCandidates || [];
  state.dispatchWarnings = result.warnings || [];
  if (incident?.id) state.selectedIncidentId = incident.id;
  if (unit?.id) state.selectedUnitId = unit.id;
  if (route && incident) {
    const start = validMapPoint(unit) || incidentCoordinates(incident, "unitLocation", null);
    const destination = incidentCoordinates(incident, "location", null);
    if (start && destination) {
      state.mapNavigation.start = { ...start, label: `${unitLabel(unit)} location` };
      state.mapNavigation.destination = { ...destination, label: incident.address || incident.title || "Incident" };
      state.mapNavigation = applyRouteResponse(state.mapNavigation, route);
      updateNavigationPanel(result.selectionReason || route.alternativeMessage || "Dispatch route ready.");
    }
  }
  renderDispatchPanels();
  renderSatelliteMaps();
}

function resetMap(instance) {
  setMapView(instance, instance.homeLatLng || tileToLatLng(instance.homeCenter.x, instance.homeCenter.y, instance.homeZoom), instance.homeZoom, "Operational center");
  renderSatelliteMap(instance);
}

function showWorldMap(instance) {
  setMapView(instance, { lat: 20.5937, lng: 78.9629 }, 3, "India overview");
  renderSatelliteMap(instance);
}

function togglePanMode(instance) {
  setPanMode(instance, true);
}

function createLeafletTileLayer(key) {
  return L.tileLayer(TILE_SOURCES[key].urlTemplate, {
    minZoom: MIN_MAP_ZOOM,
    maxZoom: MAX_MAP_ZOOM,
    crossOrigin: true
  });
}

function initializeLeafletInstance(instance, centerLatLng) {
  const leafletMap = initializeLeafletOnce(instance, () => {
    const map = L.map(instance.leafletHost, {
      zoomControl: false,
      attributionControl: false,
      keyboard: true
    }).setView([centerLatLng.lat, centerLatLng.lng], instance.zoom);
    instance.leafletTileLayers = {
      streets: createLeafletTileLayer("streets"),
      satellite: createLeafletTileLayer("satellite")
    };
    Object.entries(instance.leafletTileLayers).forEach(([key, layer]) => {
      layer.on("tileloadstart", () => handleLeafletTileEvent(instance, key, "tileloadstart"));
      layer.on("tileload", () => handleLeafletTileEvent(instance, key, "tileload"));
      layer.on("tileerror", () => handleLeafletTileEvent(instance, key, "tileerror"));
      layer.on("load", () => handleLeafletTileEvent(instance, key, "load"));
    });
    resetLeafletLayerState(instance, instance.baseLayer);
    instance.leafletTileLayers[instance.baseLayer].addTo(map);
    instance.leafletRouteLayer = L.layerGroup().addTo(map);
    instance.leafletMarkerLayer = L.layerGroup().addTo(map);
    return map;
  });
  if (leafletMap) {
    enableMapInteractions(instance);
    if (!instance.initialBaseLayerOutcomeScheduled) {
      instance.initialBaseLayerOutcomeScheduled = true;
      const switchId = nextBaseLayerSwitch(instance);
      if (instance.baseLayer === "satellite") scheduleSatelliteVisibilityFallback(instance);
      else scheduleStreetLoadOutcome(instance, switchId);
    }
  }
  return leafletMap;
}

function bindLeafletInteractions(instance) {
  if (!instance.leafletMap || !instance.selectNavigationPointFromMap) return;
  bindInstanceOnce(instance, "leaflet-interactions", () => {
    instance.leafletMap.on("click", (event) => {
      instance.selectNavigationPointFromMap(event);
    });
    instance.leafletMap.on("moveend zoomend resize", () => {
      if (instance.syncingLeafletView || instance.renderingLeafletMap) return;
      syncInstanceFromLeaflet(instance);
      scheduleLeafletRender(instance);
    });
  });
}

function enableMapInteractions(instance) {
  if (instance.mapInteractionsEnabled) {
    bindLeafletInteractions(instance);
    return;
  }
  instance.mapInteractionsEnabled = true;
  const drag = { active: false, lastX: 0, lastY: 0, moved: false };

  function blockedMapSelectionTarget(event) {
    return event.target.closest(".map-control, .map-zoom-slider, .map-search, .map-layer-control, .operational-marker");
  }

  function pointFromMapEvent(event) {
    if (event.latlng) return validMapPoint({ lat: event.latlng.lat, lng: event.latlng.lng });
    const rect = instance.map.getBoundingClientRect();
    const tileX = instance.center.x + (event.clientX - rect.left - rect.width / 2) / TILE_SIZE;
    const tileY = instance.center.y + (event.clientY - rect.top - rect.height / 2) / TILE_SIZE;
    return validMapPoint(tileToLatLng(tileX, tileY, instance.zoom));
  }

  async function selectNavigationPointFromMap(event) {
    if (instance.map.id !== "gisMap" || (!event.latlng && blockedMapSelectionTarget(event))) return false;
    const selectionMode = state.mapNavigation.selectionMode;
    if (!selectionMode) return false;
    event.preventDefault();
    event.stopPropagation();
    const validPoint = pointFromMapEvent(event);
    if (!validPoint) {
      updateNavigationPanel("The selected map point is invalid.");
      return true;
    }
    if (selectionMode === "start") {
      setRouteStart(validPoint, "Selected map start");
      updateNavigationPanel("Route start selected.");
    } else {
      setRouteDestination(validPoint, "Selected map destination", { locationStatus: "Approximate" });
      updateNavigationPanel("Destination selected. Click Calculate Route.");
    }
    state.mapNavigation.selectionMode = null;
    instance.map.classList.remove("selection-active");
    $("#setMapStart")?.classList.remove("active");
    $("#setMapStart")?.setAttribute("aria-pressed", "false");
    $("#setMapDestination")?.classList.remove("active");
    $("#setMapDestination")?.setAttribute("aria-pressed", "false");
    renderSatelliteMap(instance);
    try {
      const place = await reverseGeocodePoint(validPoint);
      const target = selectionMode === "start"
        ? state.mapNavigation.start
        : state.mapNavigation.destination;
      if (place && target) {
        target.label = place.displayName || place.name;
        instance.placeLabel = place.shortName || place.name;
        updateNavigationPanel(selectionMode === "start"
          ? "Start location identified. Choose a destination."
          : "Destination identified. Click Calculate Route.");
        renderSatelliteMap(instance);
      }
    } catch {
      updateNavigationPanel(selectionMode === "start"
        ? "Route start selected. Address lookup is unavailable."
        : "Destination selected. Address lookup is unavailable.");
    }
    return true;
  }
  instance.selectNavigationPointFromMap = selectNavigationPointFromMap;

  instance.map.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".map-control, .map-zoom-slider, .map-search, .map-layer-control")) return;
    if (instance.map.id === "gisMap" && state.mapNavigation.selectionMode && !blockedMapSelectionTarget(event)) return;
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
    if (!wasMoved && instance.map.id === "gisMap" && !blockedMapSelectionTarget(event) && !state.mapNavigation.selectionMode) {
      updateNavigationPanel("Choose Set Start or Set Destination before selecting a map point.");
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

  instance.map.addEventListener("click", (event) => {
    selectNavigationPointFromMap(event);
  });
  bindLeafletInteractions(instance);
}

function initSatelliteMaps() {
  $$("[data-satellite-map]").forEach((map) => {
    const instance = mapStateForElement(satelliteMaps, map, () => {
      const zoom = map.id === "gisMap" ? GIS_HOME_ZOOM : Number(map.dataset.mapZoom || GIS_HOME_ZOOM);
      const homeLatLng = map.id === "gisMap"
        ? { ...DEFAULT_MAP_CENTER }
        : { lat: Number(map.dataset.mapLat || DEFAULT_MAP_CENTER.lat), lng: Number(map.dataset.mapLng || DEFAULT_MAP_CENTER.lng) };
      const center = latLngToTile(homeLatLng.lat, homeLatLng.lng, zoom);
      const baseLayer = TILE_SOURCES[map.dataset.mapLayer] ? map.dataset.mapLayer : "streets";
      const leafletHost = node("div", "leaflet-host");
      const layer = node("div", "satellite-tiles");
      const navigationLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      navigationLayer.setAttribute("class", "route-overlay");
      const status = node("span", "map-status", "Loading map tiles");
      const attribution = node("span", "map-attribution");
      const controls = node("div", "map-controls");
      const created = {
        map,
        leafletHost,
        leafletInitializationAllowed: map.id !== "gisMap",
        layer,
        navigationLayer,
        status,
        attribution,
        zoom,
        center,
        homeZoom: zoom,
        homeCenter: { ...center },
        homeLatLng,
        placeLabel: map.id === "gisMap" ? "Operational center" : "",
        renderId: 0,
        baseLayer,
        activeBaseLayer: null,
        dynamicMarkers: [],
        heatVisible: state.mapLayers.heatOverlay
      };
      const search = makeMapSearch(created);
      const zoomBadge = node("span", "map-zoom-badge", `z${zoom}`);
      const zoomSlider = makeZoomSlider(created);
      const panButton = makeMapControl("PAN", "pan-hand", "Hand drag mode", () => togglePanMode(created));
      const layerControl = ["gisMap", "commandMap"].includes(map.id) ? makeMapLayersControl(created) : null;

      created.zoomBadge = zoomBadge;
      created.zoomSlider = zoomSlider;
      created.panButton = panButton;
      updateMapAttribution(created);

      controls.append(
        panButton,
        makeMapControl("+", "zoom-in", "Zoom in", () => zoomSatelliteMap(created, 1)),
        zoomBadge,
        zoomSlider,
        makeMapControl("-", "zoom-out", "Zoom out", () => zoomSatelliteMap(created, -1)),
        ...(map.id === "gisMap" ? [makeMapControl("FIT", "zoom-fit", "Fit map to local operational markers", fitGisMapToOperationalMarkers)] : []),
        makeMapControl("H", "zoom-home", "Reset to event area", () => resetMap(created)),
        makeMapControl("W", "zoom-world", "Zoom out to India overview", () => showWorldMap(created))
      );

      map.prepend(layer);
      map.prepend(leafletHost);
      map.append(navigationLayer);
      map.append(search, status, attribution, controls);
      if (layerControl) map.append(layerControl);
      setPanMode(created, true);
      enableMapInteractions(created);
      if ("ResizeObserver" in window) {
        created.resizeObserver = new ResizeObserver(() => renderSatelliteMap(created));
        created.resizeObserver.observe(map);
      } else {
        window.addEventListener("resize", () => renderSatelliteMap(created));
      }
      return created;
    });
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

function unitDispatchStatus(unit) {
  return String(unit?.dispatchStatus || unit?.status || "unknown").toLowerCase();
}

function unitTypeLabel(unit) {
  return displayValue(unit?.unitType || unit?.vehicleType || unit?.type, "police patrol");
}

function unitLabel(unit) {
  return unit?.unitCode || unit?.name || unit?.id || "Unit";
}

function unitSummary(units = state.responseUnits) {
  return {
    total: units.length,
    available: units.filter((unit) => unitDispatchStatus(unit) === "available").length,
    assigned: units.filter((unit) => unitDispatchStatus(unit) === "assigned").length,
    unavailable: units.filter((unit) => ["busy", "offline", "stale"].includes(unitDispatchStatus(unit))).length
  };
}

function incidentNavigationReady(incident) {
  return Boolean(
    incident
    && isDispatchableIncident(incident)
    && incident.assignedUnitId
    && incidentCoordinates(incident, "location", null)
    && incidentCoordinates(incident, "unitLocation", null)
    && Number(incident.distanceKm) > 0
    && Number(incident.etaMinutes) > 0
  );
}

function normalizeRouteForMap(route) {
  if (!route) return null;
  const geometry = route.geometry?.type === "LineString"
    ? route.geometry
    : Array.isArray(route.geometry) && route.geometry.length
      ? { type: "LineString", coordinates: route.geometry.map(([lat, lng]) => [lng, lat]) }
    : Array.isArray(route.coordinates)
      ? { type: "LineString", coordinates: route.coordinates }
      : { type: "LineString", coordinates: [] };
  return {
    ...route,
    geometry,
    routeOptions: (route.routeOptions || []).map((option) => ({
      ...option,
      geometry: option.geometry?.type === "LineString"
        ? option.geometry
        : Array.isArray(option.geometry) && option.geometry.length
          ? { type: "LineString", coordinates: option.geometry.map(([lat, lng]) => [lng, lat]) }
        : Array.isArray(option.coordinates)
          ? { type: "LineString", coordinates: option.coordinates }
          : { type: "LineString", coordinates: [] }
    }))
  };
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
  const rawLat = point?.lat ?? point?.latitude ?? point?.location?.lat ?? point?.coordinates?.lat;
  const rawLng = point?.lng ?? point?.lon ?? point?.longitude ?? point?.location?.lng ?? point?.location?.lon ?? point?.coordinates?.lng ?? point?.coordinates?.lon;
  if (rawLat === null || rawLat === undefined || rawLat === "" || typeof rawLat === "boolean") return null;
  if (rawLng === null || rawLng === undefined || rawLng === "" || typeof rawLng === "boolean") return null;
  const lat = Number(rawLat);
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
  if (routeButton) routeButton.disabled = !(enabled && incidentNavigationReady(incident));
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
  setMapView(instance, point, Math.max(instance.zoom, 15), incident.address || incident.title || "Selected incident");
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
    navigate.disabled = !incidentNavigationReady(incident);
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
  let successMessage = "";
  if (action === "navigate") return navigateToIncident(incident);
  if (action === "confirm-location") {
    let point;
    try {
      point = await browserLocation();
    } catch {
      throw new Error("Location permission denied. Use manual search or map click.");
    }
    let place = null;
    try { place = await reverseGeocodePoint(point); } catch {}
    const address = place?.displayName || place?.name || "Address unavailable";
    if (!window.confirm(`Use this current location?\n\n${address}\nLatitude/Longitude: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}\nSource: browser_gps`)) return;
    await api(`/api/incidents/${incident.id}/confirm-location`, {
      method: "POST",
      body: { lat: point.lat, lng: point.lng, address, locationSource: "browser_gps", confirmed: true }
    });
    successMessage = "Current location confirmed. Ready for dispatch.";
    clearRouteResult();
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
      body: { ...point, address, locationSource: "manual_latlng", locationStatus: "Verified", confirmed: true }
    });
    clearRouteResult();
  } else if (action === "recheck-address") {
    const point = incidentCoordinates(incident, "location", null);
    if (!point) throw new Error("Add valid incident coordinates before rechecking the address.");
    const place = await reverseGeocodePoint(point);
    if (!window.confirm(`Use this resolved address?\n\n${place.displayName || place.name}\n${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`)) return;
    await api(`/api/incidents/${incident.id}/location`, {
      method: "PATCH",
      body: { ...point, address: place.displayName || place.name, locationSource: "manual_search", locationStatus: "Verified", confirmed: true }
    });
    clearRouteResult();
  } else if (action === "assign") {
    try {
      const result = await api(`/api/incidents/${incident.id}/assign-nearest`, { method: "POST" });
      applyDispatchResult(result);
      const routeLabel = result.route?.approximate ? "Assigned using approximate fallback route." : "Assigned with verified driving route.";
      setText("#routeSummary", `${responseUnit(result.incident)} assigned. ${routeLabel}`);
    } catch (error) {
      throw new Error(dispatchErrorMessage(error));
    }
  } else {
    const body = action === "Rejected / False Alarm"
      ? { status: action, reason: "Marked as false alarm by operator" }
      : { status: action };
    const result = await api(`/api/incidents/${incident.id}/status`, { method: "PATCH", body });
    if (action === "Rejected / False Alarm") {
      state.selectedIncidentId = null;
      successMessage = result.message || "Incident marked as false alarm";
    }
  }
  await refresh();
  if (successMessage) setText("#routeSummary", successMessage);
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
    button.addEventListener("click", () => withButtonBusy(button, "Working...", () => commandAction(action))
      .catch((error) => alert(dispatchErrorMessage(error))));
    actions.append(button);
  };
  if (incidentNavigationReady(incident)) addAction("Navigate", "navigate");
  if (!isDispatchableIncident(incident)) addAction("Use My Current Location", "confirm-location", "primary");
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
  setCommandReviewStatus("");
  if (kind === "alert") {
    const result = await api(`/api/alerts/${id}/review`, { method: "POST", body: { action } });
    setCommandReviewStatus(result.incident ? "Incident created from AI alert." : "AI alert review updated.", "success");
    const notification = state.liveVisionNotifications.find((item) => item.alertId === id);
    if (notification) {
      notification.reviewed = true;
      renderLiveVisionNotifications();
    }
  } else {
    if (action === "reject") {
      const result = await api(`/api/reports/${id}/reject`, { method: "POST", body: { reason: "Rejected during human review" } });
      setCommandReviewStatus(result.message || "Report rejected.", "success");
    } else {
      const result = await api(`/api/reports/${id}/create-incident`, { method: "POST", body: {} });
      const locationMessage = result.incident?.locationStatus === "Verified"
        ? "Incident is ready for dispatch."
        : "Incident created. Confirm the incident location before dispatch.";
      setCommandReviewStatus(result.message || `Report verified. ${locationMessage}`, "success");
    }
  }
  await refresh();
}

function setCommandReviewStatus(message, type = "") {
  const status = $("#commandReviewStatus");
  if (!status) return;
  status.className = "form-status";
  if (type) status.classList.add(type);
  status.textContent = message;
}

function setAlertActionStatus(message, type = "") {
  const status = $("#alertActionStatus");
  if (!status) return;
  status.className = "form-status";
  if (type) status.classList.add(type);
  status.textContent = message;
}

function setKpiCardState(scopeSelector, activeKey) {
  $$(`${scopeSelector} [data-kpi]`).forEach((card) => {
    const active = card.dataset.kpi === activeKey;
    card.classList.toggle("kpi-active", active);
    card.setAttribute("aria-expanded", String(active));
    card.setAttribute("aria-pressed", String(active));
    if (!card.getAttribute("aria-label")) {
      const label = card.querySelector(".metric-heading span, span")?.textContent?.trim() || card.dataset.kpi;
      card.setAttribute("aria-label", `Show ${label} details`);
    }
  });
}

function focusKpiDetails(selector) {
  const panel = $(selector);
  if (!panel || panel.hidden) return;
  panel.focus({ preventScroll: true });
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderKpiPanel(selector, title, subtitle, stats, lines = []) {
  const panel = $(selector);
  if (!panel) return;
  panel.hidden = false;
  panel.tabIndex = -1;
  panel.textContent = "";
  const header = node("header");
  const heading = node("div");
  heading.append(node("h3", "", title), node("p", "", subtitle));
  header.append(heading);
  const grid = node("div", "kpi-detail-grid");
  stats.forEach((stat) => {
    const item = node("div", "kpi-detail-item");
    item.append(node("span", "", stat.label), node("strong", "", stat.value));
    grid.append(item);
  });
  panel.append(header, grid);
  if (lines.length) {
    const list = node("div", "kpi-detail-list");
    lines.slice(0, 4).forEach((line) => list.append(node("span", "", line)));
    panel.append(list);
  }
}

function renderDashboardKpiDetails() {
  const activeKey = state.activeDashboardKpi;
  setKpiCardState(".dashboard-metrics", activeKey);
  if (!activeKey) {
    const panel = $("#dashboardKpiDetails");
    if (panel) panel.hidden = true;
    return;
  }
  const summary = state.dashboardSummary || {};
  const reports = state.reports || [];
  const alerts = state.alerts || [];
  const sources = state.cameraSources || [];
  const zones = state.zones || [];
  const missingReports = reports.filter((report) => report.reportType === "missing_person" && isActiveReport(report));
  const openAlerts = alerts.filter((alert) => !["closed", "resolved", "false_alarm", "rejected"].includes(String(alert.status || "").toLowerCase()));
  const readySources = sources.filter((source) => ["online", "ready", "active", "healthy"].some((status) => String(source.status || source.health || "").toLowerCase().includes(status)));
  const highDensityZones = zones.filter((zone) => Number(zone.currentDensity) >= 70 || ["high", "critical"].includes(String(zone.severity || "").toLowerCase()));
  const highestZone = zones
    .slice()
    .sort((a, b) => Number(b.currentDensity || 0) - Number(a.currentDensity || 0))[0];

  if (activeKey === "missing") {
    renderKpiPanel("#dashboardKpiDetails", "Missing Persons", "Current active missing-person reports.", [
      { label: "Active", value: String(summary.missingPersons ?? missingReports.length) },
      { label: "Under Review", value: String(missingReports.filter((report) => ["under_review", "submitted_for_review", "possible_match"].includes(String(report.status || "").toLowerCase())).length) },
      { label: "Assigned", value: String(missingReports.filter((report) => ["assigned", "in_progress", "en_route", "on_scene"].includes(String(report.status || "").toLowerCase())).length) }
    ], missingReports.map((report) => `${displayValue(report.name, "Missing person")} - ${displayValue(report.status)}`));
  } else if (activeKey === "alerts") {
    renderKpiPanel("#dashboardKpiDetails", "Active Alerts", "Open AI and operator alerts needing attention.", [
      { label: "Open", value: String(summary.openAlerts ?? openAlerts.length) },
      { label: "Critical/High", value: String(openAlerts.filter((alert) => ["critical", "high"].includes(String(alert.severity || "").toLowerCase())).length) },
      { label: "Pending Review", value: String(openAlerts.filter((alert) => String(alert.status || "").toLowerCase() === "pending review").length) }
    ], openAlerts.map((alert) => `${displayValue(alert.type || alert.title, "Alert")} - ${displayValue(alert.severity, "Severity")}`));
  } else if (activeKey === "cameras") {
    renderKpiPanel("#dashboardKpiDetails", "Active Cameras", "Camera sources ready for live monitoring.", [
      { label: "Active", value: String(summary.activeCameras ?? summary.onlineSources ?? readySources.length) },
      { label: "Configured", value: String(sources.length || summary.cameraSources || summary.activeCameras || 0) },
      { label: "Offline", value: String(Math.max(0, sources.length - readySources.length)) }
    ], sources.map((source) => `${displayValue(source.name || source.type, "Camera")} - ${displayValue(source.status || source.health, "Status unknown")}`));
  } else if (activeKey === "zones") {
    renderKpiPanel("#dashboardKpiDetails", "Monitored Zones", "GIS sectors currently tracked by operations.", [
      { label: "Total Zones", value: String(zones.length) },
      { label: "High Density", value: String(highDensityZones.length) },
      { label: "Highest", value: highestZone ? `${highestZone.currentDensity || 0}%` : "--" }
    ], zones.map((zone) => `${displayValue(zone.name, "Zone")} - ${zone.currentDensity ?? 0}% ${displayValue(zone.severity, "Stable")}`));
  }
}

function renderCommandKpiDetails(active, pendingAlerts, pendingReports, availableUnits, etaValues) {
  const activeKey = state.activeCommandKpi;
  setKpiCardState(".command-kpis", activeKey);
  if (!activeKey) {
    const panel = $("#commandKpiDetails");
    if (panel) panel.hidden = true;
    return;
  }
  const units = state.responseUnits || [];
  const busyUnits = units.filter((unit) => String(unit.status || "").toLowerCase() !== "available");
  const staleUnits = units.filter((unit) => String(unit.locationFreshness || "").toLowerCase() === "stale");
  const assignedIncidents = active.filter((incident) => incident.assignedUnit);
  const unassignedIncidents = active.filter((incident) => !incident.assignedUnit);

  if (activeKey === "active") {
    renderKpiPanel("#commandKpiDetails", "Active Incidents", "Open cases visible to Incident Command.", [
      { label: "Open", value: String(active.length) },
      { label: "Assigned", value: String(assignedIncidents.length) },
      { label: "Unassigned", value: String(unassignedIncidents.length) }
    ], active.map((incident) => `${incidentTitle(incident)} - ${displayValue(incident.status)}`));
  } else if (activeKey === "review") {
    renderKpiPanel("#commandKpiDetails", "Pending Review", "Items waiting for operator verification.", [
      { label: "Total", value: String(pendingAlerts.length + pendingReports.length) },
      { label: "AI Alerts", value: String(pendingAlerts.length) },
      { label: "Citizen Reports", value: String(pendingReports.length) }
    ], [
      ...pendingAlerts.map((alert) => `AI: ${displayValue(alert.type || alert.title, "Detection")} - ${displayValue(alert.severity, "Severity")}`),
      ...pendingReports.map((report) => `Report: ${displayValue(report.name || report.reportType, "Citizen report")} - ${displayValue(report.status)}`)
    ]);
  } else if (activeKey === "units") {
    renderKpiPanel("#commandKpiDetails", "Units Available", "Police response units currently eligible for dispatch.", [
      { label: "Available", value: String(availableUnits.length) },
      { label: "Busy/Offline", value: String(busyUnits.length) },
      { label: "Stale GPS", value: String(staleUnits.length) }
    ], units.map((unit) => `${unit.unitCode || unit.name || "Unit"} - ${displayValue(unit.status)}${unit.locationFreshness ? `, ${displayValue(unit.locationFreshness)} GPS` : ""}`));
  } else if (activeKey === "eta") {
    const averageEta = etaValues.length ? Math.round(etaValues.reduce((sum, value) => sum + value, 0) / etaValues.length) : null;
    const fastestEta = etaValues.length ? Math.min(...etaValues) : null;
    renderKpiPanel("#commandKpiDetails", "Average Response Time", "ETA across currently assigned incidents.", [
      { label: "Average", value: averageEta ? `${averageEta} min` : "--" },
      { label: "Assigned", value: String(assignedIncidents.length) },
      { label: "Fastest", value: fastestEta ? `${fastestEta} min` : "--" }
    ], assignedIncidents.map((incident) => `${incidentTitle(incident)} - ${incident.etaMinutes || "--"} min`));
  }
}

function commandIncidentMatchesFilters(incident) {
  const filters = state.commandFilters;
  const search = String(filters.search || "").trim().toLowerCase();
  const severity = String(incident.severity || "").toLowerCase();
  const status = String(incident.status || "");
  const source = String(incidentSource(incident)).toLowerCase();
  const assigned = Boolean(incident.assignedUnitId || incident.assignedUnit);
  if (filters.severity !== "all" && severity !== filters.severity) return false;
  if (filters.status !== "all" && status !== filters.status) return false;
  if (filters.assignment === "assigned" && !assigned) return false;
  if (filters.assignment === "unassigned" && assigned) return false;
  if (filters.source !== "all") {
    const sourceMatch = filters.source === "command"
      ? /command|manual|operator/.test(source)
      : source.includes(filters.source);
    if (!sourceMatch) return false;
  }
  if (!search) return true;
  return [
    incident.id,
    incident.incidentId,
    incidentTitle(incident),
    incident.zone,
    incident.address,
    incident.status,
    incident.severity,
    incidentSource(incident),
    incident.locationStatus,
    incident.assignedUnit?.unitCode,
    incident.assignedUnit
  ].some((value) => String(value || "").toLowerCase().includes(search));
}

function syncCommandFilterControls() {
  const filters = state.commandFilters;
  if ($("#commandIncidentSearch")) $("#commandIncidentSearch").value = filters.search;
  if ($("#commandSeverityFilter")) $("#commandSeverityFilter").value = filters.severity;
  if ($("#commandStatusFilter")) $("#commandStatusFilter").value = filters.status;
  if ($("#commandSourceFilter")) $("#commandSourceFilter").value = filters.source;
  if ($("#commandAssignmentFilter")) $("#commandAssignmentFilter").value = filters.assignment;
}

function renderIncidentCommand() {
  const queue = $("#commandIncidentQueue");
  const review = $("#commandReviewQueue");
  if (!queue || !review) return;
  const active = state.incidents.filter((incident) => !["Closed", "Resolved", "Rejected / False Alarm"].includes(incident.status));
  const visibleIncidents = active.filter(commandIncidentMatchesFilters);
  const pendingAlerts = state.alerts.filter((item) => item.status === "Pending Review");
  const pendingReports = state.reports.filter((item) => ["submitted_for_review", "possible_match"].includes(String(item.status || "").toLowerCase()));
  const availableUnits = state.responseUnits.filter((unit) => unitDispatchStatus(unit) === "available");
  const etaValues = active.map((item) => Number(item.etaMinutes)).filter((value) => value > 0);
  syncCommandFilterControls();
  setText("#commandActiveMetric", active.length);
  setText("#commandReviewMetric", pendingAlerts.length + pendingReports.length);
  setText("#commandUnitsMetric", availableUnits.length);
  setText("#commandEtaMetric", etaValues.length ? `${Math.round(etaValues.reduce((a, b) => a + b, 0) / etaValues.length)} min` : "--");
  renderCommandKpiDetails(active, pendingAlerts, pendingReports, availableUnits, etaValues);

  queue.textContent = "";
  if (!active.length) {
    queue.append(node("div", "command-detail-empty", "No active incidents. Review pending intelligence to create one."));
  } else if (!visibleIncidents.length) {
    queue.append(node("div", "command-detail-empty", "No incidents match the current filters."));
  } else {
    visibleIncidents.forEach((incident) => {
      const row = node("button", `command-incident-row ${incident.id === state.selectedIncidentId ? "active" : ""}`);
      row.type = "button";
      row.setAttribute("aria-pressed", String(incident.id === state.selectedIncidentId));
      row.setAttribute("aria-label", `Select ${incidentTitle(incident)}`);
      const identity = node("div");
      const incidentRef = incident.incidentId || incident.id || "Incident";
      identity.append(
        node("strong", "", incidentTitle(incident)),
        node("small", "", `${incidentRef} - ${displayLocation(incident.address || incident.zone)} - ${incidentSafetyLabel(incident)}`)
      );
      const sourceMeta = node("span", "command-row-meta");
      sourceMeta.append(node("strong", "", incidentSource(incident)), node("small", "", displayValue(incident.locationStatus || incident.verificationStatus, "Location pending")));
      const statusMeta = node("span", "command-row-meta");
      statusMeta.append(node("strong", "", displayValue(incident.status)), node("small", "", incident.updatedAt ? `Updated ${alertTime(incident.updatedAt)}` : `Created ${alertTime(incident.createdAt)}`));
      const unitMeta = node("span", "command-row-meta");
      unitMeta.append(node("strong", "", incident.assignedUnit?.unitCode || incident.assignedUnit || "Unassigned"), node("small", "", incident.etaMinutes ? `${incident.etaMinutes} min ETA` : "ETA pending"));
      row.append(identity, node("span", `severity ${sevClass(incident.severity)}`, incident.severity), sourceMeta, statusMeta, unitMeta);
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
      button.addEventListener("click", async () => {
        try {
          button.disabled = true;
          await reviewCommandItem(kind, item.id, action);
        } catch (error) {
          setCommandReviewStatus(error.message, "error");
        } finally {
          button.disabled = false;
        }
      });
      actions.append(button);
    };
    add(kind === "alert" ? "Create Incident" : "Verify Report", "create_incident", "primary");
    if (kind === "alert") {
      add("Observation", "observation");
      add("False Alarm", "dismiss");
    } else {
      add("Reject Report", "reject");
    }
    card.append(actions);
    review.append(card);
  };
  pendingAlerts.forEach((item) => addReviewCard("alert", item));
  pendingReports.forEach((item) => addReviewCard("report", item));
  if (!pendingAlerts.length && !pendingReports.length) review.append(node("div", "command-detail-empty", "No alerts or reports are waiting for review."));
  renderSatelliteMaps();
  scheduleMapResizeRender();
}

function cameraTime(value) {
  if (!value) return "Not checked";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not checked";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function cameraSummaryCards(cameras) {
  const real = cameras.filter((camera) => !camera.isDemo);
  const demo = cameras.filter((camera) => camera.isDemo);
  return [
    { label: "Total Cameras", value: cameras.length },
    { label: "Online", value: cameras.filter((camera) => camera.status === "online").length },
    { label: "Offline", value: cameras.filter((camera) => camera.status === "offline").length },
    { label: "Real Configured", value: real.filter((camera) => camera.hasStreamConfig).length },
    { label: "Demo Feeds", value: demo.length }
  ];
}

function filteredCameras(cameras) {
  return cameras.filter((camera) => {
    const kindMatch = state.cameraFilters.kind === "all"
      || (state.cameraFilters.kind === "demo" && camera.isDemo)
      || (state.cameraFilters.kind === "real" && !camera.isDemo);
    const sourceType = camera.isDemo ? "demo" : camera.type;
    const typeMatch = state.cameraFilters.sourceType === "all" || sourceType === state.cameraFilters.sourceType;
    const statusMatch = state.cameraFilters.status === "all" || camera.status === state.cameraFilters.status;
    return kindMatch && typeMatch && statusMatch;
  });
}

function cameraRegistryRow(camera) {
  const row = node("article", `camera-registry-row ${camera.isDemo ? "demo-camera" : "real-camera"}`);
  const identity = node("div", "camera-identity");
  const sourceLabel = camera.isDemo ? "DEMO" : camera.sourceTypeLabel || displayValue(camera.type, "Unknown");
  const statusLabel = String(camera.statusLabel || camera.status || "Unknown").toUpperCase();
  identity.append(node("span", `source-badge ${camera.isDemo ? "demo" : "real"}`, camera.badge || (camera.isDemo ? "DEMO CAMERA / SIMULATED FEED" : "REAL CCTV")));
  identity.append(node("span", `source-badge source-type ${camera.isDemo ? "demo" : ""}`, sourceLabel));
  identity.append(node("span", `source-badge ${camera.status || "unknown"}`, statusLabel));
  identity.append(node("strong", "", camera.name));
  identity.append(node("small", "", `${camera.cameraId || camera.id} - ${camera.location || camera.zone || "Unassigned"}`));

  const meta = node("div", "camera-registry-meta");
  [
    ["Camera ID", camera.cameraId || camera.id],
    ["Location", camera.location || camera.zone || "Unassigned"],
    ["AI enabled", camera.aiEnabled ? "Yes" : "No"],
    ["Last checked", cameraTime(camera.lastCheckedAt)],
    ["Frame status", camera.lastFrameStatus || "Snapshot unavailable"],
    ["Health reason", camera.healthReason || "No health detail"]
  ].forEach(([label, value]) => {
    const item = node("span", "");
    item.append(node("small", "", label), node("strong", "", value));
    meta.append(item);
  });

  const viewer = node("div", "camera-viewer-status");
  const viewerTitle = camera.isDemo ? "Simulated demo feed" : camera.streamProxyStatus || "Stream proxy not configured";
  const viewerText = camera.isDemo
    ? "This is not a production CCTV/NVR/DVR/IP camera."
    : camera.hasStreamConfig
      ? "RTSP and ONVIF sources require backend transcoding to HLS, WebRTC, or MJPEG before browser viewing."
      : "No backend stream configuration is stored for this camera.";
  viewer.append(node("strong", "", viewerTitle), node("small", "", viewerText));

  const actions = node("div", "camera-row-actions");
  const test = node("button", "ghost", "Test Connection");
  test.type = "button";
  test.dataset.cameraTest = camera.id;
  actions.append(test);
  const analyze = node("button", camera.aiEnabled || camera.isDemo ? "ghost" : "ghost disabled", "Analyze Snapshot");
  analyze.type = "button";
  analyze.dataset.cameraAnalyze = camera.id;
  analyze.disabled = !camera.isDemo && !camera.aiEnabled;
  actions.append(analyze);
  if (isAdminRole() && !camera.isDemo && !camera.externalConfig) {
    const edit = node("button", "ghost", "Edit");
    edit.type = "button";
    edit.dataset.cameraEdit = camera.id;
    const remove = node("button", "danger", "Delete");
    remove.type = "button";
    remove.dataset.cameraDelete = camera.id;
    actions.append(edit, remove);
  }

  row.append(identity, meta, viewer, actions);
  return row;
}

function renderCameras(cameras = []) {
  state.cameraRegistry = cameras;
  const addButton = $("#showCameraConfig");
  if (addButton) addButton.hidden = !isAdminRole();
  const configPanel = $("#cameraConfigPanel");
  if (configPanel && !isAdminRole()) configPanel.hidden = true;
  const summary = $("#cameraSummary");
  if (summary) {
    summary.textContent = "";
    cameraSummaryCards(cameras).forEach((item) => {
      const card = node("article", "cctv-summary-card");
      card.append(node("span", "", item.label), node("strong", "", String(item.value)));
      summary.append(card);
    });
  }
  const largeGrid = $("#cameraGridLarge");
  if (largeGrid) {
    largeGrid.textContent = "";
    const visible = filteredCameras(cameras);
    if (!visible.length) {
      largeGrid.append(node("div", "empty-state", "No cameras match the current filters."));
      return;
    }
    visible.forEach((camera) => largeGrid.append(cameraRegistryRow(camera)));
  }
}

function sourceModeMeta(type) {
  if (["demo", "rtsp", "hls", "onvif", "nvr", "dvr", "webcam"].includes(type)) {
    return { title: "CCTV Registry", description: "Camera metadata and health", action: "View CCTV", view: "cctv" };
  }
  if (type === "phone_camera") {
    return { title: "Browser / Device Camera", description: "Live device camera testing", action: "Open Live Vision", view: "live-vision" };
  }
  if (type === "upload") {
    return { title: "Video Evidence Upload", description: "Upload authorized footage for AI-assisted review.", action: "Upload Video / Review Evidence", view: "video-evidence" };
  }
  if (type === "citizen_evidence") {
    return { title: "Citizen Evidence", description: "Report evidence review", action: "Review Evidence", view: "missing" };
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
  const icons = { phone_camera: "LV", upload: "UP", citizen_evidence: "EV" };
  const header = node("div", "source-card-head");
  const icon = node("span", "source-icon", icons[source.type] || "CC");
  const title = node("div", "source-title");
  title.append(node("strong", "", meta.title), node("small", "", meta.description));
  header.append(icon, title, node("span", `source-badge ${source.status || "demo"}`, source.statusLabel || source.status || "Demo Feed"));
  card.append(header);

  const details = node("div", "source-card-details");
  [
    ["Source", source.name],
    ["Scope", source.zone || "Unassigned"],
    ["Events", `${source.incidentCount || 0} total`]
  ].forEach(([label, value]) => {
    const item = node("span", "");
    item.append(node("small", "", label), node("strong", "", value));
    details.append(item);
  });
  card.append(details);

  if (source.latestDetection) {
    card.append(node("small", "source-detection", source.latestDetection.message || "Possible detection"));
  } else {
    card.append(node("small", "source-detection", "No detections yet"));
  }
  if (source.latestAlertTime) card.append(node("small", "", `Latest alert: ${alertTime(source.latestAlertTime)}`));
  const action = node("button", meta.view ? "primary source-action" : "ghost source-action", meta.action);
  action.type = "button";
  action.disabled = !meta.view;
  if (meta.view) action.addEventListener("click", () => setView(meta.view));
  card.append(action);
  return card;
}

function dashboardSourceCards(sources = []) {
  const cctvTypes = new Set(["demo", "rtsp", "hls", "onvif", "nvr", "dvr", "webcam"]);
  const cctvSources = sources.filter((source) => cctvTypes.has(source.type));
  const readyCctv = cctvSources.filter((source) => ["online", "ready", "available"].includes(String(source.status || "").toLowerCase())).length;
  const phone = sources.find((source) => source.type === "phone_camera") || {
    id: "phone_001",
    type: "phone_camera",
    name: "Rakshak Live Vision",
    zone: "Browser Source",
    status: "available",
    statusLabel: "Available"
  };
  const upload = sources.find((source) => source.type === "upload") || {
    id: "upload_001",
    type: "upload",
    name: "Recorded Footage",
    zone: "Evidence Review",
    status: "ready",
    statusLabel: "Ready"
  };
  const pendingVideoObservations = (state.videoEvidence?.observations || [])
    .filter((observation) => ["pending_review", "human_verification_required"].includes(String(observation.reviewStatus || observation.verificationStatus || "").toLowerCase()))
    .length;
  const evidenceReports = (state.reports || []).filter((report) => report.imageName || report.evidenceType || report.evidence);
  return [
    {
      id: "cctv_registry",
      type: cctvSources[0]?.type || "demo",
      name: `${cctvSources.length} authorized camera${cctvSources.length === 1 ? "" : "s"}`,
      zone: `${readyCctv} ready`,
      status: readyCctv ? "online" : "unknown",
      statusLabel: readyCctv ? "Online" : "Unknown",
      incidentCount: cctvSources.reduce((sum, source) => sum + (Number(source.incidentCount) || 0), 0),
      latestDetection: cctvSources.find((source) => source.latestDetection)?.latestDetection || null,
      latestAlertTime: cctvSources.find((source) => source.latestAlertTime)?.latestAlertTime || null
    },
    phone,
    { ...upload, incidentCount: pendingVideoObservations },
    {
      id: "citizen_evidence",
      type: "citizen_evidence",
      name: `${evidenceReports.length} submitted evidence item${evidenceReports.length === 1 ? "" : "s"}`,
      zone: "Report Review",
      status: evidenceReports.length ? "ready" : "available",
      statusLabel: evidenceReports.length ? "Ready" : "Available",
      incidentCount: evidenceReports.length
    }
  ];
}

function renderSources(sources = []) {
  state.cameraSources = sources;
  ["#sourceSelector"].forEach((selector) => {
    const wrap = $(selector);
    if (!wrap) return;
    wrap.textContent = "";
    const primary = dashboardSourceCards(sources);
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
  preview.textContent = "";
  if (fileData.type.startsWith("video/")) {
    preview.append(node("span", "", `Video evidence attached for staff review: ${fileData.name}`));
  } else {
    const image = document.createElement("img");
    image.src = fileData.dataUrl;
    image.alt = "Uploaded report evidence preview";
    preview.append(image, node("span", "", "Image evidence attached for staff review"));
  }
}

function readVideoEvidenceFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("Select an investigation video to upload."));
    if (!file.type.startsWith("video/")) return reject(new Error("Upload a supported video file."));
    if (file.size > 1_100_000) return reject(new Error("Upload a video smaller than 1.1 MB for this local evidence workflow."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected video."));
    reader.onload = () => {
      const video = document.createElement("video");
      const objectUrl = URL.createObjectURL(file);
      let settled = false;
      const finish = (durationSeconds = null) => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(objectUrl);
        resolve({
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          durationSeconds,
          dataUrl: reader.result
        });
      };
      video.preload = "metadata";
      video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? Math.round(video.duration) : null);
      video.onerror = () => finish(null);
      setTimeout(() => finish(null), 1200);
      video.src = objectUrl;
    };
    reader.readAsDataURL(file);
  });
}

function refreshVideoEvidenceSelectors() {
  const reportSelect = $("#videoLinkedReport");
  const incidentSelect = $("#videoLinkedIncident");
  if (reportSelect) {
    const current = reportSelect.value;
    reportSelect.textContent = "";
    reportSelect.append(node("option", "", "No report link"));
    reportSelect.lastChild.value = "";
    (state.reports || []).forEach((report) => {
      const option = node("option", "", `${displayValue(report.name, "Report")} - ${displayValue(report.status, "review")}`);
      option.value = report.id;
      reportSelect.append(option);
    });
    reportSelect.value = current;
  }
  if (incidentSelect) {
    const current = incidentSelect.value;
    incidentSelect.textContent = "";
    incidentSelect.append(node("option", "", "No incident link"));
    incidentSelect.lastChild.value = "";
    (state.incidents || []).forEach((incident) => {
      const option = node("option", "", `${displayValue(incident.title, "Incident")} - ${displayValue(incident.status, "open")}`);
      option.value = incident.id;
      incidentSelect.append(option);
    });
    incidentSelect.value = current;
  }
}

function evidenceObservations(evidenceId) {
  return (state.videoEvidence?.observations || []).filter((observation) => observation.linkedEvidenceId === evidenceId);
}

function observationReviewState(observation) {
  return String(observation.reviewStatus || observation.verificationStatus || observation.status || "pending_review").toLowerCase();
}

function videoObservationDetails(observation) {
  const rows = [
    ["Signal", displayValue(observation.detectionLabel || observation.threatType, "Possible detection")],
    ["Frame", displayValue(observation.frameTimestamp, "Frame pending")],
    ["Confidence", `${Math.round((observation.confidence || 0) * 100)}% possible`]
  ];
  if (observation.vehicleType) rows.push(["Vehicle", observation.vehicleType]);
  if (observation.possibleColor) rows.push(["Possible color", observation.possibleColor]);
  if (observation.plateDetected || observation.possiblePlateText) {
    rows.push(["Possible plate", displayValue(observation.possiblePlateText, "Plate area detected")]);
  }
  if (observation.objectType) rows.push(["Object", observation.objectType]);
  if (observation.possibleSize) rows.push(["Possible size", observation.possibleSize]);
  if (observation.activityType) rows.push(["Activity", observation.activityType.replace(/_/g, " ")]);
  return rows;
}

function renderVideoEvidence(data = state.videoEvidence) {
  state.videoEvidence = data || { evidence: [], observations: [] };
  refreshVideoEvidenceSelectors();
  const list = $("#videoEvidenceList");
  if (!list) return;
  list.textContent = "";
  const evidenceItems = state.videoEvidence.evidence || [];
  if (!evidenceItems.length) {
    list.append(node("div", "empty-state", "No video evidence uploaded yet."));
  } else {
    evidenceItems.forEach((evidence) => {
      const card = node("article", `video-evidence-card ${state.activeEvidenceId === evidence.id ? "active" : ""}`);
      const head = node("div", "video-evidence-card-head");
      head.append(node("strong", "", evidence.fileName), node("span", `source-badge ${evidence.processingStatus === "analysis_complete" ? "ready" : "unknown"}`, evidence.processingStatus || "uploaded"));
      const meta = node("div", "video-evidence-meta");
      [
        ["Evidence ID", evidence.evidenceId],
        ["Uploaded", alertTime(evidence.uploadedAt)],
        ["Uploader", `${evidence.uploadedByRole}: ${evidence.uploadedByName}`],
        ["Checksum", String(evidence.checksum || "").slice(0, 12)],
        ["Observations", `${evidence.pendingObservationCount || 0} pending / ${evidence.observationCount || 0} total`]
      ].forEach(([label, value]) => {
        const item = node("span", "");
        item.append(node("small", "", label), node("strong", "", value || "--"));
        meta.append(item);
      });
      const actions = node("div", "video-evidence-actions");
      const select = node("button", "ghost", "Review");
      select.type = "button";
      select.dataset.evidenceSelect = evidence.id;
      const analyze = node("button", "primary", "Run AI Analysis");
      analyze.type = "button";
      analyze.dataset.evidenceAnalyze = evidence.id;
      actions.append(select, analyze);
      card.append(head, meta, actions);
      list.append(card);
    });
  }
  renderVideoReviewPanel();
}

function renderVideoReviewPanel() {
  const wrap = $("#videoReviewSplit");
  if (!wrap) return;
  wrap.textContent = "";
  const evidence = (state.videoEvidence?.evidence || []).find((item) => item.id === state.activeEvidenceId) || (state.videoEvidence?.evidence || [])[0];
  if (!evidence) {
    wrap.append(node("div", "empty-state", "Select evidence to review observations."));
    return;
  }
  state.activeEvidenceId = evidence.id;
  const left = node("div", "video-review-media");
  if (String(evidence.mimeType || "").startsWith("video/")) {
    const video = document.createElement("video");
    video.controls = true;
    video.preload = "metadata";
    video.src = evidence.previewUrl;
    left.append(video);
  } else {
    left.append(node("div", "video-placeholder", "Evidence preview available through secure review"));
  }
  const chain = node("div", "custody-chain");
  chain.append(node("strong", "", "Chain of custody"));
  (evidence.chainOfCustody || []).slice(0, 4).forEach((item) => {
    chain.append(node("small", "", `${item.action} - ${item.actorRole} - ${alertTime(item.timestamp)}`));
  });
  left.append(chain);

  const right = node("div", "video-observation-review");
  right.append(node("p", "review-warning", "Possible detections only. Human verification is required before any incident is created."));
  const observations = evidenceObservations(evidence.id);
  if (!observations.length) {
    right.append(node("div", "empty-state", "Run AI Analysis to create pending observations."));
  } else {
    observations.forEach((observation) => {
      const status = observationReviewState(observation);
      const card = node("article", "video-observation-card");
      card.append(node("span", `source-badge ${status.includes("verified") ? "ready" : status.includes("false") || status.includes("reject") ? "offline" : "unknown"}`, status.replace(/_/g, " ")));
      card.append(node("strong", "", observation.message || "Possible detection"));
      const details = node("dl", "video-observation-meta");
      videoObservationDetails(observation).forEach(([label, value]) => {
        const item = node("div", "");
        item.append(node("dt", "", label), node("dd", "", value));
        details.append(item);
      });
      card.append(details);
      const notes = document.createElement("textarea");
      notes.rows = 2;
      notes.placeholder = "Review notes";
      notes.dataset.observationNotes = observation.id;
      const actions = node("div", "video-observation-actions");
      ["verify", "reject"].forEach((action) => {
        const button = node("button", action === "verify" ? "primary" : "ghost", action === "verify" ? "Verify Observation" : "Reject Observation");
        button.type = "button";
        button.dataset.observationReview = observation.id;
        button.dataset.reviewAction = action;
        button.disabled = status.includes("incident_created");
        actions.append(button);
      });
      const convert = node("button", "primary", "Convert to Incident");
      convert.type = "button";
      convert.dataset.observationConvert = observation.id;
      convert.disabled = status !== "verified";
      actions.append(convert);
      card.append(notes, actions);
      right.append(card);
    });
  }
  wrap.append(left, right);
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

function alertTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString([], { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function alertStatusLabel(status) {
  const value = String(status || "active").toLowerCase();
  if (value === "open") return "ACTIVE";
  return value.replace(/[_-]+/g, " ").toUpperCase();
}

function normalizedAlertReviewStatus(alert) {
  return String(alert.verificationStatus || alert.reviewStatus || alert.status || "unreviewed")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function canReviewAlert(alert) {
  return isOperatorRole()
    && Boolean(alert.acknowledged)
    && ["pending_review", "unreviewed", "human_verification_required"].includes(normalizedAlertReviewStatus(alert));
}

function canRejectAlert(alert) {
  return canReviewAlert(alert);
}

function canConvertAlert(alert) {
  return isOperatorRole()
    && normalizedAlertReviewStatus(alert) === "verified"
    && Boolean(alert.actionable)
    && !alert.isDemo
    && !alert.linkedIncidentId;
}

function alertSourceLabel(alert) {
  return alert.sourceLabel || {
    demo_seed: "DEMO SEED",
    citizen_report: "REAL CITIZEN REPORT",
    ai_observation: "AI OBSERVATION",
    cctv_scan: "CCTV",
    video_upload: "VIDEO",
    manual_alert: "MANUAL ALERT",
    system: "SYSTEM"
  }[alert.source] || "SYSTEM";
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
  const alreadyAcknowledged = Boolean(alert.acknowledged) || acknowledgedBy.some((item) => item.userId === state.user?.id);
  meta.append(node("span", `severity ${sevClass(alert.severity)}`, alert.severity || "low"));
  meta.append(node("span", "alert-type", alertSourceLabel(alert)));
  meta.append(node("span", alert.isDemo ? "alert-demo-badge" : "alert-real-badge", alert.isDemo ? "Not actionable demo data" : alert.actionable ? "Actionable" : "Review only"));
  const title = node("strong", "", alert.message || "Emergency alert");
  const detailGrid = node("div", "alert-detail-grid");
  detailGrid.append(node("small", "", alertTime(alert.createdAt || alert.timestamp)));
  detailGrid.append(node("small", "", `Zone: ${alert.zone || "All Zones"}`));
  detailGrid.append(node("small", "", `Location: ${alertLocation(alert)}`));
  detailGrid.append(node("small", "", `Source: ${alertSourceLabel(alert)}`));
  detailGrid.append(node("small", "", `Creator: ${displayValue(alert.createdByRole)} - ${displayValue(alert.createdBy)}`));
  detailGrid.append(node("small", "", `Location source: ${displayValue(alert.locationSource, "unknown")}`));
  detailGrid.append(node("small", "", `Verification: ${alertStatusLabel(alert.verificationStatus)}`));
  if (alert.linkedReportId) detailGrid.append(node("small", "", `Linked report: ${alert.linkedReportId}`));
  if (alert.linkedIncidentId) detailGrid.append(node("small", "", `Linked incident: ${alert.linkedIncidentId}`));
  if (alert.confidence) detailGrid.append(node("small", "", `Confidence: ${Math.round(Number(alert.confidence) * 100)}%`));
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
    if (canReviewAlert(alert)) {
      const verify = node("button", "primary alert-review", "Verify Alert");
      verify.type = "button";
      verify.dataset.alertReview = alert.id;
      verify.dataset.alertAction = "verify";
      actions.append(verify);
    }
    if (canRejectAlert(alert)) {
      const reject = node("button", "ghost alert-review", "Reject Alert");
      reject.type = "button";
      reject.dataset.alertReview = alert.id;
      reject.dataset.alertAction = "reject";
      actions.append(reject);
    }
    if (canConvertAlert(alert)) {
      const convert = node("button", "primary alert-review", "Convert to Incident");
      convert.type = "button";
      convert.dataset.alertReview = alert.id;
      convert.dataset.alertAction = "convert_incident";
      actions.append(convert);
    }
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
    const status = integration.status || (integration.configured ? "ready" : "setup_required");
    const card = node("article", `integration-card ${status}`);
    const head = node("div", "integration-card-head");
    head.append(node("strong", "", integration.name), node("span", "integration-state", integrationStatusLabel(status)));
    const meta = node("div", "integration-meta");
    if (integration.requiredKey) meta.append(node("span", "", `Config: ${integration.requiredKey}`));
    if (integration.healthUrl) meta.append(node("span", "", `Health: ${integration.healthUrl}`));
    if (integration.checkedAt) meta.append(node("span", "", `Last checked: ${alertTime(integration.checkedAt)}`));
    card.append(head, node("small", "", integration.detail || "Service status unavailable."));
    if (meta.childElementCount) card.append(meta);
    list.append(card);
  });
}

function deviceStatusLabel(status = "") {
  const value = String(status || "unknown").toLowerCase();
  if (["online", "ready", "active", "healthy"].includes(value)) return "ONLINE";
  if (["warning", "degraded", "stale"].includes(value)) return "WARNING";
  if (["offline", "down", "unavailable"].includes(value)) return "OFFLINE";
  return value.replace(/[_-]+/g, " ").toUpperCase();
}

function renderDeviceHealth(devices = []) {
  const list = $("#deviceList");
  if (!list) return;
  list.textContent = "";
  if (!devices.length) {
    const empty = node("article", "device-health-card");
    empty.append(node("strong", "", "No registered devices"), node("small", "", "Connected cameras and field devices will appear here."));
    list.append(empty);
    return;
  }
  devices.forEach((device) => {
    const status = String(device.status || "unknown").toLowerCase();
    const card = node("article", `device-health-card status-${status}`);
    const icon = node("span", "device-health-icon", String(device.type || device.name || "DV").slice(0, 2).toUpperCase());
    const body = node("div", "device-health-body");
    const head = node("div", "device-health-head");
    head.append(node("strong", "", device.name || "Device"), node("span", "device-health-state", deviceStatusLabel(device.status)));
    const meta = node("div", "device-health-meta");
    meta.append(node("span", "", `Zone: ${displayValue(device.zone, "Unknown")}`));
    if (device.type) meta.append(node("span", "", `Type: ${device.type}`));
    if (device.latencyMs !== null && device.latencyMs !== undefined) meta.append(node("span", "", `Latency: ${device.latencyMs} ms`));
    body.append(head, meta);
    card.append(icon, body);
    list.append(card);
  });
}

function resetUnitRegistryForm() {
  const form = $("#unitRegistryForm");
  if (!form) return;
  form.reset();
  form.elements.namedItem("id").value = "";
  form.elements.namedItem("operational").checked = true;
  form.elements.namedItem("linkedStationId").value = "";
}

function fillUnitRegistryForm(unit) {
  const form = $("#unitRegistryForm");
  if (!form || !unit) return;
  form.elements.namedItem("id").value = unit.id || "";
  form.elements.namedItem("unitId").value = unit.unitId || unit.unitCode || "";
  form.elements.namedItem("unitName").value = unit.unitName || unit.name || "";
  form.elements.namedItem("unitType").value = unit.unitType || "police_patrol";
  form.elements.namedItem("source").value = unit.source || "admin_registry";
  form.elements.namedItem("status").value = unit.status || "available";
  form.elements.namedItem("officerName").value = unit.officerName || unit.teamName || "";
  form.elements.namedItem("linkedStationId").value = unit.linkedStationId || unit.stationId || "";
  form.elements.namedItem("stationName").value = unit.stationName || unit.station || "";
  form.elements.namedItem("beat").value = unit.beat || unit.sector || "";
  form.elements.namedItem("jurisdiction").value = unit.jurisdiction || "";
  form.elements.namedItem("lat").value = unit.latitude ?? unit.lat ?? "";
  form.elements.namedItem("lng").value = unit.longitude ?? unit.lng ?? "";
  form.elements.namedItem("address").value = unit.address || unit.currentAddress || "";
  form.elements.namedItem("operational").checked = unit.operational !== false;
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderUnitRegistry(units = state.responseUnits) {
  const list = $("#unitRegistryList");
  if (!list) return;
  list.textContent = "";
  if (!units.length) {
    list.append(node("article", "unit-registry-empty", "No response units configured."));
    return;
  }
  units.forEach((unit) => {
    const card = node("article", `unit-registry-card ${unit.isDemo ? "demo" : "real"} status-${unitDispatchStatus(unit)}`);
    const head = node("div", "unit-registry-head");
    head.append(
      node("strong", "", `${unitLabel(unit)} - ${unit.unitName || unit.name || "Response unit"}`),
      node("span", `source-badge ${unit.isDemo ? "demo" : "real"}`, unit.isDemo ? "DEMO UNIT" : "REAL UNIT")
    );
    const meta = node("div", "unit-registry-meta");
    [
      ["Type", unitTypeLabel(unit)],
      ["Status", displayValue(unitDispatchStatus(unit))],
      ["Source", unit.sourceBadge || unit.sourceLabel || displayValue(unit.source)],
      ["Operational", unit.operational ? "Yes" : "No"],
      ["Station", unit.stationName || unit.station],
      ["Beat", unit.beat || unit.sector],
      ["Jurisdiction", unit.jurisdiction],
      ["Address", unit.currentAddress || unit.address],
      ["Last seen", unit.lastSeen ? alertTime(unit.lastSeen) : "Unknown"]
    ].forEach(([label, value]) => meta.append(node("span", "", `${label}: ${displayValue(value, "--")}`)));
    if (unit.sourceNotes) card.append(node("p", "location-warning", unit.sourceNotes));
    const actions = node("div", "unit-registry-row-actions");
    const edit = node("button", "ghost", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => fillUnitRegistryForm(unit));
    const deactivate = node("button", "ghost", unit.operational ? "Deactivate" : "Activate");
    deactivate.type = "button";
    deactivate.addEventListener("click", async () => {
      try {
        if (unit.operational) {
          await api(`/api/response-units/${unit.id}`, { method: "DELETE", body: {} });
        } else {
          await api(`/api/response-units/${unit.id}`, { method: "PATCH", body: { operational: true, status: "available" } });
        }
        setText("#unitRegistryStatus", unit.operational ? "Unit deactivated." : "Unit activated.");
        await refresh();
      } catch (error) {
        setText("#unitRegistryStatus", error.message);
      }
    });
    actions.append(edit, deactivate);
    card.append(head, meta, actions);
    list.append(card);
  });
}

function renderStationSelect(stations = state.policeStations) {
  const select = $("#unitStationSelect");
  if (!select) return;
  const selected = select.value;
  select.textContent = "";
  select.append(new Option("No station link", ""));
  stations.forEach((station) => {
    select.append(new Option(`${station.stationName || station.name} (${station.stationId || station.id})`, station.stationId || station.id));
  });
  select.value = stations.some((station) => [station.stationId, station.id].includes(selected)) ? selected : "";
}

function resetStationRegistryForm() {
  const form = $("#stationRegistryForm");
  if (!form) return;
  form.reset();
  form.elements.namedItem("id").value = "";
  form.elements.namedItem("source").value = "admin_registry";
  form.elements.namedItem("operational").value = "true";
}

function fillStationRegistryForm(station) {
  const form = $("#stationRegistryForm");
  if (!form || !station) return;
  form.elements.namedItem("id").value = station.id || "";
  form.elements.namedItem("stationId").value = station.stationId || station.id || "";
  form.elements.namedItem("stationName").value = station.stationName || station.name || "";
  form.elements.namedItem("source").value = station.source || "admin_registry";
  form.elements.namedItem("operational").value = station.operational === false ? "false" : "true";
  form.elements.namedItem("jurisdiction").value = station.jurisdiction || "";
  form.elements.namedItem("beat").value = station.beat || "";
  form.elements.namedItem("lat").value = station.latitude ?? station.lat ?? "";
  form.elements.namedItem("lng").value = station.longitude ?? station.lng ?? "";
  form.elements.namedItem("address").value = station.address || "";
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderStationRegistry(stations = state.policeStations) {
  const list = $("#stationRegistryList");
  if (!list) return;
  list.textContent = "";
  renderStationSelect(stations);
  if (!stations.length) {
    list.append(node("article", "unit-registry-empty", "No police stations configured."));
    return;
  }
  stations.forEach((station) => {
    const card = node("article", `unit-registry-card station ${station.isDemo ? "demo" : "real"} ${station.operational ? "status-available" : "status-offline"}`);
    const head = node("div", "unit-registry-head");
    head.append(
      node("strong", "", `${station.stationId || station.id} - ${station.stationName || station.name || "Police station"}`),
      node("span", `source-badge ${station.isDemo ? "demo" : "real"}`, station.badge || (station.isDemo ? "DEMO STATION" : "REAL STATION"))
    );
    const meta = node("div", "unit-registry-meta");
    [
      ["Source", station.sourceLabel || displayValue(station.source)],
      ["Operational", station.operational ? "Yes" : "No"],
      ["Jurisdiction", station.jurisdiction],
      ["Beat", station.beat],
      ["Address", station.address],
      ["Coordinates", `${Number(station.lat).toFixed(4)}, ${Number(station.lng).toFixed(4)}`],
      ["Updated", station.lastUpdated ? alertTime(station.lastUpdated) : "Unknown"]
    ].forEach(([label, value]) => meta.append(node("span", "", `${label}: ${displayValue(value, "--")}`)));
    if (station.sourceNotes) card.append(node("p", "location-warning", station.sourceNotes));
    const actions = node("div", "unit-registry-row-actions");
    const edit = node("button", "ghost", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => fillStationRegistryForm(station));
    const deactivate = node("button", "ghost", station.operational ? "Deactivate" : "Activate");
    deactivate.type = "button";
    deactivate.addEventListener("click", async () => {
      try {
        if (station.operational) {
          await api(`/api/police-stations/${station.id}`, { method: "DELETE", body: {} });
        } else {
          await api(`/api/police-stations/${station.id}`, { method: "PATCH", body: { operational: true } });
        }
        setText("#stationRegistryStatus", station.operational ? "Station deactivated." : "Station activated.");
        await refresh();
      } catch (error) {
        setText("#stationRegistryStatus", error.message);
      }
    });
    actions.append(edit, deactivate);
    card.append(head, meta, actions);
    list.append(card);
  });
}

function policeUserCard(user) {
  const card = node("article", `police-user-card ${user.status === "inactive" ? "inactive" : "active"}`);
  const head = node("div", "police-user-head");
  const identity = node("div", "police-user-identity");
  identity.append(node("strong", "", user.name), node("small", "", user.email));
  head.append(identity, node("span", "police-user-state", user.status === "inactive" ? "INACTIVE" : "ACTIVE"));
  const meta = node("div", "police-user-meta");
  [
    ["Badge / Staff ID", user.badgeId],
    ["Unit ID", user.unitId],
    ["Station", user.station],
    ["Beat / Sector", user.beat],
    ["Jurisdiction", user.jurisdiction],
    ["Created", user.createdAt ? alertTime(user.createdAt) : ""],
    ["Updated", user.updatedAt ? alertTime(user.updatedAt) : ""]
  ].forEach(([label, value]) => meta.append(node("span", "", `${label}: ${displayValue(value, "--")}`)));
  const form = node("form", "police-user-edit");
  form.dataset.policeUserId = user.id;
  [
    ["name", "Name", user.name],
    ["email", "Email", user.email],
    ["badgeId", "Badge ID", user.badgeId],
    ["unitId", "Unit ID", user.unitId],
    ["station", "Station", user.station],
    ["beat", "Beat", user.beat],
    ["jurisdiction", "Jurisdiction", user.jurisdiction]
  ].forEach(([name, label, value]) => {
    const field = node("label", "");
    field.append(document.createTextNode(label));
    const input = document.createElement("input");
    input.name = name;
    input.value = value || "";
    input.type = name === "email" ? "email" : "text";
    input.required = ["name", "email"].includes(name);
    field.append(input);
    form.append(field);
  });
  const actions = node("div", "police-user-row-actions");
  const save = node("button", "ghost", "Save");
  save.type = "submit";
  actions.append(save);
  const toggle = node("button", "ghost", user.status === "inactive" ? "Activate" : "Deactivate");
  toggle.type = "button";
  toggle.dataset.policeAction = user.status === "inactive" ? "activate" : "deactivate";
  toggle.dataset.policeUserId = user.id;
  actions.append(toggle);
  const reset = node("button", "ghost", "Reset Password");
  reset.type = "button";
  reset.dataset.policeAction = "reset-password";
  reset.dataset.policeUserId = user.id;
  actions.append(reset);
  form.append(actions);
  card.append(head, meta, form);
  return card;
}

function renderPoliceManagementKpis(users = []) {
  const kpis = $("#policeManagementKpis");
  if (!kpis) return;
  const active = users.filter((user) => user.status !== "inactive").length;
  const inactive = users.filter((user) => user.status === "inactive").length;
  const assignedUnits = new Set(users.map((user) => String(user.unitId || "").trim()).filter(Boolean)).size;
  const items = [
    ["Total Police", users.length],
    ["Active", active],
    ["Inactive", inactive],
    ["Assigned Units", assignedUnits]
  ];
  kpis.textContent = "";
  items.forEach(([label, value]) => {
    const card = node("article", "police-kpi-card");
    card.append(node("span", "", label), node("strong", "", value));
    kpis.append(card);
  });
}

function renderPoliceUsers(users = []) {
  state.policeUsers = users;
  renderPoliceManagementKpis(users);
  setText("#policeUserCount", `${users.length} account${users.length === 1 ? "" : "s"}`);
  const list = $("#policeUserList");
  if (!list) return;
  list.textContent = "";
  if (!users.length) {
    const empty = node("article", "police-user-empty");
    empty.append(node("strong", "", "No police accounts yet"), node("small", "", "Create staff accounts here. Public signup remains Citizen-only."));
    list.append(empty);
    return;
  }
  users.forEach((user) => list.append(policeUserCard(user)));
}

function integrationStatusLabel(status) {
  return {
    ready: "READY",
    setup_required: "SETUP REQUIRED",
    offline: "OFFLINE",
    warning: "WARNING"
  }[status] || "SETUP REQUIRED";
}

const AUDIT_ACTION_LABELS = {
  alert_acknowledged: "Alert Acknowledged",
  alert_rejected: "Alert Rejected",
  alert_verified: "Alert Verified",
  ai_alert_reviewed: "AI Alert Reviewed",
  alert_converted_to_incident: "Alert Converted to Incident",
  ai_alert_marked_observation: "AI Alert Marked Observation",
  false_alarm_rejected: "False Alarm Rejected",
  unit_assigned: "Unit Assigned",
  incident_closed: "Incident Closed",
  incident_resolved: "Incident Resolved",
  incident_verified: "Incident Verified",
  incident_created: "Incident Created",
  incident_location_updated: "Incident Location Updated",
  incident_location_verified: "Incident Location Verified",
  citizen_report_submitted: "Citizen Report Submitted",
  citizen_report_verified: "Citizen Report Verified",
  citizen_report_converted: "Citizen Report Converted",
  citizen_report_rejected: "Citizen Report Rejected",
  admin_password_changed: "Password Updated",
  password_updated: "Password Updated",
  staff_account_created: "Staff Account Created",
  police_account_created: "Police Account Created",
  police_account_updated: "Police Account Updated",
  police_account_activated: "Police Account Activated",
  police_account_deactivated: "Police Account Deactivated",
  police_password_reset: "Police Password Reset",
  route_suggested: "Route Suggested",
  unit_recommended: "Unit Recommended",
  alert_created: "Alert Created"
};

function auditActionLabel(action = "") {
  const key = String(action);
  if (AUDIT_ACTION_LABELS[key]) return AUDIT_ACTION_LABELS[key];
  return key
    .replace(/^cleared_(\d+)_/, "cleared ")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function auditCategory(action = "") {
  const key = String(action);
  if (key.includes("alert") || key.includes("ai_")) return "alerts";
  if (key.includes("incident") || key.includes("unit") || key.includes("route")) return "incidents";
  if (key.includes("report") || key.includes("missing")) return "reports";
  return "system";
}

function auditEntityLabel(category) {
  return { alerts: "Alert", incidents: "Incident", reports: "Report", system: "Auth/System" }[category] || "System";
}

function auditStatus(action = "") {
  const key = String(action).toLowerCase();
  if (key.includes("reject") || key.includes("false_alarm")) return "Warning";
  if (key.includes("failed") || key.includes("error")) return "Failed";
  return "Success";
}

function auditCard(log) {
  const category = auditCategory(log.action);
  const status = auditStatus(log.action);
  const card = node("article", `audit-card audit-${category}`);
  const icon = node("span", "audit-icon", auditEntityLabel(category).slice(0, 2).toUpperCase());
  const body = node("div", "audit-body");
  const title = node("div", "audit-title");
  title.append(node("strong", "", auditActionLabel(log.action)), node("span", `audit-result ${status.toLowerCase()}`, status));
  const meta = node("div", "audit-meta");
  meta.append(
    node("span", "", `Actor: ${displayValue(log.actorName, "System")}`),
    node("span", "", `Role: ${displayValue(log.actorRole, "System")}`),
    node("span", "", `Entity: ${auditEntityLabel(category)}`),
    node("span", "", alertTime(log.timestamp))
  );
  body.append(title, meta);
  if (log.details || log.incidentId) {
    body.append(node("small", "audit-details", log.details ? String(log.details) : `Incident: ${log.incidentId}`));
  }
  card.append(icon, body);
  return card;
}

function renderAuditFilters(logs = []) {
  const filters = $("#auditFilters");
  if (!filters) return;
  const counts = logs.reduce((acc, log) => {
    acc[auditCategory(log.action)] = (acc[auditCategory(log.action)] || 0) + 1;
    acc.all += 1;
    return acc;
  }, { all: 0, alerts: 0, incidents: 0, reports: 0, system: 0 });
  const items = [["all", "All"], ["alerts", "Alerts"], ["incidents", "Incidents"], ["reports", "Reports"], ["system", "Auth/System"]];
  filters.textContent = "";
  items.forEach(([key, label]) => {
    const button = node("button", state.auditFilter === key ? "active" : "", `${label} (${counts[key] || 0})`);
    button.type = "button";
    button.dataset.auditFilter = key;
    filters.append(button);
  });
}

function renderAuditLogs(logs = []) {
  const list = $("#auditList");
  if (!list) return;
  renderAuditFilters(logs);
  const filtered = state.auditFilter === "all" ? logs : logs.filter((log) => auditCategory(log.action) === state.auditFilter);
  list.textContent = "";
  if (!filtered.length) {
    const empty = node("article", "audit-empty");
    empty.append(node("strong", "", "No audit records in this filter"), node("small", "", "Security and workflow activity will appear here."));
    list.append(empty);
    return;
  }
  filtered.slice(0, 12).forEach((log) => list.append(auditCard(log)));
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
      () => reject(new Error("Location permission denied. Use manual search or map click.")),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  });
}

function gisMapInstance() {
  return satelliteMaps.find((instance) => instance.map.id === "gisMap");
}

function focusRouteOnMap(start, destination) {
  const instance = gisMapInstance();
  if (!instance) return;
  const midpoint = { lat: (start.lat + destination.lat) / 2, lng: (start.lng + destination.lng) / 2 };
  const span = Math.max(Math.abs(start.lat - destination.lat), Math.abs(start.lng - destination.lng));
  const zoom = span < 0.01 ? 15 : span < 0.05 ? 13 : span < 0.2 ? 11 : span < 1 ? 8 : 5;
  setMapView(instance, midpoint, zoom, "Active route");
  renderSatelliteMap(instance);
}

function fitCalculatedRoutesOnMap() {
  const instance = gisMapInstance();
  if (!instance?.leafletMap) return;
  const points = (state.mapNavigation.routes || [])
    .flatMap((route) => route.geometry?.coordinates || [])
    .map(([lng, lat]) => validMapPoint({ lat, lng }))
    .filter(Boolean)
    .map((point) => [point.lat, point.lng]);
  if (points.length < 2) return;
  instance.leafletMap.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 16 });
  instance.center = { ...instance.leafletMap.getCenter() };
  instance.zoom = instance.leafletMap.getZoom();
}

function logRouteDevelopment(status, details = {}) {
  if (!import.meta.env.DEV) return;
  console.info("[GIS route]", {
    status,
    start: details.start ? { lat: details.start.lat, lng: details.start.lng } : null,
    destination: details.destination ? { lat: details.destination.lat, lng: details.destination.lng } : null
  });
}

async function calculateMapRoute() {
  if (!isOperatorRole()) return updateNavigationPanel("Operational navigation is available to Police and Admin users.");
  const routeValidation = routePointValidation();
  if (!routeValidation.valid) return updateNavigationPanel(routeValidation.message);
  const { start, destination } = routeValidation;
  if (state.mapNavigation.routeLoading) return updateNavigationPanel("Route calculation is already running.");
  state.mapNavigation.routeLoading = true;
  clearRouteResult();
  updateNavigationPanel("Calculating route...");
  logRouteDevelopment("request", { start, destination });
  try {
    const response = await api("/api/maps/route", {
      method: "POST",
      body: {
        start: { lat: start.lat, lng: start.lng },
        destination: { lat: destination.lat, lng: destination.lng },
        mode: "driving"
      }
    });
    state.mapNavigation = applyRouteResponse(state.mapNavigation, response);
    const route = selectedRoute(state.mapNavigation);
    logRouteDevelopment(route?.isApproximate ? "approximate_fallback" : "success", { start, destination });
    fitCalculatedRoutesOnMap();
    renderSatelliteMaps();
    updateNavigationPanel(route?.isApproximate
      ? "Air-line estimate ready. Road distance and travel time are unavailable."
      : `${state.mapNavigation.routes.length} real road route option${state.mapNavigation.routes.length === 1 ? "" : "s"} ready.`);
    setText("#routeSummary", route?.isApproximate
      ? `${Number(route.distanceKm).toFixed(2)} km straight-line distance to ${destination.label || "destination"}; ETA unavailable.`
      : `${Number(route.distanceKm).toFixed(2)} km, about ${Math.round(route.durationMinutes)} min to ${destination.label || "destination"}.`);
  } catch (error) {
    logRouteDevelopment("error", { start, destination });
    clearRouteResult();
    updateNavigationPanel(error.message.includes("permission") ? error.message : "Route could not be calculated. Choose a manual start point and retry.");
  } finally {
    state.mapNavigation.routeLoading = false;
    updateNavigationPanel();
  }
}

async function useCurrentLocation() {
  const button = $("#useMyLocation");
  const originalText = button?.textContent || "Use My Location";
  state.mapNavigation.locationLoading = true;
  if (button) {
    button.disabled = true;
    button.textContent = "Getting location...";
    button.classList.add("loading");
  }
  updateNavigationPanel("Getting location...");
  try {
    const point = await browserLocation();
    state.mapNavigation.currentLocation = point;
    setRouteStart(point, "Current device location");
    const instance = gisMapInstance();
    if (instance) {
      setMapView(instance, point, Math.max(instance.zoom, 14), point.label);
      renderSatelliteMap(instance);
    }
    updateNavigationPanel("Current location selected as route start.");
  } catch (error) {
    updateNavigationPanel(error.message);
  } finally {
    state.mapNavigation.locationLoading = false;
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
      button.classList.remove("loading");
    }
    updateGisButtonStates();
  }
}

async function navigateToIncident(incident) {
  const destination = incidentCoordinates(incident, "location", null);
  if (!destination) {
    setText("#routeSummary", "This incident has no coordinates.");
    return;
  }
  state.selectedIncidentId = incident.id;
  clearSearchPreview();
  state.mapNavigation.destination = {
    ...destination,
    label: incident.address || incident.title || incident.type || "Incident",
    locationStatus: incident.locationStatus
  };
  const unitPoint = incidentCoordinates(incident, "unitLocation", null);
  state.mapNavigation.start = unitPoint ? { ...unitPoint, label: `${responseUnit(incident)} location` } : null;
  setView("gis", { preserveGisNavigation: true });
  updateNavigationPanel("Incident destination selected. Calculating route...");
  await calculateMapRoute();
}

function clearMapRoute() {
  resetGisNavigationState("");
  resetGisMapToOperationalCenter("Route cleared. Map restored to Patancheru/BHEL operational center.");
}

function openExternalRoute() {
  const route = selectedRoute(state.mapNavigation);
  const routeValidation = routePointValidation();
  if (!routeValidation.valid || !hasUsableRealRoute(route)) {
    return updateNavigationPanel(route?.isApproximate
      ? "A real road route is required before opening full navigation."
      : route ? routeValidation.message : "Calculate a route before opening full navigation.");
  }
  const { start, destination } = routeValidation;
  const url = new URL("https://www.openstreetmap.org/directions");
  url.searchParams.set("engine", "fossgis_osrm_car");
  url.searchParams.set("route", `${start.lat},${start.lng};${destination.lat},${destination.lng}`);
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

function clearRouteStart() {
  state.mapNavigation.start = null;
  clearRouteResult();
  updateNavigationPanel("Start cleared. Choose a route start.");
  renderSatelliteMaps();
}

function clearRouteDestination() {
  state.mapNavigation.destination = null;
  clearSearchPreview();
  clearRouteResult();
  updateNavigationPanel("Destination cleared. Choose a destination.");
  renderSatelliteMaps();
}

function swapRoutePoints() {
  const routeValidation = routePointValidation();
  const { start, destination } = routeValidation;
  if (!start || !destination) return updateNavigationPanel(routeValidation.message);
  state.mapNavigation.start = { ...destination, label: destination.label || "Swapped start" };
  state.mapNavigation.destination = { ...start, label: start.label || "Swapped destination" };
  clearRouteResult();
  updateNavigationPanel("Start and destination swapped. Calculate the route again.");
  renderSatelliteMaps();
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

function browserObservationLabel(observation) {
  return displayValue(observation.detectionType || observation.threatType || observation.type || "ai_observation");
}

function observationConfidence(observation) {
  return Math.round((Number(observation.confidence) || 0) * 100);
}

function renderLiveVisionObservations() {
  const wrap = $("#liveObservationResults");
  if (!wrap) return;
  wrap.textContent = "";
  if (!state.liveVisionObservations.length) {
    wrap.append(node("div", "empty-state", "No browser camera observations in this session."));
    return;
  }
  state.liveVisionObservations.forEach((observation) => {
    const status = String(observation.reviewStatus || observation.status || "pending_review").toLowerCase();
    const card = node("article", `live-observation-card ${status.includes("verified") ? "verified" : status.includes("false") || status.includes("reject") ? "rejected" : ""}`);
    const header = node("header");
    header.append(
      node("strong", "", observation.message || `Possible ${browserObservationLabel(observation)} detected`),
      node("span", "badge", displayValue(status))
    );
    const meta = node("div", "live-observation-meta");
    [
      ["Type", browserObservationLabel(observation)],
      ["Confidence", `${observationConfidence(observation)}%`],
      ["Source", "browser_camera"],
      ["Time", alertTime(observation.frameTimestamp || observation.lastDetectedAt || observation.createdAt)]
    ].forEach(([label, value]) => meta.append(node("span", "", `${label}: ${value}`)));
    card.append(
      header,
      node("small", "", observation.objectMatch?.message || observation.objectMatch?.matchedObjectType ? `Possible match: ${observation.objectMatch?.matchedObjectType || observation.matchedObjectType}` : "Possible detection only. Human verification required."),
      meta,
      node("small", "", observation.personIdentity?.identified ? "Identity requires human verification." : "Face identification not configured. Person identity is not inferred.")
    );
    if (status === "pending_review") {
      const actions = node("div", "live-review-actions");
      const notes = node("textarea", "", "");
      notes.placeholder = "Review note";
      notes.dataset.browserObservationNote = observation.id;
      const buttons = node("div", "live-review-buttons");
      const verify = node("button", "primary", "Verify Observation");
      verify.type = "button";
      verify.dataset.browserObservationReview = observation.id;
      verify.dataset.reviewAction = "verify";
      const reject = node("button", "ghost", "Reject Observation");
      reject.type = "button";
      reject.dataset.browserObservationReview = observation.id;
      reject.dataset.reviewAction = "reject";
      buttons.append(verify, reject);
      actions.append(notes, buttons);
      card.append(actions);
    }
    wrap.append(card);
  });
}

function appendLiveVisionObservations(result) {
  const observations = Array.isArray(result.observations) && result.observations.length
    ? result.observations
    : result.alert
      ? [result.alert]
      : [];
  if (!observations.length || result.duplicateSuppressed) return;
  const byId = new Map(state.liveVisionObservations.map((item) => [item.id, item]));
  observations.forEach((observation) => {
    if (observation?.id) byId.set(observation.id, observation);
  });
  state.liveVisionObservations = [...byId.values()]
    .sort((a, b) => String(b.createdAt || b.lastDetectedAt || "").localeCompare(String(a.createdAt || a.lastDetectedAt || "")))
    .slice(0, 20);
  renderLiveVisionObservations();
}

function updateLiveLastFrame(image) {
  state.liveVisionLastFrame = image;
  const preview = $("#liveLastFramePreview");
  if (preview) {
    preview.src = image;
    preview.hidden = false;
  }
  setText("#liveLastFrameDetail", `Captured: ${new Date().toLocaleTimeString()}`);
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
    updateLiveLastFrame(image);
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
    appendLiveVisionObservations(result);
    recordLiveVisionNotification(result);
    playLiveVisionBeep(result);
    const videoWrap = $("#liveVisionVideo")?.closest(".live-video-wrap");
    videoWrap?.classList.toggle("critical-pulse", surveillanceSeverity(result) === "critical" && Boolean(result.alert));
    if (!result.configured) {
      setText("#liveSourceHealth", "AI Service Offline");
      setText("#liveAiHealthDetail", "AI service not connected. Configure AI_SERVICE_URL to enable real detection.");
      setLiveVisionStatus("AI service not connected", "Configure AI_SERVICE_URL to enable real detection.");
    } else if (result.serviceError) {
      setText("#liveSourceHealth", "AI Service Offline");
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
  const previousRole = state.user?.role || null;
  state.user = me.user;
  if (previousRole && previousRole !== state.user?.role) {
    resetGisNavigationState("GIS route state reset after role change.");
  }
  applyRoleAccess();
  const operator = isOperatorRole();
  const admin = isAdminRole();
  const aiVision = loadAiVisionData({ role: state.user?.role, api });
  const [dashboard, reports, zones, incidents, alerts, units, stations, devices, audits, integrations, policeUsers, { cameras, sources, videoEvidence, aiHealth }] = await Promise.all([
    operator ? api("/api/dashboard") : Promise.resolve({ summary: {} }),
    api("/api/reports"),
    operator ? api("/api/zones") : Promise.resolve({ zones: [] }),
    operator ? api("/api/incidents/live") : Promise.resolve({ incidents: [] }),
    operator ? api("/api/alerts") : Promise.resolve({ alerts: [] }),
    operator ? api("/api/response-units") : Promise.resolve({ units: [] }),
    operator ? api("/api/police-stations") : Promise.resolve({ stations: [], defaultCenter: DEFAULT_MAP_CENTER }),
    admin ? api("/api/devices/health") : Promise.resolve({ devices: [] }),
    admin ? api("/api/audit-logs") : Promise.resolve({ auditLogs: [] }),
    admin ? api("/api/integrations/status") : Promise.resolve({ integrations: [] }),
    admin ? api("/api/admin/police-users") : Promise.resolve({ users: [] }),
    aiVision
  ]);
  const aiConnected = aiHealth.status === "connected";
  setText("#liveSourceHealth", aiConnected ? "AI Connected" : "AI Service Offline");
  setText("#liveAiHealthDetail", aiConnected
    ? "Real AI detection service is connected."
    : aiHealth.status === "not_configured"
      ? "AI service not connected. Configure AI_SERVICE_URL to enable real detection."
      : "The configured AI service is unreachable.");
  setText("#currentUser", me.user ? `${me.user.role}: ${me.user.name}` : "Not signed in");
  const localMissingPersons = reports.reports.filter((report) => report.reportType === "missing_person" && isActiveReport(report)).length;
  setText("#missingMetric", localMissingPersons);
  state.dashboardSummary = dashboard.summary || {};
  if (operator) {
    const summary = state.dashboardSummary;
    const activeCameras = summary.activeCameras ?? summary.camerasOnline ?? summary.onlineSources ?? 0;
    const onlineSources = summary.onlineSources ?? summary.healthyCameras ?? summary.camerasOnline ?? activeCameras;
    setText("#missingMetric", summary.missingPersons ?? localMissingPersons);
    setText("#cameraMetric", activeCameras);
    setText("#cameraStatus", `${onlineSources} sources ready`);
    setText("#alertMetric", summary.openAlerts ?? summary.criticalAlerts ?? 0);
    setText("#zoneMetric", zones.zones.length);
    setText("#queueCount", `${summary.activeIncidents ?? 0} active`);
    setText("#systemHealthTitle", aiConnected ? "Systems operational" : "AI connection pending");
    setText("#systemHealthDetail", aiConnected
      ? "AI, GIS, cameras, and dispatch are ready"
      : "Core operations remain available while AI reconnects");
  }
  renderIncidents(incidents.incidents);
  state.reports = reports.reports;
  state.incidents = incidents.incidents;
  state.alerts = alerts.alerts;
  state.responseUnits = units.units;
  state.responseUnitSummary = units.summary || unitSummary(units.units || []);
  state.policeStations = stations.stations || [];
  state.mapDefaultCenter = stations.defaultCenter || DEFAULT_MAP_CENTER;
  state.zones = zones.zones;
  renderDashboardKpiDetails();
  renderDispatchPanels();
  renderUnitRegistry(units.units);
  renderStationRegistry(stations.stations);
  renderSatelliteMaps();
  renderCameras(cameras.cameras);
  renderVideoEvidence(videoEvidence);
  renderSources(sources.sources);
  const zoneTable = $("#zoneTable");
  if (zoneTable) {
    zoneTable.textContent = "";
    zones.zones.forEach((z) => zoneTable.append(node("div", "", `${z.name}: ${z.currentDensity}% (${z.severity})`)));
  }
  $("#caseList").textContent = "";
  reports.reports.forEach((r) => $("#caseList").append(reportCard(r)));
  renderAlerts(alerts.alerts);
  renderIncidentCommand();
  renderDeviceHealth(devices.devices);
  renderAuditLogs(audits.auditLogs);
  renderIntegrations(integrations.integrations);
  renderPoliceUsers(policeUsers.users);
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

function setupKpiCards() {
  const activate = (card) => {
    const key = card.dataset.kpi;
    if (card.closest(".dashboard-metrics")) {
      state.activeDashboardKpi = key;
      renderDashboardKpiDetails();
      focusKpiDetails("#dashboardKpiDetails");
    } else if (card.closest(".command-kpis")) {
      state.activeCommandKpi = key;
      renderIncidentCommand();
      focusKpiDetails("#commandKpiDetails");
    }
  };
  $$("[data-kpi]").forEach((card) => {
    card.addEventListener("click", () => activate(card));
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activate(card);
    });
  });
}

setupKpiCards();
$$(".nav-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
$$("[data-layer]").forEach((button) => button.addEventListener("click", () => setLayer(button.dataset.layer)));
$$("[data-view-jump]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.viewJump)));
$("#refreshCommand")?.addEventListener("click", () => refresh().catch((error) => alert(error.message)));
$("#commandIncidentSearch")?.addEventListener("input", (event) => {
  state.commandFilters.search = event.currentTarget.value;
  renderIncidentCommand();
});
[
  ["#commandSeverityFilter", "severity"],
  ["#commandStatusFilter", "status"],
  ["#commandSourceFilter", "source"],
  ["#commandAssignmentFilter", "assignment"]
].forEach(([selector, key]) => {
  $(selector)?.addEventListener("change", (event) => {
    state.commandFilters[key] = event.currentTarget.value;
    renderIncidentCommand();
  });
});
$("#cameraRegistryFilters")?.addEventListener("change", (event) => {
  const control = event.target.closest("[data-camera-filter]");
  if (!control) return;
  state.cameraFilters[control.dataset.cameraFilter] = control.value;
  renderCameras(state.cameraRegistry || []);
});

function openCameraConfig(camera = null) {
  if (!isAdminRole()) return;
  const panel = $("#cameraConfigPanel");
  const form = $("#cameraConfigForm");
  if (!panel || !form) return;
  form.reset();
  form.dataset.cameraSourceId = camera?.id || "";
  form.elements.namedItem("name").value = camera?.isDemo ? "" : camera?.name || "";
  form.elements.namedItem("location").value = camera?.isDemo ? "" : camera?.location || camera?.zone || "";
  form.elements.namedItem("sourceType").value = camera?.isDemo ? "rtsp" : camera?.type || "rtsp";
  form.elements.namedItem("aiEnabled").value = camera?.aiEnabled ? "true" : "false";
  form.elements.namedItem("status").value = camera?.status || "unknown";
  const streamUrl = form.elements.namedItem("streamUrl");
  const username = form.elements.namedItem("username");
  const password = form.elements.namedItem("password");
  const keepSecretText = "Configured securely - leave blank to keep existing secret";
  streamUrl.value = "";
  username.value = "";
  password.value = "";
  streamUrl.placeholder = camera?.hasStreamConfig ? keepSecretText : "rtsp://<user>:<password>@<camera-host>/<path>";
  username.placeholder = camera?.hasStreamConfig ? keepSecretText : "Optional backend credential";
  password.placeholder = camera?.hasStreamConfig ? "Leave blank to keep existing secret" : "Optional backend credential";
  $("#cameraConfigStatus").textContent = camera?.hasStreamConfig ? "Configured securely. Leave secret fields blank to keep existing backend values." : "";
  panel.hidden = false;
  form.name.focus();
}

$("#showCameraConfig")?.addEventListener("click", () => openCameraConfig());
$("#cancelCameraConfig")?.addEventListener("click", () => {
  const panel = $("#cameraConfigPanel");
  if (panel) panel.hidden = true;
});

$("#cameraConfigForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $("#cameraConfigStatus");
  const button = form.querySelector("button[type='submit']");
  const data = new FormData(form);
  const id = form.dataset.cameraSourceId;
  status.className = "form-status";
  status.textContent = "";
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const body = {
      name: data.get("name"),
      location: data.get("location"),
      sourceType: data.get("sourceType"),
      aiEnabled: data.get("aiEnabled") === "true",
      status: data.get("status")
    };
    const streamUrl = String(data.get("streamUrl") || "").trim();
    const username = String(data.get("username") || "").trim();
    const password = String(data.get("password") || "");
    if (streamUrl) body.streamUrl = streamUrl;
    if (username) body.username = username;
    if (password) body.password = password;
    if (id) await api(`/api/camera-sources/${id}/config`, { method: "PATCH", body });
    else await api("/api/camera-sources", { method: "POST", body });
    form.reset();
    form.dataset.cameraSourceId = "";
    status.classList.add("success");
    status.textContent = "Camera metadata saved. Stream secrets remain backend-side only.";
    await refresh();
  } catch (error) {
    status.classList.add("error");
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Save Camera";
  }
});

$("#cameraGridLarge")?.addEventListener("click", async (event) => {
  const testButton = event.target.closest("[data-camera-test]");
  const analyzeButton = event.target.closest("[data-camera-analyze]");
  const editButton = event.target.closest("[data-camera-edit]");
  const deleteButton = event.target.closest("[data-camera-delete]");
  const button = testButton || analyzeButton || editButton || deleteButton;
  if (!button) return;
  const id = button.dataset.cameraTest || button.dataset.cameraAnalyze || button.dataset.cameraEdit || button.dataset.cameraDelete;
  const camera = (state.cameraRegistry || []).find((item) => item.id === id);
  if (editButton) return openCameraConfig(camera);
  if (deleteButton && !confirm("Delete this real camera configuration? Stream credentials will be removed from backend storage.")) return;
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = testButton ? "Testing..." : analyzeButton ? "Analyzing..." : "Deleting...";
  try {
    const result = testButton
      ? await api(`/api/camera-sources/${id}/test`, { method: "POST" })
      : analyzeButton
        ? await api(`/api/camera-sources/${id}/analyze`, { method: "POST" })
        : await api(`/api/camera-sources/${id}`, { method: "DELETE" });
    if (result.message) alert(result.message);
    else if (result.alert) alert(result.alert.message || "AI observation created for human review.");
    await refresh();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
});

$("#refreshVideoEvidence")?.addEventListener("click", refresh);

$("#videoEvidenceFile")?.addEventListener("change", (event) => {
  const file = event.currentTarget.files?.[0];
  setText("#videoEvidenceFileName", file ? file.name : "No video selected");
});

$("#videoEvidenceForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $("#videoEvidenceStatus");
  const button = form.querySelector("button[type='submit']");
  status.className = "form-status";
  status.textContent = "";
  button.disabled = true;
  button.textContent = "Uploading...";
  try {
    const file = form.elements.namedItem("videoEvidenceFile").files?.[0];
    const video = await readVideoEvidenceFile(file);
    const data = new FormData(form);
    const result = await api("/api/video-evidence", {
      method: "POST",
      body: {
        ...video,
        linkedReportId: data.get("linkedReportId"),
        linkedIncidentId: data.get("linkedIncidentId"),
        notes: data.get("notes")
      }
    });
    form.reset();
    setText("#videoEvidenceFileName", "No video selected");
    status.classList.add("success");
    status.textContent = result.message || "Video evidence uploaded.";
    state.activeEvidenceId = result.evidence?.id || state.activeEvidenceId;
    await refresh();
  } catch (error) {
    status.classList.add("error");
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Upload Video";
  }
});

$("#videoEvidenceList")?.addEventListener("click", async (event) => {
  const select = event.target.closest("[data-evidence-select]");
  const analyze = event.target.closest("[data-evidence-analyze]");
  if (!select && !analyze) return;
  const id = select?.dataset.evidenceSelect || analyze?.dataset.evidenceAnalyze;
  state.activeEvidenceId = id;
  if (select) return renderVideoEvidence();
  const original = analyze.textContent;
  analyze.disabled = true;
  analyze.textContent = "Analyzing...";
  try {
    await api(`/api/video-evidence/${id}/analyze`, { method: "POST", body: {} });
    await refresh();
  } catch (error) {
    alert(error.message);
  } finally {
    analyze.disabled = false;
    analyze.textContent = original;
  }
});

$("#videoReviewSplit")?.addEventListener("click", async (event) => {
  const review = event.target.closest("[data-observation-review]");
  const convert = event.target.closest("[data-observation-convert]");
  if (!review && !convert) return;
  const id = review?.dataset.observationReview || convert?.dataset.observationConvert;
  const notes = $(`[data-observation-notes="${id}"]`)?.value || "";
  const button = review || convert;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = convert ? "Converting..." : "Saving...";
  try {
    if (convert) await api(`/api/video-observations/${id}/convert-incident`, { method: "POST", body: {} });
    else await api(`/api/video-observations/${id}/review`, { method: "POST", body: { action: review.dataset.reviewAction, notes } });
    await refresh();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});

$("#liveObservationResults")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-browser-observation-review]");
  if (!button) return;
  const id = button.dataset.browserObservationReview;
  const notes = $(`[data-browser-observation-note="${id}"]`)?.value || "";
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const result = await api(`/api/browser-observations/${id}/review`, {
      method: "POST",
      body: { action: button.dataset.reviewAction, notes }
    });
    state.liveVisionObservations = state.liveVisionObservations.map((item) =>
      item.id === id ? result.observation : item
    );
    renderLiveVisionObservations();
    await refresh();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
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
  try {
    await withButtonBusy($("#assignIncident"), "Assigning...", async () => {
      const result = await api(`/api/incidents/${incident.id}/assign-nearest`, { method: "POST" });
      applyDispatchResult(result);
      await refresh();
      const routeLabel = result.route?.approximate ? "Assigned using approximate fallback route." : "Assigned with verified driving route.";
      setText("#routeSummary", `${responseUnit(result.incident)} assigned. ${routeLabel}`);
    });
  } catch (error) {
    setText("#routeSummary", dispatchErrorMessage(error));
    alert(dispatchErrorMessage(error));
  }
});
$("#routeIncident").addEventListener("click", async () => { try { await suggestPoliceRoute(); } catch (error) { $("#routeSummary").textContent = `Route unavailable: ${error.message}`; } });
$("#navigateMap").addEventListener("click", calculateMapRoute);
$("#streetMapLayer").addEventListener("click", () => {
  const instance = gisMapInstance();
  if (instance) setBaseLayer(instance, "streets");
});
$("#satelliteMapLayer").addEventListener("click", () => {
  const instance = gisMapInstance();
  if (instance) setBaseLayer(instance, "satellite");
});
$("#fitGisMap").addEventListener("click", fitGisMapToOperationalMarkers);
$("#resetGisMap").addEventListener("click", resetGisMapView);
$("#useMyLocation").addEventListener("click", useCurrentLocation);
$("#recalculateRoute").addEventListener("click", calculateMapRoute);
$("#openExternalRoute").addEventListener("click", openExternalRoute);
$("#clearMapRoute").addEventListener("click", clearMapRoute);
$("#clearRouteStart").addEventListener("click", clearRouteStart);
$("#clearRouteDestination").addEventListener("click", clearRouteDestination);
$("#swapRoutePoints").addEventListener("click", swapRoutePoints);
$("#setMapStart").addEventListener("click", () => setNavigationSelectionMode("start"));
$("#setMapDestination").addEventListener("click", () => setNavigationSelectionMode("destination"));
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
  const location = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, locationSource: "manual_latlng" } : null;
  try {
    await api("/api/send-alert", {
      method: "POST",
      body: {
        type: data.get("type"),
        severity: data.get("severity"),
        zone,
        message: data.get("message"),
        location,
        locationSource: location ? "manual_latlng" : "unknown"
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
$("#auditFilters")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-audit-filter]");
  if (!button) return;
  state.auditFilter = button.dataset.auditFilter;
  api("/api/audit-logs")
    .then((result) => renderAuditLogs(result.auditLogs))
    .catch((error) => alert(error.message));
});
$("#alertGrid").addEventListener("click", async (event) => {
  const ackButton = event.target.closest("[data-alert-ack]");
  const reviewButton = event.target.closest("[data-alert-review]");
  const button = ackButton || reviewButton;
  if (!button) return;
  button.disabled = true;
  setAlertActionStatus("");
  try {
    if (ackButton) {
      await api(`/api/alerts/${ackButton.dataset.alertAck}/ack`, { method: "PATCH" });
      setAlertActionStatus("Alert acknowledged.", "success");
    } else {
      const action = reviewButton.dataset.alertAction;
      const result = await api(`/api/alerts/${reviewButton.dataset.alertReview}/review`, {
        method: "POST",
        body: { action }
      });
      const message = action === "verify"
        ? "Alert verified. Convert is available when the alert is actionable."
        : action === "reject"
          ? "Alert rejected as false alarm."
          : result.incident
            ? "Alert converted to incident."
            : "Alert review updated.";
      setAlertActionStatus(message, "success");
      if (action === "convert_incident" && result.incident?.id) {
        state.selectedIncidentId = result.incident.id;
      }
    }
    await refresh();
    if (reviewButton?.dataset.alertAction === "convert_incident") setView("incident-command");
  } catch (error) {
    setAlertActionStatus(error.message, "error");
  } finally {
    if (button.isConnected) button.disabled = false;
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
$("#useReportLocation")?.addEventListener("click", async () => {
  const form = $("#missingForm");
  const status = $("#missingFormStatus");
  status.className = "form-status";
  status.textContent = "Requesting current location...";
  try {
    const point = await browserLocation();
    let place = null;
    try { place = await reverseGeocodePoint(point); } catch {}
    form.elements.lat.value = point.lat.toFixed(6);
    form.elements.lng.value = point.lng.toFixed(6);
    form.dataset.locationSource = "browser_gps";
    if (place?.displayName || place?.name) form.elements.lastSeen.value = place.displayName || place.name;
    status.classList.add("success");
    status.textContent = "Current location added to this report.";
  } catch {
    form.dataset.locationSource = "";
    status.classList.add("error");
    status.textContent = "Location permission denied. Use manual search or map click.";
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
    const reportPoint = validMapPoint({ lat: data.get("lat"), lng: data.get("lng") });
    const locationSource = form.dataset.locationSource === "browser_gps"
      ? "browser_gps"
      : reportPoint
        ? "manual_latlng"
        : "unknown";
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
        lat: reportPoint?.lat ?? null,
        lng: reportPoint?.lng ?? null,
        locationSource,
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
    form.dataset.locationSource = "";
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
  if (loginSubmissionInFlight) return;
  loginSubmissionInFlight = true;
  const form = event.currentTarget;
  const submitButton = form.querySelector("button[type='submit']");
  const submitLabel = submitButton?.textContent;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Signing in...";
  }
  $("#loginError").textContent = "";
  const data = new FormData(form);
  try {
    const login = await api("/api/login", {
      method: "POST",
      body: { email: data.get("email"), password: data.get("password") }
    });
    if (!login?.user) throw new Error("Session could not be created. Please try again.");
    resetGisNavigationState("GIS route state reset for the new session.");
    state.user = login.user;
    showApp();
    await refresh();
    setView(location.pathname === "/rakshak/live-vision" ? "live-vision" : landingForRole(state.user.role));
  } catch (error) {
    showPortal(error.message);
  } finally {
    loginSubmissionInFlight = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = submitLabel;
    }
  }
});

$("#registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (registerSubmissionInFlight) return;
  registerSubmissionInFlight = true;
  const form = event.currentTarget;
  const submitButton = form.querySelector("button[type='submit']");
  const submitLabel = submitButton?.textContent;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Creating account...";
  }
  $("#registerError").textContent = "";
  const data = new FormData(form);
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
    resetGisNavigationState("GIS route state reset for the new session.");
    state.user = created.user;
    showApp();
    await refresh();
    setView(location.pathname === "/rakshak/live-vision" ? "live-vision" : landingForRole(state.user.role));
  } catch (error) {
    showPortal(error.message, "register");
  } finally {
    registerSubmissionInFlight = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = submitLabel;
    }
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

$("#unitRegistryForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $("#unitRegistryStatus");
  const button = form.querySelector("button[type='submit']");
  const data = new FormData(form);
  const id = String(data.get("id") || "").trim();
  const body = {
    unitId: data.get("unitId"),
    unitName: data.get("unitName"),
    unitType: data.get("unitType"),
    source: data.get("source"),
    status: data.get("status"),
    officerName: data.get("officerName"),
    linkedStationId: data.get("linkedStationId"),
    stationName: data.get("stationName"),
    beat: data.get("beat"),
    jurisdiction: data.get("jurisdiction"),
    lat: data.get("lat"),
    lng: data.get("lng"),
    address: data.get("address"),
    operational: data.get("operational") === "on"
  };
  status.className = "form-status";
  status.textContent = "";
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    if (id) await api(`/api/response-units/${id}`, { method: "PATCH", body });
    else await api("/api/response-units", { method: "POST", body });
    resetUnitRegistryForm();
    status.classList.add("success");
    status.textContent = id ? "Unit updated." : "Unit created.";
    await refresh();
  } catch (error) {
    status.classList.add("error");
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Save Unit";
  }
});

$("#resetUnitRegistryForm")?.addEventListener("click", resetUnitRegistryForm);

$("#unitStationSelect")?.addEventListener("change", (event) => {
  const station = state.policeStations.find((item) => [item.stationId, item.id].includes(event.currentTarget.value));
  const form = $("#unitRegistryForm");
  if (!station || !form) return;
  form.elements.namedItem("stationName").value = station.stationName || station.name || "";
  form.elements.namedItem("beat").value = form.elements.namedItem("beat").value || station.beat || "";
  form.elements.namedItem("jurisdiction").value = form.elements.namedItem("jurisdiction").value || station.jurisdiction || "";
  form.elements.namedItem("address").value = form.elements.namedItem("address").value || station.address || "";
});

$("#stationRegistryForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $("#stationRegistryStatus");
  const button = form.querySelector("button[type='submit']");
  const data = new FormData(form);
  const id = String(data.get("id") || "").trim();
  const body = {
    stationId: data.get("stationId"),
    stationName: data.get("stationName"),
    source: data.get("source"),
    operational: data.get("operational") === "true",
    jurisdiction: data.get("jurisdiction"),
    beat: data.get("beat"),
    lat: data.get("lat"),
    lng: data.get("lng"),
    address: data.get("address")
  };
  status.className = "form-status";
  status.textContent = "";
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    if (id) await api(`/api/police-stations/${id}`, { method: "PATCH", body });
    else await api("/api/police-stations", { method: "POST", body });
    resetStationRegistryForm();
    status.classList.add("success");
    status.textContent = id ? "Station updated." : "Station created.";
    await refresh();
  } catch (error) {
    status.classList.add("error");
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Save Station";
  }
});

$("#resetStationRegistryForm")?.addEventListener("click", resetStationRegistryForm);

$("#policeUserForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $("#policeUserStatus");
  const button = form.querySelector("button[type='submit']");
  const data = new FormData(form);
  status.className = "form-status";
  status.textContent = "";
  button.disabled = true;
  button.textContent = "Creating...";
  try {
    await api("/api/admin/police-users", {
      method: "POST",
      body: {
        name: data.get("name"),
        email: data.get("email"),
        temporaryPassword: data.get("temporaryPassword"),
        badgeId: data.get("badgeId"),
        unitId: data.get("unitId"),
        station: data.get("station"),
        beat: data.get("beat"),
        jurisdiction: data.get("jurisdiction")
      }
    });
    form.reset();
    status.classList.add("success");
    status.textContent = "Police account created.";
    await refresh();
  } catch (error) {
    status.classList.add("error");
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Create Police Account";
  }
});

$("#policeUserList")?.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-police-user-id]");
  if (!form) return;
  event.preventDefault();
  const status = $("#policeUserStatus");
  const data = new FormData(form);
  const button = form.querySelector("button[type='submit']");
  if (status) {
    status.className = "form-status";
    status.textContent = "";
  }
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    await api(`/api/admin/police-users/${form.dataset.policeUserId}`, {
      method: "PATCH",
      body: {
        name: data.get("name"),
        email: data.get("email"),
        badgeId: data.get("badgeId"),
        unitId: data.get("unitId"),
        station: data.get("station"),
        beat: data.get("beat"),
        jurisdiction: data.get("jurisdiction")
      }
    });
    if (status) {
      status.classList.add("success");
      status.textContent = "Police account updated.";
    }
    await refresh();
  } catch (error) {
    if (status) {
      status.classList.add("error");
      status.textContent = error.message;
    } else {
      alert(error.message);
    }
  } finally {
    button.disabled = false;
    button.textContent = "Save";
  }
});

$("#policeUserList")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-police-action]");
  if (!button) return;
  const action = button.dataset.policeAction;
  const userId = button.dataset.policeUserId;
  const status = $("#policeUserStatus");
  if (status) {
    status.className = "form-status";
    status.textContent = "";
  }
  button.disabled = true;
  try {
    if (action === "reset-password") {
      const temporaryPassword = prompt("Enter a temporary password for this police account (minimum 8 characters):");
      if (temporaryPassword === null) return;
      await api(`/api/admin/police-users/${userId}/reset-password`, { method: "POST", body: { temporaryPassword } });
      if (status) status.textContent = "Temporary password reset.";
    } else {
      await api(`/api/admin/police-users/${userId}/${action}`, { method: "PATCH" });
      if (status) status.textContent = action === "activate" ? "Police account activated." : "Police account deactivated.";
    }
    if (status) status.classList.add("success");
    await refresh();
  } catch (error) {
    if (status) {
      status.classList.add("error");
      status.textContent = error.message;
    } else {
      alert(error.message);
    }
  } finally {
    button.disabled = false;
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
  resetGisNavigationState("Logged out. GIS route markers cleared.");
  state.user = null;
  applyRoleAccess();
  showPortal("Logged out successfully.");
});

window.addEventListener("resize", scheduleMapResizeRender);

function handleBrowserNavigationRestore(message = "GIS route state reset after navigation restore.") {
  if (browserNavigationRestoreInProgress) return;
  browserNavigationRestoreInProgress = true;
  resetGisNavigationState(message);
  scheduleMapResizeRender();
  requestAnimationFrame(() => {
    browserNavigationRestoreInProgress = false;
  });
}

window.addEventListener("pageshow", (event) => {
  if (event.persisted) handleBrowserNavigationRestore();
});

window.addEventListener("popstate", () => {
  handleBrowserNavigationRestore("GIS route state reset after browser navigation.");
});

initSatelliteMaps();
resetGisNavigationState("GIS map ready. Route markers cleared.");

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
