const test = require("node:test");
const assert = require("node:assert/strict");
const { answer } = require("../services/copilotRead.service");

function db() {
  return { incidents: [{ id: "INC-1042", title: "Emergency", severity: "CRITICAL", status: "verified", assignedUnitId: "unit_14" }], responseUnits: [{ id: "unit_14", unitCode: "P-14", status: "available", operational: true, stationName: "Madhapur" }], cameraSources: [{ id: "cam_27", cameraId: "CAM-C27", healthStatus: "NO_VIDEO_FRAMES", zone: "Junction" }], escalationAlerts: [] };
}

test("Copilot returns record-backed incident, camera and unit information", () => {
  assert.match(answer(db(), "Show INC-1042").answer, /Assigned unit: P-14/);
  assert.match(answer(db(), "Why is CAM-C27 red?").answer, /NO_VIDEO_FRAMES/);
  assert.match(answer(db(), "Where is P-14?").answer, /Madhapur/);
});

test("Copilot blocks mutation language without changing the source data", () => {
  const source = db();
  const result = answer(source, "Assign P-14 to INC-1042");
  assert.equal(result.blockedWriteRequest, true);
  assert.equal(source.responseUnits[0].status, "available");
  assert.equal(source.incidents[0].assignedUnitId, "unit_14");
});

test("Copilot reports missing authoritative records rather than guessing", () => {
  assert.match(answer(db(), "Show INC-9999").answer, /No incident/);
});
