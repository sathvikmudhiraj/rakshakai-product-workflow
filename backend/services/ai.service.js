const ALLOWED_THREAT_TYPES = new Set([
  "weapon_detected",
  "fire_smoke",
  "violence_detected",
  "suspicious_activity",
  "theft_attempt",
  "restricted_zone_entry",
  "missing_person_possible_match",
  "missing_object_possible_match",
  "abandoned_object",
  "suspicious_object",
  "damaged_object_possible",
  "missing_object_damaged_possible_match",
  "person_detected",
  "vehicle_detected",
  "object_detected",
  "no_threat"
]);

const ACTIONABLE_THREAT_TYPES = new Set([
  "weapon_detected",
  "fire_smoke",
  "violence_detected",
  "suspicious_activity",
  "theft_attempt",
  "restricted_zone_entry",
  "missing_person_possible_match",
  "missing_object_possible_match",
  "abandoned_object",
  "suspicious_object",
  "damaged_object_possible",
  "missing_object_damaged_possible_match"
]);

const THRESHOLDS = Object.freeze({
  default: 0.75,
  weapon_detected: 0.70,
  fire_smoke: 0.70,
  violence_detected: 0.70,
  suspicious_activity: 0.80,
  theft_attempt: 0.80,
  restricted_zone_entry: 0.80,
  missing_person_possible_match: 0.85,
  missing_object_possible_match: 0.85,
  abandoned_object: 0.85,
  suspicious_object: 0.85,
  damaged_object_possible: 0.85,
  missing_object_damaged_possible_match: 0.85
});

const SAFE_NOT_CONFIGURED = Object.freeze({
  configured: false,
  threatDetected: false,
  threatType: "no_threat",
  confidence: 0,
  severity: "low",
  detections: [],
  activity: null,
  personMatch: null,
  objectMatch: null,
  objectCondition: null,
  alertClassification: "observation",
  performance: null,
  vehicleAnalysis: [],
  personAnalysis: [],
  objectAnalysis: [],
  personIdentity: { identified: false, status: "unsupported" },
  duplicateSuppressed: false,
  message: "AI service is not connected"
});

function serviceUrl() {
  return String(process.env.AI_SERVICE_URL || "").trim().replace(/\/+$/, "");
}

function serviceHeaders() {
  const apiKey = String(process.env.AI_SERVICE_API_KEY || "").trim();
  if (!apiKey) return {};
  return { "X-API-Key": apiKey };
}

function confidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const normalized = parsed > 1 ? parsed / 100 : parsed;
  return Math.max(0, Math.min(1, normalized));
}

function normalizedThreatType(value) {
  const type = String(value || "").trim().toLowerCase();
  return ALLOWED_THREAT_TYPES.has(type) ? type : "no_threat";
}

function normalizedBox(box) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const values = box.map(Number);
  return values.every(Number.isFinite) ? values : null;
}

function normalizeObjectCondition(value, score) {
  if (!value || typeof value !== "object") return null;
  const status = ["normal", "possibly_damaged", "unknown"].includes(String(value.status || "").toLowerCase())
    ? String(value.status).toLowerCase()
    : "unknown";
  const damageLevel = ["minor", "partial", "severe"].includes(String(value.damageLevel || "").toLowerCase())
    ? String(value.damageLevel).toLowerCase()
    : null;
  return {
    status,
    damageLevel,
    confidence: confidence(value.confidence ?? score),
    verification: "human_verification_required"
  };
}

function safeText(value, length = 120) {
  return String(value || "").trim().slice(0, length);
}

function normalizeSize(value) {
  if (!value || typeof value !== "object") return null;
  const width = Number(value.width);
  const height = Number(value.height);
  const area = Number(value.area);
  if (![width, height, area].every(Number.isFinite)) return null;
  return { width: Math.max(0, width), height: Math.max(0, height), area: Math.max(0, area) };
}

function normalizePlate(value) {
  if (!value || typeof value !== "object") {
    return { detected: false, text: null, confidence: 0, status: "plate OCR unavailable", verification: "human_verification_required" };
  }
  return {
    detected: Boolean(value.detected),
    text: safeText(value.text, 20) || null,
    confidence: confidence(value.confidence),
    status: safeText(value.status, 100) || "plate OCR unavailable",
    verification: "human_verification_required"
  };
}

function normalizePerformance(value) {
  if (!value || typeof value !== "object") return null;
  return {
    inferenceMs: Math.max(0, Number(value.inferenceMs) || 0),
    analyzedAt: Number.isNaN(Date.parse(value.analyzedAt)) ? null : new Date(value.analyzedAt).toISOString(),
    imageWidth: Math.max(0, Number(value.imageWidth) || 0),
    imageHeight: Math.max(0, Number(value.imageHeight) || 0),
    device: safeText(value.device, 30) || null
  };
}

