const test = require("node:test");
const assert = require("node:assert/strict");
const { seedDb } = require("../services/core.service");
const cctns = require("../services/cctns.service");

function fixture() {
  const db = seedDb();
  const police = db.users.find((user) => user.id === "u_police");
  const citizen = db.users.find((user) => user.role === "Citizen");
  db.incidents = [{ id: "inc_cctns_test", title: "Verified vehicle incident", stationId: "PS-PATANCHERU" }];
  return { db, police, citizen };
}

test("CCTNS simulator classifies global vehicle and crime searches within station scope", () => {
  const { db, police } = fixture();
  const vehicle = cctns.listRecords(db, police, { q: "TS09 AB 1234" });
  assert.equal(vehicle.total, 1);
  assert.equal(vehicle.records[0].type, "vehicle");
  const detail = cctns.recordDetail(db, police, vehicle.records[0].id);
  assert.match(detail.record.chassisNumber, /••••/);
  assert.doesNotMatch(detail.record.chassisNumber, /ME1RG4510N1234567/);
  const crime = cctns.listRecords(db, police, { q: "Smuggling", crimeType: "Smuggling" });
  assert.equal(crime.records[0].type, "case");
  assert.equal(crime.records[0].status, "UNDER INVESTIGATION");
  assert.equal(crime.state, "POSSIBLE_MATCH");
});

test("CCTNS resource access is server-side and does not grant Citizen access", () => {
  const { db, citizen } = fixture();
  assert.throws(() => cctns.recordDetail(db, citizen, "CCTNS-VEH-2026-4587"), { status: 403 });
});

test("CCTNS structured person and property filters and grouped counts remain scoped", () => {
  const { db, police } = fixture();
  const person = cctns.listRecords(db, police, { type: "person", name: "Arun", ageMin: 30, ageMax: 35, gender: "Male", caseReference: "1042" });
  assert.equal(person.total, 1);
  assert.equal(person.records[0].id, "CCTNS-PER-2026-1188");
  assert.equal(cctns.listRecords(db, police, { type: "person", ageMax: 20 }).total, 0);
  const property = cctns.listRecords(db, police, { type: "property", serialNumber: "MH3RG", brand: "Yamaha", propertyType: "Frame", caseReference: "1234" });
  assert.equal(property.total, 1);
  const grouped = cctns.listRecords(db, police, { group: "vehicle" });
  assert.equal(grouped.total, 1);
  assert.ok(grouped.counts.case > 0);
  assert.ok(grouped.counts.all > grouped.total);
});

test("CCTNS incident links require human confirmation and persist safe audited metadata", () => {
  const { db, police } = fixture();
  assert.throws(() => cctns.createLink(db, police, { cctnsRecordId: "CCTNS-VEH-2026-4587", incidentId: "inc_cctns_test" }), /Human confirmation/);
  assert.ok(db.auditLogs.some((entry) => entry.action === "cctns_link_rejected"));
  const link = cctns.createLink(db, police, {
    cctnsRecordId: "CCTNS-VEH-2026-4587", incidentId: "inc_cctns_test", humanConfirmed: true, verificationReason: "Registration and FIR reviewed by the assigned officer"
  });
  assert.equal(db.cctnsLinks.length, 1);
  assert.equal(link.cctnsRecordId, "CCTNS-VEH-2026-4587");
  assert.ok(db.auditLogs.some((entry) => entry.action === "cctns_link_confirmed"));
  assert.ok(cctns.recordDetail(db, police, link.cctnsRecordId).activityLog.some((entry) => entry.action === "cctns_link_confirmed"));
  const unlinked = cctns.unlinkReference(db, police, link.id);
  assert.ok(unlinked.unlinkedAt);
  assert.ok(db.auditLogs.some((entry) => entry.action === "cctns_reference_unlinked"));
  assert.ok(db.auditLogs.every((entry) => typeof entry.timestamp === "string"));
});

