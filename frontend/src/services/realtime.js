import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "";

let socket = null;
let isConnected = false;
const eventHandlers = new Map();
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

export function initializeSocket(user) {
  if (socket?.connected) return socket;

  socket = io(SOCKET_URL, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
    withCredentials: true
  });

  socket.on("connect", () => {
    isConnected = true;
    reconnectAttempts = 0;
    console.log("[Real-time] Connected:", socket.id);

    if (user?.role === "Admin" || user?.role === "Police Officer") {
      socket.emit("join_dashboard", user.role);
    }
  });

  socket.on("disconnect", (reason) => {
    isConnected = false;
    console.log("[Real-time] Disconnected:", reason);
  });

  socket.on("connect_error", (error) => {
    reconnectAttempts++;
    console.warn("[Real-time] Connection error:", error.message, `(${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
  });

  socket.on("reconnect", (attemptNumber) => {
    isConnected = true;
    console.log("[Real-time] Reconnected after", attemptNumber, "attempts");

    if (user?.role === "Admin" || user?.role === "Police Officer") {
      socket.emit("join_dashboard", user.role);
    }
  });

  socket.on("reconnect_failed", () => {
    console.error("[Real-time] Reconnection failed after max attempts");
  });

  setupEventListeners();

  return socket;
}

function setupEventListeners() {
  const events = [
    "critical_incident_created",
    "incident_assignment_warning",
    "incident_assignment_breached",
    "response_sla_breached",
    "escalation_level_changed",
    "investigation_overdue",
    "incident_assigned",
    "incident_en_route",
    "incident_on_scene",
    "unit_assigned",
    "unit_reassigned",
    "unit_released",
    "incident_assignment_changed",
    "escalation_alert_created",
    "escalation_alert_acknowledged",
    "escalation_alert_resolved"
  ];

  events.forEach((event) => {
    socket.on(event, (data) => {
      const handlers = eventHandlers.get(event) || [];
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          console.error(`[Real-time] Handler error for ${event}:`, error);
        }
      });
    });
  });
}

export function on(event, handler) {
  if (!eventHandlers.has(event)) {
    eventHandlers.set(event, []);
  }
  eventHandlers.get(event).push(handler);

  return () => {
    const handlers = eventHandlers.get(event) || [];
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}

export function off(event, handler) {
  const handlers = eventHandlers.get(event) || [];
  const index = handlers.indexOf(handler);
  if (index >= 0) handlers.splice(index, 1);
}

export function joinIncidentRoom(incidentId) {
  if (socket?.connected && incidentId) {
    socket.emit("join_incident_room", incidentId);
  }
}

export function leaveIncidentRoom(incidentId) {
  if (socket?.connected && incidentId) {
    socket.emit("leave_incident_room", incidentId);
  }
}

export function disconnect() {
  if (socket) {
    socket.disconnect();
    socket = null;
    isConnected = false;
  }
}

export function getConnectionStatus() {
  return isConnected;
}

export function getSocket() {
  return socket;
}
