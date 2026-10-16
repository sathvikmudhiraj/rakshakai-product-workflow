const crypto = require("node:crypto");
const trackingService = require("../services/multiCameraTracking.service");
const trackingSessionsRepository = require("../repositories/trackingSessions.repository");
const trackingObservationsRepository = require("../repositories/trackingObservations.repository");
const trackingCandidatesRepository = require("../repositories/trackingCandidates.repository");
const trackingVerificationsRepository = require("../repositories/trackingVerifications.repository");
const cameraAdjacencyRepository = require("../repositories/cameraAdjacency.repository");
const cameraSourcesRepository = require("../repositories/cameraSources.repository");
const auditLogsRepository = require("../repositories/auditLogs.repository");
const { readDatabase, writeDatabase, writeSelectedRecords, userFromReq, hasRole, addAuditLog, routeBetween, routeUrl, strictPoint } = require("../services/core.service");
const { withTransaction } = require("../services/postgres.service");
const { getDatabaseMode } = require("../services/postgres.service");

const { TRACK_TYPES, SESSION_STATUSES, CANDIDATE_STATUSES, VERIFICATION_DECISIONS, emitTrackingEvent } = trackingService;

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function isoNow() {
  return new Date().toISOString();
}

async function authenticate(req, roles) {
  const db = await readDatabase();
  const user = userFromReq(req, db);
  if (!user) throw Object.assign(new Error("Authentication required"), { status: 401 });
  if (roles && !hasRole(user, roles)) {
    throw Object.assign(new Error("You do not have permission for this action"), { status: 403 });
  }
  return { db, user };
}

function validateTrackingSessionInput(body, user) {
  const trackType = String(body.trackType || "").toUpperCase();
  if (!Object.values(TRACK_TYPES).includes(trackType)) {
    throw Object.assign(new Error("trackType must be PERSON, VEHICLE, OBJECT, or ANIMAL"), { status: 400 });
  }
  const referenceDetectionId = String(body.referenceDetectionId || "").trim();
  if (!referenceDetectionId) throw Object.assign(new Error("referenceDetectionId is required"), { status: 400 });
  const referenceCameraId = String(body.referenceCameraId || "").trim();
  if (!referenceCameraId) throw Object.assign(new Error("referenceCameraId is required"), { status: 400 });
  const referenceTimestamp = body.referenceTimestamp && !Number.isNaN(Date.parse(body.referenceTimestamp))
    ? new Date(body.referenceTimestamp).toISOString()
    : new Date().toISOString();
  const incidentId = body.incidentId ? String(body.incidentId).trim() : null;
  const alertId = body.alertId ? String(body.alertId).trim() : null;
  const evidenceId = body.evidenceId ? String(body.evidenceId).trim() : null;
  const referenceObservation = body.referenceObservation || null;
  const referenceObservationId = body.referenceObservationId ? String(body.referenceObservationId).trim() : null;
  const sourceType = evidenceId ? "EVIDENCE" : "CAMERA";
  const sourceId = evidenceId || referenceCameraId;
  return { trackType, referenceDetectionId, referenceCameraId, referenceTimestamp, incidentId, alertId, evidenceId, referenceObservation, referenceObservationId, sourceType, sourceId };
}

function validateVerificationInput(body) {
  const decision = String(body.decision || "").toUpperCase();
  if (!VERIFICATION_DECISIONS.includes(decision)) {
    throw Object.assign(new Error("decision must be CONFIRM_MATCH, REJECT_MATCH, or UNCERTAIN"), { status: 400 });
  }
  const reason = body.reason ? String(body.reason).trim().slice(0, 500) : null;
  return { decision, reason };
}

