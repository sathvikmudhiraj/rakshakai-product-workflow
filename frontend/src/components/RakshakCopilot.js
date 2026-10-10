import { api } from "../services/api.js";

let getContext = () => ({ page: "dashboard" });
let mounted = false;
let removeEscapeListener = null;

const suggestions = {
  "incident-command": ["What needs attention in this incident?", "Who is responding?", "Which incidents still need a unit?"],
  cctv: ["Which cameras need attention?", "Why is this camera unhealthy?", "Which cameras are offline?"],
  "unit-assignment": ["Which incidents still need a unit?", "Which units are available?", "What needs attention now?"],
  "multi-camera-tracking": ["What needs attention now?", "Which cameras need attention?", "Give today's operational summary."],
  dashboard: ["Give today's operational summary.", "What needs attention now?", "Which cameras need attention?"]
};

export function configureCopilot({ context } = {}) { if (typeof context === "function") getContext = context; }

function element(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text != null) el.textContent = text; return el; }
function appendMessage(container, role, text) { const message = element("article", `copilot-message ${role}`); message.append(element("strong", "copilot-message-role", role === "user" ? "You" : "Rakshak AI"), element("p", "", text)); container.append(message); container.scrollTop = container.scrollHeight; }

export function mountCopilot() {
  if (mounted || document.getElementById("rakshakCopilot")) return;
  mounted = true;
  const root = element("section", "rakshak-copilot"); root.id = "rakshakCopilot";
  root.innerHTML = `<button type="button" class="copilot-launcher" aria-label="Open Rakshak AI Copilot" aria-expanded="false">AI</button><aside class="copilot-drawer" aria-label="Rakshak AI Copilot" aria-hidden="true"><header><div><strong>Rakshak AI Copilot</strong><small>READ-ONLY · Information access only</small></div><button type="button" class="ghost copilot-close" aria-label="Close Copilot">×</button></header><p class="copilot-context"></p><div class="copilot-suggestions"></div><div class="copilot-messages" aria-live="polite"></div><form class="copilot-form"><label class="sr-only" for="copilotQuestion">Ask Rakshak AI</label><textarea id="copilotQuestion" maxlength="2000" placeholder="Ask Rakshak about authorized operational information"></textarea><button class="btn btn-primary" type="submit">Send</button></form></aside>`;
  const launcher = root.querySelector(".copilot-launcher"), drawer = root.querySelector(".copilot-drawer"), close = root.querySelector(".copilot-close"), messages = root.querySelector(".copilot-messages"), contextText = root.querySelector(".copilot-context"), suggestionBox = root.querySelector(".copilot-suggestions"), form = root.querySelector(".copilot-form"), input = root.querySelector("textarea");
  const open = () => { const context = getContext(); drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); launcher.setAttribute("aria-expanded", "true"); contextText.textContent = `Viewing: ${String(context.page || "dashboard").replace(/-/g, " ")}`; suggestionBox.replaceChildren(...(suggestions[context.page] || suggestions.dashboard).map((text) => { const button = element("button", "copilot-suggestion", text); button.type = "button"; button.addEventListener("click", () => { input.value = text; form.requestSubmit(); }); return button; })); input.focus(); };
  const hide = () => { drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); launcher.setAttribute("aria-expanded", "false"); launcher.focus(); };
  launcher.addEventListener("click", open); close.addEventListener("click", hide);
  const onEscape = (event) => { if (event.key === "Escape" && drawer.classList.contains("open")) hide(); };
  document.addEventListener("keydown", onEscape);
  removeEscapeListener = () => document.removeEventListener("keydown", onEscape);
  form.addEventListener("submit", async (event) => { event.preventDefault(); const message = input.value.trim(); if (!message) return; appendMessage(messages, "user", message); input.value = ""; const button = form.querySelector("button"); button.disabled = true; try { const result = await api("/api/copilot/query", { method: "POST", body: { message, pageContext: getContext() } }); appendMessage(messages, "assistant", result.answer); } catch (error) { appendMessage(messages, "assistant", error.message || "Rakshak Copilot is temporarily unavailable."); } finally { button.disabled = false; input.focus(); } });
  document.body.append(root);
}

export function unmountCopilot() { removeEscapeListener?.(); removeEscapeListener = null; document.getElementById("rakshakCopilot")?.remove(); mounted = false; }
