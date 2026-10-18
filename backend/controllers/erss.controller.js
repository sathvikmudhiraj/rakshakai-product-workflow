const { readDatabase, writeErssChanges, hasRole, userFromReq } = require("../services/core.service");
const snapshots = new WeakMap();
const realtimeEvents = require("../services/realtimeEvents.service");
async function writeDatabase(db) { return writeErssChanges(db, snapshots.get(db)); }
const {
  createErssEvent,
  updateErssEvent,
  createErssCall,
  endErssCall,
  createTriage,
  createDispatchRequest,
  approveDispatchRequest,
  createUnitRequest,
  acknowledgeUnitRequest,
  acceptUnitRequest,
  timeoutUnitRequest,
  recommendFallbackUnit,
  createAssistanceRequest,
  acknowledgeAssistanceRequest,
  acceptAssistanceRequest,
  declineAssistanceRequest,
  timeoutAssistanceRequest,
  createOwnershipTransfer,
  acknowledgeOwnershipTransfer,
  completeOwnershipTransfer,
  simulateErssEvent,
  getErssEventWithDetails,
  getDispatcherWorkload,
  getSupervisorQueue,
  calculateUnitRecommendations,
  determineJurisdiction,
  DEFAULT_ACK_TIMEOUT,
  DEFAULT_ASSISTANCE_ACK_TIMEOUT,
  TRIAGE_STATUSES,
  TRIAGE_ACTIONS,
  UNIT_REQUEST_STATUSES,
  ASSISTANCE_STATUSES,
  DISPATCH_REQUEST_STATUSES,
  OWNERSHIP_TRANSFER_STATUSES,
  DECLINE_REASONS,
  EMERGENCY_TYPES,
  PRIORITIES,
  isValidTriageStatus,
  isValidUnitRequestStatus,
  isValidAssistanceStatus,
  isValidDispatchRequestStatus,
  isValidOwnershipTransferStatus,
  isValidDeclineReason,
  isValidEmergencyType,
  isValidPriority
} = require("../services/erss.service");

async function requireErssRole(req, allowedRoles) {
  const db = await readDatabase();
  snapshots.set(db, structuredClone(db));
  const user = userFromReq(req, db);
  if (!user) throw Object.assign(new Error("Authentication required"), { status: 401 });
  if (!hasRole(user, ["Admin", "Police Officer"])) {
    throw Object.assign(new Error("Police or Admin role required"), { status: 403 });
  }
  if (allowedRoles && allowedRoles.length > 0 && user.role !== "Admin") {
    const operationalRole = user.operationalRole || user.data?.operationalRole;
    if (!operationalRole || !allowedRoles.includes(operationalRole)) {
      throw Object.assign(new Error(`Required operational role: ${allowedRoles.join(", ")}`), { status: 403 });
    }
  }
  return { db, user };
}

function operationalStationIds(db, user) {
  const stationIds = new Set([user.stationId, user.data?.stationId].filter(Boolean));
  for (const officer of db.policeOfficers || []) {
    if (officer.userId === user.id || officer.officerUserId === user.id) stationIds.add(officer.stationId);
  }
  for (const membership of db.responseUnitMembers || []) {
    if (membership.officerUserId !== user.id) continue;
    const unit = (db.responseUnits || []).find((item) => item.id === membership.unitId);
    if (unit?.stationId) stationIds.add(unit.stationId);
  }
  return stationIds;
}

function assertStationAuthority(db, user, stationId) {
  if (user.role === "Admin") return;
  if (!stationId || !operationalStationIds(db, user).has(stationId)) {
    throw Object.assign(new Error("You are not authorized for this station"), { status: 403 });
  }
}

