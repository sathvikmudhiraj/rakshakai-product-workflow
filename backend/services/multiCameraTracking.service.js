const crypto = require("node:crypto");
const { query, withTransaction, getDatabaseMode } = require("./postgres.service");
const trackingSessionsRepository = require("../repositories/trackingSessions.repository");
const trackingObservationsRepository = require("../repositories/trackingObservations.repository");
const trackingCandidatesRepository = require("../repositories/trackingCandidates.repository");
const trackingVerificationsRepository = require("../repositories/trackingVerifications.repository");
const cameraAdjacencyRepository = require("../repositories/cameraAdjacency.repository");
const trackingScoreConfigRepository = require("../repositories/trackingScoreConfig.repository");
const cameraSourcesRepository = require("../repositories/cameraSources.repository");
const cameraHealthEventsRepository = require("../repositories/cameraHealthEvents.repository");
const auditLogsRepository = require("../repositories/auditLogs.repository");
const { addAuditLog } = require("./core.service");
const realtimeEvents = require("./realtimeEvents.service");

const TRACK_TYPES = Object.freeze({ PERSON: "PERSON", VEHICLE: "VEHICLE" });
const SESSION_STATUSES = Object.freeze(["SEARCHING", "CANDIDATE_FOUND", "HUMAN_REVIEW", "CONFIRMED", "REJECTED", "CLOSED"]);
const CANDIDATE_STATUSES = Object.freeze(["PENDING_REVIEW", "CONFIRMED", "REJECTED", "UNCERTAIN"]);
const VERIFICATION_DECISIONS = Object.freeze(["CONFIRM_MATCH", "REJECT_MATCH", "UNCERTAIN"]);
const VEHICLE_TYPES = Object.freeze(["CAR", "SUV", "BIKE", "AUTO", "BUS", "TRUCK", "VAN", "OTHER", "unknown"]);
const MOVEMENT_STATES = Object.freeze(["STANDING", "WALKING", "FAST_WALKING", "RUNNING", "UNKNOWN"]);

const DEFAULT_PERSON_WEIGHTS = Object.freeze({
  appearance: 0.35,
  spatial: 0.20,
  timing: 0.20,
  direction: 0.10,
  activity: 0.05,
  gait: 0.10
});

const DEFAULT_VEHICLE_WEIGHTS = Object.freeze({
  plate: 0.35,
  appearance: 0.15,
  color: 0.10,
  vehicleType: 0.10,
  brandModel: 0.05,
  distinctiveMarks: 0.05,
  spatial: 0.10,
  route: 0.10,
  timing: 0.05,
  speed: 0.05,
  direction: 0.05
});

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function isoNow() {
  return new Date().toISOString();
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function bearingBetween(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  const bearing = toDeg(Math.atan2(y, x));
  return (bearing + 360) % 360;
}

function angleDifference(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

async function persistTrackingRecord(repository, collection, record, db) {
  if (getDatabaseMode() === "json") {
    const records = db[collection] || (db[collection] = []);
    const index = records.findIndex((item) => item.id === record.id);
    if (index >= 0) records[index] = record;
    else records.push(record);
    return;
  }
  await repository.upsert(record, db.client);
}

async function getScoreWeights(trackType, db = {}) {
  const configs = await trackingScoreConfigRepository.list(db);
  const weights = trackType === TRACK_TYPES.PERSON ? { ...DEFAULT_PERSON_WEIGHTS } : { ...DEFAULT_VEHICLE_WEIGHTS };
  for (const config of configs) {
    if (weights.hasOwnProperty(config.weightKey)) {
      weights[config.weightKey] = config.weightValue;
    }
  }
  return weights;
}

function normalizePlate(text) {
  if (!text) return "";
  return String(text).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function plateSimilarity(plate1, plate2) {
  const p1 = normalizePlate(plate1);
  const p2 = normalizePlate(plate2);
  if (!p1 || !p2) return 0;
  if (p1 === p2) return 1;
  const shorter = p1.length < p2.length ? p1 : p2;
  const longer = p1.length >= p2.length ? p1 : p2;
  if (longer.startsWith(shorter) || longer.endsWith(shorter)) {
    return 0.7 + 0.3 * (shorter.length / longer.length);
  }
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] === longer[i]) matches++;
  }
  return matches / longer.length * 0.6;
}

