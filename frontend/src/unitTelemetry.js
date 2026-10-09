export const UNIT_TELEMETRY_MIN_INTERVAL_MS = 5000;
export const UNIT_TELEMETRY_MAX_INTERVAL_MS = 15000;
export const UNIT_TELEMETRY_MIN_MOVEMENT_METERS = 10;

function radians(value) {
  return Number(value) * Math.PI / 180;
}

export function movementMeters(from, to) {
  if (!from || !to) return Infinity;
  const earthRadius = 6371000;
  const latDelta = radians(to.lat - from.lat);
  const lngDelta = radians(to.lng - from.lng);
  const startLat = radians(from.lat);
  const endLat = radians(to.lat);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(startLat) * Math.cos(endLat) * Math.sin(lngDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function shouldTransmitUnitTelemetry({ lastSent = null, point, nowMs = Date.now() } = {}) {
  if (!point) return false;
  if (!lastSent?.point || !Number.isFinite(lastSent.sentAt)) return true;
  const elapsed = Math.max(0, nowMs - lastSent.sentAt);
  if (elapsed >= UNIT_TELEMETRY_MAX_INTERVAL_MS) return true;
  return elapsed >= UNIT_TELEMETRY_MIN_INTERVAL_MS
    && movementMeters(lastSent.point, point) >= UNIT_TELEMETRY_MIN_MOVEMENT_METERS;
}

export function unitTelemetryPayload(point) {
  return {
    latitude: point.lat,
    longitude: point.lng,
    accuracy: point.accuracy,
    capturedAt: point.capturedAt,
    speed: point.speed,
    heading: point.heading,
    altitude: point.altitude
  };
}

export function unitTelemetryRenderFingerprint(units = [], summary = {}) {
  const normalizedUnits = units
    .map((unit = {}) => {
      const { locationAgeSeconds, locationAgeMinutes, ...stableUnit } = unit;
      const ageSeconds = Number(locationAgeSeconds);
      return {
        ...stableUnit,
        locationAgeBucketMinutes: Number.isFinite(ageSeconds) ? Math.floor(ageSeconds / 60) : null
      };
    })
    .sort((left, right) => String(left.id || left.unitId || "").localeCompare(String(right.id || right.unitId || "")));
  return JSON.stringify({ summary, units: normalizedUnits });
}