function assertUnitAuthority(db, user, unitId) {
  if (user.role === "Admin") return;
  const unit = (db.responseUnits || []).find((item) => item.id === unitId);
  if (!unit) throw Object.assign(new Error("Unit not found"), { status: 404 });
  const isDispatcher = ["DISPATCHER", "SUPERVISOR"].includes(user.operationalRole || user.data?.operationalRole);
  const hasMembership = (db.responseUnitMembers || []).some((item) => item.unitId === unitId && item.officerUserId === user.id);
  const officerHasUnit = (db.policeOfficers || []).some((item) =>
    (item.userId === user.id || item.officerUserId === user.id) &&
    (item.assignedUnitId === unitId || item.unitId === unitId)
  );
  if ((isDispatcher && operationalStationIds(db, user).has(unit.stationId)) || hasMembership || officerHasUnit) return;
  throw Object.assign(new Error("You are not authorized for this unit"), { status: 403 });
}

function validateBody(requiredFields) {
  return (req, res, next) => {
    for (const field of requiredFields) {
      if (req.body[field] === undefined || req.body[field] === null || req.body[field] === "") {
        return res.status(400).json({ error: `Missing required field: ${field}` });
      }
    }
    next();
  };
}

exports.listEvents = async (req, res, next) => {
  try {
    await requireErssRole(req);
    const db = await readDatabase();
    const { status, priority, jurisdictionId, callTakerId, dispatcherId, limit = 50, offset = 0 } = req.query;
    let events = db.erssEvents || [];
    if (status) events = events.filter(e => e.triageStatus === status);
    if (priority) events = events.filter(e => e.priority === priority);
    if (jurisdictionId) events = events.filter(e => e.jurisdictionId === jurisdictionId);
    if (callTakerId) events = events.filter(e => e.callTakerId === callTakerId);
    if (dispatcherId) events = events.filter(e => e.dispatcherId === dispatcherId);
    events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const total = events.length;
    events = events.slice(Number(offset), Number(offset) + Number(limit));
    res.json({ events, total, limit: Number(limit), offset: Number(offset) });
  } catch (error) {
    next(error);
  }
};

exports.createEvent = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["CALL_TAKER"]);
    const event = await createErssEvent(db, req.body, user);
    db.erssEvents = db.erssEvents || [];
    db.erssEvents.push(event);
    await writeDatabase(db);
    res.status(201).json({ event });
  } catch (error) {
    next(error);
  }
};

exports.simulateEvent = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req);
    if (user.role !== "Admin") return res.status(403).json({ error: "Admin role required" });
    const { event, call } = await simulateErssEvent(db, req.body, user);
    await writeDatabase(db);
    res.status(201).json({ event, call, simulated: true });
  } catch (error) {
    next(error);
  }
};

exports.getEvent = async (req, res, next) => {
  try {
    await requireErssRole(req);
    const db = await readDatabase();
    const details = await getErssEventWithDetails(db, req.params.id);
    if (!details) return res.status(404).json({ error: "Event not found" });
    res.json(details);
  } catch (error) {
    next(error);
  }
};

exports.updateEvent = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["CALL_TAKER", "DISPATCHER", "SUPERVISOR"]);
    const event = await updateErssEvent(db, req.params.id, req.body, user);
    await writeDatabase(db);
    res.json({ event });
  } catch (error) {
    next(error);
  }
};

exports.updateLocation = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["CALL_TAKER", "DISPATCHER"]);
    const { incidentLatitude, incidentLongitude, incidentLocationText, locationSource, locationConfidence } = req.body;
    if (!Number.isFinite(incidentLatitude) || !Number.isFinite(incidentLongitude)) {
      return res.status(400).json({ error: "Valid incident coordinates required" });
    }
    const jurisdictionResult = await determineJurisdiction(db, incidentLatitude, incidentLongitude);
    const updates = {
      incidentLatitude,
      incidentLongitude,
      incidentLocationText,
      locationSource: locationSource || "MANUAL_OPERATOR",
      locationConfidence,
      jurisdictionId: jurisdictionResult.station?.id || null
    };
    const event = await updateErssEvent(db, req.params.id, updates, user);
    await writeDatabase(db);
    res.json({ event, jurisdiction: jurisdictionResult });
  } catch (error) {
    next(error);
  }
};