exports.createTrackingSession = async (req, res, next) => {
  try {
    const { db, user } = await authenticate(req, ["Police Officer", "Admin"]);
    const input = validateTrackingSessionInput(req.body, user);
    if (!(db.cameraSources || []).some((camera) => camera.id === input.referenceCameraId)) {
      throw Object.assign(new Error("Reference camera is not an authorized source"), { status: 404 });
    }
    if (input.evidenceId && !(db.videoEvidence || []).some((item) => item.id === input.evidenceId)) {
      throw Object.assign(new Error("Reference evidence not found"), { status: 404 });
    }
    const referenceLabel = input.referenceObservation && trackingService.observationEntityLabel(input.referenceObservation, input.trackType);
    if ([TRACK_TYPES.OBJECT, TRACK_TYPES.ANIMAL].includes(input.trackType) && !referenceLabel) {
      throw Object.assign(new Error(`${input.trackType.toLowerCase()} reference label is required`), { status: 400 });
    }
    if (referenceLabel && !trackingService.supportedEntityLabel(input.trackType, referenceLabel)) {
      throw Object.assign(new Error(`Unsupported by current AI model: ${input.trackType.toLowerCase()} label '${referenceLabel}'`), { status: 422, code: "TRACKING_LABEL_UNSUPPORTED" });
    }
    const databaseMode = getDatabaseMode();

    const result = await (databaseMode === "postgres"
      ? withTransaction(async (client) => {
          const session = await trackingService.createTrackingSession(
            { ...db, client },
            { ...input, createdBy: user.id }
          );
          if (input.referenceObservation) {
            const observation = await trackingService.createObservation(
              { ...db, client },
              { ...input.referenceObservation, sessionId: session.id, cameraId: input.referenceCameraId, detectedAt: input.referenceTimestamp, detectionId: input.referenceDetectionId, trackType: input.trackType,
                sourceType: input.sourceType, sourceId: input.sourceId, evidenceId: input.evidenceId }
            );
            session.referenceObservationId = observation.id;
            await trackingSessionsRepository.upsert(session, client);
          }
          return session;
        })
      : (async () => {
          const session = await trackingService.createTrackingSession(db, { ...input, createdBy: user.id });
          if (input.referenceObservation) {
            const observation = await trackingService.createObservation(db, { ...input.referenceObservation, sessionId: session.id, cameraId: input.referenceCameraId,
              detectedAt: input.referenceTimestamp, detectionId: input.referenceDetectionId, trackType: input.trackType,
              sourceType: input.sourceType, sourceId: input.sourceId, evidenceId: input.evidenceId });
            session.referenceObservationId = observation.id;
            await trackingSessionsRepository.upsert(session, db);
          }
          await writeDatabase(db);
          return session;
        })()
    );

    const startAction = input.evidenceId ? "tracking_started_from_evidence" : "tracking_session_started";
    const startAudit = addAuditLog(db, startAction, user, result.id, `Entity ${input.trackType}; source ${input.sourceType}:${input.sourceId}`, isoNow());
    await writeSelectedRecords(db, [[auditLogsRepository, [startAudit]]]);

    emitTrackingEvent("tracking_session_created", { session: result });

    res.status(201).json({ session: result });
  } catch (error) {
    next(error);
  }
};

exports.getTrackingSession = async (req, res, next) => {
  try {
    const { db, user } = await authenticate(req, ["Police Officer", "Admin"]);
    const sessionId = req.params.sessionId;
    const session = (await trackingSessionsRepository.list(db)).find((s) => s.id === sessionId);
    if (!session) throw Object.assign(new Error("Tracking session not found"), { status: 404 });

    const candidates = (await trackingCandidatesRepository.list(db)).filter((c) => c.sessionId === sessionId);
    const candidateObservationIds = new Set(candidates.map((candidate) => candidate.observationId));
    const observations = (await trackingObservationsRepository.list(db)).filter((observation) => observation.sessionId === sessionId || candidateObservationIds.has(observation.id));
    const verifications = (await trackingVerificationsRepository.list(db)).filter((v) => v.sessionId === sessionId);

    res.json({ session, observations, candidates, verifications });
  } catch (error) {
    next(error);
  }
};

exports.listTrackingSessions = async (req, res, next) => {
  try {
    const { db, user } = await authenticate(req, ["Police Officer", "Admin"]);
    const { trackType, status, incidentId, cameraId, limit = "50", offset = "0" } = req.query;

    let sessions = await trackingSessionsRepository.list(db);
    if (trackType) sessions = sessions.filter((s) => s.trackType === trackType.toUpperCase());
    if (status) sessions = sessions.filter((s) => s.status === status.toUpperCase());
    if (incidentId) sessions = sessions.filter((s) => s.incidentId === incidentId);
    if (cameraId) sessions = sessions.filter((s) => s.referenceCameraId === cameraId);

    sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const start = parseInt(offset, 10) || 0;
    const lim = Math.min(parseInt(limit, 10) || 50, 200);
    const paginated = sessions.slice(start, start + lim);

    res.json({ sessions: paginated, total: sessions.length, offset: start, limit: lim });
  } catch (error) {
    next(error);
  }
};

