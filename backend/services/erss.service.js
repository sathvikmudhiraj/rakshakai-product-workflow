const { uid, now, addAuditLog, createIncidentRecord } = require("../services/core.service");
const {
  buildRoute,
  haversineDistanceKm
} = require("../services/core.service");
const { normalized } = require("../services/hybridDispatch.service");
const realtimeEvents = require("./realtimeEvents.service");
const { ERSS_REALTIME_EVENTS } = require("./erssRealtimeEvents.service");

const ERSS_CHANNELS = ["VOICE_CALL", "SMS", "SOS", "APP", "WEB", "IOT", "EXTERNAL_EVENT"];
const LOCATION_SOURCES = ["CALLER_CONFIRMED", "GPS", "DEVICE", "MANUAL_OPERATOR", "REVERSE_GEOCODED", "EXTERNAL_EVENT", "UNKNOWN"];
const EMERGENCY_TYPES = ["POLICE", "FIRE", "MEDICAL", "DISASTER", "MULTI_SERVICE", "ASSESSING"];
const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "ASSESSING"];
const CALL_STATUSES = ["IN_PROGRESS", "COMPLETED", "DROPPED", "CALLBACK"];
const TRIAGE_STATUSES = ["RECEIVED", "CALL_IN_PROGRESS", "TRIAGING", "ACTIONABLE", "VERIFYING", "ACCIDENTAL", "FALSE_ALARM", "NUISANCE", "DISPATCH_RECOMMENDED", "DISPATCHED", "LEGAL_REVIEW", "CLOSED"];
const UNIT_REQUEST_STATUSES = ["REQUESTED", "ACKNOWLEDGED", "ACCEPTED", "UNAVAILABLE", "DECLINED", "TIMEOUT", "CANCELLED", "ESCALATED"];
const ASSISTANCE_STATUSES = ["REQUESTED", "ACKNOWLEDGED", "ACCEPTED", "DECLINED", "UNAVAILABLE", "TIMEOUT", "ESCALATED", "CANCELLED", "COMPLETED"];
const DECLINE_REASONS = ["NO_AVAILABLE_UNIT", "ACTIVE_CRITICAL_INCIDENT", "ROAD_BLOCKED", "RESOURCE_UNSUITABLE", "SERVICE_UNAVAILABLE", "OTHER"];
const OWNERSHIP_TRANSFER_STATUSES = ["TRANSFER_REQUESTED", "TARGET_ACKNOWLEDGED", "OWNERSHIP_TRANSFERRED", "REJECTED", "CANCELLED"];
const DISPATCH_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "MODIFIED", "ESCALATED"];
const TRIAGE_ACTIONS = ["MARK_ACTIONABLE", "NEED_VERIFICATION", "MARK_ACCIDENTAL", "MARK_FALSE_ALARM", "MARK_NUISANCE", "FORWARD_TO_DISPATCH", "ESCALATE_TO_SUPERVISOR"];
const TRIAGE_STATUS_BY_ACTION = Object.freeze({
  MARK_ACTIONABLE: "ACTIONABLE",
  NEED_VERIFICATION: "VERIFYING",
  MARK_ACCIDENTAL: "ACCIDENTAL",
  MARK_FALSE_ALARM: "FALSE_ALARM",
  MARK_NUISANCE: "NUISANCE",
  FORWARD_TO_DISPATCH: "DISPATCH_RECOMMENDED",
  ESCALATE_TO_SUPERVISOR: "LEGAL_REVIEW"
});

const DEFAULT_ACK_TIMEOUT = 60;
const DEFAULT_ASSISTANCE_ACK_TIMEOUT = 120;

function auditErss(db, action, actor, event, details, metadata = {}) {
  const audit = addAuditLog(db, action, actor, event?.incidentId || null, details);
  Object.assign(audit, { entityType: "erss_event", entityId: event?.id || null, metadata });
  return audit;
}

function ensureCanonicalIncident(db, event, actor) {
  if (event.incidentId) {
    const existing = (db.incidents || []).find((incident) => incident.id === event.incidentId);
    if (existing) return existing;
    event.incidentId = null;
  }
  if (!Number.isFinite(event.incidentLatitude) || !Number.isFinite(event.incidentLongitude)) {
    throw Object.assign(new Error("Verified incident location is required before dispatch"), { status: 409 });
  }
  const severity = ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(event.priority) ? event.priority : "MEDIUM";
  const incident = createIncidentRecord(db, {
    title: `ERSS-112 ${event.emergencyType || "Emergency"}`,
    category: "erss_112",
    severity,
    status: "Verified",
    source: "ERSS-112",
    sourceType: "erss_112",
    sourceName: "ERSS-112 Command Center",
    sourceRecordId: event.id,
    address: event.incidentLocationText || "Verified emergency location",
    lat: event.incidentLatitude,
    lng: event.incidentLongitude,
    locationSource: event.locationSource === "UNKNOWN" ? "manual_latlng" : "manual_latlng",
    locationStatus: "Verified",
    confidence: 1
  }, actor);
  event.incidentId = incident.id;
  event.updatedAt = now();
  auditErss(db, "erss_incident_created", actor, event, `Canonical incident ${incident.id} created`, { incidentId: incident.id });
  return incident;
}

