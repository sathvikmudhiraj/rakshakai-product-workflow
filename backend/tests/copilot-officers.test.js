const test = require("node:test");
const assert = require("node:assert/strict");
const { answer } = require("../services/copilotRead.service");
const { normalizeQuery, detectLanguage } = require("../services/copilotLanguage.service");
const { policeManagementUsers } = require("../services/copilotOfficers.service");

test("police profiles separate active unit, hybrid support and investigation, without duplicate deployments", () => {
  const db = fixture();
  db.responseUnits[0].unitCode = "P-01";
  db.responseUnitMembers.push({ officerUserId: "pat1", unitId: "unit_0" });
  db.incidentOfficerAssignments = [{ id: "deployment-1", officerId: "pat1", incidentId: "INC-1", unitId: "unit_0", status: "ASSIGNED", responseRole: "TEAM_LEAD" }];
  db.policeOfficers.find((x) => x.userId === "bhel1").assignedIncidentId = "INC-1";
  db.incidents = [{ id: "INC-1", status: "Assigned", assignedUnitId: "unit_0", investigatingOfficerId: "pat3", supportAllocations: [{ stationName: "BHEL", officerIds: ["bhel1"] }] }];
  const profiles = policeManagementUsers(db);
  const primary = profiles.find((x) => x.id === "pat1");
  const support = profiles.find((x) => x.id === "bhel1");
  assert.equal(primary.deployments[0].unitCode, "P-01");
  assert.equal(primary.supportDeployments.length, 0);
  assert.equal(support.supportDeployments[0].id, "INC-1");
  assert.equal(profiles.find((x) => x.id === "pat3").investigations[0].id, "INC-1");
  db.policeOfficers.find((x) => x.userId === "bhel1").assignedIncidentId = null;
  assert.equal(policeManagementUsers(db).find((x) => x.id === "bhel1").supportDeployments.length, 0);
});

function fixture() {
  return {
    policeStations: [
      { id: "station_pat", stationId: "PS-PATANCHERU", stationName: "Patancheru Police Station" },
      { id: "station_bhel", stationId: "PS-BHEL-RCP", stationName: "BHEL / Ramachandrapuram Demo Station" }
    ],
    users: [
      { id: "pat1", name: "Pat Officer One", role: "Police Officer", active: true, passwordHash: "never-expose" },
      { id: "pat2", name: "Pat Officer Two", role: "Police Officer", active: false, apiToken: "never-expose" },
      { id: "pat3", name: "User Assigned Officer", role: "Police Officer", stationId: "PS-PATANCHERU" },
      { id: "bhel1", name: "BHEL Officer", role: "Police Officer", active: true },
      { id: "admin", name: "Never count Admin", role: "Admin", stationId: "PS-PATANCHERU" },
      { id: "citizen", name: "Never count Citizen", role: "Citizen", stationId: "PS-PATANCHERU" }
    ],
    policeOfficers: [
      { id: "pat_row_1", userId: "pat1", badgeId: "PO-101", stationId: "PS-PATANCHERU", active: true, dutyStatus: "on_duty", availabilityStatus: "available", updatedAt: "2026-10-19T10:00:00Z" },
      { id: "duplicate_row", user_id: "pat1", badgeId: "PO-OLD", station_id: "PS-PATANCHERU", updatedAt: "2026-10-18T10:00:00Z" },
      { id: "pat_row_2", user_id: "pat2", badge_id: "PO-102", station_id: "station_pat", active: true, duty_status: "ON DUTY", availability_status: "available" },
      { id: "bhel_row", userId: "bhel1", badgeId: "PO-201", stationId: "station_bhel", active: true, dutyStatus: "off_duty", availabilityStatus: "busy" },
      { id: "invalid_admin_row", userId: "admin", stationId: "PS-PATANCHERU" },
      { id: "invalid_citizen_row", userId: "citizen", stationId: "PS-PATANCHERU" }
    ],
    responseUnits: Array.from({ length: 9 }, (_, index) => ({ id: `unit_${index}`, stationId: "PS-PATANCHERU", status: "available" })),
    responseUnitMembers: [], incidents: [{ id: "INC-SELECTED", title: "Unrelated incident", severity: "critical", status: "Verified" }]
  };
}
const admin = { actor: { id: "admin", role: "Admin" }, selectedLanguage: "en" };
const police = { actor: { id: "pat1", role: "Police Officer" }, selectedLanguage: "en" };

