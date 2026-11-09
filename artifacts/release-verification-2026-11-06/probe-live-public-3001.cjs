(async () => {
  const checks = {};
  for (const [name, route] of [["dashboard", "/"], ["slaMonitoring", "/api/sla/monitoring"]]) {
    try {
      const response = await fetch(`http://localhost:3001${route}`);
      checks[name] = { status: response.status, contentType: response.headers.get("content-type") };
      await response.body?.cancel();
    } catch (error) {
      checks[name] = { error: error.message };
    }
  }
  console.log(JSON.stringify({ origin: "http://localhost:3001", checks }, null, 2));
  if (checks.dashboard.status !== 200 || ![200, 401, 403, 429].includes(checks.slaMonitoring.status)) process.exitCode = 1;
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