function isValidChannel(channel) {
  return ERSS_CHANNELS.includes(channel);
}

function isValidLocationSource(source) {
  return LOCATION_SOURCES.includes(source);
}

function isValidEmergencyType(type) {
  return EMERGENCY_TYPES.includes(type);
}

function isValidPriority(priority) {
  return PRIORITIES.includes(priority);
}

function isValidCallStatus(status) {
  return CALL_STATUSES.includes(status);
}

function isValidTriageStatus(status) {
  return TRIAGE_STATUSES.includes(status);
}

function isValidUnitRequestStatus(status) {
  return UNIT_REQUEST_STATUSES.includes(status);
}

function isValidAssistanceStatus(status) {
  return ASSISTANCE_STATUSES.includes(status);
}

function isValidDeclineReason(reason) {
  return DECLINE_REASONS.includes(reason);
}

function isValidOwnershipTransferStatus(status) {
  return OWNERSHIP_TRANSFER_STATUSES.includes(status);
}

function isValidDispatchRequestStatus(status) {
  return DISPATCH_REQUEST_STATUSES.includes(status);
}

async function determineJurisdiction(db, incidentLat, incidentLng, callerLat, callerLng) {
  if (!Number.isFinite(incidentLat) || !Number.isFinite(incidentLng)) {
    if (Number.isFinite(callerLat) && Number.isFinite(callerLng)) {
      return { station: null, provisional: true, reason: "Incident location unknown, using caller location as provisional" };
    }
    return { station: null, provisional: true, reason: "No location available" };
  }

  let bestStation = null;
  let bestDistance = Infinity;

  for (const station of db.policeStations || []) {
    if (station.operational === false) continue;
    const stationLat = Number(station.latitude ?? station.lat);
    const stationLng = Number(station.longitude ?? station.lng);
    if (!Number.isFinite(stationLat) || !Number.isFinite(stationLng)) continue;

    const distance = haversineDistanceKm({ lat: incidentLat, lng: incidentLng }, { lat: stationLat, lng: stationLng });
    if (distance < bestDistance) {
      bestDistance = distance;
      bestStation = station;
    }
  }

  return {
    station: bestStation,
    provisional: false,
    distanceKm: bestDistance,
    reason: bestStation ? `Nearest station: ${bestStation.name} (${bestDistance.toFixed(1)} km)` : "No operational stations found"
  };
}

async function calculateUnitRecommendations(db, incident, requirements, excludeUnitIds = []) {
  const incidentLat = incident.incidentLatitude ?? incident.incident_latitude;
  const incidentLng = incident.incidentLongitude ?? incident.incident_longitude;

  if (!Number.isFinite(incidentLat) || !Number.isFinite(incidentLng)) {
    return { primary: null, fallbacks: [], error: "Incident location required for unit recommendations" };
  }

  const recommendations = [];

  for (const unit of db.responseUnits || []) {
    if (excludeUnitIds.includes(unit.id)) continue;
    if (unit.status !== "available" && unit.status !== "idle") continue;
    if (unit.operational === false) continue;

    const unitLat = unit.latitude;
    const unitLng = unit.longitude;
    if (!Number.isFinite(unitLat) || !Number.isFinite(unitLng)) continue;

    const distanceKm = haversineDistanceKm({ lat: incidentLat, lng: incidentLng }, { lat: unitLat, lng: unitLng });
    const route = await buildRoute({ lat: unitLat, lng: unitLng }, { lat: incidentLat, lng: incidentLng });
    const etaMinutes = route && route.durationSeconds ? Math.max(1, Math.round(route.durationSeconds / 60)) : Math.max(1, Math.round(distanceKm * 2));

    const station = db.policeStations?.find(s => s.id === unit.stationId);
    const workload = (db.incidents || []).filter(i => i.assignedUnitId === unit.id && !["closed", "rejected_/_false_alarm"].includes(normalized(i.status))).length;

    recommendations.push({
      unitId: unit.id,
      unitCode: unit.unitCode || unit.id,
      unit,
      stationId: station?.id,
      stationCode: station?.stationCode || station?.id,
      stationName: station?.name || "Unknown Station",
      distanceKm: Number(distanceKm.toFixed(2)),
      etaMinutes,
      route,
      workload,
      capabilityMatch: { matches: true },
      selectionReason: `Distance: ${distanceKm.toFixed(1)} km, ETA: ${etaMinutes} min, Workload: ${workload}`
    });
  }

  recommendations.sort((a, b) => a.etaMinutes - b.etaMinutes || a.distanceKm - b.distanceKm || a.workload - b.workload);

  const primary = recommendations[0] || null;
  const fallbacks = recommendations.slice(1, 4);

  return { primary, fallbacks, all: recommendations };
}

