function currentConfirm() {
  return typeof globalThis.window === "object" ? globalThis.window.confirm : null;
}

const nativeConfirm = currentConfirm();

function parseMessage(message) {
  const lines = String(message || "").split("\n").map((line) => line.trim()).filter(Boolean);
  return { title: lines[0] || "Confirm", detail: lines.slice(1).join(" ") };
}

export function confirmAction(message, {
  title,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false
} = {}) {
  const confirmFn = currentConfirm();
  if (confirmFn && confirmFn !== nativeConfirm) {
    return Promise.resolve(Boolean(confirmFn(message)));
  }
  const parsed = parseMessage(message);
  return showAppConfirm({
    title: title || parsed.title,
    message: parsed.detail || parsed.title,
    confirmLabel,
    cancelLabel,
    danger
  });
}

function showAppConfirm({ title, message, confirmLabel, cancelLabel, danger }) {
  return new Promise((resolve) => {
    const document = globalThis.document;
    if (!document?.body) {
      resolve(Boolean(currentConfirm()?.(message)));
      return;
    }
    document.getElementById("appConfirmDialog")?.remove();
    const dialog = document.createElement("div");
    dialog.id = "appConfirmDialog";
    dialog.className = "app-confirm-overlay";
    dialog.innerHTML = `
      <div class="app-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="appConfirmTitle" aria-describedby="appConfirmMessage">
        <h2 id="appConfirmTitle"></h2>
        <p id="appConfirmMessage"></p>
        <div class="app-confirm-actions">
          <button type="button" class="ghost" data-confirm="no"></button>
          <button type="button" class="primary" data-confirm="yes"></button>
        </div>
      </div>`;
    dialog.querySelector("#appConfirmTitle").textContent = title;
    dialog.querySelector("#appConfirmMessage").textContent = message;
    dialog.querySelector('[data-confirm="no"]').textContent = cancelLabel;
    const yes = dialog.querySelector('[data-confirm="yes"]');
    yes.textContent = confirmLabel;
    if (danger) yes.className = "danger";
    const previous = document.activeElement;
    const finish = (ok) => {
      dialog.remove();
      document.removeEventListener("keydown", onKey);
      if (previous?.focus) previous.focus();
      resolve(ok);
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
      if (event.key !== "Tab") return;
      const buttons = [...dialog.querySelectorAll("button")];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) finish(false);
      const button = event.target.closest("[data-confirm]");
      if (button) finish(button.dataset.confirm === "yes");
    });
    document.addEventListener("keydown", onKey);
    document.body.append(dialog);
    yes.focus();
  });
}
