import { api, trackingApi } from "../services/api.js";
import { on as onRealtime } from "../services/realtime.js";

// Keep this screen independent from the application bootstrap.  Importing
// app.js here creates a circular dependency and makes this component
// impossible to exercise outside a Vite browser bundle.
const $ = (selector) => document.querySelector(selector);
function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function titleCase(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function statusClass(value) {
  return `status-${String(value || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

let getCameraSources = () => window.state?.cameraSources || [];

export function configureTracking({ cameraSources } = {}) {
  if (typeof cameraSources === "function") getCameraSources = cameraSources;
}

let trackingState = {
  sessions: [],
  selectedSessionId: null,
  selectedCandidateId: null,
  view: "list",
  filters: { trackType: "all", status: "all", camera: "all" },
  unsubscribers: [],
  comparisonData: null,
  sidebarOpen: true
};

const STATUS_LABELS = {
  SEARCHING: "Searching",
  CANDIDATE_FOUND: "Candidates Found",
  HUMAN_REVIEW: "Human Review",
  CONFIRMED: "Confirmed",
  REJECTED: "Rejected",
  CLOSED: "Closed"
};

const CANDIDATE_STATUS_LABELS = {
  PENDING_REVIEW: "Pending Review",
  CONFIRMED: "Confirmed",
  REJECTED: "Rejected",
  UNCERTAIN: "Uncertain"
};

const TRACK_TYPE_LABELS = {
  PERSON: "Person",
  VEHICLE: "Vehicle"
};

function formatTimestamp(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
    " " + date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatDuration(seconds) {
  if (seconds == null) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function confidenceColor(confidence) {
  if (confidence >= 0.85) return "confidence-high";
  if (confidence >= 0.65) return "confidence-medium";
  if (confidence >= 0.4) return "confidence-low";
  return "confidence-very-low";
}

function createStatBar(label, value, max = 1, colorClass = "") {
  const pct = Math.round((value / max) * 100);
  const wrapper = node("div", "stat-bar");
  wrapper.append(node("div", "stat-bar-label", label));
  const barContainer = node("div", "stat-bar-container");
  const bar = node("div", `stat-bar-fill ${colorClass}`);
  bar.style.width = `${pct}%`;
  barContainer.append(bar);
  wrapper.append(barContainer, node("div", "stat-bar-value", `${pct}%`));
  return wrapper;
}

function createScoreBreakdown(explanation) {
  const container = node("div", "score-breakdown");
  const weights = {
    appearance: "Appearance",
    spatial: "Spatial",
    timing: "Timing",
    direction: "Direction",
    activity: "Activity",
    gait: "Gait",
    plate: "Plate",
    color: "Color",
    vehicleType: "Vehicle Type",
    brandModel: "Brand/Model",
    distinctiveMarks: "Markings",
    speed: "Speed",
    route: "Route"
  };
  for (const [key, label] of Object.entries(weights)) {
    if (explanation[key]) {
      const exp = explanation[key];
      const row = node("div", "score-row");
      row.append(
        node("span", "score-label", label),
        node("span", "score-raw", `Raw: ${Math.round((exp.raw || 0) * 100)}%`),
        node("span", "score-adjusted", `Adj: ${Math.round((exp.adjusted || 0) * 100)}%`),
        node("span", "score-weight", `Weight: ${exp.weight ? (exp.weight * 100).toFixed(0) : "—"}%`)
      );
      container.append(row);
    }
  }
  if (explanation.cameraHealth) {
    const ch = explanation.cameraHealth;
    const row = node("div", "score-row camera-health-row");
    row.append(
      node("span", "score-label", "Camera Health"),
      node("span", "score-value", `Status: ${ch.status || "—"}, Severity: ${ch.severity || "—"}`)
    );
    container.append(row);
  }
  return container;
}

function renderSessionCard(session) {
  const card = node("div", `session-card ${session.status.toLowerCase().replace("_", "-")}`);
  card.dataset.sessionId = session.id;

  const statusEl = node("span", `session-status ${statusClass(session.status)}`, STATUS_LABELS[session.status] || session.status);
  const typeEl = node("span", "session-type", TRACK_TYPE_LABELS[session.trackType] || session.trackType);
  const timeEl = node("span", "session-time", formatTimestamp(session.createdAt));
  const confEl = node("span", `session-confidence ${confidenceColor(session.confidence)}`, `${Math.round((session.confidence || 0) * 100)}%`);

  const header = node("div", "session-header");
  header.append(node("div", "session-id", `Track: ${session.id.slice(0, 16)}...`), statusEl, typeEl, timeEl, confEl);

  const meta = node("div", "session-meta");
  if (session.referenceCameraId) {
    meta.append(node("span", "meta-item", `Ref Cam: ${session.referenceCameraId}`));
  }
  if (session.lastSeenCameraId) {
    meta.append(node("span", "meta-item", `Last Seen: ${session.lastSeenCameraId} (${formatTimestamp(session.lastSeenAt)})`));
  }
  if (session.incidentId) {
    meta.append(node("span", "meta-item", `Incident: ${session.incidentId.slice(0, 12)}...`));
  }

  const actions = node("div", "session-actions");
  const searchBtn = node("button", "btn btn-primary btn-sm", "Search Cameras");
  searchBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleSearchSession(session.id);
  });
  const viewBtn = node("button", "btn btn-secondary btn-sm", "View Details");
  viewBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleSelectSession(session.id);
  });
  const closeBtn = node("button", "btn btn-danger btn-sm", "Close Track");
  closeBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (confirm("Close this tracking session?")) {
      try {
        await trackingApi.closeSession(session.id);
        await loadSessions();
      } catch (error) {
        alert(`Failed to close session: ${error.message}`);
      }
    }
  });
  actions.append(searchBtn, viewBtn, closeBtn);

  card.append(header, meta, actions);
  card.addEventListener("click", () => handleSelectSession(session.id));
  return card;
}

function renderCandidateCard(candidate, session, observation) {
  const card = node("div", `candidate-card ${candidate.status.toLowerCase().replace("_", "-")}`);
  card.dataset.candidateId = candidate.id;

  const statusEl = node("span", `candidate-status ${statusClass(candidate.status)}`, CANDIDATE_STATUS_LABELS[candidate.status] || candidate.status);
  const confEl = node("span", `candidate-confidence ${confidenceColor(candidate.overallConfidence)}`, `${Math.round(candidate.overallConfidence * 100)}%`);
  const timeEl = node("span", "candidate-time", formatTimestamp(candidate.detectedAt));
  const cameraEl = node("span", "candidate-camera", `Camera: ${candidate.cameraId}`);

  const header = node("div", "candidate-header");
  header.append(statusEl, confEl, timeEl, cameraEl);

  const breakdown = node("div", "candidate-breakdown");
  if (session.trackType === "PERSON") {
    breakdown.append(
      createStatBar("Appearance", candidate.appearanceSimilarity),
      createStatBar("Spatial", candidate.spatialConsistency),
      createStatBar("Timing", candidate.timingConsistency),
      createStatBar("Direction", candidate.directionConsistency),
      createStatBar("Activity", candidate.activityConsistency)
    );
  } else {
    breakdown.append(
      createStatBar("Plate", candidate.plateSimilarity),
      createStatBar("Appearance", candidate.colorSimilarity),
      createStatBar("Vehicle Type", candidate.vehicleTypeSimilarity),
      createStatBar("Spatial", candidate.spatialConsistency),
      createStatBar("Timing", candidate.timingConsistency),
      createStatBar("Route", candidate.routeConsistency)
    );
  }

  const actions = node("div", "candidate-actions");
  if (candidate.status === "PENDING_REVIEW") {
    const confirmBtn = node("button", "btn btn-success btn-sm", "Confirm Match");
    confirmBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await handleVerifyCandidate(session.id, candidate.id, "CONFIRM_MATCH");
    });
    const rejectBtn = node("button", "btn btn-danger btn-sm", "Reject");
    rejectBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const reason = prompt("Reason for rejection (optional):");
      await handleVerifyCandidate(session.id, candidate.id, "REJECT_MATCH", reason);
    });
    const uncertainBtn = node("button", "btn btn-warning btn-sm", "Uncertain");
    uncertainBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const reason = prompt("Reason for uncertainty (optional):");
      await handleVerifyCandidate(session.id, candidate.id, "UNCERTAIN", reason);
    });
    actions.append(confirmBtn, rejectBtn, uncertainBtn);
  }

  const compareBtn = node("button", "btn btn-info btn-sm", "Side-by-Side");
  compareBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleSideBySide(session, candidate, observation);
  });
  actions.append(compareBtn);

  card.append(header, breakdown, actions);
  return card;
}

function renderObservationDetails(obs, label, isReference = false) {
  const container = node("div", `observation-details ${isReference ? "reference" : "candidate"}`);
  const header = node("div", "obs-header");
  header.append(node("h4", "", `${label} ${isReference ? "(Reference)" : ""}`));
  if (obs.cameraId) header.append(node("span", "obs-camera", `Camera: ${obs.cameraId}`));
  if (obs.detectedAt) header.append(node("span", "obs-time", formatTimestamp(obs.detectedAt)));

  const grid = node("div", "obs-grid");
  if (obs.trackType === "PERSON" || obs.upperClothingColor) {
    if (obs.upperClothingColor) grid.append(createDetailRow("Upper Clothing", obs.upperClothingColor));
    if (obs.lowerClothingColor) grid.append(createDetailRow("Lower Clothing", obs.lowerClothingColor));
    if (obs.clothingType) grid.append(createDetailRow("Clothing Type", obs.clothingType));
    if (obs.carryingBag) grid.append(createDetailRow("Carrying Bag", titleCase(obs.carryingBag)));
    if (obs.bagDescription) grid.append(createDetailRow("Bag Description", obs.bagDescription));
    if (obs.helmetHat) grid.append(createDetailRow("Helmet/Hat", obs.helmetHat));
    if (obs.approxHeightCm) grid.append(createDetailRow("Approx Height", `${obs.approxHeightCm} cm`));
    if (obs.bodyBuild) grid.append(createDetailRow("Body Build", obs.bodyBuild));
    if (obs.movementState) grid.append(createDetailRow("Movement", titleCase(obs.movementState.replace("_", " "))));
    if (obs.movementSpeedMs) grid.append(createDetailRow("Speed", `${obs.movementSpeedMs.toFixed(2)} m/s`));
    if (obs.activityLabel) grid.append(createDetailRow("Activity", titleCase(obs.activityLabel.replace("_", " "))));
    if (obs.directionDegrees != null) grid.append(createDetailRow("Direction", `${obs.directionDegrees}°`));
  }
  if (obs.trackType === "VEHICLE" || obs.plateText) {
    if (obs.plateText) grid.append(createDetailRow("Plate", obs.plateText + (obs.plateConfidence ? ` (${Math.round(obs.plateConfidence * 100)}%)` : "")));
    if (obs.vehicleColor) grid.append(createDetailRow("Color", obs.vehicleColor));
    if (obs.vehicleType) grid.append(createDetailRow("Type", obs.vehicleType));
    if (obs.vehicleBrand && obs.vehicleBrand !== "Unknown") {
      grid.append(createDetailRow("Brand", `${obs.vehicleBrand}${obs.vehicleModel && obs.vehicleModel !== "Unknown" ? ` ${obs.vehicleModel}` : ""}${obs.brandModelConfidence ? ` (${Math.round(obs.brandModelConfidence * 100)}%)` : ""}`));
    }
    if (obs.distinctiveMarks?.length) grid.append(createDetailRow("Distinctive Marks", obs.distinctiveMarks.join(", ")));
    if (obs.estimatedSpeedKmh) grid.append(createDetailRow("Speed", `${obs.estimatedSpeedKmh.toFixed(1)} km/h`));
    if (obs.directionDegrees != null) grid.append(createDetailRow("Direction", `${obs.directionDegrees}°`));
  }
  if (obs.detectionConfidence != null) grid.append(createDetailRow("Detection Confidence", `${Math.round(obs.detectionConfidence * 100)}%`));
  if (obs.cameraHealthStatus) grid.append(createDetailRow("Camera Health", `${obs.cameraHealthStatus} (${obs.cameraHealthSeverity || "—"})`));

  container.append(header, grid);
  return container;
}

function createDetailRow(label, value) {
  const row = node("div", "detail-row");
  row.append(node("span", "detail-label", label), node("span", "detail-value", value));
  return row;
}

async function handleSearchSession(sessionId) {
  try {
    const result = await trackingApi.searchCandidates(sessionId);
    trackingState.selectedSessionId = sessionId;
    trackingState.view = "candidates";
    renderCandidatesView(result.session, result.candidates, result.referenceObservation);
  } catch (error) {
    alert(`Search failed: ${error.message}`);
  }
}

async function handleSelectSession(sessionId) {
  try {
    const result = await trackingApi.getSession(sessionId);
    trackingState.selectedSessionId = sessionId;
    trackingState.view = "detail";
    renderSessionDetail(result.session, result.observations, result.candidates, result.verifications);
  } catch (error) {
    alert(`Failed to load session: ${error.message}`);
  }
}

async function handleVerifyCandidate(sessionId, candidateId, decision, reason) {
  try {
    await trackingApi.verifyCandidate(sessionId, candidateId, decision, reason);
    await handleSelectSession(sessionId);
  } catch (error) {
    alert(`Verification failed: ${error.message}`);
  }
}

function handleSideBySide(session, candidate, observation) {
  const referenceObs = session.observations?.find((o) => o.detectionId === session.referenceDetectionId) || session.observations?.[0];
  trackingState.comparisonData = { session, candidate, observation, referenceObs };
  trackingState.view = "compare";
  renderComparisonView(session, candidate, observation, referenceObs);
}

async function loadSessions() {
  try {
    const result = await trackingApi.listSessions(trackingState.filters);
    trackingState.sessions = result.sessions || [];
    renderSessionsList();
  } catch (error) {
    console.error("Failed to load sessions:", error);
  }
}

function renderSessionsList() {
  const container = $("#trackingSessionsList");
  if (!container) return;
  container.innerHTML = "";
  if (trackingState.sessions.length === 0) {
    container.append(node("div", "empty-state", "No tracking sessions found. Create a new session to start."));
    return;
  }
  for (const session of trackingState.sessions) {
    container.append(renderSessionCard(session));
  }
}

function renderCandidatesView(session, candidates, referenceObs) {
  const container = $("#trackingContent");
  if (!container) return;

  const header = node("div", "view-header");
  header.append(
    node("h2", "", `Candidates for ${session.trackType} Track`),
    node("p", "", `Reference: ${session.referenceCameraId} at ${formatTimestamp(session.referenceTimestamp)}`)
  );

  const refCard = node("div", "reference-card");
  refCard.append(node("h3", "", "Reference Detection"), renderObservationDetails(referenceObs || {}, "Reference"));

  const candidatesContainer = node("div", "candidates-container");
  if (candidates.length === 0) {
    candidatesContainer.append(node("div", "empty-state", "No candidates found. Try expanding the time window or check camera coverage."));
  } else {
    for (const candidate of candidates) {
      const obs = session.observations?.find((o) => o.id === candidate.observationId);
      candidatesContainer.append(renderCandidateCard(candidate, session, obs));
    }
  }

  container.innerHTML = "";
  container.append(header, refCard, node("h3", "", `Candidates (${candidates.length})`), candidatesContainer);
}

function renderSessionDetail(session, observations, candidates, verifications) {
  const container = $("#trackingContent");
  if (!container) return;

  const header = node("div", "view-header");
  const backBtn = node("button", "btn btn-secondary btn-sm", "← Back to Sessions");
  backBtn.addEventListener("click", () => {
    trackingState.view = "list";
    trackingState.selectedSessionId = null;
    renderTrackingPage();
  });
  header.append(backBtn, node("h2", "", `${session.trackType} Track: ${session.id.slice(0, 16)}...`), node("span", `session-status ${statusClass(session.status)}`, STATUS_LABELS[session.status] || session.status));

  const tabs = node("div", "detail-tabs");
  const tabButtons = [
    { id: "timeline", label: "Timeline" },
    { id: "map", label: "Map" },
    { id: "candidates", label: `Candidates (${candidates?.length || 0})` },
    { id: "verifications", label: `Verifications (${verifications?.length || 0})` }
  ];
  for (const tab of tabButtons) {
    const btn = node("button", `tab-btn ${trackingState.detailTab === tab.id ? "active" : ""}`, tab.label);
    btn.dataset.tab = tab.id;
    btn.addEventListener("click", () => {
      trackingState.detailTab = tab.id;
      renderSessionDetail(session, observations, candidates, verifications);
    });
    tabs.append(btn);
  }

  const content = node("div", "detail-content");
  switch (trackingState.detailTab) {
    case "timeline":
      renderTimelineTab(session, observations, candidates, verifications, content);
      break;
    case "map":
      renderMapTab(session, observations, candidates, content);
      break;
    case "candidates":
      renderCandidatesTab(session, observations, candidates, content);
      break;
    case "verifications":
      renderVerificationsTab(verifications, content);
      break;
  }

  container.innerHTML = "";
  container.append(header, tabs, content);
}

function renderTimelineTab(session, observations, candidates, verifications, container) {
  const timeline = [];
  for (const obs of observations.sort((a, b) => new Date(a.detectedAt) - new Date(b.detectedAt))) {
    const cand = candidates?.find((c) => c.observationId === obs.id);
    const verification = cand ? verifications?.find((v) => v.candidateId === cand.id) : null;
    timeline.push({ obs, cand, verification, isReference: obs.detectionId === session.referenceDetectionId });
  }

  const timelineContainer = node("div", "timeline-container");
  for (const item of timeline) {
    const row = node("div", `timeline-row ${item.isReference ? "reference" : ""}`);
    const time = node("div", "timeline-time", formatTimestamp(item.obs.detectedAt));
    const camera = node("div", "timeline-camera", item.obs.cameraId);
    const status = node("div", "timeline-status");
    if (item.cand) {
      status.append(node("span", `candidate-status ${statusClass(item.cand.status)}`, CANDIDATE_STATUS_LABELS[item.cand.status] || item.cand.status));
      if (item.verification) {
        status.append(node("span", "verification-badge", `${item.verification.decision.replace("_", " ")}`));
      }
    } else if (item.isReference) {
      status.append(node("span", "reference-badge", "Reference"));
    }
    row.append(time, camera, status);
    timelineContainer.append(row);
  }
  container.append(timelineContainer);
}

function renderMapTab(session, observations, candidates, container) {
  container.innerHTML = '<div id="trackingMap" class="tracking-map" style="height: 500px;"></div>';
  setTimeout(() => {
    try {
      initTrackingMap(session, observations, candidates);
    } catch (e) {
      console.warn("Map init failed:", e);
    }
  }, 100);
}

function renderCandidatesTab(session, observations, candidates, container) {
  if (!candidates?.length) {
    container.append(node("div", "empty-state", "No candidates. Run a search first."));
    return;
  }
  const list = node("div", "candidates-list");
  for (const candidate of candidates) {
    const obs = observations.find((o) => o.id === candidate.observationId);
    list.append(renderCandidateCard(candidate, session, obs));
  }
  container.append(list);
}

function renderVerificationsTab(verifications, container) {
  if (!verifications?.length) {
    container.append(node("div", "empty-state", "No verifications yet."));
    return;
  }
  const list = node("div", "verifications-list");
  for (const v of verifications) {
    const row = node("div", "verification-row");
    row.append(
      node("span", "", formatTimestamp(v.createdAt)),
      node("span", `verification-decision ${statusClass(v.decision)}`, v.decision.replace("_", " ")),
      node("span", "", `AI Confidence: ${Math.round(v.aiConfidence * 100)}%`),
      node("span", "", v.reason || "—")
    );
    list.append(row);
  }
  container.append(list);
}

function renderComparisonView(session, candidate, observation, referenceObs) {
  const container = $("#trackingContent");
  if (!container) return;

  const header = node("div", "view-header");
  const backBtn = node("button", "btn btn-secondary btn-sm", "← Back to Candidates");
  backBtn.addEventListener("click", () => {
    trackingState.view = "candidates";
    handleSelectSession(session.id);
  });
  header.append(backBtn, node("h2", "", "Side-by-Side Comparison"), node("span", `candidate-confidence ${confidenceColor(candidate.overallConfidence)}`, `${Math.round(candidate.overallConfidence * 100)}% Overall`));

  const comparison = node("div", "comparison-container");
  const left = node("div", "comparison-pane reference");
  left.append(node("h3", "", "Reference Detection"), renderObservationDetails(referenceObs || {}, "Reference", true));

  const right = node("div", "comparison-pane candidate");
  right.append(node("h3", "", `Candidate: ${candidate.cameraId}`), renderObservationDetails(observation || {}, "Candidate"));

  const explanation = node("div", "comparison-explanation");
  explanation.append(node("h3", "", "Match Explanation"), createScoreBreakdown(candidate.matchExplanation || {}));

  const actions = node("div", "comparison-actions");
  const confirmBtn = node("button", "btn btn-success btn-lg", "Confirm Match");
  confirmBtn.addEventListener("click", async () => {
    await handleVerifyCandidate(session.id, candidate.id, "CONFIRM_MATCH", "Confirmed via side-by-side review");
  });
  const rejectBtn = node("button", "btn btn-danger btn-lg", "Reject Match");
  rejectBtn.addEventListener("click", async () => {
    const reason = prompt("Reason for rejection:");
    await handleVerifyCandidate(session.id, candidate.id, "REJECT_MATCH", reason);
  });
  const uncertainBtn = node("button", "btn btn-warning btn-lg", "Uncertain");
  uncertainBtn.addEventListener("click", async () => {
    const reason = prompt("Reason for uncertainty:");
    await handleVerifyCandidate(session.id, candidate.id, "UNCERTAIN", reason);
  });
  actions.append(confirmBtn, rejectBtn, uncertainBtn);

  comparison.append(left, right, explanation, actions);
  container.innerHTML = "";
  container.append(header, comparison);
}

function initTrackingMap(session, observations, candidates) {
  if (typeof L === "undefined") return;
  const mapEl = document.getElementById("trackingMap");
  if (!mapEl) return;
  if (mapEl._leafletMap) return;

  const map = L.map(mapEl).setView([17.5109, 78.3276], 13);
  mapEl._leafletMap = map;
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  const confirmedCandidates = candidates?.filter((c) => c.status === "CONFIRMED") || [];
  const confirmedObsIds = new Set(confirmedCandidates.map((c) => c.observationId));
  const trackObs = observations.filter((o) => o.detectionId === session.referenceDetectionId || confirmedObsIds.has(o.id))
    .sort((a, b) => new Date(a.detectedAt) - new Date(b.detectedAt));

  const points = [];
  for (const obs of trackObs) {
    const cam = getCameraSources().find((c) => c.id === obs.cameraId);
    if (cam?.latitude && cam?.longitude) {
      points.push({ lat: cam.latitude, lng: cam.longitude, cameraId: cam.id, cameraName: cam.name || cam.cameraId, time: obs.detectedAt });
    }
  }

  if (points.length >= 2) {
    const latlngs = points.map((p) => [p.lat, p.lng]);
    L.polyline(latlngs, { color: "#3388ff", weight: 3, opacity: 0.7, dashArray: "10, 10" }).addTo(map);
  }

  for (const [i, point] of points.entries()) {
    const isReference = i === 0;
    const isLast = i === points.length - 1;
    const marker = L.circleMarker([point.lat, point.lng], {
      radius: isReference ? 10 : isLast ? 10 : 8,
      color: isReference ? "#0066cc" : isLast ? "#cc0000" : "#00aa00",
      fillColor: isReference ? "#3388ff" : isLast ? "#ff3333" : "#33cc33",
      fillOpacity: 0.9,
      weight: 2
    }).addTo(map);
    marker.bindPopup(`<b>${point.cameraName}</b><br>${formatTimestamp(point.time)}<br>${isReference ? "Reference" : isLast ? "Last Seen" : "Track Point"}`);
  }

  if (points.length > 0) {
    const group = new L.featureGroup(points.map((p) => L.marker([p.lat, p.lng])));
    map.fitBounds(group.getBounds().pad(0.1));
  }
}

function createTrackingSessionModal() {
  const modal = node("div", "modal-overlay", "");
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 600px;">
      <h2>Create Tracking Session</h2>
      <form id="createTrackingForm">
        <div class="form-group">
          <label>Track Type</label>
          <select name="trackType" required>
            <option value="PERSON">Person</option>
            <option value="VEHICLE">Vehicle</option>
          </select>
        </div>
        <div class="form-group">
          <label>Reference Camera</label>
          <select name="referenceCameraId" required></select>
        </div>
        <div class="form-group">
          <label>Reference Detection ID</label>
          <input name="referenceDetectionId" type="text" required placeholder="e.g., det_abc123">
        </div>
        <div class="form-group">
          <label>Reference Timestamp</label>
          <input name="referenceTimestamp" type="datetime-local" required>
        </div>
        <div class="form-group">
          <label>Incident ID (optional)</label>
          <input name="incidentId" type="text" placeholder="Link to incident">
        </div>
        <div class="form-group">
          <label>Alert ID (optional)</label>
          <input name="alertId" type="text" placeholder="Link to alert">
        </div>
        <div class="form-group">
          <label>Evidence ID (optional)</label>
          <input name="evidenceId" type="text" placeholder="Link to evidence">
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="cancelCreateTracking">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Session</button>
        </div>
      </form>
    </div>
  `;

  const cameraSelect = modal.querySelector("[name=referenceCameraId]");
  const cameras = getCameraSources();
  for (const cam of cameras) {
    const opt = document.createElement("option");
    opt.value = cam.id;
    opt.textContent = `${cam.cameraId || cam.id} - ${cam.name || cam.zone || "Unknown"}`;
    cameraSelect.append(opt);
  }

  const timestampInput = modal.querySelector("[name=referenceTimestamp]");
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  timestampInput.value = now.toISOString().slice(0, 16);

  const form = modal.querySelector("#createTrackingForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    data.referenceTimestamp = new Date(data.referenceTimestamp).toISOString();
    if (!data.incidentId) delete data.incidentId;
    if (!data.alertId) delete data.alertId;
    if (!data.evidenceId) delete data.evidenceId;

    try {
      const result = await trackingApi.createSession(data);
      document.body.removeChild(modal);
      await loadSessions();
    } catch (error) {
      alert(`Failed to create session: ${error.message}`);
    }
  });

  modal.querySelector("#cancelCreateTracking").addEventListener("click", () => document.body.removeChild(modal));
  modal.addEventListener("click", (e) => { if (e.target === modal) document.body.removeChild(modal); });
  document.body.append(modal);
}