async function createErssEvent(db, data, user) {
  const {
    channel,
    simulated = false,
    callerReference,
    callerLatitude,
    callerLongitude,
    callerLocationText,
    incidentLatitude,
    incidentLongitude,
    incidentLocationText,
    locationSource = "UNKNOWN",
    locationConfidence,
    emergencyType = "ASSESSING",
    priority = "ASSESSING",
    callStatus = "IN_PROGRESS",
    triageStatus = "RECEIVED"
  } = data;

  if (!isValidChannel(channel)) throw new Error(`Invalid channel: ${channel}`);
  if (!isValidLocationSource(locationSource)) throw new Error(`Invalid location source: ${locationSource}`);
  if (!isValidEmergencyType(emergencyType)) throw new Error(`Invalid emergency type: ${emergencyType}`);
  if (!isValidPriority(priority)) throw new Error(`Invalid priority: ${priority}`);
  if (!isValidCallStatus(callStatus)) throw new Error(`Invalid call status: ${callStatus}`);
  if (!isValidTriageStatus(triageStatus)) throw new Error(`Invalid triage status: ${triageStatus}`);

  const jurisdictionResult = await determineJurisdiction(db, incidentLatitude, incidentLongitude, callerLatitude, callerLongitude);

  const event = {
    id: uid("erss"),
    externalEventId: data.externalEventId || `ERSS-112-${Date.now()}`,
    channel,
    simulated,
    callerReference,
    callerLatitude,
    callerLongitude,
    callerLocationText,
    incidentLatitude,
    incidentLongitude,
    incidentLocationText,
    locationSource,
    locationConfidence,
    jurisdictionId: jurisdictionResult.station?.id || null,
    emergencyType,
    priority,
    callStatus,
    triageStatus,
    callTakerId: user?.id || null,
    createdAt: now(),
    updatedAt: now()
  };

  auditErss(db, "erss_event_created", user, event, "ERSS event created", { channel, simulated: Boolean(simulated) });
  realtimeEvents.emit(ERSS_REALTIME_EVENTS.EVENT_RECEIVED, { event, simulated: Boolean(simulated) });
  return event;
}

async function updateErssEvent(db, eventId, updates, user) {
  const event = db.erssEvents?.find(e => e.id === eventId);
  if (!event) throw new Error("ERSS event not found");

  const allowedUpdates = [
    "callerLatitude", "callerLongitude", "callerLocationText",
    "incidentLatitude", "incidentLongitude", "incidentLocationText",
    "locationSource", "locationConfidence",
    "jurisdictionId", "emergencyType", "priority",
    "callStatus", "triageStatus",
    "dispatcherId", "incidentId"
  ];

  let jurisdictionChanged = false;
  const oldJurisdictionId = event.jurisdictionId;

  for (const key of allowedUpdates) {
    if (updates[key] !== undefined) {
      event[key] = updates[key];
      if (key === "jurisdictionId" && updates[key] !== oldJurisdictionId) {
        jurisdictionChanged = true;
      }
    }
  }

  event.updatedAt = now();

  if (jurisdictionChanged && updates.jurisdictionId) {
    const history = {
      id: uid("jur"),
      erssEventId: eventId,
      oldJurisdictionId,
      newJurisdictionId: updates.jurisdictionId,
      reason: updates.jurisdictionChangeReason || "Jurisdiction updated",
      changedBy: user?.id,
      changedAt: now()
    };
    db.erssJurisdictionHistory = db.erssJurisdictionHistory || [];
    db.erssJurisdictionHistory.push(history);
  }

  auditErss(db, "erss_event_updated", user, event, "ERSS event updated", { changedFields: Object.keys(updates).filter((key) => allowedUpdates.includes(key)) });
  realtimeEvents.emit(ERSS_REALTIME_EVENTS.EVENT_UPDATED, { event });

  return event;
}

async function createErssCall(db, erssEventId, callTakerId) {
  const call = {
    id: uid("call"),
    erssEventId,
    callTakerId,
    status: "ACTIVE",
    startedAt: now(),
    createdAt: now(),
    updatedAt: now()
  };
  db.erssCalls = db.erssCalls || [];
  db.erssCalls.push(call);
  realtimeEvents.emit(ERSS_REALTIME_EVENTS.CALL_STARTED, { call, eventId: erssEventId });
  return call;
}

