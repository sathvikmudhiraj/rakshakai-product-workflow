const test = require("node:test");
const assert = require("node:assert/strict");
const { installSocketSessionGuard } = require("../services/socketSession.service");

test("live sessions fail closed on revoked roles, authentication outage and incoming packets", async () => {
  let user = { id: "officer", role: "Police Officer" };
  let middleware; let disconnected = 0;
  const socket = { request: {}, data: { user }, use(fn) { middleware = fn; }, disconnect() { disconnected++; } };
  const guard = installSocketSessionGuard({ sockets: { sockets: new Map([["socket", socket]]) } }, { resolveUser: async () => user });
  guard.attach(socket);
  try {
    await new Promise((resolve, reject) => middleware([], (error) => error ? reject(error) : resolve()));
    assert.equal(disconnected, 0);
    user = null;
    await new Promise((resolve) => middleware([], (error) => { assert.ok(error); resolve(); }));
    assert.equal(disconnected, 1);
    user = { role: "Citizen" }; await guard.checkAll(); assert.equal(disconnected, 2);
  } finally { guard.stop(); }
  const outage = installSocketSessionGuard({ sockets: { sockets: new Map([["socket", socket]]) } }, { resolveUser: async () => { throw new Error("Database down"); } });
  try { await outage.checkAll(); assert.equal(disconnected, 3); } finally { outage.stop(); }
});