exports.updateJurisdiction = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["DISPATCHER", "SUPERVISOR"]);
    const { jurisdictionId, reason } = req.body;
    if (!jurisdictionId) return res.status(400).json({ error: "jurisdictionId required" });
    const updates = { jurisdictionId, jurisdictionChangeReason: reason };
    const event = await updateErssEvent(db, req.params.id, updates, user);
    await writeDatabase(db);
    res.json({ event });
  } catch (error) {
    next(error);
  }
};

exports.listCalls = async (req, res, next) => {
  try {
    await requireErssRole(req);
    const db = await readDatabase();
    const calls = (db.erssCalls || []).filter(c => c.erssEventId === req.params.id);
    res.json({ calls });
  } catch (error) {
    next(error);
  }
};

exports.createCall = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["CALL_TAKER"]);
    const call = await createErssCall(db, req.params.id, user.id);
    await writeDatabase(db);
    res.status(201).json({ call });
  } catch (error) {
    next(error);
  }
};

exports.updateCall = async (req, res, next) => {
  try {
    const { db } = await requireErssRole(req, ["CALL_TAKER"]);
    const call = db.erssCalls?.find(c => c.id === req.params.callId);
    if (!call) return res.status(404).json({ error: "Call not found" });
    const allowed = ["status", "transcript", "aiSummary", "aiSuggestions", "notes"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) call[key] = req.body[key];
    }
    call.updatedAt = new Date().toISOString();
    await writeDatabase(db);
    res.json({ call });
  } catch (error) {
    next(error);
  }
};

exports.endCall = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["CALL_TAKER"]);
    const { transcript, aiSummary, aiSuggestions } = req.body;
    const call = await endErssCall(db, req.params.callId, transcript, aiSummary, aiSuggestions);
    await writeDatabase(db);
    res.json({ call });
  } catch (error) {
    next(error);
  }
};

exports.createTriage = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["CALL_TAKER"]);
    const { emergencyType, priority, callerLocationVerified, incidentLocationVerified, immediateDanger, description, aiEmergencyTypeSuggestion, aiPrioritySuggestion, aiJurisdictionSuggestion, humanConfirmed, actionTaken } = req.body;
    if (!isValidEmergencyType(emergencyType)) return res.status(400).json({ error: "Invalid emergency type" });
    if (!isValidPriority(priority)) return res.status(400).json({ error: "Invalid priority" });
    if (actionTaken && !TRIAGE_ACTIONS.includes(actionTaken)) return res.status(400).json({ error: "Invalid action taken" });
    const triage = await createTriage(db, req.params.id, user.id, req.body);
    await writeDatabase(db);
    res.status(201).json({ triage });
  } catch (error) {
    next(error);
  }
};

exports.getTriage = async (req, res, next) => {
  try {
    await requireErssRole(req);
    const db = await readDatabase();
    const triage = db.erssTriage?.find(t => t.erssEventId === req.params.id);
    res.json({ triage });
  } catch (error) {
    next(error);
  }
};

exports.createDispatchRequest = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["DISPATCHER"]);
    const { recommendedServices, primary, fallbacks } = req.body;
    if (!primary) return res.status(400).json({ error: "Primary recommendation required" });
    const request = await createDispatchRequest(db, req.params.id, user.id, { services: recommendedServices, primary, fallbacks });
    await writeDatabase(db);
    res.status(201).json({ request });
  } catch (error) {
    next(error);
  }
};

exports.getDispatchRequest = async (req, res, next) => {
  try {
    await requireErssRole(req);
    const db = await readDatabase();
    const request = db.erssDispatchRequests?.find(r => r.erssEventId === req.params.id);
    if (!request) return res.status(404).json({ error: "Dispatch request not found" });
    res.json({ request });
  } catch (error) {
    next(error);
  }
};

exports.approveDispatchRequest = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["DISPATCHER"]);
    const { primary, fallbacks } = req.body;
    const request = await approveDispatchRequest(db, req.params.requestId, user, { primary, fallbacks });
    await writeDatabase(db);
    res.json({ request });
  } catch (error) {
    next(error);
  }
};