async function endErssCall(db, callId, transcript, aiSummary, aiSuggestions) {
  const call = db.erssCalls?.find(c => c.id === callId);
  if (!call) throw new Error("Call not found");

  call.status = "ENDED";
  call.endedAt = now();
  call.durationSeconds = Math.round((new Date(call.endedAt) - new Date(call.startedAt)) / 1000);
  call.transcript = transcript;
  call.aiSummary = aiSummary;
  call.aiSuggestions = aiSuggestions;
  call.updatedAt = now();
  realtimeEvents.emit(ERSS_REALTIME_EVENTS.CALL_ENDED, { call, eventId: call.erssEventId });

  return call;
}

async function createTriage(db, erssEventId, callTakerId, data) {
  if (data.actionTaken && !TRIAGE_ACTIONS.includes(data.actionTaken)) throw new Error("Invalid triage action");
  if (data.actionTaken === "FORWARD_TO_DISPATCH" && !data.humanConfirmed) {
    throw Object.assign(new Error("Human confirmation is required before forwarding to dispatch"), { status: 409 });
  }
  const triage = {
    id: uid("triage"),
    erssEventId,
    callTakerId,
    emergencyType: data.emergencyType || "ASSESSING",
    priority: data.priority || "ASSESSING",
    callerLocationVerified: data.callerLocationVerified || false,
    incidentLocationVerified: data.incidentLocationVerified || false,
    immediateDanger: data.immediateDanger || false,
    description: data.description,
    aiEmergencyTypeSuggestion: data.aiEmergencyTypeSuggestion,
    aiPrioritySuggestion: data.aiPrioritySuggestion,
    aiJurisdictionSuggestion: data.aiJurisdictionSuggestion,
    humanConfirmed: data.humanConfirmed || false,
    actionTaken: data.actionTaken,
    createdAt: now(),
    updatedAt: now()
  };
  db.erssTriage = db.erssTriage || [];
  db.erssTriage.push(triage);

  const event = db.erssEvents?.find(e => e.id === erssEventId);
  if (event) {
    event.triageStatus = TRIAGE_STATUS_BY_ACTION[data.actionTaken] || "TRIAGING";
    event.emergencyType = data.emergencyType || event.emergencyType;
    event.priority = data.priority || event.priority;
    event.updatedAt = now();
    const actor = (db.users || []).find((user) => user.id === callTakerId) || null;
    auditErss(db, "erss_triage_completed", actor, event, `Triage action: ${data.actionTaken || "IN_PROGRESS"}`, { triageId: triage.id, actionTaken: data.actionTaken || null });
    realtimeEvents.emit(ERSS_REALTIME_EVENTS.TRIAGE_COMPLETED, { triage, event });
    if (data.actionTaken === "MARK_ACTIONABLE") realtimeEvents.emit(ERSS_REALTIME_EVENTS.ACTIONABLE, { event, triage });
    if (data.actionTaken === "FORWARD_TO_DISPATCH") realtimeEvents.emit(ERSS_REALTIME_EVENTS.DISPATCH_REQUIRED, { event, triage });
    if (data.actionTaken === "ESCALATE_TO_SUPERVISOR") realtimeEvents.emit(ERSS_REALTIME_EVENTS.SUPERVISOR_ESCALATED, { event, triage });
  }

  return triage;
}

async function createDispatchRequest(db, erssEventId, dispatcherId, recommendations) {
  const request = {
    id: uid("dispatch"),
    erssEventId,
    dispatcherId,
    recommendedServices: recommendations.services || [],
    primaryRecommendation: recommendations.primary || null,
    fallbackRecommendations: recommendations.fallbacks || [],
    status: "PENDING",
    createdAt: now(),
    updatedAt: now()
  };
  db.erssDispatchRequests = db.erssDispatchRequests || [];
  db.erssDispatchRequests.push(request);

  const event = db.erssEvents?.find(e => e.id === erssEventId);
  if (event) {
    event.dispatcherId = dispatcherId;
    event.triageStatus = "DISPATCH_RECOMMENDED";
    event.updatedAt = now();
  }

  return request;
}

async function approveDispatchRequest(db, requestId, user, modifiedRecommendations = null) {
  const request = db.erssDispatchRequests?.find(r => r.id === requestId);
  if (!request) throw new Error("Dispatch request not found");

  if (modifiedRecommendations) {
    request.primaryRecommendation = modifiedRecommendations.primary || request.primaryRecommendation;
    request.fallbackRecommendations = modifiedRecommendations.fallbacks || request.fallbackRecommendations;
  }

  request.status = "APPROVED";
  request.approvedAt = now();
  request.approvedBy = user.id;
  request.updatedAt = now();

  const event = db.erssEvents?.find(e => e.id === request.erssEventId);
  if (event) {
    ensureCanonicalIncident(db, event, user);
    event.triageStatus = "DISPATCH_RECOMMENDED";
    event.updatedAt = now();
  }
  auditErss(db, "erss_dispatch_approved", user, event, `Dispatch request ${request.id} approved`, { dispatchRequestId: request.id });
  realtimeEvents.emit(ERSS_REALTIME_EVENTS.DISPATCH_APPROVED, { request, event });

  return request;
}