test("police account aggregate queries use the authorized roster and never response-unit counts", () => {
  const source = fixture();
  let response = answer(source, "how many police accounts are there", admin);
  assert.equal(response.intent, "POLICE_ACCOUNT_COUNT");
  assert.equal(response.summary.total, 4);
  assert.equal(response.summary.active, 3);
  assert.equal(response.summary.inactive, 1);
  assert.equal(response.summary.assignedUnits, 0);
  assert.match(response.answer, /Total police accounts: 4/);
  source.responseUnitMembers.push({ id: "membership-1", officerUserId: "pat1", unitId: "unit_0" });
  source.responseUnitMembers.push({ id: "membership-duplicate", officerUserId: "pat1", unitId: "unit_0" });
  response = answer(source, "total police", admin);
  assert.equal(response.summary.total, 4);
  assert.equal(response.summary.assignedUnits, 1);
  response = answer(source, "list all police accounts", admin);
  assert.equal(response.intent, "POLICE_ACCOUNT_LIST");
  assert.equal(response.matchedCount, 4);
  assert.doesNotMatch(JSON.stringify(response), /never-expose|apiToken/);
});

test("police account and officer queries remain read-only and citizen-scoped", () => {
  const source = fixture();
  const before = JSON.stringify(source);
  assert.equal(answer(source, "how many police accounts are there", { actor: { id: "citizen", role: "Citizen" } }).scopeDenied, true);
  assert.equal(answer(source, "Patancheru PS lo eni officers unnaru", { actor: { id: "citizen", role: "Citizen" } }).scopeDenied, true);
  assert.equal(JSON.stringify(source), before);
});

test("officer intent variants distinguish active, inactive, available, unit and jurisdiction queries", () => {
  const source = fixture();
  source.responseUnitMembers.push({ officerUserId: "pat1", unitId: "unit_0" });
  source.policeOfficers[0].jurisdiction = "Patancheru";
  assert.equal(answer(source, "list active police officers", admin).intent, "ACTIVE_OFFICERS");
  assert.equal(answer(source, "list inactive police officers", admin).intent, "INACTIVE_OFFICERS");
  assert.equal(answer(source, "Patancheru lo available officers evaru", admin).intent, "AVAILABLE_OFFICERS");
  assert.equal(answer(source, "officers by unit unit_0", admin).intent, "OFFICERS_BY_UNIT");
  assert.equal(answer(source, "officers in Patancheru jurisdiction", admin).intent, "OFFICERS_BY_JURISDICTION");
  assert.equal(answer(source, "available response units", admin).intent, "unit_search");
});

test("confirmed Roman Telugu phrase resolves the canonical officer intent and Patancheru station", () => {
  const source = fixture(), before = JSON.stringify(source);
  const prompt = "ipudu eni officers unar o chepu patancheru ps";
  const response = answer(source, prompt, { ...admin, pageContext: { page: "incident-command", entityId: "INC-SELECTED" }, priorEntities: [{ type: "response_unit", id: "UNIT-1" }] });
  assert.equal(response.intent, "OFFICER_COUNT_BY_STATION");
  assert.equal(response.station.name, "Patancheru Police Station");
  assert.equal(response.summary.total, 3);
  assert.equal(response.summary.active, 2);
  assert.equal(response.summary.onDuty, 1);
  assert.equal(response.summary.available, 1);
  assert.equal(response.summary.activeKnown, 3);
  assert.equal(detectLanguage(prompt).language, "te");
  assert.equal(detectLanguage("Patancheru PS officers", "te").language, "en");
  assert.match(response.answer, /Total officers: 3/);
  assert.doesNotMatch(JSON.stringify(response), /never-expose|BHEL Officer|Never count|INC-SELECTED|unit_0/);
  assert.equal(JSON.stringify(source), before);
});