exports.searchCandidates = async (req, res, next) => {
  try {
    const { db, user } = await authenticate(req, ["Police Officer", "Admin"]);
    const sessionId = req.params.sessionId;
    const { timeWindowMinutes = "30" } = req.query;

    const session = (await trackingSessionsRepository.list(db)).find((s) => s.id === sessionId);
    if (!session) throw Object.assign(new Error("Tracking session not found"), { status: 404 });

    const observations = (await trackingObservationsRepository.list(db)).filter((o) => o.sessionId === sessionId);
    const referenceObs = observations.find((o) => o.detectionId === session.referenceDetectionId) || observations[0];
    if (!referenceObs) throw Object.assign(new Error("Reference observation not found"), { status: 404 });

    let candidates = await trackingService.searchCandidates(db, session, referenceObs, parseInt(timeWindowMinutes, 10));
    const existingObservationIds = new Set((await trackingCandidatesRepository.list(db))
      .filter((candidate) => candidate.sessionId === sessionId).map((candidate) => candidate.observationId));
    candidates = candidates.filter((candidate) => !existingObservationIds.has(candidate.observationId));

    if (candidates.length > 0) {
      await (getDatabaseMode() === "postgres"
        ? withTransaction(async (client) => {
            await trackingService.createCandidates({ ...db, client }, candidates);
          })
        : (async () => {
            await trackingService.createCandidates(db, candidates);
            await writeDatabase(db);
          })()
      );
      session.status = "CANDIDATE_FOUND";
      session.updatedAt = isoNow();
      await trackingSessionsRepository.upsert(session, db.client || db);
      if (getDatabaseMode() === "json") await writeDatabase(db);

      emitTrackingEvent("tracking_candidates_found", { sessionId, candidates, count: candidates.length });
    }

    const searchAudit = addAuditLog(db, candidates.length ? "candidate_found" : "tracking_search_performed", user, sessionId, `Entity ${session.trackType}; found ${candidates.length} candidates`, isoNow());
    await writeSelectedRecords(db, [[auditLogsRepository, [searchAudit]]]);

    res.json({ session, candidates, referenceObservation: referenceObs });
  } catch (error) {
    next(error);
  }
};