function colorSimilarity(color1, color2) {
  if (!color1 || !color2 || color1 === "unknown" || color2 === "unknown") return 0;
  return color1.toLowerCase() === color2.toLowerCase() ? 1 : 0;
}

function vehicleTypeSimilarity(type1, type2) {
  if (!type1 || !type2 || type1 === "unknown" || type2 === "unknown") return 0;
  return type1.toUpperCase() === type2.toUpperCase() ? 1 : 0;
}

function brandModelSimilarity(brand1, model1, conf1, brand2, model2, conf2) {
  if (!brand1 || !brand2 || brand1 === "Unknown" || brand2 === "Unknown") return 0;
  const b1 = brand1.toLowerCase();
  const b2 = brand2.toLowerCase();
  if (b1 !== b2) return 0;
  if (!model1 || !model2 || model1 === "Unknown" || model2 === "Unknown") {
    return clamp01(((conf1 || 0) + (conf2 || 0)) / 2 * 0.5);
  }
  return model1.toLowerCase() === model2.toLowerCase() ? clamp01(((conf1 || 0) + (conf2 || 0)) / 2) : 0;
}

function distinctiveMarksSimilarity(marks1, marks2) {
  if (!marks1?.length || !marks2?.length) return 0;
  const set1 = new Set(marks1.map((m) => m.toLowerCase()));
  const set2 = new Set(marks2.map((m) => m.toLowerCase()));
  let matches = 0;
  for (const mark of set1) {
    if (set2.has(mark)) matches++;
  }
  return matches / Math.max(set1.size, set2.size);
}

function clothingColorSimilarity(upper1, lower1, upper2, lower2) {
  let score = 0;
  let count = 0;
  if (upper1 && upper2 && upper1 !== "unknown" && upper2 !== "unknown") {
    score += upper1.toLowerCase() === upper2.toLowerCase() ? 1 : 0;
    count++;
  }
  if (lower1 && lower2 && lower1 !== "unknown" && lower2 !== "unknown") {
    score += lower1.toLowerCase() === lower2.toLowerCase() ? 1 : 0;
    count++;
  }
  return count > 0 ? score / count : 0;
}

function embeddingSimilarity(emb1, emb2) {
  if (!emb1 || !emb2 || !Array.isArray(emb1) || !Array.isArray(emb2) || emb1.length !== emb2.length) return 0;
  let dot = 0, norm1 = 0, norm2 = 0;
  for (let i = 0; i < emb1.length; i++) {
    dot += emb1[i] * emb2[i];
    norm1 += emb1[i] ** 2;
    norm2 += emb2[i] ** 2;
  }
  if (norm1 === 0 || norm2 === 0) return 0;
  return Math.max(0, dot / (Math.sqrt(norm1) * Math.sqrt(norm2)));
}

function gaitSimilarity(gait1, gait2) {
  return embeddingSimilarity(gait1, gait2);
}

function spatialConsistency(cam1, cam2, timeDiffSeconds, maxSpeed = 15) {
  if (!cam1?.latitude || !cam1?.longitude || !cam2?.latitude || !cam2?.longitude) return 0.5;
  const distance = haversineDistance(cam1.latitude, cam1.longitude, cam2.latitude, cam2.longitude);
  const maxPossibleDistance = maxSpeed * timeDiffSeconds;
  if (distance <= maxPossibleDistance) return 1;
  return Math.max(0, maxPossibleDistance / distance);
}

function timingConsistency(camA, camB, timeDiffSeconds, expectedMin, expectedMax) {
  if (expectedMin == null || expectedMax == null) {
    if (!camA?.latitude || !camA?.longitude || !camB?.latitude || !camB?.longitude) return 0.5;
    const distance = haversineDistance(camA.latitude, camA.longitude, camB.latitude, camB.longitude);
    const walkSpeed = 1.4;
    const runSpeed = 5;
    const vehicleSpeed = 13.9;
    const minTime = distance / vehicleSpeed;
    const maxTime = distance / walkSpeed;
    expectedMin = minTime;
    expectedMax = maxTime * 2;
  }
  if (timeDiffSeconds >= expectedMin && timeDiffSeconds <= expectedMax) return 1;
  if (timeDiffSeconds < expectedMin) return Math.max(0, timeDiffSeconds / expectedMin);
  return Math.max(0, expectedMax / timeDiffSeconds);
}

