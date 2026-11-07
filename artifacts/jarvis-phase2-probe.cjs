// Phase 2 follow-up probes for ambiguous results.
const BASE = "http://localhost:5000";
async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Cookie: token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
async function login(email) {
  const res = await fetch(BASE + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "demo123" }) });
  const cookies = (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).filter((c) => c.startsWith("rakshakai_session="));
  return cookies.join("; ");
}

(async () => {
  const admin = await login("admin@rakshakai.local");

  // 1) camera-health vs camera-sources shape
  const health = await api("/api/camera-health", { token: admin });
  const sources = await api("/api/camera-sources", { token: admin });
  console.log("camera-health keys:", JSON.stringify(Object.keys(health.data)).slice(0, 200));
  console.log("camera-health sample:", JSON.stringify(health.data).slice(0, 400));
  console.log("camera-sources sample:", JSON.stringify(sources.data).slice(0, 400));

  // 2) SLA question full answer
  const sla = await api("/api/copilot/query", { method: "POST", token: admin, body: { message: "Any SLA breaches right now?", pageContext: { page: "sla-monitoring" } } });
  console.log("SLA answer:", JSON.stringify(sla.data.answer), "intent:", sla.data.intent);

  // 3) officer roster ground truth
  const officers = await api("/api/admin/police-users", { token: admin });
  const list = Array.isArray(officers.data) ? officers.data : officers.data.users || [];
  console.log("police-users sample:", JSON.stringify(list.slice(0, 2)).slice(0, 400));
  const officerAsk = await api("/api/copilot/query", { method: "POST", token: admin, body: { message: "Show me all officers", pageContext: { page: "police-management" } } });
  console.log("officer list answer:", JSON.stringify(officerAsk.data.answer).slice(0, 500), "intent:", officerAsk.data.intent);

  // 4) police scoping ground truth
  const police = await login("police@rakshakai.local");
  const me = await api("/api/me", { token: police });
  console.log("police user:", JSON.stringify(me.data).slice(0, 300));
  const pInc = await api("/api/incidents", { token: police });
  const pList = Array.isArray(pInc.data) ? pInc.data : pInc.data.incidents || [];
  const stationsOf = pList.map((i) => i.stationId ?? i.station_id ?? i.jurisdictionId ?? null);
  const uniq = [...new Set(stationsOf.map(String))];
  console.log("police-visible incidents:", pList.length, "stationIds:", uniq.slice(0, 10).join(","), "total stations in db:");
  const stations = await api("/api/police-stations", { token: police });
  const sList = Array.isArray(stations.data) ? stations.data : stations.data.stations || [];
  console.log("stations:", sList.map((s) => `${s.id}:${s.stationName || s.name}`).join(" | ").slice(0, 300));
  const pAsk = await api("/api/copilot/query", { method: "POST", token: police, body: { message: "How many active incidents are there?", pageContext: { page: "incident-command" } } });
  console.log("police copilot answer:", JSON.stringify(pAsk.data.answer).slice(0, 300), "intent:", pAsk.data.intent);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