test("CCTNS linking enforces the authorized incident station scope", () => {
  const { db, police } = fixture();
  db.incidents.push({ id: "inc_outside_scope", title: "Other station incident", stationId: "PS-BHEL-RCP" });
  assert.throws(() => cctns.createLink(db, police, {
    cctnsRecordId: "CCTNS-VEH-2026-4587", incidentId: "inc_outside_scope", humanConfirmed: true, verificationReason: "Reviewed"
  }), { status: 403 });
  assert.ok(db.auditLogs.some((entry) => entry.action === "cctns_link_rejected" && /incident_scope_denied/.test(entry.details)));
});

test("CCTNS details and unlinking do not expose or modify links outside incident scope", () => {
  const { db, police } = fixture();
  const admin = db.users.find((user) => user.role === "Admin");
  db.incidents.push({ id: "inc_outside_scope", stationId: "PS-BHEL-RCP" });
  const outside = cctns.createLink(db, admin, {
    cctnsRecordId: "CCTNS-VEH-2026-4587", incidentId: "inc_outside_scope", humanConfirmed: true, verificationReason: "Reviewed"
  });
  const permitted = cctns.createLink(db, police, {
    cctnsRecordId: "CCTNS-VEH-2026-4587", incidentId: "inc_cctns_test", humanConfirmed: true, verificationReason: "Reviewed"
  });
  assert.deepEqual(cctns.recordDetail(db, police, outside.cctnsRecordId).links.map((link) => link.id), [permitted.id]);
  assert.throws(() => cctns.unlinkReference(db, police, outside.id), { status: 403 });
  assert.equal(outside.unlinkedAt, undefined);
  assert.equal(cctns.recordDetail(db, admin, outside.cctnsRecordId).links.length, 2);
});

test("CCTNS adapter failure is isolated from operational records", () => {
  const { db, police } = fixture();
  const previous = process.env.CCTNS_SIMULATOR_STATUS;
  process.env.CCTNS_SIMULATOR_STATUS = "UNAVAILABLE";
  try {
    const result = cctns.listRecords(db, police, { q: "TS09" });
    assert.equal(result.state, "ADAPTER_UNAVAILABLE");
    assert.equal(result.records.length, 0);
    assert.equal(db.incidents.length, 1);
  } finally {
    if (previous === undefined) delete process.env.CCTNS_SIMULATOR_STATUS;
    else process.env.CCTNS_SIMULATOR_STATUS = previous;
  }
});

test("CCTNS linking requires a boolean confirmation and a bounded text reason", () => {
  const { db, police } = fixture();
  for (const humanConfirmed of ["false", "true", 1, {}, []]) {
    assert.throws(() => cctns.createLink(db, police, { cctnsRecordId: "CCTNS-VEH-2026-4587", incidentId: "inc_cctns_test", humanConfirmed, verificationReason: "Reviewed" }), { status: 409 });
  }
  for (const verificationReason of [{ reviewed: true }, "x".repeat(501)]) {
    assert.throws(() => cctns.createLink(db, police, { cctnsRecordId: "CCTNS-VEH-2026-4587", incidentId: "inc_cctns_test", humanConfirmed: true, verificationReason }), { status: 409 });
  }
  assert.equal((db.cctnsLinks || []).length, 0);
});

test("CCTNS rejects malformed pagination and does not broaden unsupported queries", () => {
  const { db, police, citizen } = fixture();
  for (const query of [{ page: "Infinity" }, { page: "1.5" }, { limit: -1 }, { limit: 51 }, { q: ["TS09", "Arun"] }, { ageMin: "NaN" }, { ageMin: 40, ageMax: 20 }]) {
    assert.throws(() => cctns.listRecords(db, police, query), { status: 400 });
  }
  assert.equal(cctns.listRecords(db, police, { q: "!!!" }).total, 0);
  assert.equal(cctns.listRecords(db, police, { ageMax: 0 }).total, 0);
  citizen.stationId = "PS-PATANCHERU";
  assert.equal(cctns.listRecords(db, citizen).total, 0);
  assert.throws(() => cctns.recordDetail(db, citizen, "CCTNS-VEH-2026-4587"), { status: 403 });
});
