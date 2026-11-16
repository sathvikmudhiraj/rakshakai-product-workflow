const test = require("node:test");
const assert = require("node:assert/strict");
const { joinAuthorizedIncidentRoom } = require("../services/socketIncidentAccess.service");

function socketRecorder() {
  const joined = [];
  return { joined, socket: { join: (room) => joined.push(room) } };
}

test("Admin and Police sockets may join a room only for an existing incident", async () => {
  for (const role of ["Admin", "Police Officer"]) {
    const { joined, socket } = socketRecorder();
    const result = await joinAuthorizedIncidentRoom({
      socket,
      user: { id: "authorized-test-user", role },
      incidentId: "incident-existing",
      readDatabase: async () => ({ incidents: [{ id: "incident-existing" }] })
    });
    assert.equal(result, true);
    assert.deepEqual(joined, ["incident:incident-existing"]);
  }
});

test("non-staff, malformed and unknown incident subscriptions fail closed", async () => {
  const { joined, socket } = socketRecorder();
  const readDatabase = async () => ({ incidents: [{ id: "incident-existing" }] });
  for (const [user, incidentId] of [
    [{ id: "citizen", role: "Citizen" }, "incident-existing"],
    [{ id: "staff", role: "Police Officer" }, "incident-unknown"],
    [{ id: "staff", role: "Police Officer" }, ""],
    [{ id: "staff", role: "Police Officer" }, { id: "incident-existing" }],
    [{ id: "staff", role: "Police Officer" }, "x".repeat(161)]
  ]) {
    const result = await joinAuthorizedIncidentRoom({ socket, user, incidentId, readDatabase });
    assert.equal(result, false);
  }
  assert.deepEqual(joined, []);
});

test("incident room subscription fails closed when record lookup is unavailable", async () => {
  const { joined, socket } = socketRecorder();
  await assert.rejects(joinAuthorizedIncidentRoom({
    socket,
    user: { id: "staff", role: "Police Officer" },
    incidentId: "incident-existing",
    readDatabase: async () => { throw new Error("database unavailable"); }
  }));
  assert.deepEqual(joined, []);
});
