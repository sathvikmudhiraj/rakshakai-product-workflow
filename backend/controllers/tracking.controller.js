const crypto = require("node:crypto");
const trackingService = require("../services/multiCameraTracking.service");
const trackingSessionsRepository = require("../repositories/trackingSessions.repository");
const trackingObservationsRepository = require("../repositories/trackingObservations.repository");
const trackingCandidatesRepository = require("../repositories/trackingCandidates.repository");
const trackingVerificationsRepository = require("../repositories/trackingVerifications.repository");
const cameraAdjacencyRepository = require("../repositories/cameraAdjacency.repository");
const cameraSourcesRepository = require("../repositories/cameraSources.repository");
const { readDatabase, writeDatabase, userFromReq, hasRole, addAuditLog } = require("../services/core.service");
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
  if (!["PERSON", "VEHICLE"].includes(trackType)) {
    throw Object.assign(new Error("trackType must be PERSON or VEHICLE"), { status: 400 });
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
  return { trackType, referenceDetectionId, referenceCameraId, referenceTimestamp, incidentId, alertId, evidenceId, referenceObservation };
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
    const databaseMode = getDatabaseMode();

    const result = await (databaseMode === "postgres"
      ? withTransaction(async (client) => {
          const session = await trackingService.createTrackingSession(
            { ...db, client },
            { ...input, createdBy: user.id }
          );
          if (input.referenceObservation) {
            await trackingService.createObservation(
              { ...db, client },
              { sessionId: session.id, ...input.referenceObservation }
            );
          }
          return session;
        })
      : (async () => {
          const session = await trackingService.createTrackingSession(db, { ...input, createdBy: user.id });
          if (input.referenceObservation) {
            await trackingService.createObservation(db, { sessionId: session.id, ...input.referenceObservation });
          }
          await writeDatabase(db);
          return session;
        })()
    );

    addAuditLog(db, "tracking_session_created", user, result.id, `Created ${input.trackType} tracking session from camera ${input.referenceCameraId}`, isoNow());

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

    const observations = (await trackingObservationsRepository.list(db)).filter((o) => o.sessionId === sessionId);
    const candidates = (await trackingCandidatesRepository.list(db)).filter((c) => c.sessionId === sessionId);
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

    let candidates;
    if (session.trackType === TRACK_TYPES.PERSON) {
      candidates = await trackingService.searchCandidatesForPerson(db, session, referenceObs, parseInt(timeWindowMinutes, 10));
    } else {
      candidates = await trackingService.searchCandidatesForVehicle(db, session, referenceObs, parseInt(timeWindowMinutes, 10));
    }

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

    addAuditLog(db, "tracking_search_performed", user, sessionId, `Found ${candidates.length} candidates`, isoNow());

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

          candidate.status = decision === "CONFIRM_MATCH" ? "CONFIRMED" : decision === "REJECT_MATCH" ? "REJECTED" : "UNCERTAIN";
          candidate.reviewedAt = isoNow();
          candidate.reviewedBy = user.id;
          candidate.reviewReason = reason;
          await trackingCandidatesRepository.upsert(candidate, client);

          if (decision === "CONFIRM_MATCH") {
            const obs = (await trackingObservationsRepository.list({ ...db, client })).find((o) => o.id === candidate.observationId);
            if (obs) {
              session.lastSeenCameraId = obs.cameraId;
              session.lastSeenAt = obs.detectedAt;
              session.confidence = candidate.overallConfidence;
              session.verificationStatus = "CONFIRMED";
              if (session.status !== "CONFIRMED" && session.status !== "CLOSED") {
                session.status = "HUMAN_REVIEW";
              }
              session.updatedAt = isoNow();
              await trackingSessionsRepository.upsert(session, client);
            }
          } else if (decision === "REJECT_MATCH") {
            session.verificationStatus = "REJECTED";
            session.updatedAt = isoNow();
            await trackingSessionsRepository.upsert(session, client);
          }

          addAuditLog({ ...db, client }, "tracking_candidate_verified", user, sessionId, `Candidate ${candidateId} ${decision.toLowerCase().replace("_", " ")}: ${reason || "No reason provided"}`, isoNow());
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

          candidate.status = decision === "CONFIRM_MATCH" ? "CONFIRMED" : decision === "REJECT_MATCH" ? "REJECTED" : "UNCERTAIN";
          candidate.reviewedAt = isoNow();
          candidate.reviewedBy = user.id;
          candidate.reviewReason = reason;
          await trackingCandidatesRepository.upsert(candidate, db);

          if (decision === "CONFIRM_MATCH") {
            const obs = (await trackingObservationsRepository.list(db)).find((o) => o.id === candidate.observationId);
            if (obs) {
              session.lastSeenCameraId = obs.cameraId;
              session.lastSeenAt = obs.detectedAt;
              session.confidence = candidate.overallConfidence;
              session.verificationStatus = "CONFIRMED";
              if (session.status !== "CONFIRMED" && session.status !== "CLOSED") {
                session.status = "HUMAN_REVIEW";
              }
              session.updatedAt = isoNow();
              await trackingSessionsRepository.upsert(session, db);
            }
          } else if (decision === "REJECT_MATCH") {
            session.verificationStatus = "REJECTED";
            session.updatedAt = isoNow();
            await trackingSessionsRepository.upsert(session, db);
          }

          addAuditLog(db, "tracking_candidate_verified", user, sessionId, `Candidate ${candidateId} ${decision.toLowerCase().replace("_", " ")}: ${reason || "No reason provided"}`, isoNow());
          await writeDatabase(db);
        })()
    );

    emitTrackingEvent("tracking_candidate_verified", { sessionId, candidateId, decision, reason, verifiedBy: user.id });

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

    addAuditLog(db, "tracking_session_closed", user, sessionId, "Tracking session closed by operator", isoNow());
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

    const observations = (await trackingObservationsRepository.list(db))
      .filter((o) => o.sessionId === sessionId)
      .sort((a, b) => new Date(a.detectedAt).getTime() - new Date(b.detectedAt).getTime());

    const candidates = (await trackingCandidatesRepository.list(db))
      .filter((c) => c.sessionId === sessionId)
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

    const observations = (await trackingObservationsRepository.list(db))
      .filter((o) => o.sessionId === sessionId)
      .sort((a, b) => new Date(a.detectedAt).getTime() - new Date(b.detectedAt).getTime());

    const candidates = (await trackingCandidatesRepository.list(db))
      .filter((c) => c.sessionId === sessionId && c.status === "CONFIRMED");

    const confirmedObsIds = new Set(candidates.map((c) => c.observationId));
    const confirmedObservations = observations.filter((o) => confirmedObsIds.has(o.id));

    const trackPoints = [];
    const allTrackObs = [session.referenceCameraId, ...confirmedObservations.map((o) => o.cameraId)];
    for (const camId of allTrackObs) {
      const cam = (db.cameraSources || []).find((c) => c.id === camId);
      if (cam?.latitude && cam?.longitude) {
        const obs = observations.find((o) => o.cameraId === camId) || confirmedObservations.find((o) => o.cameraId === camId);
        trackPoints.push({
          cameraId: cam.id,
          cameraName: cam.name || cam.cameraId,
          lat: cam.latitude,
          lng: cam.longitude,
          timestamp: obs?.detectedAt,
          isReference: camId === session.referenceCameraId,
          isLastSeen: camId === session.lastSeenCameraId
        });
      }
    }

    res.json({
      session,
      trackPoints,
      referenceCamera: trackPoints.find((p) => p.isReference),
      lastSeenCamera: trackPoints.find((p) => p.isLastSeen)
    });
  } catch (error) {
    next(error);
  }
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

    const config = {
      id: uid("cfg"),
      trackType: trackType.toUpperCase(),
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
  validateVerificationInput
};