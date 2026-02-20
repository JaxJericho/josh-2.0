import { ONBOARDING_STATE_TOKENS } from "../interview/state.ts";
import {
  ONBOARDING_EXPLANATION,
  ONBOARDING_LATER,
  ONBOARDING_MESSAGE_1,
  ONBOARDING_MESSAGE_2,
  ONBOARDING_MESSAGE_3,
  ONBOARDING_MESSAGE_4,
  renderOnboardingOpening,
} from "./messages.ts";

export const ONBOARDING_AWAITING_OPENING_RESPONSE =
  "onboarding:awaiting_opening_response" as const;
export const ONBOARDING_AWAITING_EXPLANATION_RESPONSE =
  "onboarding:awaiting_explanation_response" as const;
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
    }
  | {
      kind: "delay";
      ms: number;
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
        nextStateToken: ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
        outboundPlan: [buildSendStep("onboarding_later", ONBOARDING_LATER)],
      };
    }

    return {
      nextStateToken: ONBOARDING_AWAITING_INTERVIEW_START,
      outboundPlan: [
        buildSendStep("onboarding_message_1", ONBOARDING_MESSAGE_1),
        { kind: "delay", ms: 8000 },
        buildSendStep("onboarding_message_2", ONBOARDING_MESSAGE_2),
        { kind: "delay", ms: 8000 },
        buildSendStep("onboarding_message_3", ONBOARDING_MESSAGE_3),
        { kind: "delay", ms: 8000 },
        buildSendStep("onboarding_message_4", ONBOARDING_MESSAGE_4),
      ],
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

export async function sendOnboardingBurst(params: {
  currentStateToken: string | null;
  burstIdempotencyKeyPrefix: string;
  sendMessage: (input: SendOnboardingMessageInput) => Promise<void>;
  persistState: (input: PersistOnboardingStateInput) => Promise<void>;
  delay?: (ms: number) => Promise<void>;
}): Promise<{ didSendBurst: boolean; nextStateToken: OnboardingStateToken }> {
  if (isTokenAtOrBeyond(params.currentStateToken, ONBOARDING_AWAITING_INTERVIEW_START)) {
    return {
      didSendBurst: false,
      nextStateToken: ONBOARDING_AWAITING_INTERVIEW_START,
    };
  }

  const delay = params.delay ?? defaultBurstDelay;

  await params.sendMessage({
    messageKey: "onboarding_message_1",
    body: ONBOARDING_MESSAGE_1,
    idempotencyKey: `${params.burstIdempotencyKeyPrefix}:message_1`,
  });
  await delay(8000);

  await params.sendMessage({
    messageKey: "onboarding_message_2",
    body: ONBOARDING_MESSAGE_2,
    idempotencyKey: `${params.burstIdempotencyKeyPrefix}:message_2`,
  });
  await delay(8000);

  await params.sendMessage({
    messageKey: "onboarding_message_3",
    body: ONBOARDING_MESSAGE_3,
    idempotencyKey: `${params.burstIdempotencyKeyPrefix}:message_3`,
  });
  await delay(8000);

  await params.sendMessage({
    messageKey: "onboarding_message_4",
    body: ONBOARDING_MESSAGE_4,
    idempotencyKey: `${params.burstIdempotencyKeyPrefix}:message_4`,
  });

  await params.persistState({
    nextStateToken: ONBOARDING_AWAITING_INTERVIEW_START,
  });

  return {
    didSendBurst: true,
    nextStateToken: ONBOARDING_AWAITING_INTERVIEW_START,
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
  if (token === ONBOARDING_AWAITING_INTERVIEW_START) {
    return 3;
  }
  if (token === INTERVIEW_ACTIVITY_01_STATE_TOKEN) {
    return 4;
  }
  if (token.startsWith("interview:")) {
    return 5;
  }
  return 0;
}

function isTokenAtOrBeyond(token: string | null, targetToken: string): boolean {
  return tokenOrder(token) >= tokenOrder(targetToken);
}

async function defaultBurstDelay(ms: number): Promise<void> {
  if (ms !== 8000) {
    throw new Error(`Unsupported onboarding delay '${ms}'. Expected 8000.`);
  }
  await new Promise((r) => setTimeout(r, 8000));
}
