const { uid, now, addAuditLog } = require("./core.service");

const CCTNS_RECORD_TYPES = Object.freeze(["vehicle", "case", "person", "property", "missing_person", "station"]);
const CRIME_TYPES = Object.freeze(["Theft", "Vehicle Theft", "Burglary", "Robbery", "Assault", "Kidnapping", "Fraud", "Cybercrime", "Narcotics", "Smuggling", "Human Trafficking", "Arms-related Case", "Property Offence", "Missing Person", "Other"]);
const PAGE_LIMIT = 50;

// This adapter deliberately contains only simulated project data. It does not
// connect to, imitate, or claim access to government CCTNS infrastructure.
const SIMULATED_RECORDS = Object.freeze([
  {
    id: "CCTNS-VEH-2026-4587", type: "vehicle", title: "TS09 AB 1234", subtitle: "Black Yamaha FZ", status: "STOLEN", crimeType: "Vehicle Theft",
    stationId: "PS-PATANCHERU", station: "Patancheru Police Station", district: "Sangareddy", state: "Telangana", year: "2026", updatedAt: "2026-10-14T09:30:00.000Z",
    registrationNumber: "TS09 AB 1234", vehicleType: "Motorcycle", makeModel: "Yamaha FZ", color: "Black", vehicleYear: "2023", chassisNumber: "ME1RG4510N1234567", engineNumber: "G3N4E567890", dateOfTheft: "2026-10-12", firNumber: "FIR-2026-1234", caseNumber: "CASE-2026-0456", remarks: "Reported stolen from Industrial Area Beat. Human verification required before any operational action.", linkedCaseIds: ["CCTNS-CASE-2026-0456"], linkedPropertyIds: ["CCTNS-PROP-2026-3321"], referenceImage: null
  },
  {
    id: "CCTNS-CASE-2026-0456", type: "case", title: "CASE-2026-0456", subtitle: "Inter-State Vehicle Theft", status: "ACTIVE", crimeType: "Vehicle Theft",
    stationId: "PS-PATANCHERU", station: "Patancheru Police Station", district: "Sangareddy", state: "Telangana", year: "2026", updatedAt: "2026-10-14T09:28:00.000Z",
    firNumber: "FIR-2026-1234", caseNumber: "CASE-2026-0456", incidentDate: "2026-10-12", assignedInvestigationReference: "INV-PSP-2026-088", description: "Vehicle theft investigation with cross-district coordination.", linkedVehicleIds: ["CCTNS-VEH-2026-4587"], linkedPropertyIds: ["CCTNS-PROP-2026-3321"]
  },
  {
    id: "CCTNS-CASE-2026-1042", type: "case", title: "CASE-2026-1042", subtitle: "Smuggling", status: "UNDER INVESTIGATION", crimeType: "Smuggling",
    stationId: "PS-PATANCHERU", station: "Patancheru Police Station", district: "Sangareddy", state: "Telangana", year: "2026", updatedAt: "2026-10-13T16:15:00.000Z",
    firNumber: "FIR-2026-2410", caseNumber: "CASE-2026-1042", incidentDate: "2026-10-11", assignedInvestigationReference: "INV-PSP-2026-091", description: "Case-related goods moved across district boundaries; review linked records before action.", linkedPersonIds: ["CCTNS-PER-2026-1188"]
  },
  {
    id: "CCTNS-PER-2026-1188", type: "person", title: "Case-related person: Arun Kumar", subtitle: "Subject of investigation", status: "WANTED REFERENCE", crimeType: "Smuggling",
    stationId: "PS-PATANCHERU", station: "Patancheru Police Station", district: "Sangareddy", state: "Telangana", year: "2026", updatedAt: "2026-10-13T16:12:00.000Z",
    personName: "Arun Kumar", age: 31, gender: "Male", caseReference: "CASE-2026-1042", remarks: "Reference record only. Identity and legal status require authorized human verification.", linkedCaseIds: ["CCTNS-CASE-2026-1042"]
  },
  {
    id: "CCTNS-MP-2026-2107", type: "missing_person", title: "Meera N.", subtitle: "Missing-person record", status: "MISSING", crimeType: "Missing Person",
    stationId: "PS-PATANCHERU", station: "Patancheru Police Station", district: "Sangareddy", state: "Telangana", year: "2026", updatedAt: "2026-10-12T14:20:00.000Z",
    personName: "Meera N.", age: 17, gender: "Female", missingSince: "2026-10-10", lastKnownLocation: "Patancheru Bus Stand", referenceNumber: "MP-2026-2107", remarks: "Human-reviewed missing-person record; any sighting remains a possible sighting until verified."
  },
  {
    id: "CCTNS-PROP-2026-3321", type: "property", title: "Recovered motorcycle frame", subtitle: "Linked property", status: "RECOVERED", crimeType: "Property Offence",
    stationId: "PS-PATANCHERU", station: "Patancheru Police Station", district: "Sangareddy", state: "Telangana", year: "2026", updatedAt: "2026-10-14T08:40:00.000Z",
    propertyReference: "PROP-2026-3321", serialNumber: "MH3RG4510N1234567", propertyType: "Vehicle Frame", brand: "Yamaha", description: "Recovered motorcycle frame linked to the vehicle-theft case.", firNumber: "FIR-2026-1234", caseNumber: "CASE-2026-0456", linkedCaseIds: ["CCTNS-CASE-2026-0456"]
  },
  {
    id: "CCTNS-STATION-PS-PATANCHERU", type: "station", title: "Patancheru Police Station", subtitle: "Police station record", status: "ACTIVE", crimeType: "Other",
    stationId: "PS-PATANCHERU", station: "Patancheru Police Station", district: "Sangareddy", state: "Telangana", year: "2026", updatedAt: "2026-10-14T07:00:00.000Z",
    address: "Patancheru, Sangareddy District, Telangana", stationReference: "PS-PATANCHERU"
  }
]);

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function stationScope(db, user) {
  if (user?.role === "Admin") return null;
  const ids = new Set([user?.stationId, user?.data?.stationId].filter(Boolean));
  for (const officer of db.policeOfficers || []) {
    if (officer.userId === user?.id || officer.officerUserId === user?.id) ids.add(officer.stationId);
  }
  for (const membership of db.responseUnitMembers || []) {
    if (membership.officerUserId !== user?.id) continue;
    const unit = (db.responseUnits || []).find((item) => item.id === membership.unitId);
    if (unit?.stationId) ids.add(unit.stationId);
  }
  return ids;
}