function normalizeResponse(raw = {}) {
  const claimedThreat = Boolean(raw.threatDetected ?? raw.threat ?? raw.detected);
  const threatType = normalizedThreatType(raw.threatType || raw.type || raw.label);
  const threatDetected = claimedThreat && threatType !== "no_threat";
  const score = confidence(raw.confidence ?? raw.score);
  const detections = Array.isArray(raw.detections)
    ? raw.detections.slice(0, 100).map((item) => ({
      label: String(item?.label || "unknown").slice(0, 80),
      confidence: confidence(item?.confidence ?? item?.score),
      box: normalizedBox(item?.box),
      approximateSizePixels: normalizeSize(item?.approximateSizePixels),
      dominantColor: safeText(item?.dominantColor, 40) || "unknown",
      shape: ["rectangular", "circular/oval", "unknown"].includes(item?.shape) ? item.shape : "unknown",
      timestamp: Number.isNaN(Date.parse(item?.timestamp)) ? null : new Date(item.timestamp).toISOString(),
      duplicateSuppressed: Boolean(item?.duplicateSuppressed)
    })).filter((item) => item.box || item.label !== "unknown")
    : [];
  const activity = raw.activity && typeof raw.activity === "object"
    ? {
      label: String(raw.activity.label || "").slice(0, 80),
      confidence: confidence(raw.activity.confidence)
    }
    : null;
  const possibleMatch = threatType === "missing_person_possible_match"
    && Boolean(raw.personMatch?.possibleMatch);
  const personMatch = possibleMatch
    ? {
      possibleMatch: true,
      missingPersonId: String(raw.personMatch?.missingPersonId || "").slice(0, 120) || null,
      confidence: confidence(raw.personMatch?.confidence ?? score),
      status: "human_verification_required"
    }
    : null;
  const possibleObjectMatch = [
    "missing_object_possible_match",
    "missing_object_damaged_possible_match"
  ].includes(threatType)
    && Boolean(raw.objectMatch?.possibleMatch);
  const objectMatch = possibleObjectMatch
    ? {
      possibleMatch: true,
      missingObjectId: String(raw.objectMatch?.missingObjectId || "").slice(0, 120) || null,
      confidence: confidence(raw.objectMatch?.confidence ?? score),
      status: "human_verification_required",
      label: String(raw.objectMatch?.label || "").slice(0, 120) || null
    }
    : null;
  const damageThreat = ["damaged_object_possible", "missing_object_damaged_possible_match"].includes(threatType);
  const objectCondition = normalizeObjectCondition(raw.objectCondition, score)
    || (damageThreat
      ? {
        status: "possibly_damaged",
        damageLevel: null,
        confidence: score,
        verification: "human_verification_required"
      }
      : null);
  const policySeverity = severityFor(threatType, score);
  const severity = [
    "damaged_object_possible",
    "missing_object_damaged_possible_match",
    "missing_object_possible_match",
    "missing_person_possible_match",
    "abandoned_object",
    "suspicious_object",
    "object_detected",
    "person_detected",
    "vehicle_detected"
  ].includes(threatType)
    ? policySeverity
    : ["critical", "high", "medium", "low"].includes(String(raw.severity || "").toLowerCase())
      ? String(raw.severity).toLowerCase()
      : policySeverity;
  const message = possibleMatch
    ? "Possible missing person match detected. Human verification required."
    : threatType === "missing_object_damaged_possible_match"
      ? "Possible missing object match detected with possible damage. Human verification required."
      : possibleObjectMatch
        ? "Possible missing object match detected. Human verification required."
        : threatType === "damaged_object_possible"
        ? "Object detected with possible damage. Human verification required."
          : String(raw.message || (threatType === "object_detected"
              ? "Object detected"
              : threatDetected ? "AI detection received" : "No threat detected")).slice(0, 500);
  const vehicleAnalysis = Array.isArray(raw.vehicleAnalysis) ? raw.vehicleAnalysis.slice(0, 30).map((item) => ({
    vehicleType: safeText(item?.vehicleType, 60) || "unknown",
    dominantColor: safeText(item?.dominantColor, 40) || "unknown",
    vehicleModel: "unsupported",
    plate: normalizePlate(item?.plate),
    confidence: confidence(item?.confidence),
    box: normalizedBox(item?.box),
    verification: "human_verification_required"
  })) : [];
  const personAnalysis = Array.isArray(raw.personAnalysis) ? raw.personAnalysis.slice(0, 30).map((item) => ({
    trackingId: safeText(item?.trackingId, 60) || null,
    upperClothingColor: safeText(item?.upperClothingColor, 40) || "unknown",
    lowerClothingColor: safeText(item?.lowerClothingColor, 40) || "unknown",
    boundingBoxHeightPixels: Math.max(0, Number(item?.boundingBoxHeightPixels) || 0),
    carryingBag: ["yes", "no", "unknown"].includes(item?.carryingBag) ? item.carryingBag : "unknown",
    ridingVehicle: ["yes", "no", "unknown"].includes(item?.ridingVehicle) ? item.ridingVehicle : "unknown",
    identity: "not_inferred",
    message: "Person description is approximate and requires human verification.",
    box: normalizedBox(item?.box)
  })) : [];
  const objectAnalysis = Array.isArray(raw.objectAnalysis) ? raw.objectAnalysis.slice(0, 50).map((item) => ({
    label: safeText(item?.label, 80) || "unknown",
    confidence: confidence(item?.confidence),
    box: normalizedBox(item?.box),
    approximateSizePixels: normalizeSize(item?.approximateSizePixels),
    dominantColor: safeText(item?.dominantColor, 40) || "unknown",
    shape: ["rectangular", "circular/oval", "unknown"].includes(item?.shape) ? item.shape : "unknown",
    timestamp: Number.isNaN(Date.parse(item?.timestamp)) ? null : new Date(item.timestamp).toISOString()
  })) : [];
  const alertClassification = severity === "critical" ? "critical"
    : severity === "high" ? "warning"
      : severity === "medium" ? "watch"
        : "observation";

  return {
    configured: true,
    threatDetected,
    threatType,
    confidence: score,
    severity,
    detections,
    activity,
    personMatch,
    objectMatch,
    objectCondition,
    alertClassification,
    performance: normalizePerformance(raw.performance),
    vehicleAnalysis,
    personAnalysis,
    objectAnalysis,
    personIdentity: {
      identified: false,
      status: "unsupported",
      message: "Person identity is not inferred. Investigation-assist only; human review required."
    },
    duplicateSuppressed: Boolean(raw.duplicateSuppressed),
    message
  };
}