function directionConsistency(dir1, dir2, cam1, cam2) {
  if (dir1 == null || dir2 == null) {
    if (!cam1?.latitude || !cam1?.longitude || !cam2?.latitude || !cam2?.longitude) return 0.5;
    const expectedBearing = bearingBetween(cam1.latitude, cam1.longitude, cam2.latitude, cam2.longitude);
    const diff = angleDifference(dir1 ?? expectedBearing, dir2 ?? expectedBearing);
    return Math.max(0, 1 - diff / 180);
  }
  const diff = angleDifference(dir1, dir2);
  return Math.max(0, 1 - diff / 180);
}

function activityConsistency(act1, act2) {
  if (!act1 || !act2) return 0.5;
  const compatible = {
    walking: ["walking", "fast_walking", "standing", "crossing_road"],
    fast_walking: ["walking", "fast_walking", "running"],
    running: ["running", "fast_walking"],
    standing: ["standing", "walking", "looking_around"],
    looking_around: ["standing", "walking", "looking_around"],
    carrying_object: ["walking", "fast_walking", "carrying_object"],
    entering_vehicle: ["walking", "entering_vehicle", "standing"],
    leaving_vehicle: ["walking", "leaving_vehicle", "standing"],
    crossing_road: ["walking", "crossing_road"],
    approaching_gate: ["walking", "approaching_gate", "standing"],
    approaching_camera: ["walking", "approaching_camera", "standing"]
  };
  const a1 = act1.toLowerCase();
  const a2 = act2.toLowerCase();
  if (a1 === a2) return 1;
  return (compatible[a1]?.includes(a2) || compatible[a2]?.includes(a1)) ? 0.7 : 0.3;
}

function speedConsistency(speed1, speed2, timeDiffSeconds, distanceMeters) {
  if (speed1 == null || speed2 == null || distanceMeters == null || timeDiffSeconds <= 0) return 0.5;
  const avgSpeed = distanceMeters / timeDiffSeconds;
  const diff1 = Math.abs(speed1 - avgSpeed);
  const diff2 = Math.abs(speed2 - avgSpeed);
  const maxDiff = Math.max(diff1, diff2);
  return Math.max(0, 1 - maxDiff / (avgSpeed + 1));
}

function routeConsistency(cam1, cam2, dir1, dir2) {
  if (!cam1?.latitude || !cam1?.longitude || !cam2?.latitude || !cam2?.longitude) return 0.5;
  const expectedBearing = bearingBetween(cam1.latitude, cam1.longitude, cam2.latitude, cam2.longitude);
  let score = 0.5;
  if (dir1 != null) score += Math.max(0, 1 - angleDifference(dir1, expectedBearing) / 180) * 0.25;
  if (dir2 != null) score += Math.max(0, 1 - angleDifference(dir2, expectedBearing) / 180) * 0.25;
  return Math.min(1, score);
}

function adjustForCameraHealth(baseConfidence, healthStatus, healthSeverity) {
  if (!healthStatus || healthStatus === "ONLINE") return baseConfidence;
  const penalties = {
    DEGRADED: 0.05,
    LOW_FPS: 0.10,
    HIGH_LATENCY: 0.05,
    BLURRY: 0.15,
    TOO_DARK: 0.15,
    OBSTRUCTED: 0.25,
    NO_SIGNAL: 0.50,
    NO_VIDEO_FRAMES: 0.50,
    TAMPER_SUSPECTED: 0.30,
    TAMPER_CONFIRMED: 0.50,
    STORAGE_ERROR: 0.10,
    OFFLINE: 1.0,
    MAINTENANCE: 0.20
  };
  const penalty = penalties[healthStatus] || 0.1;
  const severityMultiplier = healthSeverity === "CRITICAL" ? 1.5 : healthSeverity === "HIGH" ? 1.2 : 1;
  return Math.max(0, baseConfidence - penalty * severityMultiplier);
}

