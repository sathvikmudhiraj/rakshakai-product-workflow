import { api } from "../services/api.js";
import { COPILOT_LANGUAGE_KEY, localeFor, suggestionsFor, htmlLanguage } from "./copilotLocales.js";

let getContext = () => ({ page: "dashboard" });
let mounted = false;
let removeGlobalListeners = null;
let conversationId = null;
let openMountedCopilot = null;
const POSITION_KEY = "rakshakai_copilot_launcher_position";
const CONVERSATION_KEY = "rakshakai_copilot_conversation_id";

export function configureCopilot({ context } = {}) { if (typeof context === "function") getContext = context; }
function el(tag, className = "", text = null) { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
function titleCase(value) { return String(value || "dashboard").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function storedLanguage() { try { const value = window.localStorage.getItem(COPILOT_LANGUAGE_KEY); return ["auto", "en", "te", "hi"].includes(value) ? value : "auto"; } catch { return "auto"; } }
function relativeFreshness(value, locale) { const elapsed = Date.now() - Date.parse(value || ""); if (!Number.isFinite(elapsed)) return locale.unavailable; if (elapsed < 60_000) return locale.justNow; if (elapsed < 3_600_000) return locale.minutesAgo(Math.floor(elapsed / 60_000)); return locale.hoursAgo(Math.floor(elapsed / 3_600_000)); }
function sourceName(source) { const type = ({ incident: "Incident", investigation: "Investigation", camera: "Camera", response_unit: "Unit", unit: "Unit", officer: "Officer", track: "Tracking" })[source.type] || titleCase(source.type); return `${type} ${source.id}`; }

async function loadConversationHistory(convId) {
  if (!convId) return [];
  try {
    const response = await api(`/api/copilot/history?conversationId=${encodeURIComponent(convId)}`, { method: "GET" });
    return response.messages || [];
  } catch {
    return null;
  }
}

function renderHistoryMessage(role, text, response = {}, locale, onNavigate) {
  const article = el("article", `copilot-message ${role}`);
  article.append(el("strong", "copilot-message-role", role === "user" ? locale.you : locale.assistant), el("p", "copilot-message-text", text));
  if (role === "assistant" && response.sources?.length) {
    const box = el("div", "copilot-source-box");
    box.append(el("span", "copilot-source-label", response.sources.length > 1 ? locale.sources : locale.source));
    response.sources.forEach((source) => {
      const row = el("div", "copilot-source-row");
      row.append(el("strong", "", sourceName(source)), el("small", "", `${locale.updated}: ${relativeFreshness(source.updatedAt, locale)}`));
      box.append(row);
    });
    article.append(box);
  }
  if (role === "assistant" && response.navigation?.view) {
    const button = el("button", "copilot-navigation", locale.open);
    button.type = "button";
    button.setAttribute("aria-label", `${locale.open}: ${titleCase(response.navigation.view)}${response.navigation.entityId ? ` ${response.navigation.entityId}` : ""}`);
    button.addEventListener("click", () => onNavigate?.(response.navigation));
    article.append(button);
  }
  return article;
}

export function mountCopilot() {
  if (mounted || document.getElementById("rakshakCopilot")) return;
  mounted = true;
  const root = el("section", "rakshak-copilot"); root.id = "rakshakCopilot";
  root.innerHTML = `
    <button type="button" class="copilot-launcher" aria-label="Open Rakshak AI Assistant" aria-expanded="false"><svg class="copilot-police-icon" aria-hidden="true" viewBox="0 0 64 64" fill="none"><path class="copilot-icon-shield" d="M32 4 53 12v17c0 14-8.8 24.6-21 31C19.8 53.6 11 43 11 29V12L32 4Z"/><path class="copilot-icon-cap" d="m19 25 13-8 13 8-13 5-13-5Z"/><path class="copilot-icon-cap" d="M23 27v6c5.8 3.5 12.2 3.5 18 0v-6"/><circle class="copilot-icon-face" cx="32" cy="39" r="7"/><path class="copilot-icon-badge" d="m32 35.5 1.2 2.4 2.7.4-2 1.9.5 2.7-2.4-1.3-2.4 1.3.5-2.7-2-1.9 2.7-.4L32 35.5Z"/></svg></button>
    <div class="copilot-backdrop" hidden></div>
    <aside class="copilot-drawer" role="dialog" aria-modal="true" aria-labelledby="copilotTitle" aria-hidden="true">
      <header class="copilot-header"><div class="copilot-identity"><span class="copilot-identity-icon" aria-hidden="true">RA</span><div><strong id="copilotTitle"></strong><div class="copilot-trust-row"><small class="copilot-read-only"></small><span class="copilot-availability"><i aria-hidden="true"></i><span></span></span></div></div></div><button type="button" class="copilot-close">×</button></header>
      <div class="copilot-control-bar"><label class="copilot-language-label"><span></span><select class="copilot-language" aria-label="Assistant language"><option value="auto">Auto</option><option value="en">English</option><option value="te">తెలుగు</option><option value="hi">हिन्दी</option></select></label><p class="copilot-context"></p></div>
      <section class="copilot-prompt-section" aria-labelledby="copilotSuggestionsLabel"><span id="copilotSuggestionsLabel"></span><div class="copilot-suggestions"></div></section>
      <div class="copilot-conversation"><section class="copilot-empty"><span class="copilot-empty-icon" aria-hidden="true">RA</span><h3></h3><p></p></section><div class="copilot-messages" role="log" aria-live="polite" aria-relevant="additions"></div></div>
      <form class="copilot-form"><label class="sr-only" for="copilotQuestion"></label><textarea id="copilotQuestion" maxlength="2000" rows="2" dir="auto"></textarea><button class="copilot-send" type="submit"></button><div class="copilot-form-footer"><p class="copilot-status" role="status" aria-live="polite"></p><span class="copilot-safety-note"></span></div></form>
    </aside>`;
  document.body.append(root);
  const launcher = root.querySelector(".copilot-launcher"), drawer = root.querySelector(".copilot-drawer"), backdrop = root.querySelector(".copilot-backdrop"), close = root.querySelector(".copilot-close"), messages = root.querySelector(".copilot-messages"), empty = root.querySelector(".copilot-empty"), contextText = root.querySelector(".copilot-context"), suggestionBox = root.querySelector(".copilot-suggestions"), form = root.querySelector(".copilot-form"), input = root.querySelector("textarea"), status = root.querySelector(".copilot-status"), send = root.querySelector(".copilot-send"), languageSelect = root.querySelector(".copilot-language");
  let previousFocus = null, drag = null, suppressClick = false, responseLanguage = "en", languageMode = storedLanguage();
  try { conversationId = window.sessionStorage.getItem(CONVERSATION_KEY) || null; } catch { conversationId = null; }
  const compact = window.matchMedia?.("(max-width: 1120px)") || { matches: false, addEventListener() {}, removeEventListener() {} };
  languageSelect.value = languageMode;
  const effectiveLanguage = () => languageMode === "auto" ? responseLanguage : languageMode;
  const locale = () => localeFor(effectiveLanguage());

  const renderSuggestions = () => {
    const copy = locale(), context = getContext(); root.querySelector("#copilotSuggestionsLabel").textContent = copy.suggested;
    suggestionBox.replaceChildren(...suggestionsFor(context.page, effectiveLanguage()).map((text) => { const button = el("button", "copilot-suggestion", text); button.type = "button"; button.addEventListener("click", () => { input.value = text; form.requestSubmit(); }); return button; }));
  };
  const applyLocale = () => {
    const copy = locale(), context = getContext(); drawer.lang = htmlLanguage(effectiveLanguage());
    root.querySelector("#copilotTitle").textContent = copy.title; root.querySelector(".copilot-read-only").textContent = copy.readOnly; root.querySelector(".copilot-availability span").textContent = copy.live; root.querySelector(".copilot-language-label > span").textContent = copy.language; root.querySelector('.copilot-language option[value="auto"]').textContent = copy.auto;
    close.setAttribute("aria-label", copy.close); contextText.textContent = `${copy.context}: ${titleCase(context.page)}${context.entityId ? ` · ${context.entityId}` : ""}`; input.placeholder = copy.placeholder; root.querySelector('label[for="copilotQuestion"]').textContent = copy.inputLabel; send.textContent = copy.send; root.querySelector(".copilot-safety-note").textContent = `${copy.readOnly} · ${copy.operationalCopilot}`; empty.querySelector("h3").textContent = copy.welcomeTitle; empty.querySelector("p").textContent = copy.welcomeBody;
    messages.querySelectorAll(".copilot-message.user .copilot-message-role").forEach((node) => { node.textContent = copy.you; }); messages.querySelectorAll(".copilot-message.assistant .copilot-message-role").forEach((node) => { node.textContent = copy.assistant; }); renderSuggestions();
  };
  const navigate = ({ view, entityId }) => { const nav = [...document.querySelectorAll(".nav-item")].find((button) => button.dataset.view === view && !button.hidden); if (nav) { if (entityId) document.body.dataset.copilotEntityId = entityId; nav.click(); hide(); } };
  const appendMessage = (role, text, response = {}) => {
    empty.hidden = true; const copy = locale(); messages.append(renderHistoryMessage(role, text, response, copy, navigate)); messages.scrollTop = messages.scrollHeight;
  };
  const appendError = (query) => { empty.hidden = true; const copy = locale(), article = el("article", "copilot-message system-error"); article.append(el("strong", "copilot-message-role", copy.assistant), el("p", "copilot-message-text", copy.error)); const retry = el("button", "copilot-retry", copy.retry); retry.type = "button"; retry.addEventListener("click", () => submitQuery(query, false)); article.append(retry); messages.append(article); messages.scrollTop = messages.scrollHeight; };

  const loadAndRenderHistory = async () => {
    if (!conversationId) return;
    const history = await loadConversationHistory(conversationId);
    if (!history) return;
    messages.replaceChildren();
    const latestAssistant = [...history].reverse().find((msg) => msg.role === "assistant");
    if (languageMode === "auto" && ["en", "te", "hi"].includes(latestAssistant?.metadata?.responseLanguage)) responseLanguage = latestAssistant.metadata.responseLanguage;
    empty.hidden = history.length > 0;
    applyLocale();
    const copy = locale();
    for (const msg of history) messages.append(renderHistoryMessage(msg.role, msg.content, msg.metadata || {}, copy, navigate));
    messages.scrollTop = messages.scrollHeight;
  };

  const clamp = ({ left, top }) => { const margin = 10, size = launcher.getBoundingClientRect().width || 58; return { left: Math.min(Math.max(margin, Number(left) || margin), Math.max(margin, window.innerWidth - size - margin)), top: Math.min(Math.max(margin, Number(top) || margin), Math.max(margin, window.innerHeight - size - margin)) }; };
  const position = (value, save = false) => { const next = clamp(value); launcher.style.left = `${next.left}px`; launcher.style.top = `${next.top}px`; launcher.style.right = "auto"; launcher.style.bottom = "auto"; if (save) try { window.localStorage.setItem(POSITION_KEY, JSON.stringify(next)); } catch {} };
  try { const saved = JSON.parse(window.localStorage.getItem(POSITION_KEY) || "null"); if (saved) position(saved); } catch {}
  const syncDock = () => {
    root.classList.toggle("docked", compact.matches); launcher.classList.toggle("docked", compact.matches);
    if (compact.matches) {
      const actions = document.querySelector(".topbar-actions"); if (actions && launcher.parentElement !== actions) actions.prepend(launcher);
      ["left", "top", "right", "bottom"].forEach((property) => launcher.style.removeProperty(property));
    } else if (launcher.parentElement !== root) root.prepend(launcher);
  };
  const hide = () => { drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); backdrop.hidden = true; launcher.setAttribute("aria-expanded", "false"); (previousFocus?.isConnected ? previousFocus : launcher).focus(); };
  const open = async () => { previousFocus = document.activeElement; applyLocale(); drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); backdrop.hidden = false; launcher.setAttribute("aria-expanded", "true"); await loadAndRenderHistory(); input.focus(); };
  openMountedCopilot = open;

  const submitQuery = async (message, showUser = true) => {
    const query = String(message || "").trim(); if (!query || send.disabled) return; if (showUser) appendMessage("user", query); input.value = ""; send.disabled = true; input.disabled = true; status.classList.add("loading"); status.textContent = locale().checking;
    try { const response = await api("/api/copilot/query", { method: "POST", body: { message: query, pageContext: getContext(), conversationId, selectedLanguage: languageMode } }); conversationId = response.conversationId || conversationId; if (conversationId) try { window.sessionStorage.setItem(CONVERSATION_KEY, conversationId); } catch {} responseLanguage = response.responseLanguage || response.detectedLanguage || responseLanguage; applyLocale(); appendMessage("assistant", response.answer, response); status.textContent = locale().generated; }
    catch { appendError(query); status.textContent = locale().error; }
    finally { status.classList.remove("loading"); send.disabled = false; input.disabled = false; input.focus(); }
  };

  let composing = false;
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { composing = false; });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || composing || event.keyCode === 229) return;
    event.preventDefault();
    if (!event.repeat) form.requestSubmit();
  });

  const onPointerDown = (event) => { if (root.classList.contains("docked") || (event.button !== undefined && event.button !== 0)) return; const rect = launcher.getBoundingClientRect(); drag = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top, sx: event.clientX, sy: event.clientY, moved: false }; launcher.setPointerCapture?.(event.pointerId); launcher.classList.add("dragging"); };
  const onPointerMove = (event) => { if (!drag || drag.id !== event.pointerId) return; if (Math.hypot(event.clientX - drag.sx, event.clientY - drag.sy) > 5) drag.moved = true; if (drag.moved) { event.preventDefault(); position({ left: event.clientX - drag.x, top: event.clientY - drag.y }); } };
  const onPointerUp = (event) => { if (!drag || drag.id !== event.pointerId) return; suppressClick = drag.moved; if (drag.moved) position({ left: event.clientX - drag.x, top: event.clientY - drag.y }, true); launcher.releasePointerCapture?.(event.pointerId); launcher.classList.remove("dragging"); drag = null; };
  const onKeydown = (event) => { if (!drawer.classList.contains("open")) return; if (event.key === "Escape") { event.preventDefault(); hide(); return; } if (event.key !== "Tab") return; const nodes = [...drawer.querySelectorAll('button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((node) => node.getClientRects().length); if (!nodes.length) return; if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1).focus(); } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); } };
  const onResize = () => { if (!root.classList.contains("docked") && launcher.style.left) position({ left: parseFloat(launcher.style.left), top: parseFloat(launcher.style.top) }, true); };
  launcher.addEventListener("click", () => { if (suppressClick) { suppressClick = false; return; } open(); }); launcher.addEventListener("pointerdown", onPointerDown); launcher.addEventListener("pointermove", onPointerMove); launcher.addEventListener("pointerup", onPointerUp); launcher.addEventListener("pointercancel", onPointerUp); close.addEventListener("click", hide); backdrop.addEventListener("click", hide); form.addEventListener("submit", (event) => { event.preventDefault(); submitQuery(input.value); }); languageSelect.addEventListener("change", () => { languageMode = languageSelect.value; try { window.localStorage.setItem(COPILOT_LANGUAGE_KEY, languageMode); } catch {} if (languageMode !== "auto") responseLanguage = languageMode; applyLocale(); input.focus(); }); document.addEventListener("keydown", onKeydown); window.addEventListener("resize", onResize); compact.addEventListener?.("change", syncDock);
  removeGlobalListeners = () => { document.removeEventListener("keydown", onKeydown); window.removeEventListener("resize", onResize); compact.removeEventListener?.("change", syncDock); };
  syncDock(); applyLocale();
}

export function openCopilot() { openMountedCopilot?.(); }
export function unmountCopilot() { removeGlobalListeners?.(); removeGlobalListeners = null; const root = document.getElementById("rakshakCopilot"); document.querySelector(".copilot-launcher.docked")?.remove(); root?.remove(); conversationId = null; try { window.sessionStorage.removeItem(CONVERSATION_KEY); } catch {} openMountedCopilot = null; mounted = false; }
