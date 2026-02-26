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
export const POST_EVENT_DO_AGAIN_DECISIONS = [
  "yes",
  "no",
  "unsure",
] as const;
export type PostEventDoAgainDecision = (typeof POST_EVENT_DO_AGAIN_DECISIONS)[number];
export const POST_EVENT_EXCHANGE_CHOICES = [
  "yes",
  "no",
  "later",
] as const;
export type PostEventExchangeChoice = (typeof POST_EVENT_EXCHANGE_CHOICES)[number];

export type PostEventConversationResult = {
  session_state_token: PostEventStateToken;
  attendance_result: PostEventAttendanceResult | null;
  do_again_decision: PostEventDoAgainDecision | null;
  exchange_choice: PostEventExchangeChoice | null;
  reply_message: string | null;
};

export const POST_EVENT_REFLECTION_PROMPT =
  "Thanks for confirming. Quick reflection: what stood out most?";
export const POST_EVENT_REFLECTION_ACK =
  "Appreciate it. I’ve logged your reflection step for next time.";
export const POST_EVENT_DO_AGAIN_PROMPT =
  "Glad you made it. Would you want to hang out with this group again? Reply A) Yes, B) Maybe, C) Probably not.";
export const POST_EVENT_COMPLETE_ACK =
  "Thanks again. Post-event follow-up is complete.";
export const POST_EVENT_CONTACT_EXCHANGE_PROMPT =
  "Want to stay in touch with anyone from that LinkUp? You can share your number with anyone who shares theirs back. Reply YES, NO, or LATER.";
export const POST_EVENT_CONTACT_EXCHANGE_CAPTURE_ACK =
  "Thanks. I recorded your contact exchange choice.";

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
      do_again_decision: null,
      exchange_choice: null,
      reply_message: POST_EVENT_REFLECTION_PROMPT,
    };
  }

  if (stateToken === "post_event:reflection") {
    return {
      session_state_token: stateToken,
      attendance_result: null,
      do_again_decision: null,
      exchange_choice: null,
      reply_message: POST_EVENT_REFLECTION_ACK,
    };
  }

  if (stateToken === "post_event:complete") {
    const doAgainDecision = detectPostEventDoAgainDecision(input.body_raw);
    return {
      session_state_token: stateToken,
      attendance_result: null,
      do_again_decision: doAgainDecision,
      exchange_choice: null,
      reply_message: doAgainDecision ? POST_EVENT_CONTACT_EXCHANGE_PROMPT : POST_EVENT_DO_AGAIN_PROMPT,
    };
  }

  if (stateToken === "post_event:contact_exchange") {
    const exchangeChoice = detectPostEventExchangeChoice(input.body_raw);
    return {
      session_state_token: stateToken,
      attendance_result: null,
      do_again_decision: null,
      exchange_choice: exchangeChoice,
      reply_message: exchangeChoice
        ? POST_EVENT_CONTACT_EXCHANGE_CAPTURE_ACK
        : POST_EVENT_CONTACT_EXCHANGE_PROMPT,
    };
  }

  return {
    session_state_token: stateToken,
    attendance_result: null,
    do_again_decision: null,
    exchange_choice: null,
    reply_message: POST_EVENT_COMPLETE_ACK,
  };
}

const EXCHANGE_EXACT_MATCHES: Record<string, PostEventExchangeChoice> = {
  "yes": "yes",
  "y": "yes",
  "1": "yes",
  "a": "yes",
  "all": "yes",
  "no": "no",
  "n": "no",
  "2": "no",
  "b": "no",
  "none": "no",
  "later": "later",
  "l": "later",
  "3": "later",
  "c": "later",
  "maybe": "later",
  "not now": "later",
} as const;

const EXCHANGE_TOKEN_MATCHES: Record<string, PostEventExchangeChoice> = {
  ...EXCHANGE_EXACT_MATCHES,
  "optiona": "yes",
  "optionb": "no",
  "optionc": "later",
} as const;

const EXCHANGE_PHRASE_MATCHES: ReadonlyArray<{ phrase: string; value: PostEventExchangeChoice }> = [
  { phrase: "for now no", value: "no" },
  { phrase: "not now", value: "later" },
  { phrase: "maybe later", value: "later" },
] as const;