function setupRealtimeListeners() {
  trackingState.unsubscribers.forEach((unsub) => unsub());
  trackingState.unsubscribers = [];

  trackingState.unsubscribers.push(
    onRealtime("tracking_session_created", ({ session }) => {
      trackingState.sessions.unshift(session);
      if (trackingState.view === "list") renderSessionsList();
    })
  );
  trackingState.unsubscribers.push(
    onRealtime("tracking_candidates_found", ({ sessionId, candidates }) => {
      if (trackingState.selectedSessionId === sessionId && trackingState.view === "candidates") {
        const session = trackingState.sessions.find((s) => s.id === sessionId);
        if (session) renderCandidatesView(session, candidates, session.observations?.[0]);
      }
    })
  );
  trackingState.unsubscribers.push(
    onRealtime("tracking_candidate_verified", ({ sessionId, candidateId, decision }) => {
      if (trackingState.selectedSessionId === sessionId) {
        handleSelectSession(sessionId);
      }
    })
  );
  trackingState.unsubscribers.push(
    onRealtime("tracking_session_closed", ({ sessionId }) => {
      trackingState.sessions = trackingState.sessions.filter((s) => s.id !== sessionId);
      if (trackingState.view === "list") renderSessionsList();
      if (trackingState.selectedSessionId === sessionId) {
        trackingState.view = "list";
        trackingState.selectedSessionId = null;
        renderTrackingPage();
      }
    })
  );
}