async function createUnitRequest(db, dispatchRequestId, erssEventId, unitId, serviceType, ackTimeoutSeconds = DEFAULT_ACK_TIMEOUT, actor = null) {
  const unit = db.responseUnits?.find(u => u.id === unitId);
  if (!unit) throw new Error("Unit not found");
  const dispatchRequest = db.erssDispatchRequests?.find((item) => item.id === dispatchRequestId);
  if (!dispatchRequest || dispatchRequest.erssEventId !== erssEventId) {
    throw Object.assign(new Error("Dispatch request does not belong to this ERSS event"), { status: 409 });
  }

  const station = db.policeStations?.find(s => s.id === unit.stationId);

  const request = {
    id: uid("unitreq"),
    erssDispatchRequestId: dispatchRequestId,
    erssEventId,
    unitId,
    stationId: station?.id,
    serviceType,
    status: "REQUESTED",
    requestedAt: now(),
    ackTimeoutSeconds,
    timeoutAt: new Date(Date.now() + ackTimeoutSeconds * 1000).toISOString(),
    createdAt: now(),
    updatedAt: now()
  };
  db.erssUnitRequests = db.erssUnitRequests || [];
  db.erssUnitRequests.push(request);

  auditErss(db, "erss_unit_requested", actor, (db.erssEvents || []).find((event) => event.id === erssEventId), `Unit ${unitId} requested`, { unitRequestId: request.id, unitId });
  realtimeEvents.emit(ERSS_REALTIME_EVENTS.UNIT_REQUESTED, { request, unit, eventId: erssEventId });

  return request;
}

async function acknowledgeUnitRequest(db, requestId, unitId, actor = null) {
  const request = db.erssUnitRequests?.find(r => r.id === requestId && r.unitId === unitId);
  if (!request) throw new Error("Unit request not found");

  if (request.status !== "REQUESTED") throw new Error(`Cannot acknowledge request in status: ${request.status}`);

  request.status = "ACKNOWLEDGED";
  request.acknowledgedAt = now();
  request.updatedAt = now();

  auditErss(db, "erss_unit_acknowledged", actor, (db.erssEvents || []).find((event) => event.id === request.erssEventId), `Unit ${unitId} acknowledged request`, { unitRequestId: request.id, unitId });
  realtimeEvents.emit(ERSS_REALTIME_EVENTS.UNIT_ACKNOWLEDGED, { request, unitId });

  return request;
}

async function acceptUnitRequest(db, requestId, unitId, actor = null) {
  const request = db.erssUnitRequests?.find(r => r.id === requestId && r.unitId === unitId);
  if (!request) throw new Error("Unit request not found");

  if (request.status !== "REQUESTED" && request.status !== "ACKNOWLEDGED") {
    throw new Error(`Cannot accept request in status: ${request.status}`);
  }

  request.status = "ACCEPTED";
  request.acceptedAt = now();
  request.updatedAt = now();

  const event = db.erssEvents?.find(e => e.id === request.erssEventId);
  if (!event) throw new Error("ERSS event not found");
  const incident = ensureCanonicalIncident(db, event, actor);
  const unit = db.responseUnits?.find(u => u.id === unitId);
  if (unit) {
    unit.status = "busy";
    unit.assignedIncidentId = incident.id;
    unit.currentIncidentId = incident.id;
    unit.lastUpdated = now();
  }

  event.triageStatus = "DISPATCHED";
  event.updatedAt = now();

  auditErss(db, "erss_unit_accepted", actor, event, `Unit ${unitId} accepted request`, { unitRequestId: request.id, unitId, incidentId: incident.id });
  realtimeEvents.emit(ERSS_REALTIME_EVENTS.UNIT_ACCEPTED, { request, unit, eventId: request.erssEventId });

  return request;
}

async function timeoutUnitRequest(db, requestId, actor = null) {
  const request = db.erssUnitRequests?.find(r => r.id === requestId);
  if (!request) throw new Error("Unit request not found");

  if (request.status !== "REQUESTED" && request.status !== "ACKNOWLEDGED") {
    return request;
  }

  request.status = "TIMEOUT";
  request.timeoutAt = now();
  request.updatedAt = now();

  auditErss(db, "erss_unit_timeout", actor, (db.erssEvents || []).find((event) => event.id === request.erssEventId), `Unit request ${request.id} timed out`, { unitRequestId: request.id });
  realtimeEvents.emit(ERSS_REALTIME_EVENTS.UNIT_TIMEOUT, { request, eventId: request.erssEventId });

  return request;
}

