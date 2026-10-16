const test = require("node:test");
const assert = require("node:assert/strict");
process.env.DATABASE_URL = "";
const tracking = require("../services/multiCameraTracking.service");
const { __testables: controller } = require("../controllers/tracking.controller");

function database() {
  return {
    cameraSources: [
      { id: "camera-a", lat: 17.45, lng: 78.37 },
      { id: "camera-b", lat: 17.451, lng: 78.371 }
    ],
    cameraAdjacency: [{ id: "edge-a-b", cameraAId: "camera-a", cameraBId: "camera-b", distanceMeters: 150 }],
    trackingSessions: [], trackingObservations: [], trackingCandidates: [], trackingVerifications: [], trackingScoreConfig: []
  };
}

async function entityCandidate(trackType, labelFields) {
  const db = database();
  const timestamp = new Date().toISOString();
  const session = await tracking.createTrackingSession(db, {
    trackType, referenceDetectionId: "reference-detection", referenceCameraId: "camera-a",
    referenceTimestamp: timestamp, createdBy: "officer-1", evidenceId: "evidence-1",
    referenceObservationId: "reference-observation"
  });
  const reference = { id: "reference-observation", sessionId: session.id, cameraId: "camera-a", detectedAt: timestamp,
    detectionId: "reference-detection", trackType, primaryColor: "black", sizeClass: "medium", distinctiveMarks: ["white stripe"], ...labelFields };
  const candidateObservation = { id: "candidate-observation", sessionId: "source-observation-session", cameraId: "camera-b",
    detectedAt: new Date(Date.now() + 60_000).toISOString(), trackType, primaryColor: "black", sizeClass: "medium",
    distinctiveMarks: ["white stripe"], ...labelFields };
  db.trackingObservations.push(reference, candidateObservation);
  return { session, candidates: await tracking.searchCandidates(db, session, reference, 30) };
}

test("object candidates use object-specific factors and retain evidence provenance", async () => {
  const { candidates } = await entityCandidate(tracking.TRACK_TYPES.OBJECT, { objectClass: "backpack", shape: "rectangular", contextLabel: "platform" });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].entityType, "OBJECT");
  assert.equal(candidates[0].referenceEvidenceId, "evidence-1");
  assert.equal(candidates[0].humanVerificationRequired, true);
  assert.equal(candidates[0].status, "PENDING_REVIEW");
  assert.equal(candidates[0].classSimilarity, 1);
  assert.ok(candidates[0].matchExplanation.shape);
});

test("supported animal candidates use species scoring and stay advisory", async () => {
  const { candidates } = await entityCandidate(tracking.TRACK_TYPES.ANIMAL, { animalSpecies: "dog", directionDegrees: 80 });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].speciesSimilarity, 1);
  assert.equal(candidates[0].status, "PENDING_REVIEW");
  assert.equal(candidates[0].humanVerificationRequired, true);
});

test("unsupported object and animal labels fail honestly", async () => {
  assert.equal(tracking.supportedEntityLabel("OBJECT", "firearm"), false);
  assert.equal(tracking.supportedEntityLabel("ANIMAL", "tiger"), false);
  assert.equal(tracking.supportedEntityLabel("ANIMAL", "dog"), true);
  const db = database();
  const session = await tracking.createTrackingSession(db, { trackType: "ANIMAL", referenceDetectionId: "d", referenceCameraId: "camera-a", referenceTimestamp: new Date().toISOString(), createdBy: "officer" });
  await assert.rejects(() => tracking.searchCandidates(db, session, { cameraId: "camera-a", detectedAt: new Date().toISOString(), animalSpecies: "tiger" }), (error) => error.code === "TRACKING_LABEL_UNSUPPORTED");
});

test("all four tracking types have independent score configurations", async () => {
  const db = database();
  db.trackingScoreConfig.push({ trackType: "OBJECT", weightKey: "class", weightValue: 0.6 });
  assert.equal((await tracking.getScoreWeights("OBJECT", db)).class, 0.6);
  assert.ok((await tracking.getScoreWeights("ANIMAL", db)).species > 0);
  assert.ok((await tracking.getScoreWeights("PERSON", db)).appearance > 0);
  assert.ok((await tracking.getScoreWeights("VEHICLE", db)).plate > 0);
});

test("response recommendations are blocked until a human-confirmed sighting", async () => {
  const db = database();
  db.policeStations = [{ id: "station-1", name: "Station One", lat: 17.452, lng: 78.372, operational: true }];
  db.responseUnits = [{ id: "unit-1", unitCode: "P-1", lat: 17.453, lng: 78.373, status: "available" }];
  const pending = await controller.trackingRecommendations(db, { verificationStatus: "PENDING", lastSeenCameraId: "camera-b" });
  assert.equal(pending.authoritative, false);
  assert.deepEqual(pending.units, []);
  const confirmed = await controller.trackingRecommendations(db, { verificationStatus: "CONFIRMED", lastSeenCameraId: "camera-b", lastSeenAt: new Date().toISOString() });
  assert.equal(confirmed.authoritative, true);
  assert.equal(confirmed.units[0].id, "unit-1");
  assert.equal(confirmed.stations[0].id, "station-1");
  assert.equal(typeof confirmed.units[0].approximate, "boolean");
  assert.ok(confirmed.units[0].route?.distanceMeters > 0);
});
