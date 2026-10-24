const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exercise the actual startup hook without importing the server or opening a DB.
const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
const hook = source.slice(source.indexOf("async function runStartupDataRepair()"), source.indexOf("async function start(listenPort"));

test("safe local reload skips the data-repair function entirely", async () => {
  let calls = 0;
  const context = vm.createContext({ process: { env: { SKIP_STARTUP_DATA_REPAIR: "true" } }, console: { log() {} }, repairLegacyPersistedData: async () => { calls++; return []; } });
  vm.runInContext(hook, context);
  await context.runStartupDataRepair();
  assert.equal(calls, 0);
  assert.match(source, /await runStartupDataRepair\(\);/);
});

test("normal startup retains legacy repair unless explicitly opted out", async () => {
  for (const setting of [undefined, "false", "1"]) {
    let calls = 0;
    const context = vm.createContext({ process: { env: { SKIP_STARTUP_DATA_REPAIR: setting } }, console: { log() {} }, repairLegacyPersistedData: async () => { calls++; return ["fixture repair"]; } });
    vm.runInContext(hook, context);
    await context.runStartupDataRepair();
    assert.equal(calls, 1);
  }
});

test("local reload override replaces migration/import command without changing database service", () => {
  const override = fs.readFileSync(path.join(__dirname, "../../compose.local-reload.yaml"), "utf8");
  assert.match(override, /command: \["node", "server\.js"\]/);
  assert.match(override, /SKIP_STARTUP_DATA_REPAIR: "true"/);
  assert.doesNotMatch(override, /^  (postgres|ai-service|osrm):|npm run|volumes:/m);
});