async function recommendFallbackUnit(db, erssEventId, originalUnitId, excludeUnitIds = [], actor = null) {
  const event = db.erssEvents?.find(e => e.id === erssEventId);
  if (!event) throw new Error("Event not found");

  const dispatchRequest = db.erssDispatchRequests?.find(r => r.erssEventId === erssEventId);
  if (!dispatchRequest) throw new Error("Dispatch request not found");

  const recommendations = await calculateUnitRecommendations(db, event, {}, [originalUnitId, ...excludeUnitIds]);

  if (recommendations.primary) {
    const fallbackRequest = await createUnitRequest(db, dispatchRequest.id, erssEventId, recommendations.primary.unitId, "POLICE", DEFAULT_ACK_TIMEOUT, actor);
    fallbackRequest.fallbackUnitId = originalUnitId;
    fallbackRequest.fallbackRecommendedAt = now();
    fallbackRequest.updatedAt = now();

    auditErss(db, "erss_fallback_recommended", actor, event, `Fallback unit ${recommendations.primary.unitId} recommended`, { originalUnitId, unitRequestId: fallbackRequest.id });
    realtimeEvents.emit(ERSS_REALTIME_EVENTS.FALLBACK_RECOMMENDED, { fallbackRequest, originalUnitId, eventId: erssEventId });

    return fallbackRequest;
  }

  return null;
}

async function createAssistanceRequest(db, erssEventId, requestingStationId, requestedStationId, data, actor = null) {
  const requestingStation = db.policeStations?.find(s => s.id === requestingStationId);
  const requestedStation = db.policeStations?.find(s => s.id === requestedStationId);
  if (!requestingStation || !requestedStation) throw new Error("Station not found");

  if (requestingStationId === requestedStationId) throw new Error("Cannot request assistance from same station");

  const request = {
    id: uid("assist"),
    erssEventId,
    requestingStationId,
    requestedStationId,
    incidentId: data.incidentId,
    priority: data.priority || "HIGH",
    reason: data.reason,
    suggestedUnitId: data.suggestedUnitId,
    suggestedEtaMinutes: data.suggestedEtaMinutes,
    status: "REQUESTED",
    requestedAt: now(),
    ackTimeoutSeconds: DEFAULT_ASSISTANCE_ACK_TIMEOUT,
    timeoutAt: new Date(Date.now() + DEFAULT_ASSISTANCE_ACK_TIMEOUT * 1000).toISOString(),
    createdAt: now(),
    updatedAt: now()
  };
  db.erssAssistanceRequests = db.erssAssistanceRequests || [];
  db.erssAssistanceRequests.push(request);

  auditErss(db, "erss_assistance_requested", actor, (db.erssEvents || []).find((event) => event.id === erssEventId), `Assistance requested from station ${requestedStationId}`, { assistanceRequestId: request.id, requestingStationId, requestedStationId });
  realtimeEvents.emit(ERSS_REALTIME_EVENTS.ASSISTANCE_REQUESTED, { request, requestingStation, requestedStation });

  return request;
}

async function acknowledgeAssistanceRequest(db, requestId, stationId, actor = null) {
  const request = db.erssAssistanceRequests?.find(r => r.id === requestId && r.requestedStationId === stationId);
  if (!request) throw new Error("Assistance request not found");

  if (request.status !== "REQUESTED") throw new Error(`Cannot acknowledge request in status: ${request.status}`);

  request.status = "ACKNOWLEDGED";
  request.acknowledgedAt = now();
  request.updatedAt = now();

  auditErss(db, "erss_assistance_acknowledged", actor, (db.erssEvents || []).find((event) => event.id === request.erssEventId), `Station ${stationId} acknowledged assistance`, { assistanceRequestId: request.id, stationId });
  realtimeEvents.emit(ERSS_REALTIME_EVENTS.ASSISTANCE_ACKNOWLEDGED, { request, stationId });

  return request;
}

async function acceptAssistanceRequest(db, requestId, stationId, unitId, actor = null) {
  const request = db.erssAssistanceRequests?.find(r => r.id === requestId && r.requestedStationId === stationId);
  if (!request) throw new Error("Assistance request not found");

  if (request.status !== "REQUESTED" && request.status !== "ACKNOWLEDGED") {
    throw new Error(`Cannot accept request in status: ${request.status}`);
  }

  request.status = "ACCEPTED";
  request.acceptedAt = now();
  request.updatedAt = now();

  const event = db.erssEvents?.find(e => e.id === request.erssEventId);
  if (!event) throw new Error("ERSS event not found");
  const incident = ensureCanonicalIncident(db, event, actor);
  if (unitId) {
    const unit = db.responseUnits?.find(u => u.id === unitId);
    if (unit) {
      if (unit.stationId !== stationId && unit.linkedStationId !== stationId) throw new Error("Unit is not assigned to the responding station");
      unit.status = "busy";
      unit.assignedIncidentId = incident.id;
      unit.currentIncidentId = incident.id;
      unit.lastUpdated = now();
    }
  }

  auditErss(db, "erss_assistance_accepted", actor, event, `Station ${stationId} accepted assistance`, { assistanceRequestId: request.id, stationId, unitId: unitId || null, incidentId: incident.id });
  realtimeEvents.emit(ERSS_REALTIME_EVENTS.ASSISTANCE_ACCEPTED, { request, stationId, unitId });

  return request;
}

