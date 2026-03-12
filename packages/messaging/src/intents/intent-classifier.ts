import type {
  ConversationSession,
  IntentClassification,
} from "./intent-types";

const STOP_KEYWORDS = new Set(["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const HELP_KEYWORDS = new Set(["HELP", "INFO"]);

export function classifyIntent(
  message: string,
  session: ConversationSession,
): IntentClassification {
  if (hasPendingInvitationForUnknownSender(session)) {
    return buildClassification("CONTACT_INVITE_RESPONSE", 1);
  }

  const normalizedForKeywordMatch = normalizeForKeywordMatch(message);
  if (isSystemKeyword(normalizedForKeywordMatch)) {
    return buildClassification("SYSTEM_COMMAND", 1);
  }

  if (session.mode === "awaiting_invitation_response") {
    return buildClassification("INVITATION_RESPONSE", 1);
  }

  if (session.mode === "awaiting_invite_reply") {
    return buildClassification("INVITE_RESPONSE", 1);
  }

  if (session.mode === "interviewing") {
    return buildClassification("INTERVIEW_ANSWER", 1);
  }

  if (session.mode === "interviewing_abbreviated") {
    return buildClassification("INTERVIEW_ANSWER_ABBREVIATED", 1);
  }

  if (session.mode === "post_activity_checkin") {
    return buildClassification("POST_ACTIVITY_CHECKIN", 1);
  }

  return buildClassification("UNKNOWN", 0.35);
}

function normalizeForKeywordMatch(message: string): string {
  return message.trim().replace(/\s+/g, " ").toUpperCase();
}

function isSystemKeyword(normalizedMessage: string): boolean {
  return STOP_KEYWORDS.has(normalizedMessage) || HELP_KEYWORDS.has(normalizedMessage);
}

function hasPendingInvitationForUnknownSender(session: ConversationSession): boolean {
  if (session.is_unknown_number_with_pending_invitation === true) {
    return true;
  }
  return session.has_user_record === false &&
    session.has_pending_contact_invitation === true;
}

function buildClassification(
  intent: IntentClassification["intent"],
  confidence: number,
): IntentClassification {
  return {
    intent,
    confidence: clampConfidence(confidence),
  };
}

function clampConfidence(confidence: number): number {
  if (confidence <= 0) {
    return 0;
  }
  if (confidence >= 1) {
    return 1;
  }
  return confidence;
}