async function buildCameraGraph(db) {
  const cameras = db.cameraSources || [];
  const adjacency = [];
  for (let i = 0; i < cameras.length; i++) {
    const camA = cameras[i];
    if (!camA.latitude || !camA.longitude) continue;
    for (let j = i + 1; j < cameras.length; j++) {
      const camB = cameras[j];
      if (!camB.latitude || !camB.longitude) continue;
      const distance = haversineDistance(camA.latitude, camA.longitude, camB.latitude, camB.longitude);
      if (distance > 5000) continue;
      const walkTime = distance / 1.4;
      const vehicleTime = distance / 13.9;
      adjacency.push({
        id: uid("adj"),
        cameraAId: camA.id,
        cameraBId: camB.id,
        distanceMeters: distance,
        expectedMinTravelSeconds: Math.round(vehicleTime),
        expectedMaxTravelSeconds: Math.round(walkTime * 2),
        direction: null,
        routeType: "road",
        isBidirectional: true,
        data: {}
      });
    }
  }
  return adjacency;
}

async function getAdjacentCameras(cameraId, db, maxDistance = 5000) {
  let adjacency = await cameraAdjacencyRepository.list(db);
  if (getDatabaseMode() === "json" && adjacency.length === 0) {
    adjacency = await buildCameraGraph(db);
  }
  const connected = new Set();
  for (const adj of adjacency) {
    if (adj.cameraAId === cameraId && adj.distanceMeters <= maxDistance) connected.add(adj.cameraBId);
    if (adj.cameraBId === cameraId && adj.distanceMeters <= maxDistance) connected.add(adj.cameraAId);
  }
  const cameras = (db.cameraSources || []).filter((c) => connected.has(c.id));
  return cameras;
}

