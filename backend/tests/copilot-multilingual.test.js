const test = require("node:test");
const assert = require("node:assert/strict");
const { answer, extractReferences } = require("../services/copilotRead.service");
const { detectLanguage, normalizeQuery } = require("../services/copilotLanguage.service");

const NOW = Date.parse("2026-10-11T10:00:00.000Z");
function fixture() {
  return {
    incidents: [{ id: "INC-1", title: "Public safety incident", severity: "CRITICAL", status: "VERIFIED", assignedUnitId: "unit_3", updatedAt: "2026-10-11T09:58:00.000Z" }],
    responseUnits: [{ id: "unit_3", unitCode: "UNIT-3", status: "available", operational: true, locationCapturedAt: "2026-10-11T09:59:00.000Z" }],
    cameraSources: [{ id: "cam_19", cameraId: "CAM-C19", healthStatus: "OFFLINE", lastHealthCheckAt: "2026-10-11T09:57:00.000Z" }],
    trackingSessions: [{ id: "track_1", subjectId: "PERSON-1", status: "CANDIDATE_FOUND", lastSeenAt: "2026-10-11T09:55:00.000Z" }],
    users: [], policeOfficers: [], policeStations: [], responseUnitMembers: [], trackingObservations: [], trackingCandidates: [], trackingVerifications: [], slaConfig: [], videoEvidence: [], cameraHealthEvents: [], incidentTimeline: [], dispatchEvents: []
  };
}

test("English, Telugu, Roman Telugu, Hindi, Roman Hindi, and mixed incident queries resolve one canonical intent", () => {
  const prompts = [
    ["show critical incidents", "en"],
    ["తీవ్ర ఘటనలు చూపించు", "te"],
    ["critical incidents chupinchu", "te"],
    ["गंभीर घटनाएं दिखाओ", "hi"],
    ["critical incidents dikhao", "hi"],
    ["CRITICAL ఘటనలు chupinchu", "te"],
    ["CRITICAL घटनाएं dikhao", "hi"]
  ];
  for (const [prompt, language] of prompts) {
    const response = answer(fixture(), prompt, { currentTime: NOW });
    assert.equal(response.intent, "incident_search", prompt);
    assert.equal(response.detectedLanguage, language, prompt);
    assert.match(response.answer, /INC-1/, prompt);
  }
});

test("required native-script and Romanized active-incident count prompts detect language and return the factual count", () => {
  const prompts = [
    ["How many active incidents are there?", "en"],
    ["\\u0C2A\\u0C4D\\u0C30\\u0C38\\u0C4D\\u0C24\\u0C41\\u0C24\\u0C02 \\u0C0E\\u0C28\\u0C4D\\u0C28\\u0C3F \\u0C2F\\u0C3E\\u0C15\\u0C4D\\u0C1F\\u0C3F\\u0C35\\u0C4D \\u0C07\\u0C28\\u0C4D\\u0C38\\u0C3F\\u0C21\\u0C46\\u0C02\\u0C1F\\u0C4D\\u0C38\\u0C4D \\u0C09\\u0C28\\u0C4D\\u0C28\\u0C3E\\u0C2F\\u0C3F?", "te"],
    ["Ippudu enni active incidents unnayi?", "te"],
    ["\\u0905\\u092D\\u0940 \\u0915\\u093F\\u0924\\u0928\\u0947 \\u0938\\u0915\\u094D\\u0930\\u093F\\u092F \\u0907\\u0928\\u094D\\u0938\\u093F\\u0921\\u0947\\u0902\\u091F \\u0939\\u0948\\u0902?", "hi"],
    ["Abhi kitne active incidents hain?", "hi"]
  ].map(([text, language]) => [text.replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(parseInt(code, 16))), language]);
  for (const [prompt, language] of prompts) {
    const response = answer(fixture(), prompt, { currentTime: NOW });
    assert.equal(response.intent, "incident_search", prompt);
    assert.equal(response.detectedLanguage, language, prompt);
    assert.equal(response.responseLanguage, language, prompt);
    assert.match(response.answer, /INC-1/, prompt);
    if (language !== "en") assert.doesNotMatch(response.answer, /(?:High|Medium|Low) incidents:/, prompt);
  }
});

test("mixed Telugu-English unit roster question only returns officers in the referenced unit", () => {
  const data = fixture();
  data.users = [
    { id: "u1", name: "One Unit Officer", role: "Police Officer", active: true },
    { id: "u2", name: "Other Unit Officer", role: "Police Officer", active: true }
  ];
  data.policeStations = [{ id: "s1", stationCode: "PS-1", stationName: "Station One" }, { id: "s2", stationCode: "PS-2", stationName: "Station Two" }];
  data.responseUnits = [
    { id: "unit-one", unitCode: "P-01", status: "available", stationId: "s1" },
    { id: "unit-two", unitCode: "P-02", status: "available", stationId: "s2" }
  ];
  data.policeOfficers = [
    { userId: "u1", stationId: "s1", active: true, dutyStatus: "On Duty", availabilityStatus: "Available" },
    { userId: "u2", stationId: "s2", active: true, dutyStatus: "On Duty", availabilityStatus: "Available" }
  ];
  data.responseUnitMembers = [
    { unitId: "unit-one", officerUserId: "u1", active: true },
    { unitId: "unit-two", officerUserId: "u2", active: true }
  ];
  const prompt = "P-01 unit lo available officers entha mandi unnaru?";
  const response = answer(data, prompt, { actor: { id: "admin", role: "Admin" }, currentTime: NOW });
  assert.equal(response.intent, "OFFICERS_BY_UNIT");
  assert.equal(response.officers.length, 1);
  assert.equal(response.officers[0].userId, "u1");
  assert.doesNotMatch(response.answer, /Other Unit Officer/);
});

