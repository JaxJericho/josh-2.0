import { ONBOARDING_STATE_TOKENS } from "../interview/state.ts";
import {
  ONBOARDING_EXPLANATION,
  ONBOARDING_LATER,
  renderOnboardingOpening,
} from "./messages.ts";

/**
 * Canonical onboarding state machine for reply-gated transitions.
 *
 * The timed onboarding burst is delivered via QStash sequential scheduling:
 * an affirmative explanation reply moves state to `onboarding:awaiting_burst`,
 * and runtime scheduling code publishes exactly one follow-up step execution.
 * This module does not perform in-process timing or burst enqueues.
 */
export const ONBOARDING_AWAITING_OPENING_RESPONSE =
  "onboarding:awaiting_opening_response" as const;
export const ONBOARDING_AWAITING_EXPLANATION_RESPONSE =
  "onboarding:awaiting_explanation_response" as const;
export const ONBOARDING_AWAITING_BURST = "onboarding:awaiting_burst" as const;
export const ONBOARDING_AWAITING_INTERVIEW_START =
  "onboarding:awaiting_interview_start" as const;
export const INTERVIEW_ACTIVITY_01_STATE_TOKEN = "interview:activity_01" as const;

export type OnboardingStateToken = (typeof ONBOARDING_STATE_TOKENS)[number];
export type OnboardingIntentDecision = {
  advance: boolean;
  pause: boolean;
};

export type OnboardingOutboundMessageKey =
  | "onboarding_opening"
  | "onboarding_explanation"
  | "onboarding_message_1"
  | "onboarding_message_2"
  | "onboarding_message_3"
  | "onboarding_message_4"
  | "onboarding_later";

export type OnboardingOutboundPlanStep =
  | {
      kind: "send";
      message_key: OnboardingOutboundMessageKey;
      body: string;
    };

export type OnboardingInboundResult = {
  nextStateToken: OnboardingStateToken | typeof INTERVIEW_ACTIVITY_01_STATE_TOKEN;
  outboundPlan: OnboardingOutboundPlanStep[];
  handoffToInterview?: boolean;
};

export type SendOnboardingMessageInput = {
  messageKey: OnboardingOutboundMessageKey;
  body: string;
  idempotencyKey: string;
};

type PersistOnboardingStateInput = {
  nextStateToken: OnboardingStateToken | typeof INTERVIEW_ACTIVITY_01_STATE_TOKEN;
};

export function detectOnboardingIntent(inputText: string): OnboardingIntentDecision {
  const normalized = normalizeIntentText(inputText);

  if (
    normalized === "later" ||
    normalized === "no" ||
    normalized === "not now" ||
    normalized === "nope" ||
    normalized === "nah" ||
    normalized === "not yet"
  ) {
    return {
      advance: false,
      pause: true,
    };
  }

  if (
    normalized === "yes" ||
    normalized === "y" ||
    normalized === "start" ||
    normalized === "unstop" ||
    normalized === "ok" ||
    normalized === "okay" ||
    normalized === "sure" ||
    normalized === "yep" ||
    normalized === "yeah" ||
    normalized === "affirmative" ||
    normalized === "ready" ||
    normalized === "lets go"
  ) {
    return {
      advance: true,
      pause: false,
    };
  }

  // Spec: "Any positive, affirmative, neutral, or ambiguous reply advances
  // the flow. Only an explicit negative pauses it."
  return {
    advance: true,
    pause: false,
  };
}

