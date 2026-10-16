const UNIT_GPS_FRESH_MS = 2 * 60 * 1000;
const UNIT_GPS_MAX_OBSERVATION_AGE_MS = 5 * 60 * 1000;
const UNIT_GPS_MAX_FUTURE_SKEW_MS = 60 * 1000;
const UNIT_GPS_MAX_DISPATCH_ACCURACY_METERS = 100;

function telemetryError(message, status = 400, code = "INVALID_UNIT_TELEMETRY") {
  return Object.assign(new Error(message), { status, code });
}

function finiteNumber(value, field, { required = false, min = -Infinity, max = Infinity } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw telemetryError(`${field} is required`);
    return null;
  }
  if (typeof value === "boolean" || !Number.isFinite(Number(value))) {
    throw telemetryError(`${field} must be a finite number`);
  }
  const number = Number(value);
  if (number < min || number > max) throw telemetryError(`${field} is outside the allowed range`);
  return number;
}

function telemetryPoint(record = {}) {
  const latitude = finiteNumber(record.latitude ?? record.lat, "latitude", { min: -90, max: 90 });
  const longitude = finiteNumber(record.longitude ?? record.lng, "longitude", { min: -180, max: 180 });
  return latitude === null || longitude === null ? null : { latitude, longitude };
}

function validateUnitTelemetry(payload = {}, {
  nowMs = Date.now(),
  previousCapturedAt = null
} = {}) {
  const latitude = finiteNumber(payload.latitude ?? payload.lat, "latitude", { required: true, min: -90, max: 90 });
  const longitude = finiteNumber(payload.longitude ?? payload.lng, "longitude", { required: true, min: -180, max: 180 });
  const accuracy = finiteNumber(payload.accuracy, "accuracy", { required: true, min: 0, max: 100000 });
  const speed = finiteNumber(payload.speed, "speed", { min: 0, max: 200 });
  const heading = finiteNumber(payload.heading, "heading", { min: 0, max: 360 });
  const altitude = finiteNumber(payload.altitude, "altitude", { min: -1000, max: 20000 });
  const capturedMs = Date.parse(String(payload.capturedAt || ""));
  if (!Number.isFinite(capturedMs)) throw telemetryError("capturedAt must be a valid ISO timestamp");
  if (capturedMs > nowMs + UNIT_GPS_MAX_FUTURE_SKEW_MS) {
    throw telemetryError("capturedAt is implausibly in the future", 400, "GPS_TIMESTAMP_IN_FUTURE");
  }
  if (capturedMs < nowMs - UNIT_GPS_MAX_OBSERVATION_AGE_MS) {
    throw telemetryError("GPS observation is too old", 409, "GPS_OBSERVATION_TOO_OLD");
  }
  const previousMs = Date.parse(String(previousCapturedAt || ""));
  if (Number.isFinite(previousMs) && capturedMs <= previousMs) {
    throw telemetryError("GPS observation was already received or is older than the current unit location", 409, "GPS_OBSERVATION_REPLAYED");
  }
  return {
    latitude,
    longitude,
    accuracy,
    capturedAt: new Date(capturedMs).toISOString(),
    receivedAt: new Date(nowMs).toISOString(),
    speed,
    heading,
    altitude
  };
}

function unitTelemetryFreshness(unit = {}, at = Date.now()) {
  let point = null;
  try {
    point = telemetryPoint(unit);
  } catch {
    point = null;
  }
  const timestamp = unit.locationCapturedAt || unit.lastLocationUpdatedAt || unit.lastUpdated;
  const capturedMs = Date.parse(String(timestamp || ""));
  if (!point || !Number.isFinite(capturedMs)) {
    return { state: "UNAVAILABLE", label: "Unavailable", ageMs: null, ageSeconds: null, ageMinutes: null, eligible: false };
  }
  const ageMs = Math.max(0, at - capturedMs);
  const fresh = ageMs <= UNIT_GPS_FRESH_MS;
  return {
    state: fresh ? "FRESH" : "STALE",
    label: fresh ? "Live" : "Stale",
    ageMs,
    ageSeconds: Math.floor(ageMs / 1000),
    ageMinutes: Number((ageMs / 60000).toFixed(1)),
    eligible: fresh
  };
}

function unitTelemetryDispatchQuality(unit = {}, at = Date.now()) {
  const freshness = unitTelemetryFreshness(unit, at);
  if (!freshness.eligible) return { ...freshness, eligible: false, reason: freshness.state === "STALE" ? "STALE GPS" : "NO GPS" };
  const source = String(unit.locationSource || unit.source || "").toLowerCase();
  if (source !== "live_gps") return { ...freshness, eligible: false, reason: "UNTRUSTED LOCATION SOURCE" };
  const rawAccuracy = unit.locationAccuracy ?? unit.accuracy;
  const accuracy = rawAccuracy === null || rawAccuracy === undefined || rawAccuracy === "" ? NaN : Number(rawAccuracy);
  if (!Number.isFinite(accuracy) || accuracy < 0) return { ...freshness, eligible: false, reason: "GPS INVALID" };
  if (accuracy > UNIT_GPS_MAX_DISPATCH_ACCURACY_METERS) {
    return { ...freshness, eligible: false, reason: `GPS ACCURACY EXCEEDS ${UNIT_GPS_MAX_DISPATCH_ACCURACY_METERS}M` };
  }
  return { ...freshness, eligible: true, accuracy, reason: "LIVE" };
}

function authorizedTelemetryUnitIds(user, db = {}) {
  if (!user || user.role !== "Police Officer" || user.status === "inactive") return [];
  const officer = (db.policeOfficers || []).find((item) => (item.userId || item.user_id || item.id) === user.id);
  if (officer && officer.active === false) return [];
  const memberships = (db.responseUnitMembers || [])
    .filter((member) => (member.officerUserId || member.officer_user_id) === user.id)
    .map((member) => member.unitId || member.unit_id)
    .filter(Boolean);
  const legacyUnitId = String(user.unitId || "").trim();
  if (legacyUnitId) memberships.push(legacyUnitId);
  const availableIds = new Set((db.responseUnits || []).flatMap((unit) => [unit.id, unit.unitId, unit.unitCode].filter(Boolean)));
  return [...new Set(memberships)].filter((unitId) => availableIds.has(unitId));
}

function isUserAuthorizedForUnit(user, unit, db) {
  if (!unit) return false;
  const allowed = new Set(authorizedTelemetryUnitIds(user, db));
  return [unit.id, unit.unitId, unit.unitCode].some((identifier) => identifier && allowed.has(identifier));
}

module.exports = {
  UNIT_GPS_FRESH_MS,
  UNIT_GPS_MAX_OBSERVATION_AGE_MS,
  UNIT_GPS_MAX_FUTURE_SKEW_MS,
  UNIT_GPS_MAX_DISPATCH_ACCURACY_METERS,
  authorizedTelemetryUnitIds,
  isUserAuthorizedForUnit,
  telemetryPoint,
  unitTelemetryDispatchQuality,
  unitTelemetryFreshness,
  validateUnitTelemetry
};