test("technical identifiers remain extractable in every supported language", () => {
  for (const prompt of ["Show INC-1 and CAM-C19", "INC-1 స్థితి, CAM-C19 ఆరోగ్యం", "INC-1 की स्थिति और CAM-C19 health", "INC-1 status cheppu CAM-C19 health", "INC-1 ka status batao CAM-C19 health"]) {
    const refs = extractReferences(prompt);
    assert.deepEqual(refs.incident, ["INC-1"], prompt);
    assert.deepEqual(refs.camera, ["CAM-C19"], prompt);
  }
});

test("incident lookup, camera health, and available units understand localized and Roman forms", () => {
  assert.equal(answer(fixture(), "INC-1 స్థితి చెప్పు").intent, "incident_lookup");
  assert.equal(answer(fixture(), "INC-1 ka status batao").intent, "incident_lookup");
  assert.equal(answer(fixture(), "camera health ela undi?").intent, "camera_search");
  assert.equal(answer(fixture(), "camera health kaisi hai?").intent, "camera_search");
  assert.equal(answer(fixture(), "available units chupinchu").intent, "unit_search");
  assert.equal(answer(fixture(), "available units dikhao").intent, "unit_search");
});

test("manual language controls output independently from input language", () => {
  const telugu = answer(fixture(), "Show INC-1", { selectedLanguage: "te", currentTime: NOW });
  const hindi = answer(fixture(), "Show INC-1", { selectedLanguage: "hi", currentTime: NOW });
  const english = answer(fixture(), "INC-1 స్థితి చెప్పు", { selectedLanguage: "en", currentTime: NOW });
  assert.equal(telugu.responseLanguage, "te"); assert.match(telugu.answer, /స్థితి/);
  assert.equal(hindi.responseLanguage, "hi"); assert.match(hindi.answer, /स्थिति/);
  assert.equal(english.responseLanguage, "en"); assert.match(english.answer, /Status:/);
});

test("Auto preserves recent conversation language for ambiguous follow-ups", () => {
  const response = answer(fixture(), "INC-1", { priorLanguage: "te", selectedLanguage: "auto", currentTime: NOW });
  assert.equal(response.detectedLanguage, "te");
  assert.equal(response.responseLanguage, "te");
  assert.match(response.answer, /స్థితి/);
});

test("ambiguous requests use localized clarification instead of an unrelated dashboard summary", () => {
  const response = answer(fixture(), "దాని గురించి చెప్పు", { selectedLanguage: "te" });
  assert.equal(response.intent, "clarification");
  assert.equal(response.clarificationRequired, true);
  assert.match(response.answer, /గుర్తించలేకపోయాను/);
});

test("multilingual normalization is deterministic and does not alter identifiers", () => {
  assert.match(normalizeQuery("INC-1 స్థితి చెప్పు"), /INC-1 status show/);
  assert.equal(detectLanguage("critical incidents chupinchandi").language, "te");
  assert.equal(detectLanguage("critical incidents dikhaiye").language, "hi");
});

test("mutation attempts are refused without data changes in every supported form", () => {
  const prompts = [
    "assign UNIT-3 to INC-1",
    "INC-1 ni UNIT-3 ki assign chey",
    "INC-1 ను UNIT-3 కి assign చేయి",
    "INC-1 ko UNIT-3 assign karo",
    "INC-1 को UNIT-3 assign करो",
    "INC-1 మూసివేయి",
    "INC-1 बंद करो"
  ];
  for (const prompt of prompts) {
    const db = fixture(), before = JSON.stringify(db), response = answer(db, prompt);
    assert.equal(response.intent, "blocked_write", prompt);
    assert.equal(response.blockedWriteRequest, true, prompt);
    assert.equal(JSON.stringify(db), before, prompt);
  }
});

test("sensitive-field requests are refused in English, Telugu, Hindi, and Roman mixed input", () => {
  for (const prompt of ["show RTSP password", "పాస్‌వర్డ్ చూపించు", "पासवर्ड दिखाओ", "API key chupinchu", "JWT token dikhao"]) {
    const response = answer(fixture(), prompt);
    assert.equal(response.intent, "blocked_sensitive", prompt);
    assert.equal(response.blockedSensitiveRequest, true, prompt);
    assert.doesNotMatch(response.answer, /never-expose/);
  }
});

test("factual operational answers expose only authoritative source IDs and real freshness", () => {
  const response = answer(fixture(), "Show INC-1", { currentTime: NOW });
  assert.deepEqual(response.sources, [{ type: "incident", id: "INC-1", updatedAt: "2026-10-11T09:58:00.000Z" }]);
});