function hasRecordAccess(db, user, record) {
  if (user?.role === "Admin") return true;
  if (user?.role !== "Police Officer") return false;
  const scopedStations = stationScope(db, user);
  return Boolean(record?.stationId && scopedStations?.has(record.stationId));
}

function requireRecordAccess(db, user, record) {
  if (!record) throw Object.assign(new Error("CCTNS record not found"), { status: 404 });
  if (!hasRecordAccess(db, user, record)) throw Object.assign(new Error("You do not have permission to access this CCTNS record"), { status: 403 });
  return record;
}

function hasIncidentAccess(db, user, incident) {
  if (!incident) return false;
  if (user?.role === "Admin") return true;
  if (user?.role !== "Police Officer") return false;
  const incidentStationId = incident?.stationId || incident?.station_id || incident?.jurisdictionId || incident?.jurisdiction_id;
  if (!incidentStationId && (incident?.createdBy === user?.id || incident?.reportedBy === user?.id)) return true;
  return Boolean(incidentStationId && stationScope(db, user)?.has(incidentStationId));
}

function requireIncidentAccess(db, user, incident) {
  if (!hasIncidentAccess(db, user, incident)) {
    throw Object.assign(new Error("You do not have permission to link this RakshakAI incident"), { status: 403 });
  }
  return incident;
}