export function handleOnboardingInbound(params: {
  stateToken: OnboardingStateToken;
  inputText: string;
}): OnboardingInboundResult {
  const intent = detectOnboardingIntent(params.inputText);

  if (params.stateToken === ONBOARDING_AWAITING_OPENING_RESPONSE) {
    if (intent.pause) {
      return {
        nextStateToken: ONBOARDING_AWAITING_OPENING_RESPONSE,
        outboundPlan: [buildSendStep("onboarding_later", ONBOARDING_LATER)],
      };
    }

    if (!intent.advance) {
      return {
        nextStateToken: ONBOARDING_AWAITING_OPENING_RESPONSE,
        outboundPlan: [buildSendStep("onboarding_later", ONBOARDING_LATER)],
      };
    }

    return {
      nextStateToken: ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
      outboundPlan: [buildSendStep("onboarding_explanation", ONBOARDING_EXPLANATION)],
    };
  }

  if (params.stateToken === ONBOARDING_AWAITING_EXPLANATION_RESPONSE) {
    if (intent.pause) {
      return {
        nextStateToken: ONBOARDING_AWAITING_OPENING_RESPONSE,
        outboundPlan: [buildSendStep("onboarding_later", ONBOARDING_LATER)],
      };
    }

    return {
      nextStateToken: ONBOARDING_AWAITING_BURST,
      outboundPlan: [],
    };
  }

  if (params.stateToken === ONBOARDING_AWAITING_BURST) {
    return {
      nextStateToken: ONBOARDING_AWAITING_BURST,
      outboundPlan: [],
    };
  }

  if (params.stateToken === ONBOARDING_AWAITING_INTERVIEW_START) {
    if (intent.pause) {
      return {
        nextStateToken: ONBOARDING_AWAITING_OPENING_RESPONSE,
        outboundPlan: [buildSendStep("onboarding_later", ONBOARDING_LATER)],
      };
    }

    return {
      nextStateToken: INTERVIEW_ACTIVITY_01_STATE_TOKEN,
      outboundPlan: [],
      handoffToInterview: true,
    };
  }

  throw new Error(`Unsupported onboarding state token '${params.stateToken}'.`);
}

export async function startOnboardingForUser(params: {
  firstName: string;
  currentStateToken: string | null;
  hasOpeningBeenSent: boolean;
  openingIdempotencyKey: string;
  sendMessage: (input: SendOnboardingMessageInput) => Promise<void>;
  persistState: (input: PersistOnboardingStateInput) => Promise<void>;
}): Promise<{ didSendOpening: boolean; nextStateToken: OnboardingStateToken }> {
  if (isTokenAtOrBeyond(params.currentStateToken, ONBOARDING_AWAITING_EXPLANATION_RESPONSE)) {
    return {
      didSendOpening: false,
      nextStateToken: ONBOARDING_AWAITING_OPENING_RESPONSE,
    };
  }

  if (!params.hasOpeningBeenSent) {
    await params.sendMessage({
      messageKey: "onboarding_opening",
      body: renderOnboardingOpening(params.firstName),
      idempotencyKey: params.openingIdempotencyKey,
    });
  }

  await params.persistState({
    nextStateToken: ONBOARDING_AWAITING_OPENING_RESPONSE,
  });

  return {
    didSendOpening: !params.hasOpeningBeenSent,
    nextStateToken: ONBOARDING_AWAITING_OPENING_RESPONSE,
  };
}

function buildSendStep(
  messageKey: OnboardingOutboundMessageKey,
  body: string,
): OnboardingOutboundPlanStep {
  return {
    kind: "send",
    message_key: messageKey,
    body,
  };
}

function normalizeIntentText(inputText: string): string {
  return inputText
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
}

function tokenOrder(token: string | null): number {
  if (!token) {
    return 0;
  }
  if (token === ONBOARDING_AWAITING_OPENING_RESPONSE) {
    return 1;
  }
  if (token === ONBOARDING_AWAITING_EXPLANATION_RESPONSE) {
    return 2;
  }
  if (token === ONBOARDING_AWAITING_BURST) {
    return 3;
  }
  if (token === ONBOARDING_AWAITING_INTERVIEW_START) {
    return 4;
  }
  if (token === INTERVIEW_ACTIVITY_01_STATE_TOKEN) {
    return 5;
  }
  if (token.startsWith("interview:")) {
    return 6;
  }
  return 0;
}

function isTokenAtOrBeyond(token: string | null, targetToken: string): boolean {
  return tokenOrder(token) >= tokenOrder(targetToken);
}
