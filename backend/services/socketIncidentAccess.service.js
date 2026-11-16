const ALLOWED_INCIDENT_SOCKET_ROLES = new Set(["Admin", "Police Officer"]);

async function joinAuthorizedIncidentRoom({ socket, user, incidentId, readDatabase }) {
  if (!socket || typeof socket.join !== "function" || typeof readDatabase !== "function") return false;
  if (!ALLOWED_INCIDENT_SOCKET_ROLES.has(user?.role)) return false;
  if (typeof incidentId !== "string" || incidentId.length < 1 || incidentId.length > 160) return false;

  const db = await readDatabase();
  const incidentExists = (db?.incidents || []).some((incident) => String(incident?.id || "") === incidentId);
  if (!incidentExists) return false;

  socket.join(`incident:${incidentId}`);
  return true;
}

module.exports = { joinAuthorizedIncidentRoom };
