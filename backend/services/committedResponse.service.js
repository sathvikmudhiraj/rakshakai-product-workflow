// Legacy handlers produce one complete response. Keep it private until COMMIT succeeds.
async function respondAfterCommit(res, run) {
  let response;
  let ended = false;
  const deferred = {
    writeHead(status, headers) {
      if (response || ended) throw new Error("Response already prepared");
      response = { status, headers: { ...headers } };
    },
    end(body) {
      if (!response || ended) throw new Error("Invalid deferred response");
      response.body = body;
      ended = true;
    }
  };
  await run(deferred);
  if (!ended) throw new Error("Request did not produce a response");
  if (res.destroyed) return;
  res.writeHead(response.status, response.headers);
  res.end(response.body);
}

module.exports = { respondAfterCommit };