exports.rejectDispatchRequest = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["DISPATCHER", "SUPERVISOR"]);
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: "Rejection reason required" });
    const request = db.erssDispatchRequests?.find(r => r.id === req.params.requestId);
    if (!request) return res.status(404).json({ error: "Dispatch request not found" });
    request.status = "REJECTED";
    request.rejectionReason = reason;
    request.updatedAt = new Date().toISOString();
    await writeDatabase(db);
    res.json({ request });
  } catch (error) {
    next(error);
  }
};

exports.createUnitRequest = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["DISPATCHER"]);
    const { unitId, serviceType, ackTimeoutSeconds } = req.body;
    if (!unitId || !serviceType) return res.status(400).json({ error: "unitId and serviceType required" });
    const dispatchRequest = db.erssDispatchRequests?.find(r => r.id === req.params.requestId);
    if (!dispatchRequest) return res.status(404).json({ error: "Dispatch request not found" });
    const event = db.erssEvents?.find((item) => item.id === dispatchRequest.erssEventId);
    if (!event) return res.status(409).json({ error: "Dispatch request has no valid ERSS event" });
    assertUnitAuthority(db, user, unitId);
    const request = await createUnitRequest(db, dispatchRequest.id, event.id, unitId, serviceType, ackTimeoutSeconds || DEFAULT_ACK_TIMEOUT, user);
    await writeDatabase(db);
    res.status(201).json({ request });
  } catch (error) {
    next(error);
  }
};

exports.listUnitRequests = async (req, res, next) => {
  try {
    await requireErssRole(req);
    const db = await readDatabase();
    const requests = (db.erssUnitRequests || []).filter(r => r.erssDispatchRequestId === req.params.requestId);
    res.json({ requests });
  } catch (error) {
    next(error);
  }
};

exports.acknowledgeUnitRequest = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["FIELD_OFFICER", "DISPATCHER"]);
    const { unitId } = req.body;
    if (!unitId) return res.status(400).json({ error: "unitId required" });
    assertUnitAuthority(db, user, unitId);
    const request = await acknowledgeUnitRequest(db, req.params.requestId, unitId, user);
    await writeDatabase(db);
    res.json({ request });
  } catch (error) {
    next(error);
  }
};

exports.acceptUnitRequest = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["FIELD_OFFICER", "DISPATCHER"]);
    const { unitId } = req.body;
    if (!unitId) return res.status(400).json({ error: "unitId required" });
    assertUnitAuthority(db, user, unitId);
    const request = await acceptUnitRequest(db, req.params.requestId, unitId, user);
    await writeDatabase(db);
    res.json({ request });
  } catch (error) {
    next(error);
  }
};

exports.declineUnitRequest = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["FIELD_OFFICER", "DISPATCHER"]);
    const { unitId, reason, notes } = req.body;
    if (!unitId || !reason) return res.status(400).json({ error: "unitId and reason required" });
    assertUnitAuthority(db, user, unitId);
    if (!DECLINE_REASONS.includes(reason)) {
      return res.status(400).json({ error: "Invalid decline reason" });
    }
    const request = db.erssUnitRequests?.find(r => r.id === req.params.requestId && r.unitId === unitId);
    if (!request) return res.status(404).json({ error: "Unit request not found" });
    request.status = "DECLINED";
    request.declineReason = reason;
    request.declineNotes = notes;
    request.updatedAt = new Date().toISOString();
    await writeDatabase(db);
    res.json({ request });
  } catch (error) {
    next(error);
  }
};

exports.timeoutUnitRequest = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["DISPATCHER", "SUPERVISOR"]);
    const request = await timeoutUnitRequest(db, req.params.requestId, user);
    await writeDatabase(db);
    res.json({ request });
  } catch (error) {
    next(error);
  }
};

exports.recommendFallbackUnit = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["DISPATCHER", "SUPERVISOR"]);
    const { excludeUnitIds } = req.body;
    const fallback = await recommendFallbackUnit(db, req.params.id, req.body.originalUnitId, excludeUnitIds || [], user);
    if (!fallback) return res.status(404).json({ error: "No fallback unit available" });
    await writeDatabase(db);
    res.json({ fallback });
  } catch (error) {
    next(error);
  }
};