async function searchCandidatesForPerson(db, session, referenceObs, timeWindowMinutes = 30) {
  const referenceTime = new Date(referenceObs.detectedAt).getTime();
  const timeWindowMs = timeWindowMinutes * 60 * 1000;
  const minTime = referenceTime - timeWindowMs;
  const maxTime = referenceTime + timeWindowMs;

  const adjCameras = await getAdjacentCameras(session.referenceCameraId, db);
  const candidateObs = [];

  for (const cam of adjCameras) {
    const observations = (db.trackingObservations || []).filter(
      (o) => o.cameraId === cam.id && new Date(o.detectedAt).getTime() >= minTime && new Date(o.detectedAt).getTime() <= maxTime
    );
    candidateObs.push(...observations);
  }

  const weights = await getScoreWeights(TRACK_TYPES.PERSON, db);
  const candidates = [];

  for (const obs of candidateObs) {
    if (obs.sessionId === session.id) continue;

    const timeDiff = Math.abs(new Date(obs.detectedAt).getTime() - referenceTime) / 1000;
    const camRef = (db.cameraSources || []).find((c) => c.id === session.referenceCameraId);
    const camObs = (db.cameraSources || []).find((c) => c.id === obs.cameraId);

    const appearanceSim = embeddingSimilarity(referenceObs.appearanceEmbedding, obs.appearanceEmbedding);
    const clothingSim = clothingColorSimilarity(
      referenceObs.upperClothingColor, referenceObs.lowerClothingColor,
      obs.upperClothingColor, obs.lowerClothingColor
    );
    const combinedAppearance = appearanceSim * 0.7 + clothingSim * 0.3;

    const spatial = spatialConsistency(camRef, camObs, timeDiff, 5); // Person max speed ~5 m/s (running)
    const timing = timingConsistency(camRef, camObs, timeDiff);
    const direction = directionConsistency(referenceObs.directionDegrees, obs.directionDegrees, camRef, camObs);
    const activity = activityConsistency(referenceObs.activityLabel, obs.activityLabel);
    const gait = gaitSimilarity(referenceObs.gaitEmbedding, obs.gaitEmbedding);

    const adjustedAppearance = adjustForCameraHealth(combinedAppearance, obs.cameraHealthStatus, obs.cameraHealthSeverity);
    const adjustedSpatial = adjustForCameraHealth(spatial, obs.cameraHealthStatus, obs.cameraHealthSeverity);
    const adjustedTiming = adjustForCameraHealth(timing, obs.cameraHealthStatus, obs.cameraHealthSeverity);
    const adjustedDirection = adjustForCameraHealth(direction, obs.cameraHealthStatus, obs.cameraHealthSeverity);
    const adjustedActivity = adjustForCameraHealth(activity, obs.cameraHealthStatus, obs.cameraHealthSeverity);
    const adjustedGait = adjustForCameraHealth(gait, obs.cameraHealthStatus, obs.cameraHealthSeverity);

    const overall = (
      adjustedAppearance * weights.appearance +
      adjustedSpatial * weights.spatial +
      adjustedTiming * weights.timing +
      adjustedDirection * weights.direction +
      adjustedActivity * weights.activity +
      adjustedGait * weights.gait
    ) / (weights.appearance + weights.spatial + weights.timing + weights.direction + weights.activity + weights.gait);

    if (overall < 0.3) continue;

    const candidate = {
      id: uid("cand"),
      sessionId: session.id,
      observationId: obs.id,
      cameraId: obs.cameraId,
      detectedAt: obs.detectedAt,
      appearanceSimilarity: clamp01(adjustedAppearance),
      spatialConsistency: clamp01(adjustedSpatial),
      timingConsistency: clamp01(adjustedTiming),
      directionConsistency: clamp01(adjustedDirection),
      activityConsistency: clamp01(adjustedActivity),
      overallConfidence: clamp01(overall),
      status: "PENDING_REVIEW",
      matchExplanation: {
        appearance: { raw: combinedAppearance, adjusted: adjustedAppearance, weight: weights.appearance },
        spatial: { raw: spatial, adjusted: adjustedSpatial, weight: weights.spatial },
        timing: { raw: timing, adjusted: adjustedTiming, weight: weights.timing },
        direction: { raw: direction, adjusted: adjustedDirection, weight: weights.direction },
        activity: { raw: activity, adjusted: adjustedActivity, weight: weights.activity },
        gait: { raw: gait, adjusted: adjustedGait, weight: weights.gait },
        cameraHealth: { status: obs.cameraHealthStatus, severity: obs.cameraHealthSeverity }
      }
    };
    candidates.push(candidate);
  }

  candidates.sort((a, b) => b.overallConfidence - a.overallConfidence);
  return candidates.slice(0, 20);
}

