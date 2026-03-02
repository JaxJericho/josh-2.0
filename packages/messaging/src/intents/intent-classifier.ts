import type {
  ConversationSession,
  IntentClassification,
  OpenVsNamedIntent,
} from "./intent-types";

const STOP_KEYWORDS = new Set(["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const HELP_KEYWORDS = new Set(["HELP", "INFO"]);
const OPEN_INTENT_HINT_PATTERN =
  /\b(something|anything|idea|ideas|suggestion|suggestions|today|tomorrow|tonight)\b|\b(this|next)\s+weekend\b|\b(get\s+out|hang\s*out|go\s*out)\b/i;
const GROUP_REFERENCE_PATTERN =
  /\b(my|our)\s+(friend|friends|family|crew|group|coworker|coworkers|team|partner|roommate|siblings?|parents?|kids?|neighbors?)\b/i;
const ACTION_PHRASE_PATTERN =
  /\b(want|wanna|would\s+like|looking|feel\s+like|hoping)\b/i;
const GENERIC_WITH_TARGETS = new Set([
  "someone",
  "somebody",
  "anyone",
  "anybody",
  "person",
  "people",
  "everyone",
  "everybody",
  "nobody",
  "them",
  "him",
  "her",
  "you",
  "me",
  "us",
  "myself",
]);

export type IntentDisambiguationInput = {
  message: string;
  normalizedMessage: string;
  session: ConversationSession;
  candidates: readonly ["OPEN_INTENT", "NAMED_PLAN_REQUEST"];
};

export type IntentDisambiguator = (
  input: IntentDisambiguationInput,
) => OpenVsNamedIntent | null | undefined;

export type ClassifyIntentOptions = {
  resolveAmbiguousIntent?: IntentDisambiguator;
};

export function classifyIntent(
  message: string,
  session: ConversationSession,
  options: ClassifyIntentOptions = {},
): IntentClassification {
  if (hasPendingInvitationForUnknownSender(session)) {
    return buildClassification("CONTACT_INVITE_RESPONSE", 1);
  }

  const normalizedForKeywordMatch = normalizeForKeywordMatch(message);
  if (isSystemKeyword(normalizedForKeywordMatch)) {
    return buildClassification("SYSTEM_COMMAND", 1);
  }

  if (session.mode === "awaiting_social_choice") {
    return buildClassification("PLAN_SOCIAL_CHOICE", 1);
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

  const normalizedForIntent = normalizeForIntentParse(message);
  if (looksLikeNamedPlanRequest(normalizedForIntent)) {
    return buildClassification("NAMED_PLAN_REQUEST", 0.92);
  }

  if (looksLikeOpenIntent(normalizedForIntent)) {
    return buildClassification("OPEN_INTENT", 0.9);
  }

  const resolvedByDisambiguator = options.resolveAmbiguousIntent?.({
    message,
    normalizedMessage: normalizedForIntent,
    session,
    candidates: ["OPEN_INTENT", "NAMED_PLAN_REQUEST"] as const,
  });
  if (resolvedByDisambiguator) {
    return buildClassification(resolvedByDisambiguator, 0.7);
  }

  return buildClassification("OPEN_INTENT", 0.35);
}

function normalizeForKeywordMatch(message: string): string {
  return message.trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeForIntentParse(message: string): string {
  return message.trim().replace(/\s+/g, " ").toLowerCase();
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

function looksLikeNamedPlanRequest(normalizedMessage: string): boolean {
  if (GROUP_REFERENCE_PATTERN.test(normalizedMessage)) {
    return true;
  }

  const withMatch = /\bwith\s+([a-z][a-z'-]{1,})(?:\s+([a-z][a-z'-]{1,}))?/i.exec(
    normalizedMessage,
  );
  if (!withMatch) {
    return false;
  }

  const firstToken = withMatch[1]?.toLowerCase() ?? "";
  if (!firstToken || GENERIC_WITH_TARGETS.has(firstToken)) {
    return false;
  }

  return true;
}

function looksLikeOpenIntent(normalizedMessage: string): boolean {
  return OPEN_INTENT_HINT_PATTERN.test(normalizedMessage) ||
    (ACTION_PHRASE_PATTERN.test(normalizedMessage) &&
      /\b(do|plan|hang|go)\b/.test(normalizedMessage));
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