async function declineAssistanceRequest(db, requestId, stationId, reason, notes, actor = null) {
  const request = db.erssAssistanceRequests?.find(r => r.id === requestId && r.requestedStationId === stationId);
  if (!request) throw new Error("Assistance request not found");

  if (!isValidDeclineReason(reason)) throw new Error(`Invalid decline reason: ${reason}`);
  if (reason === "OTHER" && !notes) throw new Error("Notes required for OTHER decline reason");

  request.status = "DECLINED";
  request.declinedAt = now();
  request.declineReason = reason;
  request.declineNotes = notes;
  request.updatedAt = now();

  auditErss(db, "erss_assistance_declined", actor, (db.erssEvents || []).find((event) => event.id === request.erssEventId), `Station ${stationId} declined assistance`, { assistanceRequestId: request.id, stationId, reason });
  realtimeEvents.emit(ERSS_REALTIME_EVENTS.ASSISTANCE_DECLINED, { request, stationId, reason });

  return request;
}

async function timeoutAssistanceRequest(db, requestId, actor = null) {
  const request = db.erssAssistanceRequests?.find(r => r.id === requestId);
  if (!request) throw new Error("Assistance request not found");

  if (request.status !== "REQUESTED" && request.status !== "ACKNOWLEDGED") {
    return request;
  }

  request.status = "TIMEOUT";
  request.timeoutAt = now();
  request.updatedAt = now();

  auditErss(db, "erss_assistance_timeout", actor, (db.erssEvents || []).find((event) => event.id === request.erssEventId), `Assistance request ${request.id} timed out`, { assistanceRequestId: request.id });
  realtimeEvents.emit(ERSS_REALTIME_EVENTS.ASSISTANCE_TIMEOUT, { request, eventId: request.erssEventId });

  return request;
}

async function createOwnershipTransfer(db, erssEventId, fromStationId, toStationId, requestedBy, reason, actor = null) {
  if (fromStationId === toStationId) throw new Error("Cannot transfer to same station");

  const transfer = {
    id: uid("transfer"),
    erssEventId,
    fromStationId,
    toStationId,
    requestedBy,
    status: "TRANSFER_REQUESTED",
    requestedAt: now(),
    reason,
    createdAt: now(),
    updatedAt: now()
  };
  db.erssOwnershipTransfers = db.erssOwnershipTransfers || [];
  db.erssOwnershipTransfers.push(transfer);

  auditErss(db, "erss_ownership_transfer_requested", actor, (db.erssEvents || []).find((event) => event.id === erssEventId), `Ownership transfer requested to station ${toStationId}`, { transferId: transfer.id, fromStationId, toStationId });
  realtimeEvents.emit(ERSS_REALTIME_EVENTS.OWNERSHIP_TRANSFER_REQUESTED, { transfer });

  return transfer;
}

async function acknowledgeOwnershipTransfer(db, transferId, stationId, actor = null) {
  const transfer = db.erssOwnershipTransfers?.find(t => t.id === transferId && t.toStationId === stationId);
  if (!transfer) throw new Error("Ownership transfer not found");

  if (transfer.status !== "TRANSFER_REQUESTED") throw new Error(`Cannot acknowledge transfer in status: ${transfer.status}`);

  transfer.status = "TARGET_ACKNOWLEDGED";
  transfer.acknowledgedAt = now();
  transfer.updatedAt = now();

  auditErss(db, "erss_ownership_transfer_acknowledged", actor, (db.erssEvents || []).find((event) => event.id === transfer.erssEventId), `Station ${stationId} acknowledged ownership transfer`, { transferId: transfer.id, stationId });
  realtimeEvents.emit(ERSS_REALTIME_EVENTS.OWNERSHIP_TRANSFER_ACKNOWLEDGED, { transfer, stationId });

  return transfer;
}

async function completeOwnershipTransfer(db, transferId, stationId, actor = null) {
  const transfer = db.erssOwnershipTransfers?.find(t => t.id === transferId && t.toStationId === stationId);
  if (!transfer) throw new Error("Ownership transfer not found");

  if (transfer.status !== "TARGET_ACKNOWLEDGED") throw new Error(`Cannot complete transfer in status: ${transfer.status}`);

  transfer.status = "OWNERSHIP_TRANSFERRED";
  transfer.transferredAt = now();
  transfer.updatedAt = now();

  const event = db.erssEvents?.find(e => e.id === transfer.erssEventId);
  if (event) {
    event.jurisdictionId = transfer.toStationId;
    event.updatedAt = now();
  }

  auditErss(db, "erss_ownership_transferred", actor, event, `Ownership transferred to station ${stationId}`, { transferId: transfer.id, stationId });
  realtimeEvents.emit(ERSS_REALTIME_EVENTS.OWNERSHIP_TRANSFERRED, { transfer });

  return transfer;
}