exports.verifyCandidate = async (req, res, next) => {
  try {
    const { db, user } = await authenticate(req, ["Police Officer", "Admin"]);
    const sessionId = req.params.sessionId;
    const candidateId = req.params.candidateId;
    const { decision, reason } = validateVerificationInput(req.body);

    const session = (await trackingSessionsRepository.list(db)).find((s) => s.id === sessionId);
    if (!session) throw Object.assign(new Error("Tracking session not found"), { status: 404 });

    const candidate = (await trackingCandidatesRepository.list(db)).find((c) => c.id === candidateId && c.sessionId === sessionId);
    if (!candidate) throw Object.assign(new Error("Candidate not found"), { status: 404 });
    if (!["PENDING_REVIEW", "UNCERTAIN"].includes(candidate.status)) {
      throw Object.assign(new Error("Candidate has already received a final human decision"), { status: 409 });
    }

    const databaseMode = getDatabaseMode();

    await (databaseMode === "postgres"
      ? withTransaction(async (client) => {
          const verification = {
            id: uid("ver"),
            sessionId,
            candidateId,
            actorId: user.id,
            decision,
            aiConfidence: candidate.overallConfidence,
            reason,
            data: {},
            createdAt: isoNow()
          };
          await trackingVerificationsRepository.upsert(verification, client);

          candidate.verificationId = verification.id;
          candidate.status = decision === "CONFIRM_MATCH" ? "CONFIRMED" : decision === "REJECT_MATCH" ? "REJECTED" : "UNCERTAIN";
          candidate.reviewedAt = isoNow();
          candidate.reviewedBy = user.id;
          candidate.reviewReason = reason;
          await trackingCandidatesRepository.upsert(candidate, client);

          if (decision === "CONFIRM_MATCH") {
            const obs = (await trackingObservationsRepository.list({ ...db, client })).find((o) => o.id === candidate.observationId);
            if (obs) {
              const previousCamera = (db.cameraSources || []).find((camera) => camera.id === (session.lastSeenCameraId || session.referenceCameraId));
              const confirmedCamera = (db.cameraSources || []).find((camera) => camera.id === obs.cameraId);
              const previousJurisdiction = previousCamera?.jurisdiction || previousCamera?.zone || null;
              const confirmedJurisdiction = confirmedCamera?.jurisdiction || confirmedCamera?.zone || null;
              session.lastSeenCameraId = obs.cameraId;
              session.lastSeenAt = obs.detectedAt;
              session.confidence = candidate.overallConfidence;
              session.verificationStatus = "CONFIRMED";
              session.status = session.status === "CLOSED" ? "CLOSED" : "CONFIRMED";
              session.lastConfirmedObservationId = obs.id;
              session.updatedAt = isoNow();
              await trackingSessionsRepository.upsert(session, client);
              const locationAudit = addAuditLog({ ...db, client }, "confirmed_location_updated", user, sessionId, `Entity ${session.trackType}; camera ${obs.cameraId}; observation ${obs.id}`, isoNow());
              await auditLogsRepository.upsert(locationAudit, client);
              if (previousJurisdiction && confirmedJurisdiction && previousJurisdiction !== confirmedJurisdiction) {
                const jurisdictionAudit = addAuditLog({ ...db, client }, "jurisdiction_changed", user, sessionId, `Entity ${session.trackType}; ${previousJurisdiction} -> ${confirmedJurisdiction}`, isoNow());
                await auditLogsRepository.upsert(jurisdictionAudit, client);
              }
            }
          }

          const action = decision === "CONFIRM_MATCH" ? "candidate_confirmed" : decision === "REJECT_MATCH" ? "candidate_rejected" : "candidate_uncertain";
          const decisionAudit = addAuditLog({ ...db, client }, action, user, sessionId, `Entity ${session.trackType}; candidate ${candidateId}: ${reason || "No reason provided"}`, isoNow());
          await auditLogsRepository.upsert(decisionAudit, client);
        })
      : (async () => {
          const verification = {
            id: uid("ver"),
            sessionId,
            candidateId,
            actorId: user.id,
            decision,
            aiConfidence: candidate.overallConfidence,
            reason,
            data: {},
            createdAt: isoNow()
          };
          await trackingVerificationsRepository.upsert(verification, db);

          candidate.verificationId = verification.id;
          candidate.status = decision === "CONFIRM_MATCH" ? "CONFIRMED" : decision === "REJECT_MATCH" ? "REJECTED" : "UNCERTAIN";
          candidate.reviewedAt = isoNow();
          candidate.reviewedBy = user.id;
          candidate.reviewReason = reason;
          await trackingCandidatesRepository.upsert(candidate, db);

          if (decision === "CONFIRM_MATCH") {
            const obs = (await trackingObservationsRepository.list(db)).find((o) => o.id === candidate.observationId);
            if (obs) {
              const previousCamera = (db.cameraSources || []).find((camera) => camera.id === (session.lastSeenCameraId || session.referenceCameraId));
              const confirmedCamera = (db.cameraSources || []).find((camera) => camera.id === obs.cameraId);
              const previousJurisdiction = previousCamera?.jurisdiction || previousCamera?.zone || null;
              const confirmedJurisdiction = confirmedCamera?.jurisdiction || confirmedCamera?.zone || null;
              session.lastSeenCameraId = obs.cameraId;
              session.lastSeenAt = obs.detectedAt;
              session.confidence = candidate.overallConfidence;
              session.verificationStatus = "CONFIRMED";
              session.status = session.status === "CLOSED" ? "CLOSED" : "CONFIRMED";
              session.lastConfirmedObservationId = obs.id;
              session.updatedAt = isoNow();
              await trackingSessionsRepository.upsert(session, db);
              addAuditLog(db, "confirmed_location_updated", user, sessionId, `Entity ${session.trackType}; camera ${obs.cameraId}; observation ${obs.id}`, isoNow());
              if (previousJurisdiction && confirmedJurisdiction && previousJurisdiction !== confirmedJurisdiction) {
                addAuditLog(db, "jurisdiction_changed", user, sessionId, `Entity ${session.trackType}; ${previousJurisdiction} -> ${confirmedJurisdiction}`, isoNow());
              }
            }
          }

          const action = decision === "CONFIRM_MATCH" ? "candidate_confirmed" : decision === "REJECT_MATCH" ? "candidate_rejected" : "candidate_uncertain";
          addAuditLog(db, action, user, sessionId, `Entity ${session.trackType}; candidate ${candidateId}: ${reason || "No reason provided"}`, isoNow());
          await writeDatabase(db);
        })()
    );

    emitTrackingEvent("tracking_candidate_verified", { sessionId, candidateId, decision, reason, verifiedBy: user.id });
    if (decision === "CONFIRM_MATCH") {
      emitTrackingEvent("tracking_last_seen_updated", {
        sessionId, entityType: session.trackType, cameraId: session.lastSeenCameraId,
        observedAt: session.lastSeenAt, candidateId, humanVerified: true
      });
    }

    res.json({ session, candidate, verification: { decision, reason, actorId: user.id, timestamp: isoNow() } });
  } catch (error) {
    next(error);
  }
};