async function searchCandidatesForVehicle(db, session, referenceObs, timeWindowMinutes = 30) {
  const referenceTime = new Date(referenceObs.detectedAt).getTime();
  const timeWindowMs = timeWindowMinutes * 60 * 1000;
  const minTime = referenceTime - timeWindowMs;
  const maxTime = referenceTime + timeWindowMs;

  const adjCameras = await getAdjacentCameras(session.referenceCameraId, db);
  const candidateObs = [];

  for (const cam of adjCameras) {
    const observations = (db.trackingObservations || []).filter(
      (o) => o.cameraId === cam.id && new Date(o.detectedAt).getTime() >= minTime && new Date(o.detectedAt).getTime() <= maxTime
    );
    candidateObs.push(...observations);
  }

  const weights = await getScoreWeights(TRACK_TYPES.VEHICLE, db);
  const candidates = [];

  for (const obs of candidateObs) {
    if (obs.sessionId === session.id) continue;

    const timeDiff = Math.abs(new Date(obs.detectedAt).getTime() - referenceTime) / 1000;
    const camRef = (db.cameraSources || []).find((c) => c.id === session.referenceCameraId);
    const camObs = (db.cameraSources || []).find((c) => c.id === obs.cameraId);
    const distance = camRef && camObs ? haversineDistance(camRef.latitude, camRef.longitude, camObs.latitude, camObs.longitude) : null;

    const plateSim = plateSimilarity(referenceObs.plateText, obs.plateText);
    const colorSim = colorSimilarity(referenceObs.vehicleColor, obs.vehicleColor);
    const typeSim = vehicleTypeSimilarity(referenceObs.vehicleType, obs.vehicleType);
    const brandModelSim = brandModelSimilarity(
      referenceObs.vehicleBrand, referenceObs.vehicleModel, referenceObs.brandModelConfidence,
      obs.vehicleBrand, obs.vehicleModel, obs.brandModelConfidence
    );
    const marksSim = distinctiveMarksSimilarity(referenceObs.distinctiveMarks, obs.distinctiveMarks);
    const appearanceSim = (colorSim + typeSim + brandModelSim + marksSim) / 4;

    const spatial = spatialConsistency(camRef, camObs, timeDiff, 15); // Vehicle max speed ~15 m/s
    const timing = timingConsistency(camRef, camObs, timeDiff);
    const direction = directionConsistency(referenceObs.directionDegrees, obs.directionDegrees, camRef, camObs);
    const speed = speedConsistency(referenceObs.estimatedSpeedKmh, obs.estimatedSpeedKmh, timeDiff, distance);
    const route = routeConsistency(camRef, camObs, referenceObs.directionDegrees, obs.directionDegrees);

    const adjustedPlate = adjustForCameraHealth(plateSim, obs.cameraHealthStatus, obs.cameraHealthSeverity);
    const adjustedAppearance = adjustForCameraHealth(appearanceSim, obs.cameraHealthStatus, obs.cameraHealthSeverity);
    const adjustedColor = adjustForCameraHealth(colorSim, obs.cameraHealthStatus, obs.cameraHealthSeverity);
    const adjustedType = adjustForCameraHealth(typeSim, obs.cameraHealthStatus, obs.cameraHealthSeverity);
    const adjustedBrandModel = adjustForCameraHealth(brandModelSim, obs.cameraHealthStatus, obs.cameraHealthSeverity);
    const adjustedMarks = adjustForCameraHealth(marksSim, obs.cameraHealthStatus, obs.cameraHealthSeverity);
    const adjustedSpatial = adjustForCameraHealth(spatial, obs.cameraHealthStatus, obs.cameraHealthSeverity);
    const adjustedTiming = adjustForCameraHealth(timing, obs.cameraHealthStatus, obs.cameraHealthSeverity);
    const adjustedDirection = adjustForCameraHealth(direction, obs.cameraHealthStatus, obs.cameraHealthSeverity);
    const adjustedSpeed = adjustForCameraHealth(speed, obs.cameraHealthStatus, obs.cameraHealthSeverity);
    const adjustedRoute = adjustForCameraHealth(route, obs.cameraHealthStatus, obs.cameraHealthSeverity);

    const overall = (
      adjustedPlate * weights.plate +
      adjustedAppearance * weights.appearance +
      adjustedColor * weights.color +
      adjustedType * weights.vehicleType +
      adjustedBrandModel * weights.brandModel +
      adjustedMarks * weights.distinctiveMarks +
      adjustedSpatial * weights.spatial +
      adjustedTiming * weights.timing +
      adjustedDirection * weights.direction +
      adjustedSpeed * weights.speed +
      adjustedRoute * weights.route
    ) / (weights.plate + weights.appearance + weights.color + weights.vehicleType + weights.brandModel + weights.distinctiveMarks + weights.spatial + weights.timing + weights.direction + weights.speed + weights.route);

    if (overall < 0.25) continue;

    const candidate = {
      id: uid("cand"),
      sessionId: session.id,
      observationId: obs.id,
      cameraId: obs.cameraId,
      detectedAt: obs.detectedAt,
      plateSimilarity: clamp01(adjustedPlate),
      colorSimilarity: clamp01(adjustedColor),
      vehicleTypeSimilarity: clamp01(adjustedType),
      brandModelSimilarity: clamp01(adjustedBrandModel),
      distinctiveMarksSimilarity: clamp01(adjustedMarks),
      spatialConsistency: clamp01(adjustedSpatial),
      timingConsistency: clamp01(adjustedTiming),
      directionConsistency: clamp01(adjustedDirection),
      speedConsistency: clamp01(adjustedSpeed),
      routeConsistency: clamp01(adjustedRoute),
      overallConfidence: clamp01(overall),
      status: "PENDING_REVIEW",
      matchExplanation: {
        plate: { raw: plateSim, adjusted: adjustedPlate, weight: weights.plate },
        appearance: { raw: appearanceSim, adjusted: adjustedAppearance, weight: weights.appearance },
        color: { raw: colorSim, adjusted: adjustedColor, weight: weights.color },
        vehicleType: { raw: typeSim, adjusted: adjustedType, weight: weights.vehicleType },
        brandModel: { raw: brandModelSim, adjusted: adjustedBrandModel, weight: weights.brandModel },
        distinctiveMarks: { raw: marksSim, adjusted: adjustedMarks, weight: weights.distinctiveMarks },
        spatial: { raw: spatial, adjusted: adjustedSpatial, weight: weights.spatial },
        timing: { raw: timing, adjusted: adjustedTiming, weight: weights.timing },
        direction: { raw: direction, adjusted: adjustedDirection, weight: weights.direction },
        speed: { raw: speed, adjusted: adjustedSpeed, weight: weights.speed },
        route: { raw: route, adjusted: adjustedRoute, weight: weights.route },
        cameraHealth: { status: obs.cameraHealthStatus, severity: obs.cameraHealthSeverity }
      }
    };
    candidates.push(candidate);
  }

  candidates.sort((a, b) => b.overallConfidence - a.overallConfidence);
  return candidates.slice(0, 20);
}

