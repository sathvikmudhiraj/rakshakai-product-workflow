import { api } from "../services/api.js";
import { on as onRealtime } from "../services/realtime.js";

const REALTIME_EVENTS = [
  "critical_incident_created", "incident_assignment_warning", "incident_assignment_breached",
  "response_sla_breached", "escalation_level_changed", "escalation_alert_created",
  "camera_health_changed", "camera_offline", "camera_no_signal", "camera_no_video_frames",
  "camera_tamper_suspected", "camera_health_alert_created", "tracking_candidates_found",
  "tracking_candidate_verified", "tracking_session_created"
];
const FILTERS = ["all", "unread", "critical", "incidents", "sla", "cameras", "tracking", "reports", "system"];
const POSITION_KEY = "rakshakai_notification_launcher_position";
let mounted = false;
let cleanup = [];

function el(tag, className = "", text = null) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== null) element.textContent = text;
  return element;
}

function relativeTime(value) {
  const elapsed = Math.max(0, Date.now() - Date.parse(value || ""));
  if (!Number.isFinite(elapsed)) return "Time unavailable";
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} hr ago`;
  return new Date(value).toLocaleDateString();
}

function category(item) {
  if (item.entityType === "incident" && /sla|breach|warning|escalation|investigation/.test(item.type)) return "sla";
  return ({ incident: "incidents", camera: "cameras", tracking_session: "tracking", tracking_candidate: "tracking", report: "reports", evidence: "system" })[item.entityType] || "system";
}

function matches(item, filter) {
  if (filter === "all") return true;
  if (filter === "unread") return !item.read;
  if (filter === "critical") return item.severity === "CRITICAL";
  return category(item) === filter;
}

function humanLabel(value) {
  return String(value || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (value === null || value === undefined || value === "") return "Not available";
  if (typeof value === "number") return String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(String(value))) return new Date(value).toLocaleString();
  return String(value);
}

function detailNode(value, key = "Details", depth = 0) {
  if (Array.isArray(value)) {
    const section = el("section", "notification-detail-section");
    section.append(el("h4", "", `${humanLabel(key)} (${value.length})`));
    if (!value.length) section.append(el("p", "notification-detail-empty", "No current records."));
    value.slice(0, 40).forEach((entry) => section.append(detailNode(entry, "", depth + 1)));
    return section;
  }
  if (value && typeof value === "object") {
    const section = el(depth > 0 ? "div" : "section", depth > 0 ? "notification-detail-group" : "notification-detail-section");
    if (key) section.append(el(depth > 0 ? "h5" : "h4", "", humanLabel(key)));
    const grid = el("dl", "notification-detail-grid");
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== "").forEach(([field, entry]) => {
      if (typeof entry === "object") section.append(detailNode(entry, field, depth + 1));
      else { grid.append(el("dt", "", humanLabel(field)), el("dd", "", displayValue(entry))); }
    });
    if (grid.children.length) section.insertBefore(grid, section.children[1] || null);
    return section;
  }
  return el("p", "notification-detail-value", displayValue(value));
}

export function mountNotificationCenter({ navigate, openCopilot, showCopilot = true } = {}) {
  if (mounted || document.getElementById("notificationCenter")) return;
  mounted = true;
  document.body.classList.add("notification-center-mounted");
  const root = el("section", "notification-center");
  root.id = "notificationCenter";
  root.innerHTML = `
    <button type="button" class="notification-launcher" aria-label="Open Notification Center" aria-expanded="false">
      <svg class="notification-shield" aria-hidden="true" viewBox="0 0 64 64" fill="none"><path d="M32 4 53 12v17c0 14-8.8 24.6-21 31C19.8 53.6 11 43 11 29V12L32 4Z"/><path d="M32 17v21"/><path d="M23 29h18"/><circle cx="32" cy="43" r="2.5"/></svg>
      <span class="notification-count" hidden>0</span>
    </button>
    <div class="notification-backdrop" hidden></div>
    <aside class="notification-drawer" role="dialog" aria-modal="true" aria-labelledby="notificationTitle" aria-hidden="true">
      <header class="notification-header"><div><span class="eyebrow">Operational Inbox</span><h2 id="notificationTitle">Notifications</h2><p>Current alerts linked to authoritative records.</p></div><div class="notification-header-actions"><button type="button" class="notification-mark-all">Mark all read</button><button type="button" class="notification-close" aria-label="Close notifications">×</button></div></header>
      <div class="notification-filter-bar" role="tablist" aria-label="Notification filters"></div>
      <div class="notification-status" role="status" aria-live="polite"></div>
      <div class="notification-list" role="feed" aria-busy="false"></div>
      <div class="notification-detail" hidden></div>
    </aside>`;
  document.body.append(root);

  const launcher = root.querySelector(".notification-launcher");
  const count = root.querySelector(".notification-count");
  const drawer = root.querySelector(".notification-drawer");
  const backdrop = root.querySelector(".notification-backdrop");
  const close = root.querySelector(".notification-close");
  const markAll = root.querySelector(".notification-mark-all");
  const filters = root.querySelector(".notification-filter-bar");
  const list = root.querySelector(".notification-list");
  const detail = root.querySelector(".notification-detail");
  const status = root.querySelector(".notification-status");
  let items = [];
  let activeFilter = "all";
  let previousFocus = null;
  let refreshTimer = null;
  let drag = null;
  let suppressClick = false;
  const mobileDock = window.matchMedia?.("(max-width: 1120px)") || { matches: false, addEventListener() {}, removeEventListener() {} };

  const updateBadge = (unread) => {
    const value = Math.max(0, Number(unread) || 0);
    count.textContent = value > 99 ? "99+" : String(value);
    count.hidden = value === 0;
    launcher.setAttribute("aria-label", value ? `Open Notification Center, ${value} unread` : "Open Notification Center");
  };

  const renderList = () => {
    detail.hidden = true; list.hidden = false; list.textContent = "";
    const visible = items.filter((item) => matches(item, activeFilter));
    if (!visible.length) {
      const empty = el("div", "notification-empty");
      empty.append(el("strong", "", activeFilter === "unread" ? "No unread notifications" : "No notifications match this filter"), el("p", "", "New operational events will appear here automatically."));
      list.append(empty); return;
    }
    visible.forEach((item) => {
      const card = el("article", `notification-item severity-${item.severity.toLowerCase()} ${item.read ? "read" : "unread"}`);
      card.dataset.notificationId = item.id;
      const indicator = el("span", "notification-severity-dot");
      const body = el("div", "notification-item-body");
      const meta = el("div", "notification-item-meta");
      meta.append(el("span", "notification-type", humanLabel(item.type)), el("time", "", relativeTime(item.createdAt)));
      body.append(meta, el("h3", "", item.title), el("p", "", item.message), el("small", "", `${humanLabel(item.entityType)} · ${item.entityId}`));
      const actions = el("div", "notification-item-actions");
      const view = el("button", "notification-view", "View Details"); view.type = "button";
      const toggle = el("button", "notification-read-toggle", item.read ? "Mark unread" : "Mark read"); toggle.type = "button";
      view.addEventListener("click", () => showDetails(item));
      toggle.addEventListener("click", () => setRead(item, !item.read));
      actions.append(view, toggle); card.append(indicator, body, actions); list.append(card);
    });
  };

  const load = async ({ quiet = false } = {}) => {
    if (!quiet) { list.setAttribute("aria-busy", "true"); status.textContent = "Loading current notifications…"; }
    try {
      const response = await api("/api/notifications");
      items = response.notifications || []; updateBadge(response.unreadCount); renderList(); status.textContent = "";
    } catch (error) { status.textContent = error.message; }
    finally { list.setAttribute("aria-busy", "false"); }
  };

  const setRead = async (item, read) => {
    try {
      const response = await api(`/api/notifications/${encodeURIComponent(item.id)}/read`, { method: "PATCH", body: { read } });
      item.read = response.notification.read; item.readAt = response.notification.readAt;
      updateBadge(items.filter((entry) => !entry.read).length); renderList();
    } catch (error) { status.textContent = error.message; }
  };

  const openRelated = async (item) => {
    try { await api(`/api/notifications/${encodeURIComponent(item.id)}/opened`, { method: "POST" }); } catch {}
    const view = ({ incident: "incident-command", report: "missing", camera: "cctv", ai_observation: "cctv", tracking_session: "multi-camera-tracking", tracking_candidate: "multi-camera-tracking", evidence: "video-evidence" })[item.entityType];
    if (view && typeof navigate === "function") { navigate({ view, entityType: item.entityType, entityId: item.entityId }); hide(); }
  };

  const showDetails = async (item) => {
    list.hidden = true; detail.hidden = false; detail.textContent = "";
    const back = el("button", "notification-back", "← Back to Notifications"); back.type = "button"; back.addEventListener("click", renderList);
    detail.append(back, el("p", "notification-detail-loading", "Loading latest authorized record…"));
    try {
      if (!item.read) await setRead(item, true);
      const response = await api(`/api/notifications/${encodeURIComponent(item.id)}/details`);
      detail.textContent = ""; detail.append(back);
      const head = el("div", "notification-detail-head");
      const copy = el("div"); copy.append(el("span", `notification-detail-severity severity-${item.severity.toLowerCase()}`, item.severity), el("h3", "", response.detail.kind), el("p", "", `Latest record fetched ${new Date(response.fetchedAt).toLocaleTimeString()}`));
      const open = el("button", "notification-open-related", "Open Related Module"); open.type = "button"; open.addEventListener("click", () => openRelated(item));
      head.append(copy, open); detail.append(head);
      Object.entries(response.detail).filter(([key]) => key !== "kind").forEach(([key, value]) => detail.append(detailNode(value, key)));
    } catch (error) { detail.querySelector(".notification-detail-loading").textContent = error.message; }
  };

  FILTERS.forEach((filter) => {
    const button = el("button", filter === "all" ? "active" : "", humanLabel(filter)); button.type = "button"; button.dataset.filter = filter;
    button.setAttribute("role", "tab"); button.setAttribute("aria-selected", String(filter === "all"));
    button.addEventListener("click", () => { activeFilter = filter; [...filters.children].forEach((child) => { const selected = child === button; child.classList.toggle("active", selected); child.setAttribute("aria-selected", String(selected)); }); renderList(); });
    filters.append(button);
  });
  if (showCopilot && typeof openCopilot === "function") {
    const copilot = el("button", "notification-copilot-link", "Ask Rakshak AI"); copilot.type = "button";
    copilot.addEventListener("click", () => { hide(); openCopilot(); }); filters.append(copilot);
  }

  const open = () => {
    previousFocus = document.activeElement;
    if (mobileDock.matches && root.parentElement !== document.body) {
      document.body.append(root);
      root.classList.remove("docked");
    }
    drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); backdrop.hidden = false;
    launcher.setAttribute("aria-expanded", "true"); load(); close.focus();
  };
  const hide = () => {
    drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); backdrop.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    if (mobileDock.matches) syncDock();
    (previousFocus?.isConnected ? previousFocus : launcher).focus();
  };
  const clamp = ({ left, top }) => { const size = launcher.getBoundingClientRect().width || 58, margin = 12; return { left: Math.min(Math.max(margin, Number(left) || margin), innerWidth - size - margin), top: Math.min(Math.max(margin, Number(top) || margin), innerHeight - size - margin) }; };
  const position = (value, save = false) => { const next = clamp(value); launcher.style.left = `${next.left}px`; launcher.style.top = `${next.top}px`; launcher.style.right = "auto"; launcher.style.bottom = "auto"; if (save) try { localStorage.setItem(POSITION_KEY, JSON.stringify(next)); } catch {} };
  try { const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || "null"); if (saved) position(saved); } catch {}
  const syncDock = () => {
    root.classList.toggle("docked", mobileDock.matches);
    if (mobileDock.matches) {
      const actions = document.querySelector(".topbar-actions");
      if (actions && root.parentElement !== actions) actions.prepend(root);
      launcher.style.removeProperty("left"); launcher.style.removeProperty("top"); launcher.style.removeProperty("right"); launcher.style.removeProperty("bottom");
    } else if (root.parentElement !== document.body) {
      document.body.append(root);
      try { const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || "null"); if (saved) position(saved); } catch {}
    }
  };
  syncDock();
  mobileDock.addEventListener?.("change", syncDock);
  cleanup.push(() => mobileDock.removeEventListener?.("change", syncDock));
  launcher.addEventListener("pointerdown", (event) => { if (root.classList.contains("docked")) return; const rect = launcher.getBoundingClientRect(); drag = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top, sx: event.clientX, sy: event.clientY, moved: false }; launcher.setPointerCapture?.(event.pointerId); });
  launcher.addEventListener("pointermove", (event) => { if (!drag || drag.id !== event.pointerId) return; if (Math.hypot(event.clientX - drag.sx, event.clientY - drag.sy) > 5) drag.moved = true; if (drag.moved) { event.preventDefault(); position({ left: event.clientX - drag.x, top: event.clientY - drag.y }); } });
  const endDrag = (event) => { if (!drag || drag.id !== event.pointerId) return; suppressClick = drag.moved; if (drag.moved) position({ left: event.clientX - drag.x, top: event.clientY - drag.y }, true); drag = null; };
  launcher.addEventListener("pointerup", endDrag); launcher.addEventListener("pointercancel", endDrag);
  launcher.addEventListener("click", () => { if (suppressClick) { suppressClick = false; return; } open(); });
  close.addEventListener("click", hide); backdrop.addEventListener("click", hide);
  markAll.addEventListener("click", async () => { try { await api("/api/notifications/mark-all-read", { method: "POST" }); await load({ quiet: true }); } catch (error) { status.textContent = error.message; } });
  const escape = (event) => {
    if (!drawer.classList.contains("open")) return;
    if (event.key === "Escape") { hide(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...drawer.querySelectorAll("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")].filter((node) => !node.hidden && node.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  document.addEventListener("keydown", escape); cleanup.push(() => document.removeEventListener("keydown", escape));
  REALTIME_EVENTS.forEach((eventName) => cleanup.push(onRealtime(eventName, () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => load({ quiet: true }), 120); })));
  cleanup.push(() => clearTimeout(refreshTimer));
  load({ quiet: true });
}

export function unmountNotificationCenter() {
  cleanup.forEach((dispose) => dispose?.()); cleanup = [];
  document.getElementById("notificationCenter")?.remove();
  document.body.classList.remove("notification-center-mounted"); mounted = false;
}