test("English, Roman Telugu, Telugu script and mixed Patancheru station variants use the same roster", () => {
  for (const message of [
    "How many officers are at Patancheru Police Station?", "Patancheru PS officers", "list officers from Patancheru police station",
    "eni officers unnaru patancheru ps", "entha mandi officers patancheru ps", "patancheru lo officerlu evaru",
    "Patancheru police station లో ఎంత మంది officers ఉన్నారు", "పటాన్‌చెరు పోలీస్ స్టేషన్‌లో ఎంత మంది అధికారులు ఉన్నారు",
    "పటాన్ చెరు పోలీస్ స్టేషన్ లో ఆఫీసర్లు ఎవరు ఉన్నారు", "patancheru ps available officers"
  ]) {
    const response = answer(fixture(), message, admin);
    assert.ok(["AVAILABLE_OFFICERS", "OFFICER_LIST_BY_STATION", "OFFICER_COUNT_BY_STATION"].includes(response.intent), message);
    assert.equal(response.station?.name, "Patancheru Police Station", message);
    assert.equal(response.summary?.total, 3, message);
    assert.equal(response.matchedCount, /available/.test(message) ? 1 : 3, message);
  }
});

test("BHEL and Ramachandrapuram aliases resolve only the actual BHEL/RCP station", () => {
  for (const message of [
    "How many officers in BHEL PS?", "Ramachandrapuram Police Station officers", "BHEL/Ramachandrapuram officers",
    "bhel ps lo entha mandi officers unnaru", "ramachandrapuram ps officerlu evaru", "BHEL police station లో officers ఎవరు ఉన్నారు",
    "రామచంద్రపురం పోలీస్ స్టేషన్ లో ఎంత మంది అధికారులు ఉన్నారు", "బీహెచ్ఈఎల్ పోలీస్ స్టేషన్ లో అధికారులు ఎవరు"
  ]) {
    const response = answer(fixture(), message, admin);
    assert.ok(["OFFICER_LIST_BY_STATION", "OFFICER_COUNT_BY_STATION"].includes(response.intent), message);
    assert.equal(response.station?.id, "station_bhel", message);
    assert.equal(response.summary?.total, 1, message);
    assert.equal(response.summary?.onDuty, 0, message);
    assert.equal(response.summary?.available, 0, message);
    assert.doesNotMatch(response.answer, /Pat Officer/);
  }
});

test("generic station questions infer a sole authorized station or ask for clarification", () => {
  for (const message of ["Who is at my police station?", "police station lo evaru unnaru", "పోలీస్ స్టేషన్ లో అధికారులు ఎవరు ఉన్నారు"]) {
    const response = answer(fixture(), message, police);
    assert.ok(["OFFICER_LIST_BY_STATION", "OFFICER_COUNT_BY_STATION"].includes(response.intent), message);
    assert.equal(response.station?.name, "Patancheru Police Station", message);
    assert.equal(response.summary?.total, 3, message);
    assert.equal(answer(fixture(), message, admin).clarificationRequired, true, message);
  }
  for (const message of ["eni officers unnaru", "entha mandi officers", "officerlu evaru", "available officers", "How many officers are there?", "ఎంతమంది పోలీస్ అధికారులు ఉన్నారు"]) {
    const response = answer(fixture(), message, police);
    assert.equal(response.intent, /available/.test(message) ? "AVAILABLE_OFFICERS" : /evaru/.test(message.toLowerCase()) ? "OFFICER_LIST_BY_STATION" : "OFFICER_COUNT_BY_STATION", message);
    assert.equal(response.summary?.total, 3, message);
    assert.equal(response.matchedCount, message === "available officers" ? 1 : 3, message);
  }
});