async function simulateErssEvent(db, data, user) {
  if (!user || user.role !== "Admin") throw new Error("Only Admin can simulate events");

  const event = await createErssEvent(db, { ...data, simulated: true }, user);
  db.erssEvents = db.erssEvents || [];
  db.erssEvents.push(event);

  const call = await createErssCall(db, event.id, user.id);
  event.callId = call.id;

  auditErss(db, "erss_event_simulated", user, event, "ERSS simulation created", { callId: call.id });
  return { event, call };
}

async function getErssEventWithDetails(db, eventId) {
  const event = db.erssEvents?.find(e => e.id === eventId);
  if (!event) return null;

  const call = db.erssCalls?.find(c => c.erssEventId === eventId);
  const triage = db.erssTriage?.find(t => t.erssEventId === eventId);
  const dispatchRequest = db.erssDispatchRequests?.find(d => d.erssEventId === eventId);
  const unitRequests = db.erssUnitRequests?.filter(r => r.erssEventId === eventId) || [];
  const assistanceRequests = db.erssAssistanceRequests?.filter(r => r.erssEventId === eventId) || [];
  const jurisdictionHistory = db.erssJurisdictionHistory?.filter(h => h.erssEventId === eventId) || [];
  const ownershipTransfers = db.erssOwnershipTransfers?.filter(t => t.erssEventId === eventId) || [];
  const jurisdictionStation = db.policeStations?.find(s => s.id === event.jurisdictionId);

  return {
    event,
    call,
    triage,
    dispatchRequest,
    unitRequests,
    assistanceRequests,
    jurisdictionHistory,
    ownershipTransfers,
    jurisdictionStation
  };
}

async function getDispatcherWorkload(db, dispatcherId) {
  const activeEvents = db.erssEvents?.filter(e =>
    e.dispatcherId === dispatcherId &&
    !["CLOSED", "DISPATCHED"].includes(e.triageStatus)
  ) || [];

  const unitRequests = db.erssUnitRequests?.filter(r =>
    activeEvents.some(e => e.id === r.erssEventId) &&
    ["REQUESTED", "ACKNOWLEDGED", "ACCEPTED"].includes(r.status)
  ) || [];

  return {
    activeEvents: activeEvents.length,
    pendingUnitRequests: unitRequests.filter(r => r.status === "REQUESTED").length,
    acknowledgedUnitRequests: unitRequests.filter(r => r.status === "ACKNOWLEDGED").length,
    acceptedUnitRequests: unitRequests.filter(r => r.status === "ACCEPTED").length
  };
}

async function getSupervisorQueue(db) {
  const criticalEvents = db.erssEvents?.filter(e =>
    e.priority === "CRITICAL" &&
    !["DISPATCHED", "CLOSED"].includes(e.triageStatus)
  ) || [];

  const unitTimeouts = db.erssUnitRequests?.filter(r => r.status === "TIMEOUT") || [];
  const assistanceTimeouts = db.erssAssistanceRequests?.filter(r => r.status === "TIMEOUT") || [];
  const jurisdictionDisputes = db.erssJurisdictionHistory?.filter(h =>
    h.changedAt > new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  ) || [];

  return {
    criticalEvents,
    unitTimeouts,
    assistanceTimeouts,
    jurisdictionDisputes
  };
}

module.exports = {
  ERSS_CHANNELS,
  LOCATION_SOURCES,
  EMERGENCY_TYPES,
  PRIORITIES,
  CALL_STATUSES,
  TRIAGE_STATUSES,
  TRIAGE_ACTIONS,
  TRIAGE_STATUS_BY_ACTION,
  UNIT_REQUEST_STATUSES,
  ASSISTANCE_STATUSES,
  DECLINE_REASONS,
  OWNERSHIP_TRANSFER_STATUSES,
  DISPATCH_REQUEST_STATUSES,
  DEFAULT_ACK_TIMEOUT,
  DEFAULT_ASSISTANCE_ACK_TIMEOUT,
  isValidChannel,
  isValidLocationSource,
  isValidEmergencyType,
  isValidPriority,
  isValidCallStatus,
  isValidTriageStatus,
  isValidUnitRequestStatus,
  isValidAssistanceStatus,
  isValidDeclineReason,
  isValidOwnershipTransferStatus,
  isValidDispatchRequestStatus,
  determineJurisdiction,
  calculateUnitRecommendations,
  ensureCanonicalIncident,
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
  getSupervisorQueue
};