export function detectPostEventExchangeChoice(inputText: string): PostEventExchangeChoice | null {
  const normalized = normalizeIntentText(inputText);
  if (!normalized) {
    return null;
  }

  const exact = parseSingleExchangeChoice(normalized, EXCHANGE_EXACT_MATCHES);
  if (exact) {
    return exact;
  }

  const matches = new Set<PostEventExchangeChoice>();
  for (const token of normalized.split(" ").filter(Boolean)) {
    const tokenChoice = parseSingleExchangeChoice(token, EXCHANGE_TOKEN_MATCHES);
    if (tokenChoice) {
      matches.add(tokenChoice);
    }
  }

  for (const phraseMatch of EXCHANGE_PHRASE_MATCHES) {
    if (hasPhrase(normalized, phraseMatch.phrase)) {
      matches.add(phraseMatch.value);
    }
  }

  if (matches.size !== 1) {
    return null;
  }

  const [choice] = Array.from(matches);
  return choice ?? null;
}

function parseSingleExchangeChoice(
  raw: string,
  options: Record<string, PostEventExchangeChoice>,
): PostEventExchangeChoice | null {
  const normalized = normalizeIntentText(raw);
  if (!normalized) {
    return null;
  }

  if (options[normalized]) {
    return options[normalized];
  }

  const compact = normalized.replace(/[.\s]/g, "");
  if (options[compact]) {
    return options[compact];
  }

  return null;
}

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

export function detectPostEventDoAgainDecision(inputText: string): PostEventDoAgainDecision | null {
  const normalized = normalizeIntentText(inputText);
  if (!normalized) {
    return null;
  }

  const exactMatch = parseSingleChoice(normalized, DO_AGAIN_EXACT_MATCHES);
  if (exactMatch) {
    return exactMatch;
  }

  const matches = new Set<PostEventDoAgainDecision>();
  for (const token of normalized.split(" ").filter(Boolean)) {
    const choice = parseSingleChoice(token, DO_AGAIN_TOKEN_MATCHES);
    if (choice) {
      matches.add(choice);
    }
  }

  for (const phraseMatch of DO_AGAIN_PHRASE_MATCHES) {
    if (hasPhrase(normalized, phraseMatch.phrase)) {
      matches.add(phraseMatch.value);
    }
  }

  if (matches.size !== 1) {
    return null;
  }

  const [choice] = Array.from(matches);
  return choice ?? null;
}

function parseSingleChoice(
  raw: string,
  options: Record<string, PostEventDoAgainDecision>,
): PostEventDoAgainDecision | null {
  const normalized = normalizeIntentText(raw);
  if (!normalized) {
    return null;
  }

  if (options[normalized]) {
    return options[normalized];
  }

  const compact = normalized.replace(/[.\s]/g, "");
  if (options[compact]) {
    return options[compact];
  }

  return null;
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

const DO_AGAIN_PHRASE_MATCHES: ReadonlyArray<{ phrase: string; value: PostEventDoAgainDecision }> = [
  { phrase: "probably not", value: "no" },
  { phrase: "not sure", value: "unsure" },
  { phrase: "do not know", value: "unsure" },
  { phrase: "dont know", value: "unsure" },
] as const;

const DO_AGAIN_EXACT_MATCHES: Record<string, PostEventDoAgainDecision> = {
  "a": "yes",
  "1": "yes",
  "yes": "yes",
  "y": "yes",
  "yeah": "yes",
  "yep": "yes",
  "absolutely": "yes",
  "definitely": "yes",
  "b": "unsure",
  "2": "unsure",
  "maybe": "unsure",
  "unsure": "unsure",
  "idk": "unsure",
  "c": "no",
  "3": "no",
  "no": "no",
  "n": "no",
  "nope": "no",
  "nah": "no",
} as const;

const DO_AGAIN_TOKEN_MATCHES: Record<string, PostEventDoAgainDecision> = {
  ...DO_AGAIN_EXACT_MATCHES,
  "optiona": "yes",
  "optionb": "unsure",
  "optionc": "no",
} as const;