exports.closeTrackingSession = async (req, res, next) => {
  try {
    const { db, user } = await authenticate(req, ["Police Officer", "Admin"]);
    const sessionId = req.params.sessionId;

    const session = (await trackingSessionsRepository.list(db)).find((s) => s.id === sessionId);
    if (!session) throw Object.assign(new Error("Tracking session not found"), { status: 404 });

    session.status = "CLOSED";
    session.updatedAt = isoNow();

    const databaseMode = getDatabaseMode();
    await (databaseMode === "postgres"
      ? withTransaction(async (client) => {
          await trackingSessionsRepository.upsert(session, client);
        })
      : (async () => {
          await trackingSessionsRepository.upsert(session, db);
          await writeDatabase(db);
        })()
    );

    const closeAudit = addAuditLog(db, "tracking_session_closed", user, sessionId, `Entity ${session.trackType}; tracking session closed by operator`, isoNow());
    await writeSelectedRecords(db, [[auditLogsRepository, [closeAudit]]]);
    emitTrackingEvent("tracking_session_closed", { sessionId });

    res.json({ session });
  } catch (error) {
    next(error);
  }
};

exports.getCandidateDetails = async (req, res, next) => {
  try {
    const { db, user } = await authenticate(req, ["Police Officer", "Admin"]);
    const sessionId = req.params.sessionId;
    const candidateId = req.params.candidateId;

    const candidate = (await trackingCandidatesRepository.list(db)).find((c) => c.id === candidateId && c.sessionId === sessionId);
    if (!candidate) throw Object.assign(new Error("Candidate not found"), { status: 404 });

    const observation = (await trackingObservationsRepository.list(db)).find((o) => o.id === candidate.observationId);
    const session = (await trackingSessionsRepository.list(db)).find((s) => s.id === sessionId);
    const referenceObs = session ? (await trackingObservationsRepository.list(db)).find((o) => o.sessionId === sessionId && o.detectionId === session.referenceDetectionId) : null;

    const camera = observation ? (db.cameraSources || []).find((c) => c.id === observation.cameraId) : null;
    const refCamera = referenceObs ? (db.cameraSources || []).find((c) => c.id === referenceObs.cameraId) : null;

    res.json({ candidate, observation, referenceObservation: referenceObs, camera, refCamera });
  } catch (error) {
    next(error);
  }
};