export function renderTrackingPage() {
  const panel = $("#multiCameraTrackingPanel");
  if (!panel) return;

  trackingState.view = "list";
  trackingState.detailTab = "timeline";

  panel.innerHTML = `
    <div class="tracking-header">
      <h1>Multi-Camera Tracking</h1>
      <div class="tracking-filters">
        <select id="filterTrackType"><option value="all">All Types</option><option value="PERSON">Person</option><option value="VEHICLE">Vehicle</option></select>
        <select id="filterStatus"><option value="all">All Status</option><option value="SEARCHING">Searching</option><option value="CANDIDATE_FOUND">Candidates Found</option><option value="HUMAN_REVIEW">Human Review</option><option value="CONFIRMED">Confirmed</option><option value="REJECTED">Rejected</option><option value="CLOSED">Closed</option></select>
        <button class="btn btn-primary" id="createTrackingBtn">+ New Tracking Session</button>
      </div>
    </div>
    <div class="tracking-layout">
      <aside class="tracking-sidebar" id="trackingSidebar">
        <div class="sidebar-header">Active Tracks</div>
        <div id="trackingSessionsList" class="sessions-list"></div>
      </aside>
      <main class="tracking-main" id="trackingContent">
        <div class="empty-state">Select a tracking session or create a new one.</div>
      </main>
    </div>
  `;

  const filterTrackType = $("#filterTrackType");
  const filterStatus = $("#filterStatus");
  filterTrackType.value = trackingState.filters.trackType;
  filterStatus.value = trackingState.filters.status;
  filterTrackType.addEventListener("change", async () => {
    trackingState.filters.trackType = filterTrackType.value;
    await loadSessions();
  });
  filterStatus.addEventListener("change", async () => {
    trackingState.filters.status = filterStatus.value;
    await loadSessions();
  });

  $("#createTrackingBtn").addEventListener("click", createTrackingSessionModal);

  setupRealtimeListeners();
  loadSessions();
}

export function cleanupTracking() {
  trackingState.unsubscribers.forEach((unsub) => unsub());
  trackingState.unsubscribers = [];
  const panel = $("#multiCameraTrackingPanel");
  if (panel) panel.replaceChildren();
}
