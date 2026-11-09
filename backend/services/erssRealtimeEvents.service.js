// The ERSS wire contract is intentionally centralized.  Browser clients and
// Socket.IO broadcasters subscribe only to values in this list.
const ERSS_REALTIME_EVENTS = Object.freeze({
  EVENT_RECEIVED: "erss_event_received",
  EVENT_UPDATED: "erss_event_updated",
  ACTIONABLE: "erss_actionable",
  DISPATCH_REQUIRED: "erss_dispatch_required",
  DISPATCH_APPROVED: "erss_dispatch_approved",
  RECOMMENDATION_UPDATED: "erss_recommendation_updated",
  UNIT_REQUESTED: "erss_unit_requested",
  UNIT_ACKNOWLEDGED: "erss_unit_acknowledged",
  UNIT_ACCEPTED: "erss_unit_accepted",
  UNIT_TIMEOUT: "erss_unit_timeout",
  FALLBACK_RECOMMENDED: "erss_fallback_recommended",
  ASSISTANCE_REQUESTED: "erss_assistance_requested",
  ASSISTANCE_ACKNOWLEDGED: "erss_assistance_acknowledged",
  ASSISTANCE_ACCEPTED: "erss_assistance_accepted",
  ASSISTANCE_DECLINED: "erss_assistance_declined",
  ASSISTANCE_TIMEOUT: "erss_assistance_timeout",
  JURISDICTION_CHANGED: "erss_jurisdiction_changed",
  OWNERSHIP_TRANSFER_REQUESTED: "erss_ownership_transfer_requested",
  OWNERSHIP_TRANSFER_ACKNOWLEDGED: "erss_ownership_transfer_acknowledged",
  OWNERSHIP_TRANSFERRED: "erss_ownership_transferred",
  SUPERVISOR_ESCALATED: "erss_supervisor_escalated",
  CALL_STARTED: "erss_call_started",
  CALL_ENDED: "erss_call_ended",
  TRIAGE_COMPLETED: "erss_triage_completed"
});

module.exports = { ERSS_REALTIME_EVENTS, ERSS_REALTIME_EVENT_NAMES: Object.freeze(Object.values(ERSS_REALTIME_EVENTS)) };