exports.getSessionTimeline = async (req, res, next) => {
  try {
    const { db, user } = await authenticate(req, ["Police Officer", "Admin"]);
    const sessionId = req.params.sessionId;

    const session = (await trackingSessionsRepository.list(db)).find((s) => s.id === sessionId);
    if (!session) throw Object.assign(new Error("Tracking session not found"), { status: 404 });

    const candidates = (await trackingCandidatesRepository.list(db))
      .filter((c) => c.sessionId === sessionId)
      .sort((a, b) => new Date(a.detectedAt).getTime() - new Date(b.detectedAt).getTime());
    const candidateObservationIds = new Set(candidates.map((candidate) => candidate.observationId));
    const observations = (await trackingObservationsRepository.list(db))
      .filter((observation) => observation.sessionId === sessionId || candidateObservationIds.has(observation.id))
      .sort((a, b) => new Date(a.detectedAt).getTime() - new Date(b.detectedAt).getTime());

    const verifications = (await trackingVerificationsRepository.list(db))
      .filter((v) => v.sessionId === sessionId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const timeline = [];
    for (const obs of observations) {
      const cand = candidates.find((c) => c.observationId === obs.id);
      const verification = cand ? verifications.find((v) => v.candidateId === cand.id) : null;
      const camera = (db.cameraSources || []).find((c) => c.id === obs.cameraId);
      timeline.push({
        type: "observation",
        timestamp: obs.detectedAt,
        cameraId: obs.cameraId,
        cameraName: camera?.name || camera?.cameraId || obs.cameraId,
        cameraLocation: camera ? { lat: camera.latitude, lng: camera.longitude } : null,
        detectionId: obs.detectionId,
        isReference: obs.detectionId === session.referenceDetectionId,
        candidate: cand ? { id: cand.id, confidence: cand.overallConfidence, status: cand.status } : null,
        verification: verification ? { decision: verification.decision, actorId: verification.actorId, createdAt: verification.createdAt } : null,
        data: obs
      });
    }

    res.json({ session, timeline });
  } catch (error) {
    next(error);
  }
};

exports.getSessionMapData = async (req, res, next) => {
  try {
    const { db, user } = await authenticate(req, ["Police Officer", "Admin"]);
    const sessionId = req.params.sessionId;

    const session = (await trackingSessionsRepository.list(db)).find((s) => s.id === sessionId);
    if (!session) throw Object.assign(new Error("Tracking session not found"), { status: 404 });

    const allObservations = await trackingObservationsRepository.list(db);
    const reference = allObservations.find((item) => item.id === session.referenceObservationId)
      || allObservations.find((item) => item.sessionId === sessionId && item.detectionId === session.referenceDetectionId);
    const candidates = (await trackingCandidatesRepository.list(db)).filter((item) => item.sessionId === sessionId);
    const observationById = new Map(allObservations.map((item) => [item.id, item]));
    const pointFor = (observation, state, candidate = null) => {
      if (!observation) return null;
      const camera = (db.cameraSources || []).find((item) => item.id === observation.cameraId);
      const lat = Number(camera?.lat ?? camera?.latitude);
      const lng = Number(camera?.lng ?? camera?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { cameraId: camera.id, cameraName: camera.name || camera.cameraId || camera.id, lat, lng,
        timestamp: observation.detectedAt, state, candidateId: candidate?.id || null,
        confidence: candidate?.overallConfidence ?? null, isReference: state === "REFERENCE",
        isLastSeen: state === "CONFIRMED" && camera.id === session.lastSeenCameraId };
    };
    const referencePoint = pointFor(reference || { cameraId: session.referenceCameraId, detectedAt: session.referenceTimestamp }, "REFERENCE");
    const confirmedPoints = candidates.filter((item) => item.status === "CONFIRMED")
      .map((item) => pointFor(observationById.get(item.observationId), "CONFIRMED", item)).filter(Boolean)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const pendingPoints = candidates.filter((item) => ["PENDING_REVIEW", "UNCERTAIN"].includes(item.status))
      .map((item) => pointFor(observationById.get(item.observationId), item.status, item)).filter(Boolean);
    const trackPoints = [referencePoint, ...confirmedPoints].filter(Boolean);
    let totalDistanceMeters = 0;
    for (let index = 1; index < confirmedPoints.length; index += 1) {
      totalDistanceMeters += trackingService.haversineDistance(confirmedPoints[index - 1].lat, confirmedPoints[index - 1].lng, confirmedPoints[index].lat, confirmedPoints[index].lng);
    }
    const elapsedSeconds = confirmedPoints.length > 1
      ? Math.max(1, (new Date(confirmedPoints.at(-1).timestamp) - new Date(confirmedPoints[0].timestamp)) / 1000) : 0;
    const directionDegrees = confirmedPoints.length > 1
      ? Math.round(trackingService.bearingBetween(confirmedPoints[0].lat, confirmedPoints[0].lng, confirmedPoints.at(-1).lat, confirmedPoints.at(-1).lng)) : null;

    res.json({
      session,
      trackPoints,
      pendingPoints,
      referenceCamera: referencePoint,
      lastSeenCamera: confirmedPoints.find((point) => point.isLastSeen) || null,
      movement: { basedOnConfirmedSightings: true, confirmedPointCount: confirmedPoints.length,
        totalDistanceMeters: Math.round(totalDistanceMeters), elapsedSeconds, directionDegrees,
        averageSpeedMps: elapsedSeconds ? Number((totalDistanceMeters / elapsedSeconds).toFixed(2)) : null }
    });
  } catch (error) {
    next(error);
  }
};

async function trackingRecommendations(db, session) {
  if (session.verificationStatus !== "CONFIRMED" || !session.lastSeenCameraId) {
    return { authoritative: false, reason: "A human-confirmed sighting is required before operational recommendations are available.", stations: [], units: [] };
  }
  const camera = (db.cameraSources || []).find((item) => item.id === session.lastSeenCameraId);
  const lat = Number(camera?.lat ?? camera?.latitude);
  const lng = Number(camera?.lng ?? camera?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { authoritative: false, reason: "The confirmed camera has no valid GIS coordinates.", stations: [], units: [] };
  }
  const distanceFrom = (item) => {
    const itemLat = Number(item.lat ?? item.latitude);
    const itemLng = Number(item.lng ?? item.longitude);
    return Number.isFinite(itemLat) && Number.isFinite(itemLng) ? trackingService.haversineDistance(lat, lng, itemLat, itemLng) : null;
  };
  const stationSeeds = (db.policeStations || []).map((station) => ({
    id: station.id, name: station.stationName || station.name || station.id,
    jurisdiction: station.jurisdiction || null, operational: station.operational !== false,
    availableUnits: (db.responseUnits || []).filter((unit) => (unit.stationId || unit.linkedStationId || unit.policeStationId) === station.id
      && ["AVAILABLE", "ACTIVE", "PATROLLING"].includes(String(unit.status || "").toUpperCase())).length,
    distanceMeters: distanceFrom(station)
  })).filter((item) => item.operational && item.distanceMeters != null)
    .sort((left, right) => left.distanceMeters - right.distanceMeters).slice(0, 5);
  const stations = await Promise.all(stationSeeds.map(async (item) => {
    const station = (db.policeStations || []).find((record) => record.id === item.id);
    const route = await routeBetween(routeUrl(strictPoint(station), { lat, lng }));
    return { ...item, distanceMeters: route.distanceMeters, distanceKm: route.distanceKm,
      etaMinutes: route.durationMinutes, approximate: Boolean(route.approximate), route,
      reason: `${item.jurisdiction ? `${item.jurisdiction} jurisdiction; ` : ""}operational station ranked by road ETA and distance from the human-confirmed camera${route.approximate ? " (routing fallback)" : ""}.` };
  }));
  stations.sort((left, right) => left.etaMinutes - right.etaMinutes || left.distanceMeters - right.distanceMeters);
  const unitSeeds = (db.responseUnits || []).map((unit) => ({
    id: unit.id, unitCode: unit.unitCode || unit.callsign || unit.id, status: unit.status,
    stationId: unit.stationId || unit.policeStationId || null, workload: Number(unit.activeIncidentCount || 0),
    distanceMeters: distanceFrom(unit)
  })).filter((item) => ["AVAILABLE", "ACTIVE", "PATROLLING"].includes(String(item.status || "").toUpperCase()) && item.distanceMeters != null)
    .sort((left, right) => left.distanceMeters - right.distanceMeters || left.workload - right.workload).slice(0, 5);
  const units = await Promise.all(unitSeeds.map(async (item) => {
    const unit = (db.responseUnits || []).find((record) => record.id === item.id);
    const route = await routeBetween(routeUrl(strictPoint(unit), { lat, lng }));
    return { ...item, distanceMeters: route.distanceMeters, distanceKm: route.distanceKm,
      etaMinutes: route.durationMinutes, approximate: Boolean(route.approximate), route,
      reason: `Eligible ${String(item.status).toUpperCase()} unit ranked by road ETA, distance, jurisdiction and workload (${item.workload})${route.approximate ? "; routing fallback in use" : ""}.` };
  }));
  units.sort((left, right) => left.etaMinutes - right.etaMinutes || left.distanceMeters - right.distanceMeters || left.workload - right.workload);
  return { authoritative: true, confirmedCameraId: camera.id, confirmedAt: session.lastSeenAt, stations, units,
    explanation: "Recommendations use only the latest human-confirmed sighting. Selecting a unit does not dispatch it." };
}

exports.getSessionRecommendations = async (req, res, next) => {
  try {
    const { db, user } = await authenticate(req, ["Police Officer", "Admin"]);
    const session = (await trackingSessionsRepository.list(db)).find((item) => item.id === req.params.sessionId);
    if (!session) throw Object.assign(new Error("Tracking session not found"), { status: 404 });
    const recommendations = await trackingRecommendations(db, session);
    if (recommendations.authoritative) {
      const details = `Entity ${session.trackType}; confirmed camera ${recommendations.confirmedCameraId}`;
      const existingActions = new Set((db.auditLogs || []).filter((log) => log.incidentId === session.id && log.details === details).map((log) => log.action));
      const audits = [];
      if (!existingActions.has("station_recommendations_generated")) audits.push(addAuditLog(db, "station_recommendations_generated", user, session.id, details, isoNow()));
      if (!existingActions.has("unit_recommendations_generated")) audits.push(addAuditLog(db, "unit_recommendations_generated", user, session.id, details, isoNow()));
      if (audits.length) await writeSelectedRecords(db, [[auditLogsRepository, audits]]);
    }
    res.json({ sessionId: session.id, recommendations });
  } catch (error) { next(error); }
};

exports.handoffSession = async (req, res, next) => {
  try {
    const { db, user } = await authenticate(req, ["Police Officer", "Admin"]);
    const session = (await trackingSessionsRepository.list(db)).find((item) => item.id === req.params.sessionId);
    if (!session) throw Object.assign(new Error("Tracking session not found"), { status: 404 });
    if (session.verificationStatus !== "CONFIRMED") throw Object.assign(new Error("Confirm a sighting before operational handoff"), { status: 409 });
    const unitId = req.body?.unitId ? String(req.body.unitId) : null;
    const audit = addAuditLog(db, "unit_assignment_opened_from_tracking", user, session.id, `Entity ${session.trackType}${unitId ? `; unit ${unitId}` : ""}; no dispatch was performed`, isoNow());
    await writeSelectedRecords(db, [[auditLogsRepository, [audit]]]);
    res.json({ sessionId: session.id, unitId, dispatched: false, navigateTo: "unit-assignment", message: "Review and confirm dispatch manually in Unit Assignment." });
  } catch (error) { next(error); }
};

exports.getCameraAdjacency = async (req, res, next) => {
  try {
    const { db, user } = await authenticate(req, ["Police Officer", "Admin"]);
    const adjacency = await cameraAdjacencyRepository.list(db);
    res.json({ adjacency });
  } catch (error) {
    next(error);
  }
};

exports.createCameraAdjacency = async (req, res, next) => {
  try {
    const { db, user } = await authenticate(req, ["Admin"]);
    const { cameraAId, cameraBId, distanceMeters, expectedMinTravelSeconds, expectedMaxTravelSeconds, direction, routeType, isBidirectional } = req.body;

    if (!cameraAId || !cameraBId || distanceMeters == null || expectedMinTravelSeconds == null || expectedMaxTravelSeconds == null) {
      throw Object.assign(new Error("cameraAId, cameraBId, distanceMeters, expectedMinTravelSeconds, expectedMaxTravelSeconds are required"), { status: 400 });
    }

    const existing = (await cameraAdjacencyRepository.list(db)).find(
      (a) => (a.cameraAId === cameraAId && a.cameraBId === cameraBId) || (a.cameraAId === cameraBId && a.cameraBId === cameraAId)
    );
    if (existing) throw Object.assign(new Error("Camera adjacency already exists"), { status: 409 });

    const adjacency = {
      id: uid("adj"),
      cameraAId,
      cameraBId,
      distanceMeters: Number(distanceMeters),
      expectedMinTravelSeconds: Number(expectedMinTravelSeconds),
      expectedMaxTravelSeconds: Number(expectedMaxTravelSeconds),
      direction: direction || null,
      routeType: routeType || "road",
      isBidirectional: isBidirectional !== false,
      data: {},
      createdAt: isoNow(),
      updatedAt: isoNow()
    };

    const databaseMode = getDatabaseMode();
    await (databaseMode === "postgres"
      ? withTransaction(async (client) => {
          await cameraAdjacencyRepository.upsert(adjacency, client);
        })
      : (async () => {
          await cameraAdjacencyRepository.upsert(adjacency, db);
          await writeDatabase(db);
        })()
    );

    addAuditLog(db, "camera_adjacency_created", user, adjacency.id, `Created adjacency between ${cameraAId} and ${cameraBId}`, isoNow());

    res.status(201).json({ adjacency });
  } catch (error) {
    next(error);
  }
};

exports.updateScoreConfig = async (req, res, next) => {
  try {
    const { db, user } = await authenticate(req, ["Admin"]);
    const { trackType, weightKey, weightValue, description } = req.body;

    if (!trackType || !weightKey || weightValue == null) {
      throw Object.assign(new Error("trackType, weightKey, weightValue are required"), { status: 400 });
    }
    const normalizedTrackType = String(trackType).toUpperCase();
    const allowedWeights = {
      PERSON: trackingService.DEFAULT_PERSON_WEIGHTS,
      VEHICLE: trackingService.DEFAULT_VEHICLE_WEIGHTS,
      OBJECT: trackingService.DEFAULT_OBJECT_WEIGHTS,
      ANIMAL: trackingService.DEFAULT_ANIMAL_WEIGHTS
    };
    if (!allowedWeights[normalizedTrackType] || !Object.prototype.hasOwnProperty.call(allowedWeights[normalizedTrackType], weightKey)) {
      throw Object.assign(new Error("Unsupported score weight for this tracking type"), { status: 400 });
    }
    if (!Number.isFinite(Number(weightValue)) || Number(weightValue) < 0 || Number(weightValue) > 1) {
      throw Object.assign(new Error("weightValue must be between 0 and 1"), { status: 400 });
    }

    const config = {
      id: uid("cfg"),
      trackType: normalizedTrackType,
      weightKey,
      weightValue: Number(weightValue),
      description: description || null,
      isActive: true,
      data: {},
      createdAt: isoNow(),
      updatedAt: isoNow()
    };

    const databaseMode = getDatabaseMode();
    await (databaseMode === "postgres"
      ? withTransaction(async (client) => {
          await trackingScoreConfigRepository.upsert(config, client);
        })
      : (async () => {
          await trackingScoreConfigRepository.upsert(config, db);
          await writeDatabase(db);
        })()
    );

    res.json({ config });
  } catch (error) {
    next(error);
  }
};

exports.getScoreConfig = async (req, res, next) => {
  try {
    const { db, user } = await authenticate(req, ["Police Officer", "Admin"]);
    const { trackType } = req.query;
    const configs = await trackingScoreConfigRepository.list(db);
    const filtered = trackType ? configs.filter((c) => c.trackType === trackType.toUpperCase()) : configs;
    res.json({ configs: filtered });
  } catch (error) {
    next(error);
  }
};

exports.__testables = {
  validateTrackingSessionInput,
  validateVerificationInput,
  trackingRecommendations
};