function thresholdFor(threatType) {
  return THRESHOLDS[threatType] ?? THRESHOLDS.default;
}

function severityFor(threatType, score) {
  if (["person_detected", "vehicle_detected", "object_detected"].includes(threatType)) return "low";
  if (threatType === "damaged_object_possible") return score >= 0.90 ? "high" : "medium";
  if (threatType === "missing_object_damaged_possible_match") return "high";
  if ([
    "missing_person_possible_match",
    "missing_object_possible_match",
    "abandoned_object",
    "suspicious_object"
  ].includes(threatType)) return "high";
  if (["weapon_detected", "fire_smoke", "violence_detected"].includes(threatType)) {
    return score >= 0.90 ? "critical" : "high";
  }
  if (score >= 0.90) return "critical";
  if (score >= 0.80) return "high";
  if (score >= 0.75) return "medium";
  return "low";
}

function evaluateResult(result) {
  const threshold = thresholdFor(result.threatType);
  const actionable = result.configured
    && result.threatDetected
    && ACTIONABLE_THREAT_TYPES.has(result.threatType)
    && result.confidence >= threshold;
  let reason = "no_threat";
  if (result.threatType !== "no_threat" && !ACTIONABLE_THREAT_TYPES.has(result.threatType)) reason = "non_actionable_detection";
  if (result.threatDetected && result.confidence < threshold) reason = "below_threshold";
  if (actionable) reason = "actionable";
  return { ...result, threshold, actionable, reason };
}

async function requestJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error("AI service returned invalid JSON");
    }
    if (!response.ok) throw new Error(data.error || `AI service returned HTTP ${response.status}`);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("AI service returned an invalid response");
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("AI service request timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function analyzeFrame(payload) {
  const baseUrl = serviceUrl();
  if (!baseUrl) return { ...SAFE_NOT_CONFIGURED };
  try {
    const raw = await requestJson(`${baseUrl}/analyze-frame`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...serviceHeaders()
      },
      body: JSON.stringify(payload)
    }, Number(process.env.AI_SERVICE_TIMEOUT_MS || 8000));
    return normalizeResponse(raw);
  } catch (error) {
    return {
      configured: true,
      threatDetected: false,
      threatType: "no_threat",
      confidence: 0,
      severity: "low",
      detections: [],
      activity: null,
      personMatch: null,
      objectMatch: null,
      objectCondition: null,
      alertClassification: "observation",
      performance: null,
      vehicleAnalysis: [],
      personAnalysis: [],
      objectAnalysis: [],
      personIdentity: { identified: false, status: "unsupported" },
      duplicateSuppressed: false,
      message: "AI service is temporarily unreachable",
      serviceError: error.message
    };
  }
}

async function health() {
  const baseUrl = serviceUrl();
  const timestamp = new Date().toISOString();
  if (!baseUrl) {
    return { configured: false, serviceUrl: "not_configured", status: "not_configured", timestamp };
  }
  try {
    await requestJson(`${baseUrl}/health`, {
      method: "GET",
      headers: { ...serviceHeaders() }
    }, Number(process.env.AI_HEALTH_TIMEOUT_MS || 3000));
    return { configured: true, serviceUrl: "configured", status: "connected", timestamp };
  } catch {
    return { configured: true, serviceUrl: "configured", status: "unreachable", timestamp };
  }
}

module.exports = {
  ACTIONABLE_THREAT_TYPES,
  SAFE_NOT_CONFIGURED,
  THRESHOLDS,
  analyzeFrame,
  evaluateResult,
  health,
  normalizeResponse,
  severityFor,
  thresholdFor
};