exports.createAssistanceRequest = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["DISPATCHER", "SUPERVISOR"]);
    const { requestedStationId, priority, reason, suggestedUnitId, suggestedEtaMinutes, incidentId } = req.body;
    if (!requestedStationId || !reason) return res.status(400).json({ error: "requestedStationId and reason required" });
    const event = db.erssEvents?.find((item) => item.id === req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const officer = (db.policeOfficers || []).find((item) => item.userId === user.id || item.officerUserId === user.id);
    const requestingStationId = officer?.stationId || user.stationId || user.data?.stationId || event.jurisdictionId;
    if (!requestingStationId) return res.status(409).json({ error: "Authenticated operational station is required" });
    // A dispatcher without a personal station may act only on an event that is
    // already assigned to them; the event's jurisdiction becomes the owner.
    if (operationalStationIds(db, user).size) assertStationAuthority(db, user, requestingStationId);
    else if (user.role !== "Admin" && event.dispatcherId !== user.id) {
      return res.status(403).json({ error: "You are not the assigned dispatcher for this event" });
    }
    const request = await createAssistanceRequest(db, event.id, requestingStationId, requestedStationId, { priority, reason, suggestedUnitId, suggestedEtaMinutes, incidentId: incidentId || event.incidentId }, user);
    await writeDatabase(db);
    res.status(201).json({ request });
  } catch (error) {
    next(error);
  }
};

exports.listAssistanceRequests = async (req, res, next) => {
  try {
    await requireErssRole(req);
    const db = await readDatabase();
    const requests = (db.erssAssistanceRequests || []).filter(r => r.erssEventId === req.params.id);
    res.json({ requests });
  } catch (error) {
    next(error);
  }
};

exports.acknowledgeAssistanceRequest = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["DISPATCHER", "SUPERVISOR"]);
    const { stationId } = req.body;
    if (!stationId) return res.status(400).json({ error: "stationId required" });
    assertStationAuthority(db, user, stationId);
    const request = await acknowledgeAssistanceRequest(db, req.params.requestId, stationId, user);
    await writeDatabase(db);
    res.json({ request });
  } catch (error) {
    next(error);
  }
};

exports.acceptAssistanceRequest = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["DISPATCHER", "SUPERVISOR"]);
    const { stationId, unitId } = req.body;
    if (!stationId) return res.status(400).json({ error: "stationId required" });
    assertStationAuthority(db, user, stationId);
    if (unitId) assertUnitAuthority(db, user, unitId);
    const request = await acceptAssistanceRequest(db, req.params.requestId, stationId, unitId, user);
    await writeDatabase(db);
    res.json({ request });
  } catch (error) {
    next(error);
  }
};

exports.declineAssistanceRequest = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["DISPATCHER", "SUPERVISOR"]);
    const { stationId, reason, notes } = req.body;
    if (!stationId || !reason) return res.status(400).json({ error: "stationId and reason required" });
    assertStationAuthority(db, user, stationId);
    if (!isValidDeclineReason(reason)) return res.status(400).json({ error: "Invalid decline reason" });
    if (reason === "OTHER" && !notes) return res.status(400).json({ error: "Notes required for OTHER reason" });
    const request = await declineAssistanceRequest(db, req.params.requestId, stationId, reason, notes, user);
    await writeDatabase(db);
    res.json({ request });
  } catch (error) {
    next(error);
  }
};

exports.timeoutAssistanceRequest = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["SUPERVISOR"]);
    const request = await timeoutAssistanceRequest(db, req.params.requestId, user);
    await writeDatabase(db);
    res.json({ request });
  } catch (error) {
    next(error);
  }
};

exports.createOwnershipTransfer = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["SUPERVISOR"]);
    const { toStationId, reason } = req.body;
    if (!toStationId) return res.status(400).json({ error: "toStationId required" });
    const event = db.erssEvents?.find(e => e.id === req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const fromStationId = event.jurisdictionId;
    if (!fromStationId) return res.status(400).json({ error: "No current jurisdiction to transfer from" });
    assertStationAuthority(db, user, fromStationId);
    const transfer = await createOwnershipTransfer(db, req.params.id, fromStationId, toStationId, user.id, reason, user);
    await writeDatabase(db);
    res.status(201).json({ transfer });
  } catch (error) {
    next(error);
  }
};

