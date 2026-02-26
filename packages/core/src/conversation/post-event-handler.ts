import {
  isPostEventStateToken,
  type PostEventStateToken,
} from "../interview/state.ts";

export type PostEventConversationInput = {
  user_id: string;
  session_mode: "post_event";
  session_state_token: PostEventStateToken | string;
  inbound_message_id: string;
  inbound_message_sid: string;
  body_raw: string;
  body_normalized: string;
  correlation_id: string;
};

export const POST_EVENT_ATTENDANCE_RESULTS = [
  "attended",
  "no_show",
  "cancelled",
  "unclear",
] as const;

export type PostEventAttendanceResult = (typeof POST_EVENT_ATTENDANCE_RESULTS)[number];

export type PostEventConversationResult = {
  session_state_token: PostEventStateToken;
  attendance_result: PostEventAttendanceResult | null;
  reply_message: string | null;
};

export const POST_EVENT_REFLECTION_PROMPT =
  "Thanks for confirming. Quick reflection: what stood out most?";
export const POST_EVENT_REFLECTION_ACK =
  "Appreciate it. I’ve logged your reflection step for next time.";
export const POST_EVENT_COMPLETE_ACK =
  "Thanks again. Post-event follow-up is complete.";

export function handlePostEventConversation(
  input: PostEventConversationInput,
): PostEventConversationResult {
  const stateToken = assertPostEventStateToken(input.session_state_token);

  console.info("conversation.post_event_handler_entered", {
    user_id: input.user_id,
    session_mode: input.session_mode,
    session_state_token: stateToken,
    inbound_message_id: input.inbound_message_id,
    inbound_message_sid: input.inbound_message_sid,
    correlation_id: input.correlation_id,
  });

  if (stateToken === "post_event:attendance") {
    return {
      session_state_token: stateToken,
      attendance_result: detectPostEventAttendanceResult(input.body_raw),
      reply_message: POST_EVENT_REFLECTION_PROMPT,
    };
  }

  if (stateToken === "post_event:reflection") {
    return {
      session_state_token: stateToken,
      attendance_result: null,
      reply_message: POST_EVENT_REFLECTION_ACK,
    };
  }

  return {
    session_state_token: stateToken,
    attendance_result: null,
    reply_message: POST_EVENT_COMPLETE_ACK,
  };
}

export function detectPostEventAttendanceResult(inputText: string): PostEventAttendanceResult {
  const normalized = normalizeIntentText(inputText);
  if (!normalized) {
    return "unclear";
  }

  if (normalized === "1") {
    return "attended";
  }
  if (normalized === "2") {
    return "no_show";
  }
  if (normalized === "3") {
    return "cancelled";
  }

  const score = {
    attended: scoreMatches(normalized, ATTENDED_MATCHES),
    no_show: scoreMatches(normalized, NO_SHOW_MATCHES),
    cancelled: scoreMatches(normalized, CANCELLED_MATCHES),
    unclear: scoreMatches(normalized, UNCLEAR_MATCHES),
  };

  const resolved = resolveScore(score);
  if (resolved === "unclear") {
    return "unclear";
  }

  if (resolved === "cancelled" && score.attended > 0) {
    return "unclear";
  }

  return resolved;
}

const ATTENDED_MATCHES = [
  "yes",
  "y",
  "attended",
  "made it",
  "i made it",
  "was there",
  "i was there",
  "went",
  "showed up",
] as const;

const NO_SHOW_MATCHES = [
  "no",
  "n",
  "nope",
  "didnt make it",
  "did not make it",
  "couldnt make it",
  "could not make it",
  "missed it",
  "wasnt there",
  "was not there",
] as const;

const CANCELLED_MATCHES = [
  "cancelled",
  "canceled",
  "got cancelled",
  "got canceled",
  "was cancelled",
  "was canceled",
  "event cancelled",
  "event canceled",
  "called off",
  "rescheduled",
] as const;

const UNCLEAR_MATCHES = [
  "unsure",
  "not sure",
  "maybe",
  "idk",
  "i dont know",
  "i do not know",
] as const;

function scoreMatches(text: string, phrases: readonly string[]): number {
  return phrases.reduce((count, phrase) => {
    return count + (hasPhrase(text, phrase) ? 1 : 0);
  }, 0);
}

function hasPhrase(text: string, phrase: string): boolean {
  const paddedText = ` ${text} `;
  const paddedPhrase = ` ${phrase} `;
  return paddedText.includes(paddedPhrase);
}

function resolveScore(score: {
  attended: number;
  no_show: number;
  cancelled: number;
  unclear: number;
}): PostEventAttendanceResult {
  const ranked = Object.entries(score)
    .sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const next = ranked[1];
  if (!top || top[1] === 0) {
    return "unclear";
  }
  if (next && next[1] === top[1]) {
    return "unclear";
  }
  return top[0] as PostEventAttendanceResult;
}

function normalizeIntentText(inputText: string): string {
  return inputText
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
}

function assertPostEventStateToken(token: string): PostEventStateToken {
  if (!isPostEventStateToken(token)) {
    throw new Error(`Unsupported post-event state token '${token}'.`);
  }
  return token;
}
