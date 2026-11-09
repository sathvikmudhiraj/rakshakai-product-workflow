const initialSnapshot = () => ({
  incidentId: null,
  status: "idle",
  data: null,
  error: null
});

export function canDispatchUnits(user) {
  return user?.role === "Admin" || (user?.role === "Police Officer"
    && ["DISPATCHER", "SUPERVISOR"].includes(user.operationalRole || user.data?.operationalRole));
}

export function memberUnavailable(member, incidentId) {
  return !member.active
    || ["off_duty", "leave", "suspended"].includes(String(member.dutyStatus || "").toLowerCase())
    || String(member.availability || "unknown").toLowerCase() !== "available"
    || Boolean(member.currentIncidentId && member.currentIncidentId !== incidentId);
}

export function recommendationAvailable(result) {
  return Boolean(result?.unit || result?.recommendation?.primary);
}

export function unitAssignmentAction({ status, operational = true, assignedUnitId = null }) {
  const assignable = status === "available" && operational !== false;
  return {
    assignable,
    label: assignable ? (assignedUnitId ? "Change Unit" : "Assign Unit") : String(status || "unavailable")
  };
}

export function hybridSupportVisible(incident, recommendation) {
  return Boolean(
    incident?.assignedUnitId
    && recommendation?.status === "recommended"
    && (recommendation.stationSupport?.allocations || []).length
  );
}

export function createUnitAssignmentRecommendationCoordinator({
  request,
  onChange = () => {},
  formatError = (error) => error?.message || "Recommendation request failed",
  isUnavailableError = () => false
}) {
  let snapshot = initialSnapshot();
  let requestSequence = 0;
  let inFlight = null;

  const publish = (next) => {
    snapshot = next;
    onChange(snapshot);
    return snapshot;
  };

  const select = (incident, { force = false, allowAssigned = false } = {}) => {
    const incidentId = incident?.id || null;
    if (!incidentId || (incident.assignedUnitId && !allowAssigned)) {
      requestSequence += 1;
      inFlight = null;
      return Promise.resolve(publish({ ...initialSnapshot(), incidentId }));
    }

    if (!force && snapshot.incidentId === incidentId && snapshot.status !== "idle") {
      return inFlight?.promise || Promise.resolve(snapshot);
    }

    const sequence = ++requestSequence;
    publish({ incidentId, status: "loading", data: null, error: null });

    const promise = (async () => {
      try {
        const result = await request(incident);
        if (sequence !== requestSequence) return snapshot;
        return publish({
          incidentId,
          status: recommendationAvailable(result) ? "ready" : "unavailable",
          data: result || null,
          error: null
        });
      } catch (error) {
        if (sequence !== requestSequence) return snapshot;
        return publish({ incidentId, status: isUnavailableError(error) ? "unavailable" : "error", data: null, error: formatError(error) });
      } finally {
        if (inFlight?.sequence === sequence) inFlight = null;
        if (sequence === requestSequence && snapshot.incidentId === incidentId && snapshot.status === "loading") {
          publish({ incidentId, status: "error", data: null, error: "Recommendation request did not complete" });
        }
      }
    })();

    inFlight = { incidentId, sequence, promise };
    return promise;
  };

  return {
    getSnapshot: () => snapshot,
    select,
    retry: (incident) => select(incident, { force: true, allowAssigned: Boolean(incident?.assignedUnitId) }),
    requestSupport: (incident) => select(incident, { force: true, allowAssigned: true }),
    clear: () => {
      requestSequence += 1;
      inFlight = null;
      return publish(initialSnapshot());
    }
  };
}