test("station/RBAC scope applies before counts, details and specific officer lookups", () => {
  const source = fixture();
  const response = answer(source, "BHEL PS officers", police);
  assert.equal(response.scopeDenied, true);
  assert.equal(response.summary, undefined);
  assert.deepEqual(response.officers, []);
  assert.doesNotMatch(JSON.stringify(response), /BHEL Officer|PO-201|bhel1/);
  assert.doesNotMatch(answer(source, "Show PO-201", police).answer, /BHEL Officer/);
  assert.equal(answer(source, "Patancheru PS officers", { actor: { id: "citizen", role: "Citizen" } }).scopeDenied, true);
  assert.equal(answer(source, "available officers", { actor: { id: "unassigned", role: "Police Officer" } }).summary.total, 0);
  // Membership station access is resolved via assignments, not the number of units.
  source.responseUnits[0].stationId = "station_bhel";
  source.responseUnitMembers.push({ officerUserId: "pat1", unitId: "unit_0" });
  assert.equal(answer(source, "BHEL PS officers", police).summary.total, 1);
});

test("unknown/ambiguous stations never silently fall back to all officers", () => {
  assert.equal(answer(fixture(), "How many officers at Atlantis PS?", admin).clarificationRequired, true);
  assert.equal(answer(fixture(), "Patancheru and BHEL officers", admin).clarificationRequired, true);
  const source = fixture(); source.policeStations.push({ id: "other_bhel", stationName: "BHEL Police Station" });
  assert.equal(answer(source, "BHEL PS officers", admin).clarificationRequired, true);
});

test("missing duty status stays unknown while account activity defaults to active", () => {
  const source = fixture();
  source.users = Array.from({ length: 27 }, (_, index) => ({ id: `only_user_${index}`, name: `Officer ${index}`, role: "Police Officer", stationId: "station_pat" }));
  source.policeOfficers = [];
  const response = answer(source, "Patancheru PS officers", admin);
  assert.equal(response.summary.total, 27);
  assert.equal(response.summary.active, 27);
  assert.equal(response.summary.onDuty, null);
  assert.equal(response.summary.available, null);
  assert.equal(response.officers.length, 20);
  assert.match(response.answer, /On-duty officers: Not recorded/);
  assert.match(response.answer, /Showing 20 of 27/);
});

test("officer routing is distinct from response units, remains read-only and supports Auto Telugu", () => {
  const source = fixture(), before = JSON.stringify(source);
  assert.equal(answer(source, "available units chupinchu", police).intent, "unit_search");
  assert.equal(answer(source, "How many response units at Patancheru PS?", police).intent, "unit_search");
  assert.equal(answer(source, "available response units", { ...police, pageContext: { page: "incident-command", entityId: "INC-SELECTED" }, priorEntities: [{ type: "incident", id: "INC-SELECTED" }] }).intent, "unit_search");
  assert.equal(answer(source, "available officers and response units", police).clarificationRequired, true);
  for (const message of ["Patancheru PS officers ni BHEL ki assign chey", "update patancheru officers", "Patancheru PS officers password chepu"]) {
    const response = answer(source, message, police);
    assert.ok(response.blockedWriteRequest || response.blockedSensitiveRequest, message);
  }
  const localized = answer(source, "ipudu eni officers unar o chepu patancheru ps", { actor: admin.actor });
  assert.equal(localized.responseLanguage, "te");
  assert.match(localized.answer, /మొత్తం అధికారులు: 3/);
  assert.match(localized.answer, /Patancheru Police Station/);
  assert.match(normalizeQuery("PS-PATANCHERU PO-101 UNIT-1"), /PS-PATANCHERU PO-101 UNIT-1/);
  assert.equal(JSON.stringify(source), before);
});