async function createTrackingSession(db, { trackType, referenceDetectionId, referenceCameraId, referenceTimestamp, createdBy, incidentId, alertId, evidenceId, referenceObservation }) {
  const session = {
    id: uid("track"),
    trackType,
    status: "SEARCHING",
    createdBy,
    referenceDetectionId,
    referenceCameraId,
    referenceTimestamp,
    confidence: 0,
    verificationStatus: "PENDING",
    incidentId,
    alertId,
    evidenceId,
    data: {},
    createdAt: isoNow(),
    updatedAt: isoNow()
  };
  await persistTrackingRecord(trackingSessionsRepository, "trackingSessions", session, db);
  return session;
}

async function createObservation(db, { sessionId, cameraId, detectedAt, detectionId, ...fields }) {
  const obs = {
    id: uid("obs"),
    sessionId,
    cameraId,
    detectedAt,
    detectionId,
    ...fields,
    data: {}
  };
  await persistTrackingRecord(trackingObservationsRepository, "trackingObservations", obs, db);
  return obs;
}

async function createCandidates(db, candidates) {
  const created = [];
  for (const cand of candidates) {
    await persistTrackingRecord(trackingCandidatesRepository, "trackingCandidates", cand, db);
    created.push(cand);
  }
  return created;
}

async function emitTrackingEvent(event, payload) {
  realtimeEvents.emit(event, payload);
}

module.exports = {
  TRACK_TYPES,
  SESSION_STATUSES,
  CANDIDATE_STATUSES,
  VERIFICATION_DECISIONS,
  VEHICLE_TYPES,
  MOVEMENT_STATES,
  DEFAULT_PERSON_WEIGHTS,
  DEFAULT_VEHICLE_WEIGHTS,
  uid,
  isoNow,
  clamp01,
  haversineDistance,
  bearingBetween,
  angleDifference,
  getScoreWeights,
  normalizePlate,
  plateSimilarity,
  colorSimilarity,
  vehicleTypeSimilarity,
  brandModelSimilarity,
  distinctiveMarksSimilarity,
  clothingColorSimilarity,
  embeddingSimilarity,
  gaitSimilarity,
  spatialConsistency,
  timingConsistency,
  directionConsistency,
  activityConsistency,
  speedConsistency,
  routeConsistency,
  adjustForCameraHealth,
  buildCameraGraph,
  getAdjacentCameras,
  searchCandidatesForPerson,
  searchCandidatesForVehicle,
  createTrackingSession,
  createObservation,
  createCandidates,
  emitTrackingEvent
};
