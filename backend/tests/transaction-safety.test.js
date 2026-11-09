const test = require("node:test");
const assert = require("node:assert/strict");
const { withTransaction, query, onTransactionFailure, connectionOptions } = require("../services/postgres.service");
const { respondAfterCommit } = require("../services/committedResponse.service");
const http = require("node:http");
const express = require("express");
const { errorMiddleware } = require("../middleware/error.middleware");

async function responseServer(t, pool) {
  const app = express();
  app.post("/write", (req, res, next) => {
    respondAfterCommit(res, (deferred) => withTransaction(async () => {
      await query("INSERT");
      deferred.writeHead(201, { "Content-Type": "application/json", "Set-Cookie": "test-session=created; HttpOnly" });
      deferred.end(JSON.stringify({ saved: true }));
    }, pool)).catch(next);
  });
  app.use(errorMiddleware);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}/write`;
}

test("HTTP success headers and cookie wait for a pending COMMIT acknowledgement", async (t) => {
  const { pool } = database();
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  let finishCommit;
  let reachedCommit;
  const started = new Promise((resolve) => { reachedCommit = resolve; });
  const pending = new Promise((resolve) => { finishCommit = resolve; });
  client.query = async (sql) => {
    if (sql === "COMMIT") {
      reachedCommit();
      await pending;
    }
    return originalQuery(sql);
  };
  const url = await responseServer(t, pool);
  let receivedHeaders = false;
  const request = fetch(url, { method: "POST", signal: AbortSignal.timeout(5000) }).then((response) => {
    receivedHeaders = true;
    return response;
  });
  try {
    await started;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(receivedHeaders, false);
  } finally {
    finishCommit();
  }
  const response = await request;
  assert.equal(response.status, 201);
  assert.match(response.headers.get("set-cookie"), /test-session=created/);
  assert.deepEqual(await response.json(), { saved: true });
});

for (const [name, options] of [
  ["deferred constraint failure", { commitError: Object.assign(new Error("constraint failure"), { code: "23503" }) }],
  ["lost commit acknowledgement", { commitError: Object.assign(new Error("connection lost"), { code: "ECONNRESET" }) }],
  ["COMMIT returning ROLLBACK", { commitCommand: "ROLLBACK" }]
]) {
  test(`HTTP ${name} returns an error without prepared success or cookie`, async (t) => {
    const { pool } = database(options);
    const url = await responseServer(t, pool);
    const response = await fetch(url, { method: "POST", signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("set-cookie"), null);
    const body = await response.json();
    assert.equal(typeof body.error, "string");
    assert.equal(body.saved, undefined);
  });
}

function database({ commitError, commitCommand = "COMMIT", rollbackError } = {}) {
  const events = [];
  const client = {
    async query(sql) {
      events.push(sql);
      if (sql === "COMMIT" && commitError) throw commitError;
      if (sql === "ROLLBACK" && rollbackError) throw rollbackError;
      return { rows: [], command: sql === "COMMIT" ? commitCommand : sql };
    },
    release(discard) { events.push(discard ? "DISCARD" : "RELEASE"); }
  };
  return { events, pool: { connect: async () => client } };
}

test("response and session cookie are sent only after the outer commit", async () => {
  const { events, pool } = database();
  await respondAfterCommit({
    writeHead(status, headers) {
      assert.equal(status, 201);
      assert.equal(headers["Set-Cookie"], "test-session");
      events.push("HEADERS");
    },
    end(body) { assert.equal(body, "ok"); events.push("RESPONSE"); }
  }, (res) => withTransaction(async () => {
    await withTransaction(() => query("INSERT"));
    res.writeHead(201, { "Set-Cookie": "test-session" });
    res.end("ok");
    assert.equal(events.includes("HEADERS"), false);
  }, pool));
  assert.deepEqual(events, ["BEGIN", "INSERT", "COMMIT", "RELEASE", "HEADERS", "RESPONSE"]);
});

test("concurrent repository reads are serialized on the ambient transaction client", async () => {
  const events = [];
  let activeQueries = 0;
  let maximumConcurrency = 0;
  const client = {
    async query(sql) {
      activeQueries += 1;
      maximumConcurrency = Math.max(maximumConcurrency, activeQueries);
      events.push(sql);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeQueries -= 1;
      return { rows: [], command: sql };
    },
    release() { events.push("RELEASE"); }
  };
  await withTransaction(async () => {
    await Promise.all([query("SELECT one"), query("SELECT two"), query("SELECT three")]);
  }, { connect: async () => client });
  assert.equal(maximumConcurrency, 1);
  assert.deepEqual(events, ["BEGIN", "SELECT one", "SELECT two", "SELECT three", "COMMIT", "RELEASE"]);
});

test("commit failure discards prepared success and cookie and runs outer cleanup", async () => {
  const error = Object.assign(new Error("deferred constraint"), { code: "23503" });
  const { pool } = database({ commitError: error });
  let cleanup;
  let writes = 0;
  await assert.rejects(respondAfterCommit({ writeHead() { writes++; }, end() { writes++; } }, (res) => withTransaction(async () => {
    await withTransaction(async () => { onTransactionFailure((result) => { cleanup = result.outcome; }); });
    res.writeHead(200, { "Set-Cookie": "discard-me" });
    res.end("success");
  }, pool)), /deferred constraint/);
  assert.equal(writes, 0);
  assert.equal(cleanup, "rolled_back");
});

test("lost commit acknowledgement preserves the unknown outcome and discards the client", async () => {
  const { pool, events } = database({ commitError: Object.assign(new Error("connection lost"), { code: "ECONNRESET" }) });
  let outcome;
  await assert.rejects(withTransaction(async () => {
    onTransactionFailure((result) => { outcome = result.outcome; });
  }, pool), /connection lost/);
  assert.equal(outcome, "unknown");
  assert.equal(events.at(-1), "DISCARD");
});

test("PostgreSQL COMMIT returning ROLLBACK is never treated as success", async () => {
  const { pool } = database({ commitCommand: "ROLLBACK" });
  await assert.rejects(withTransaction(async () => {}, pool), /rolled back/);
});

test("rollback failure does not mask the original error or suppress cleanup", async () => {
  const { pool, events } = database({ rollbackError: new Error("closed") });
  let cleaned = false;
  await assert.rejects(withTransaction(async () => {
    onTransactionFailure(() => { cleaned = true; });
    throw new Error("original");
  }, pool), /original/);
  assert.equal(cleaned, true);
  assert.equal(events.at(-1), "DISCARD");
});

test("remote PostgreSQL TLS is verified even with sslmode=require URL options", () => {
  for (const suffix of ["", "?sslmode=require", "?sslmode=require&uselibpqcompat=true", "?ssl=false"]) {
    const config = connectionOptions({ DATABASE_URL: `postgresql://db.example/test${suffix}`, NODE_ENV: "production" });
    assert.equal(config.ssl.rejectUnauthorized, true);
    assert.equal(new URL(config.connectionString).search, "");
  }
  const explicit = connectionOptions({ DATABASE_URL: "postgresql://db.example/test?sslmode=disable", PG_SSL_MODE: "verify-full", NODE_ENV: "production" });
  assert.equal(explicit.ssl.rejectUnauthorized, true);
});

test("invalid SSL modes and unencrypted remote production connections fail closed", () => {
  for (const mode of ["disable", "prefer", "typo"]) {
    assert.throws(() => connectionOptions({ DATABASE_URL: "postgresql://db.example/test", NODE_ENV: "production", PG_SSL_MODE: mode }));
  }
  assert.equal(connectionOptions({ DATABASE_URL: "postgresql://postgres/test", NODE_ENV: "production" }).ssl, false);
});

test("query hostname overrides cannot bypass production TLS requirements", () => {
  for (const query of ["host=remote.example", "%68ost=remote.example", "host=&host=remote.example"]) {
    assert.throws(() => connectionOptions({
      DATABASE_URL: `postgresql://postgres/test?${query}`,
      PG_SSL_MODE: "disable",
      NODE_ENV: "production"
    }), /hostname.*query parameter/);
  }
});
