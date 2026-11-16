function display(value, fallback = "Not recorded") {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text || fallback;
  }
  return fallback;
}

function emptyState(document, message) {
  const element = document.createElement("div");
  element.className = "empty-state";
  element.textContent = message;
  return element;
}

function alertCard(document, kind, title, details) {
  const card = document.createElement("article");
  card.className = `supervisor-alert ${kind}`;
  const heading = document.createElement("strong");
  heading.textContent = title;
  card.append(heading);
  for (const detail of details) {
    const line = document.createElement("small");
    line.textContent = detail;
    card.append(line);
  }
  return card;
}

function setPanelState(document, panel, { loading, error, emptyMessage }) {
  panel.replaceChildren();
  if (loading) {
    const status = document.createElement("div");
    status.className = "loading-state";
    status.setAttribute("role", "status");
    status.textContent = "Loading supervisor queue…";
    panel.append(status);
    return false;
  }
  if (error) {
    const message = document.createElement("div");
    message.className = "error-state";
    message.setAttribute("role", "alert");
    message.textContent = "Could not load supervisor queue. Use Refresh to try again.";
    panel.append(message);
    return false;
  }
  if (emptyMessage) {
    panel.append(emptyState(document, emptyMessage));
    return false;
  }
  return true;
}

export function renderErssSupervisorQueue({ document, queue, loading = false, error = null }) {
  const critical = document.querySelector("#supervisorCritical");
  const timeouts = document.querySelector("#supervisorTimeouts");
  const disputes = document.querySelector("#supervisorDisputes");
  if (!critical || !timeouts || !disputes) return;

  const panels = [critical, timeouts, disputes];
  const options = { loading, error };
  if (!panels.map((panel) => setPanelState(document, panel, options)).every(Boolean)) return;

  const criticalEvents = Array.isArray(queue?.criticalEvents) ? queue.criticalEvents : [];
  if (!criticalEvents.length) {
    critical.append(emptyState(document, "No critical events without response."));
  } else {
    for (const event of criticalEvents) {
      critical.append(alertCard(document, "critical",
        `CRITICAL: ${display(event.externalEventId || event.id, "Emergency event")}`,
        [
          `Type: ${display(event.emergencyType)} | Location: ${display(event.incidentLocationText, "Unknown")}`,
          `Triage: ${display(event.triageStatus)} | Since: ${display(event.createdAt)}`
        ]
      ));
    }
  }

  const unitTimeouts = Array.isArray(queue?.unitTimeouts) ? queue.unitTimeouts : [];
  const assistanceTimeouts = Array.isArray(queue?.assistanceTimeouts) ? queue.assistanceTimeouts : [];
  const allTimeouts = [...unitTimeouts, ...assistanceTimeouts];
  if (!allTimeouts.length) {
    timeouts.append(emptyState(document, "No active timeouts."));
  } else {
    for (const request of allTimeouts) {
      timeouts.append(alertCard(document, "timeout",
        `${display(request.status, "TIMEOUT")} - ${display(request.erssEventId, "Emergency event")}`,
        [`Unit/station: ${display(request.unitId || request.requestedStationId)} | Since: ${display(request.timeoutAt || request.requestedAt)}`]
      ));
    }
  }

  const jurisdictionDisputes = Array.isArray(queue?.jurisdictionDisputes) ? queue.jurisdictionDisputes : [];
  const ownershipTransfers = Array.isArray(queue?.ownershipTransfers) ? queue.ownershipTransfers : [];
  const allDisputes = [
    ...jurisdictionDisputes.map((item) => ({ kind: "jurisdiction", item })),
    ...ownershipTransfers.map((item) => ({ kind: "ownership", item }))
  ];
  if (!allDisputes.length) {
    disputes.append(emptyState(document, "No recent jurisdiction or ownership disputes."));
  } else {
    for (const { kind, item } of allDisputes) {
      if (kind === "jurisdiction") {
        disputes.append(alertCard(document, "dispute",
          `Jurisdiction change: ${display(item.erssEventId, "Emergency event")}`,
          [`From: ${display(item.oldJurisdictionId)} | To: ${display(item.newJurisdictionId)}`,
            `Reason: ${display(item.reason)} | Since: ${display(item.changedAt)}`]
        ));
      } else {
        disputes.append(alertCard(document, "dispute",
          `Ownership transfer: ${display(item.erssEventId, "Emergency event")}`,
          [`From: ${display(item.fromStationId)} | To: ${display(item.toStationId)}`,
            `Status: ${display(item.status)} | Reason: ${display(item.reason)} | Since: ${display(item.requestedAt)}`]
        ));
      }
    }
  }
}
