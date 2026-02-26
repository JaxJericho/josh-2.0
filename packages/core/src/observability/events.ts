import { EVENT_CATALOG } from "./event-catalog.ts";

export const EVENTS = {
  conversation: {
    routerDecision: "conversation.router_decision",
    modeTransition: "conversation.mode_transition",
    stateTransition: "conversation.state_transition",
  },
  safety: {
    keywordDetected: "safety.keyword_detected",
    rateLimitExceeded: "safety.rate_limit_exceeded",
    strikeApplied: "safety.strike_applied",
    crisisIntercepted: "safety.crisis_intercepted",
    blockCreated: "safety.block_created",
    blockedMessageAttempt: "safety.blocked_message_attempt",
    reportCreated: "safety.report_created",
  },
  postEvent: {
    attendanceRecorded: "post_event.attendance_recorded",
    learningSignalWritten: "post_event.learning_signal_written",
    contactExchangeOptIn: "post_event.contact_exchange_opt_in",
    contactExchangeRevealed: "post_event.contact_exchange_revealed",
  },
  admin: {
    actionPerformed: "admin.action_performed",
    roleUpdated: "admin.role_updated",
    safetyHoldToggled: "admin.safety_hold_toggled",
    incidentStatusUpdated: "admin.incident_status_updated",
  },
  system: {
    unhandledError: "system.unhandled_error",
    rpcFailure: "system.rpc_failure",
    migrationMismatchWarning: "system.migration_mismatch_warning",
  },
} as const;

export const EVENT_NAMES = EVENT_CATALOG.map((entry) => entry.event_name);