function safeAuditDetails(action, metadata = {}) {
  const fields = Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${String(value).replace(/[;\r\n]/g, " ").slice(0, 80)}`);
  return [action, ...fields].join("; ");
}

function adapterStatus() {
  const configured = String(process.env.CCTNS_SIMULATOR_STATUS || "AVAILABLE").toUpperCase();
  const status = ["AVAILABLE", "DEGRADED", "UNAVAILABLE", "DISABLED"].includes(configured) ? configured : "AVAILABLE";
  return { provider: "Simulator", status, simulated: true, message: status === "AVAILABLE" ? "CCTNS Adapter / Simulator for project demonstration" : "CCTNS Adapter unavailable" };
}

function recordMatches(record, query) {
  const needle = normalize(query);
  if (!needle) return !String(query || "").trim();
  return normalize(Object.values(record).flatMap((value) => Array.isArray(value) ? value : [value]).join(" ")).includes(needle);
}

function hasExactIdentifierMatch(record, query) {
  const needle = normalize(query);
  if (!needle) return false;
  return [record.id, record.title, record.registrationNumber, record.firNumber, record.caseNumber, record.referenceNumber, record.propertyReference, record.serialNumber]
    .filter(Boolean)
    .some((value) => normalize(value) === needle);
}

function toResult(record) {
  return {
    id: record.id, type: record.type, title: record.title, subtitle: record.subtitle, status: record.status,
    crimeType: record.crimeType, station: record.station, stationId: record.stationId, district: record.district,
    state: record.state, year: record.year, updatedAt: record.updatedAt, caseReference: record.caseNumber || record.firNumber || null,
    simulated: true
  };
}

function listRecords(db, user, query = {}) {
  for (const [key, value] of Object.entries(query)) {
    if (typeof value !== "string" && typeof value !== "number") {
      throw Object.assign(new Error(`Invalid CCTNS search parameter: ${key}`), { status: 400 });
    }
    if (String(value).length > 500) throw Object.assign(new Error("CCTNS search parameters must not exceed 500 characters"), { status: 400 });
  }
  for (const key of ["page", "limit", "ageMin", "ageMax"]) {
    if (query[key] === undefined || query[key] === "") continue;
    const value = Number(query[key]);
    const minimum = key.startsWith("age") ? 0 : 1;
    const maximum = key.startsWith("age") ? 120 : key === "limit" ? PAGE_LIMIT : 1000000;
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw Object.assign(new Error(`Invalid CCTNS search parameter: ${key}`), { status: 400 });
    }
  }
  if (query.ageMin !== undefined && query.ageMax !== undefined && query.ageMin !== "" && query.ageMax !== "" && Number(query.ageMin) > Number(query.ageMax)) {
    throw Object.assign(new Error("Minimum age must not exceed maximum age"), { status: 400 });
  }
  const adapter = adapterStatus();
  if (["UNAVAILABLE", "DISABLED"].includes(adapter.status)) {
    return { adapter, state: "ADAPTER_UNAVAILABLE", records: [], total: 0, page: 1, pageSize: 0 };
  }
  const type = String(query.type || "all").toLowerCase();
  const requestedCrimeType = String(query.crimeType || "").trim();
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(PAGE_LIMIT, Math.max(1, Number(query.limit) || 25));
  const includesField = (value, requested) => !requested || normalize(value).includes(normalize(requested));
  const recordsInCategory = SIMULATED_RECORDS
    .filter((record) => hasRecordAccess(db, user, record))
    .filter((record) => type === "all" || record.type === type || (type === "cases" && record.type === "case"))
    .filter((record) => !requestedCrimeType || record.crimeType === requestedCrimeType)
    .filter((record) => !query.year || record.year === String(query.year))
    .filter((record) => !query.state || record.state === query.state)
    .filter((record) => !query.district || record.district === query.district)
    .filter((record) => !query.stationId || record.stationId === query.stationId)
    .filter((record) => !query.status || record.status === query.status)
    .filter((record) => includesField(record.personName, query.name))
    .filter((record) => query.ageMin === undefined || query.ageMin === "" || (record.age != null && record.age >= Number(query.ageMin)))
    .filter((record) => query.ageMax === undefined || query.ageMax === "" || (record.age != null && record.age <= Number(query.ageMax)))
    .filter((record) => includesField(record.gender, query.gender))
    .filter((record) => includesField([record.firNumber, record.caseNumber, record.caseReference].filter(Boolean).join(" "), query.caseReference))
    .filter((record) => includesField(record.referenceNumber, query.missingReference))
    .filter((record) => includesField(record.serialNumber, query.serialNumber))
    .filter((record) => includesField(record.propertyType, query.propertyType))
    .filter((record) => includesField(record.brand, query.brand))
    .filter((record) => includesField(record.description, query.description))
    .filter((record) => recordMatches(record, query.q));
  const counts = { all: recordsInCategory.length };
  for (const recordType of CCTNS_RECORD_TYPES) counts[recordType] = recordsInCategory.filter((record) => record.type === recordType).length;
  const records = query.group && query.group !== "all" ? recordsInCategory.filter((record) => record.type === query.group) : recordsInCategory;
  const start = (page - 1) * pageSize;
  const searchState = records.length === 0 ? "NO_MATCH"
    : query.q && !records.some((record) => hasExactIdentifierMatch(record, query.q)) ? "POSSIBLE_MATCH"
      : records.length === 1 ? "EXACT_RECORD_MATCH" : "MULTIPLE_RESULTS";
  return {
    adapter,
    state: searchState,
    records: records.slice(start, start + pageSize).map(toResult), total: records.length, counts, page, pageSize
  };
}

function recordDetail(db, user, id) {
  const record = requireRecordAccess(db, user, SIMULATED_RECORDS.find((item) => item.id === id));
  const visibleRecord = (linkedId) => SIMULATED_RECORDS.find((item) => item.id === linkedId && hasRecordAccess(db, user, item));
  const linkedCases = (record.linkedCaseIds || []).map(visibleRecord).filter(Boolean).map(toResult);
  const linkedProperty = (record.linkedPropertyIds || []).map(visibleRecord).filter(Boolean).map(toResult);
  const links = (db.cctnsLinks || []).filter((link) => link.cctnsRecordId === record.id && !link.unlinkedAt
    && hasIncidentAccess(db, user, (db.incidents || []).find((incident) => incident.id === link.incidentId)));
  const safeRecord = { ...record, simulated: true };
  for (const key of ["linkedCaseIds", "linkedPropertyIds", "linkedVehicleIds", "linkedPersonIds"]) {
    if (Array.isArray(safeRecord[key])) safeRecord[key] = safeRecord[key].filter(visibleRecord);
  }
  if (user?.role !== "Admin") {
    for (const key of ["chassisNumber", "engineNumber", "serialNumber"]) {
      const value = safeRecord[key];
      if (value) safeRecord[key] = value.length > 5 ? `${value.slice(0, 3)}••••${value.slice(-4)}` : "••••";
    }
  }
  const activityLog = (db.auditLogs || [])
    .filter((entry) => ["cctns_record_viewed", "cctns_link_confirmed", "cctns_link_rejected", "cctns_reference_unlinked"].includes(entry.action)
      && String(entry.details || "").split("; ").includes(`cctnsRecordId=${record.id}`))
    .slice(0, 10)
    .map((entry) => ({ action: entry.action, timestamp: entry.timestamp }));
  return { record: safeRecord, linkedCases, linkedProperty, links, activityLog };
}

function createLink(db, user, { cctnsRecordId, incidentId, verificationReason, humanConfirmed }) {
  const record = requireRecordAccess(db, user, SIMULATED_RECORDS.find((item) => item.id === cctnsRecordId));
  if (humanConfirmed !== true || typeof verificationReason !== "string" || !verificationReason.trim() || verificationReason.trim().length > 500) {
    addAuditLog(db, "cctns_link_rejected", user, null, safeAuditDetails("CCTNS link rejected", { cctnsRecordId: record.id, reason: "human_confirmation_required", simulated: true }));
    throw Object.assign(new Error("Human confirmation and a verification reason are required before linking a CCTNS record"), { status: 409 });
  }
  const incident = (db.incidents || []).find((item) => item.id === incidentId);
  if (!incident) {
    addAuditLog(db, "cctns_link_rejected", user, null, safeAuditDetails("CCTNS link rejected", { cctnsRecordId: record.id, reason: "incident_not_found", simulated: true }));
    throw Object.assign(new Error("Authorized RakshakAI incident not found"), { status: 404 });
  }
  try { requireIncidentAccess(db, user, incident); }
  catch (error) {
    addAuditLog(db, "cctns_link_rejected", user, incident.id, safeAuditDetails("CCTNS link rejected", { cctnsRecordId: record.id, reason: "incident_scope_denied", simulated: true }));
    throw error;
  }
  const existing = (db.cctnsLinks || []).find((link) => link.cctnsRecordId === record.id && link.incidentId === incident.id && !link.unlinkedAt);
  if (existing) return existing;
  const link = { id: uid("cctnslink"), cctnsRecordId: record.id, incidentId: incident.id, stationId: record.stationId, verificationReason: String(verificationReason).trim().slice(0, 500), linkedBy: user.id, linkedAt: now(), simulated: true };
  db.cctnsLinks = db.cctnsLinks || [];
  db.cctnsLinks.push(link);
  addAuditLog(db, "cctns_link_confirmed", user, incident.id, safeAuditDetails("CCTNS simulator record linked after human confirmation", { cctnsRecordId: record.id, recordType: record.type, stationId: record.stationId, simulated: true }));
  return link;
}

function unlinkReference(db, user, linkId) {
  const link = (db.cctnsLinks || []).find((item) => item.id === linkId && !item.unlinkedAt);
  if (!link) throw Object.assign(new Error("CCTNS link not found"), { status: 404 });
  requireRecordAccess(db, user, SIMULATED_RECORDS.find((item) => item.id === link.cctnsRecordId));
  requireIncidentAccess(db, user, (db.incidents || []).find((incident) => incident.id === link.incidentId));
  link.unlinkedAt = now();
  link.unlinkedBy = user.id;
  addAuditLog(db, "cctns_reference_unlinked", user, link.incidentId, safeAuditDetails("CCTNS simulator record reference unlinked", { cctnsRecordId: link.cctnsRecordId, linkId: link.id, simulated: true }));
  return link;
}

function auditSearch(db, user, query, total) {
  addAuditLog(db, "cctns_search_performed", user, null, safeAuditDetails("CCTNS simulator search performed", { queryLength: String(query.q || "").length, type: query.type || "all", resultCount: total, simulated: true }));
}

function auditViewedRecord(db, user, record) {
  addAuditLog(db, "cctns_record_viewed", user, null, safeAuditDetails("CCTNS simulator record viewed", { cctnsRecordId: record.id, recordType: record.type, stationId: record.stationId, simulated: true }));
}

module.exports = { CCTNS_RECORD_TYPES, CRIME_TYPES, adapterStatus, listRecords, recordDetail, createLink, unlinkReference, auditSearch, auditViewedRecord, requireRecordAccess, requireIncidentAccess };