exports.listOwnershipTransfers = async (req, res, next) => {
  try {
    await requireErssRole(req);
    const db = await readDatabase();
    const transfers = (db.erssOwnershipTransfers || []).filter(t => t.erssEventId === req.params.id);
    res.json({ transfers });
  } catch (error) {
    next(error);
  }
};

exports.acknowledgeOwnershipTransfer = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["DISPATCHER", "SUPERVISOR"]);
    const { stationId } = req.body;
    if (!stationId) return res.status(400).json({ error: "stationId required" });
    assertStationAuthority(db, user, stationId);
    const transfer = await acknowledgeOwnershipTransfer(db, req.params.transferId, stationId, user);
    await writeDatabase(db);
    res.json({ transfer });
  } catch (error) {
    next(error);
  }
};

exports.completeOwnershipTransfer = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["SUPERVISOR"]);
    const { stationId } = req.body;
    if (!stationId) return res.status(400).json({ error: "stationId required" });
    assertStationAuthority(db, user, stationId);
    const transfer = await completeOwnershipTransfer(db, req.params.transferId, stationId, user);
    await writeDatabase(db);
    res.json({ transfer });
  } catch (error) {
    next(error);
  }
};

exports.getJurisdictionHistory = async (req, res, next) => {
  try {
    await requireErssRole(req);
    const db = await readDatabase();
    const history = (db.erssJurisdictionHistory || []).filter(h => h.erssEventId === req.params.eventId);
    res.json({ history });
  } catch (error) {
    next(error);
  }
};

exports.getDispatcherWorkload = async (req, res, next) => {
  try {
    const { db, user } = await requireErssRole(req, ["DISPATCHER", "SUPERVISOR"]);
    const workload = await getDispatcherWorkload(db, user.id);
    res.json({ workload });
  } catch (error) {
    next(error);
  }
};

exports.getSupervisorQueue = async (req, res, next) => {
  try {
    const { db } = await requireErssRole(req, ["SUPERVISOR"]);
    const queue = await getSupervisorQueue(db);
    res.json({ queue });
  } catch (error) {
    next(error);
  }
};

exports.getRecommendations = async (req, res, next) => {
  try {
    await requireErssRole(req, ["DISPATCHER", "SUPERVISOR"]);
    const db = await readDatabase();
    const event = db.erssEvents?.find(e => e.id === req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const recommendations = await calculateUnitRecommendations(db, event, {});
    res.json({ recommendations });
  } catch (error) {
    next(error);
  }
};

exports.refreshRecommendations = async (req, res, next) => {
  try {
    const { db } = await requireErssRole(req, ["DISPATCHER", "SUPERVISOR"]);
    const event = db.erssEvents?.find(e => e.id === req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const recommendations = await calculateUnitRecommendations(db, event, {});
    const dispatchRequest = db.erssDispatchRequests?.find(r => r.erssEventId === req.params.id);
    if (dispatchRequest) {
      dispatchRequest.primaryRecommendation = recommendations.primary;
      dispatchRequest.fallbackRecommendations = recommendations.fallbacks;
      dispatchRequest.updatedAt = new Date().toISOString();
    }
    await writeDatabase(db);
    res.json({ recommendations });
  } catch (error) {
    next(error);
  }
};

// Publish workflow events only after their save succeeds. A rejected concurrent
// edit or failed transaction must not announce a dispatch that never persisted.
for (const [name, handler] of Object.entries(exports)) {
  exports[name] = async (req, res, next) => {
    if (["GET", "HEAD"].includes(req.method)) return handler(req, res, next);
    try {
      return await realtimeEvents.withDeferredEvents(() => handler(req, res, (error) => { throw error; }));
    } catch (error) { next(error); }
  };
}
