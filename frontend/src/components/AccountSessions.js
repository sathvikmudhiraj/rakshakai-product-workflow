function element(tag, text = "", className = "") {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}

export function closeAccountSessions() {
  const dialog = document.getElementById("accountSessionsDialog");
  dialog?.close?.(); dialog?.remove();
}

export function openAccountSessions({ api, onSessionRotated, onSignedOut } = {}) {
  closeAccountSessions();
  const previousFocus = document.activeElement;
  const dialog = element("dialog", "", "account-sessions-dialog"); dialog.id = "accountSessionsDialog";
  dialog.setAttribute("aria-labelledby", "accountSessionsTitle");
  const title = element("h2", "Account sessions"); title.id = "accountSessionsTitle";
  const copy = element("p", "Review your sign-ins and sign out a device you no longer use.");
  const list = element("div", "", "stack");
  const status = element("p", "Loading sessions…", "form-status"); status.setAttribute("role", "status");
  const actions = element("div", "", "actions");
  const others = element("button", "Sign out other sessions", "ghost"); others.type = "button";
  const close = element("button", "Close", "primary"); close.type = "button";
  actions.append(others, close); dialog.append(title, copy, list, status,
    element("p", "Signing out other sessions also invalidates older sign-ins."), actions);
  document.body.append(dialog);
  const dispose = () => { dialog.remove(); previousFocus?.focus?.(); };
  dialog.addEventListener("close", dispose, { once: true });
  close.addEventListener("click", () => { dialog.close?.(); dispose(); });

  async function load() {
    try {
      const result = await api("/api/auth/sessions");
      if (!dialog.isConnected) return;
      list.replaceChildren(); status.textContent = "";
      if (!result.sessions.length) list.append(element("p", "Your current sign-in predates the session list. Use sign out other sessions to renew it."));
      for (const session of result.sessions) {
        const card = element("article", "", "account-session-card");
        const heading = element("strong", session.current ? "Current session" : "Other session");
        const method = session.authMethod === "google_workspace" ? "Google Workspace" : "Password sign-in";
        card.append(heading, element("p", session.deviceLabel), element("small", `${method} · Signed in ${new Date(session.issuedAt * 1000).toLocaleString()} · Expires ${new Date(session.expiresAt * 1000).toLocaleString()}`));
        if (!session.current) {
          const revoke = element("button", "Sign out this session", "ghost"); revoke.type = "button";
          revoke.addEventListener("click", async () => {
            revoke.disabled = true;
            try { await api(`/api/auth/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" }); await load(); }
            catch (error) { if (dialog.isConnected) { status.textContent = error.message; revoke.disabled = false; } }
          }); card.append(revoke);
        }
        list.append(card);
      }
    } catch (error) {
      if (!dialog.isConnected) return;
      if (error.status === 401) { dispose(); onSignedOut?.(); return; }
      status.textContent = error.message;
    }
  }

  others.addEventListener("click", async () => {
    others.disabled = true;
    try {
      await api("/api/auth/sessions/revoke-others", { method: "POST" });
      if (!dialog.isConnected) return;
      onSessionRotated?.(); await load();
      if (dialog.isConnected) status.textContent = "Other sessions signed out. This session has been renewed.";
    } catch (error) { if (dialog.isConnected) status.textContent = error.message; }
    finally { others.disabled = false; }
  });
  dialog.showModal?.(); close.focus(); load();
  return dialog;
}
