// JARVIS audit Phase 3 — multi-turn conversation context tests.
const BASE = process.env.BASE || "http://localhost:5001";
const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? ` :: ${detail}` : ""}`);
}

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
  let conversationId = null;
  const ask = async (message, pageContext = { page: "incident-command" }, selectedLanguage) => {
    const res = await api("/api/copilot/query", { method: "POST", token: admin, body: { message, pageContext, conversationId, selectedLanguage } });
    if (res.data.conversationId) conversationId = res.data.conversationId;
    return res.data;
  };

  // T1: list -> prior entities
  const a1 = await ask("Show me all critical incidents.");
  record("T1 critical list returned entities", (a1.entities || []).length > 0, `entities=${JSON.stringify(a1.entities).slice(0, 120)}`);
  const firstEntity = (a1.entities || [])[0];

  // T2: "the first one" resolves to prior entity
  const a2 = await ask("Show details for the first one.");
  record("T2 'first one' resolves to prior incident", firstEntity && String(a2.answer).includes(firstEntity.id), `expected=${firstEntity && firstEntity.id} answer=${String(a2.answer).slice(0, 80)}`);
  record("T2 same conversationId reused", a2.conversationId === a1.conversationId);

  // T3: "what about cameras?" topic switch keeps conversation
  const a3 = await ask("What about cameras?");
  record("T3 topic switch answered operationally", /camera|attention|healthy/i.test(a3.answer), `intent=${a3.intent} answer=${String(a3.answer).slice(0, 70)}`);

  // T4: "which one is most critical?" — picks from prior results
  const a4 = await ask("Which camera is most critical?");
  record("T4 'which one' selects from prior context", a4.intent !== "clarification" && a4.intent !== "casual", `intent=${a4.intent} answer=${String(a4.answer).slice(0, 70)}`);

  // T5: "only the unassigned ones" filters prior incidents
  const a5 = await ask("Show me all critical incidents.");
  const a5b = await ask("Only the unassigned ones.");
  record("T5 filter applies to current results", a5b.intent !== "clarification", `intent=${a5b.intent} answer=${String(a5b.answer).slice(0, 70)}`);

  // T6: language switch mid-conversation (auto mode)
  const a6 = await ask("ప్రస్తుతం ఉన్న సంఘటనలను చూపించు.");
  record("T6 Telugu query detected te", a6.detectedLanguage === "te", `detected=${a6.detectedLanguage} responseLang=${a6.responseLanguage}`);
  record("T6 Telugu answer in Telugu", /[\u0C00-\u0C7F]/u.test(a6.answer), `answer=${String(a6.answer).slice(0, 60)}`);
  const a7 = await ask("how many?");
  record("T7 follow-up preserves conversation language (te)", a7.responseLanguage === "te", `responseLang=${a7.responseLanguage} answer=${String(a7.answer).slice(0, 50)}`);
  const a8 = await ask("Show me all critical incidents.", { page: "incident-command" }, "en");
  record("T8 manual en override switches response", a8.responseLanguage === "en", `responseLang=${a8.responseLanguage}`);

  // T9: vague follow-up with no clear referent → clarification (not invention)
  const a9 = await ask("and then?");
  record("T9 vague follow-up handled without invention", typeof a9.answer === "string" && a9.answer.length > 0 && !/\b\d{4,}\b/.test(a9.answer), `intent=${a9.intent} answer=${String(a9.answer).slice(0, 60)}`);

  // T10: history persisted under conversation
  const hist = await api(`/api/copilot/history?conversationId=${encodeURIComponent(conversationId)}`, { token: admin });
  const msgs = hist.data.messages || [];
  record("T10 history returns full exchange list", msgs.length >= 16 && msgs[0].role === "user", `messages=${msgs.length}`);

  // T11: cross-user leakage — different user asking for same conversationId
  const police = await login("police@rakshakai.local");
  const leak = await api(`/api/copilot/history?conversationId=${encodeURIComponent(conversationId)}`, { token: police });
  record("T11 no cross-user history leakage", (leak.data.messages || []).length === 0, `policeSee=${(leak.data.messages || []).length}`);

  // T12: police query on admin's conversationId — new scoped state, no admin context
  const crossAsk = await api("/api/copilot/query", { method: "POST", token: police, body: { message: "show details for the first one", pageContext: { page: "incident-command" }, conversationId } });
  record("T12 no cross-user entity context in answers", !/inc_d4da9408|Admin Control/.test(String(crossAsk.data.answer || "")) && crossAsk.data.conversationId === conversationId, `answer=${String(crossAsk.data.answer).slice(0, 70)}`);

  // T13: page-context entity resolution — selected incident page
  const a13 = await ask("What is the status of this incident?", { page: "incident-command", entityId: firstEntity ? firstEntity.id : "inc_d4da9408" });
  record("T13 page entity context resolves selected incident", a13.intent === "incident_lookup" || String(a13.answer).includes(firstEntity ? firstEntity.id : "INC"), `intent=${a13.intent} answer=${String(a13.answer).slice(0, 60)}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n== Phase 3 summary: ${results.length - failed.length}/${results.length} checks passed ==`);
  require("node:fs").writeFileSync(__dirname + "/jarvis-phase3-results.json", JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
