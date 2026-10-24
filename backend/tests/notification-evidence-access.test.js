const test = require("node:test");
const assert = require("node:assert/strict");
const { deriveNotifications, authoritativeDetail } = require("../services/notification.service");

test("evidence observation notification details require current incident assignment", async () => {
  const userA = { id: "a", role: "Police Officer" };
  const userB = { id: "b", role: "Police Officer" };
  const incident = { id: "case", investigatingOfficerId: "a" };
  const evidence = { id: "evidence", linkedIncidentId: incident.id };
  const observation = { id: "observation", evidenceId: evidence.id, cameraId: null, sourceType: "evidence_image", status: "PENDING_REVIEW" };
  const db = { incidents: [incident], reports: [], responseUnitMembers: [], videoEvidence: [evidence], aiObservations: [observation] };
  const notification = deriveNotifications(db).find((item) => item.entityId === observation.id);
  assert.match(notification.message, /Evidence evidence/);
  const detail = await authoritativeDetail(db, userA, notification);
  assert.equal(detail.record.sourceType, "evidence_image");
  assert.equal(detail.record.evidenceId, evidence.id);
  assert.equal(detail.record.cameraId, null);
  await assert.rejects(authoritativeDetail(db, userB, notification), { status: 403 });
  incident.investigatingOfficerId = "b";
  await assert.rejects(authoritativeDetail(db, userA, notification), { status: 403 });
  assert.equal((await authoritativeDetail(db, userB, notification)).record.id, observation.id);
});
