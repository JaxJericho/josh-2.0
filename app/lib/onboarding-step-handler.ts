import crypto from "crypto";
import {
  createSupabaseEntitlementsRepository,
  evaluateEntitlements,
} from "../../packages/core/src/entitlements/evaluate-entitlements";
import { encryptSmsBody } from "../../packages/db/src/queries/crypto";
import {
  loadConversationSessionSummary,
  updateConversationSessionState,
} from "../../packages/db/src/queries/conversation-sessions";
import {
  hasDeliveredSmsMessage,
} from "../../packages/db/src/queries/sms-messages";
import { loadUserPhoneE164ById } from "../../packages/db/src/queries/users";
import type { DbClient } from "../../packages/db/src/types";
import { createServiceRoleDbClient } from "../../packages/db/src/client-node.mjs";
import {
  ONBOARDING_AWAITING_BURST,
  ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
  ONBOARDING_AWAITING_INTERVIEW_START,
  ONBOARDING_AWAITING_OPENING_RESPONSE,
} from "../../packages/core/src/onboarding/onboarding-engine";
import {
  getNextOnboardingStepId,
  isOnboardingStepId,
  ONBOARDING_STEP_DELAY_MS,
  type OnboardingStepId,
} from "../../packages/core/src/onboarding/step-ids";
import { createNodeEnvReader, resolveTwilioRuntimeFromEnv } from "../../packages/messaging/src/client";
import { sendSms } from "../../packages/messaging/src/sender";
import {
  onboardingBurstMessage1,
  onboardingBurstMessage2,
  onboardingBurstMessage3,
  onboardingBurstMessage4,
} from "../../packages/messaging/src/templates/onboarding";
import { logEvent } from "./observability";
import { scheduleOnboardingStep, verifyQStashSignature } from "./qstash";

const HARNESS_QSTASH_STUB_HEADER = "x-harness-qstash-stub";
const HARNESS_ADMIN_SECRET_HEADER = "x-admin-secret";

const ONBOARDING_STEP_BODIES: Record<OnboardingStepId, string> = {
  onboarding_message_1: onboardingBurstMessage1(),
  onboarding_message_2: onboardingBurstMessage2(),
  onboarding_message_3: onboardingBurstMessage3(),
  onboarding_message_4: onboardingBurstMessage4(),
};

export type OnboardingStepPayload = {
  profile_id: string;
  session_id: string;
  step_id: OnboardingStepId;
  expected_state_token: string;
  idempotency_key: string;
};

type ConversationSessionRow = {
  id: string;
  user_id: string;
  mode: string;
  state_token: string;
};

export type OnboardingStepHandlerDependencies = {
  verifyQStashSignature: (request: Request) => Promise<boolean>;
  loadSession: (sessionId: string) => Promise<ConversationSessionRow | null>;
  isSafetyHold: (profileId: string) => Promise<boolean>;
  isSessionPaused: (session: ConversationSessionRow) => Promise<boolean>;
  hasDeliveredMessage: (idempotencyKey: string) => Promise<boolean>;
  sendStepMessage: (input: {
    session: ConversationSessionRow;
    payload: OnboardingStepPayload;
  }) => Promise<void>;
  updateSessionState: (sessionId: string, stateToken: string) => Promise<void>;
  scheduleOnboardingStep: (
    payload: OnboardingStepPayload,
    delayMs: number,
  ) => Promise<unknown>;
  log: (event: string, payload: Record<string, unknown>) => void;
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveNextExpectedStateToken(stepId: OnboardingStepId): string {
  const nextStepId = getNextOnboardingStepId(stepId);
  if (!nextStepId) {
    return ONBOARDING_AWAITING_INTERVIEW_START;
  }
  return ONBOARDING_AWAITING_BURST;
}

function buildExpectedIdempotencyKey(payload: {
  profile_id: string;
  session_id: string;
  step_id: OnboardingStepId;
}): string {
  return `onboarding:${payload.profile_id}:${payload.session_id}:${payload.step_id}`;
}

async function parseOnboardingStepPayload(request: Request): Promise<OnboardingStepPayload> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new Error("Invalid JSON body.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Body must be a JSON object.");
  }

  const candidate = parsed as Record<string, unknown>;

  if (!isNonEmptyString(candidate.profile_id)) {
    throw new Error("profile_id is required.");
  }
  if (!isNonEmptyString(candidate.session_id)) {
    throw new Error("session_id is required.");
  }
  if (!isNonEmptyString(candidate.step_id) || !isOnboardingStepId(candidate.step_id)) {
    throw new Error("step_id must be a valid onboarding step id.");
  }
  if (!isNonEmptyString(candidate.expected_state_token)) {
    throw new Error("expected_state_token is required.");
  }
  if (!isNonEmptyString(candidate.idempotency_key)) {
    throw new Error("idempotency_key is required.");
  }

  const payload: OnboardingStepPayload = {
    profile_id: candidate.profile_id,
    session_id: candidate.session_id,
    step_id: candidate.step_id,
    expected_state_token: candidate.expected_state_token,
    idempotency_key: candidate.idempotency_key,
  };

  const expectedIdempotency = buildExpectedIdempotencyKey(payload);
  if (payload.idempotency_key !== expectedIdempotency) {
    throw new Error(`idempotency_key must match '${expectedIdempotency}'.`);
  }

  return payload;
}

function createStepSkippedResponse(
  deps: OnboardingStepHandlerDependencies,
  payload: OnboardingStepPayload,
  correlationId: string,
  reason: string,
): Response {
  deps.log("onboarding.step_skipped", {
    step_id: payload.step_id,
    session_id: payload.session_id,
    correlation_id: correlationId,
    reason,
  });

  return jsonResponse({ ok: true, skipped: true, reason }, 200);
}

export async function handleOnboardingStepRequest(
  request: Request,
  dependencies?: OnboardingStepHandlerDependencies,
): Promise<Response> {
  const deps = dependencies ?? createDefaultOnboardingStepHandlerDependencies();
  const correlationId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  // a) Validate QStash signature first.
  const signatureValid = isStubHarnessStepRequest(request)
    ? true
    : await deps.verifyQStashSignature(request);
  if (!signatureValid) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let payload: OnboardingStepPayload;
  try {
    payload = await parseOnboardingStepPayload(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid payload.";
    return jsonResponse({ error: message }, 400);
  }

  deps.log("onboarding.step_handler_invoked", {
    step_id: payload.step_id,
    session_id: payload.session_id,
    correlation_id: correlationId,
  });

  try {
    // b) Source-of-truth conversation session load.
    const session = await deps.loadSession(payload.session_id);

    // c) Eligibility checks.
    if (!session) {
      return createStepSkippedResponse(deps, payload, correlationId, "session_not_found");
    }

    if (session.mode !== "interviewing") {
      return createStepSkippedResponse(deps, payload, correlationId, "session_inactive");
    }

    if (session.state_token !== payload.expected_state_token) {
      return createStepSkippedResponse(deps, payload, correlationId, "stale");
    }

    if (await deps.isSafetyHold(payload.profile_id)) {
      return createStepSkippedResponse(deps, payload, correlationId, "safety_hold");
    }

    if (await deps.isSessionPaused(session)) {
      return createStepSkippedResponse(deps, payload, correlationId, "paused");
    }

    // d) Idempotency check.
    if (await deps.hasDeliveredMessage(payload.idempotency_key)) {
      return createStepSkippedResponse(deps, payload, correlationId, "already_sent");
    }

    // e) Send exactly one message.
    await deps.sendStepMessage({ session, payload });

    deps.log("onboarding.step_sent", {
      step_id: payload.step_id,
      idempotency_key: payload.idempotency_key,
      correlation_id: correlationId,
    });

    // f) Advance state then confirm delivery record; roll back if confirmation fails.
    const previousStateToken = session.state_token;
    const nextExpectedStateToken = resolveNextExpectedStateToken(payload.step_id);
    await deps.updateSessionState(session.id, nextExpectedStateToken);

    const deliveredAfterStateAdvance = await deps.hasDeliveredMessage(payload.idempotency_key);
    if (!deliveredAfterStateAdvance) {
      await deps.updateSessionState(session.id, previousStateToken);
      return jsonResponse(
        {
          error: "Delivery record missing after state advance.",
          retryable: true,
        },
        500,
      );
    }

    // g) Schedule next step when present.
    const nextStepId = getNextOnboardingStepId(payload.step_id);
    if (nextStepId) {
      const nextPayload: OnboardingStepPayload = {
        profile_id: payload.profile_id,
        session_id: payload.session_id,
        step_id: nextStepId,
        expected_state_token: nextExpectedStateToken,
        idempotency_key: buildExpectedIdempotencyKey({
          profile_id: payload.profile_id,
          session_id: payload.session_id,
          step_id: nextStepId,
        }),
      };

      await deps.scheduleOnboardingStep(nextPayload, ONBOARDING_STEP_DELAY_MS[nextStepId]);

      deps.log("onboarding.step_next_scheduled", {
        step_id: payload.step_id,
        next_step_id: nextStepId,
        delay_ms: ONBOARDING_STEP_DELAY_MS[nextStepId],
        correlation_id: correlationId,
      });
    }

    // h) Success.
    return jsonResponse({ ok: true }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error.";
    return jsonResponse({ error: message }, 500);
  }
}

let serviceRoleClient: DbClient | null = null;

function getServiceRoleClient(): DbClient {
  if (!serviceRoleClient) {
    serviceRoleClient = createServiceRoleDbClient();
  }

  if (!serviceRoleClient) {
    throw new Error("Failed to initialize Supabase service role client.");
  }

  return serviceRoleClient;
}

export function createDefaultOnboardingStepHandlerDependencies(): OnboardingStepHandlerDependencies {
  const supabase = getServiceRoleClient();
  const twilio = resolveTwilioRuntimeFromEnv({
    getEnv: createNodeEnvReader(),
  });

  return {
    verifyQStashSignature,

    async loadSession(sessionId: string): Promise<ConversationSessionRow | null> {
      return loadConversationSessionSummary(supabase, sessionId);
    },

    async isSafetyHold(profileId: string): Promise<boolean> {
      const evaluation = await evaluateEntitlements({
        profile_id: profileId,
        repository: createSupabaseEntitlementsRepository(supabase),
      });
      return evaluation.blocked_by_safety_hold;
    },

    async isSessionPaused(session: ConversationSessionRow): Promise<boolean> {
      return (
        session.state_token === ONBOARDING_AWAITING_OPENING_RESPONSE ||
        session.state_token === ONBOARDING_AWAITING_EXPLANATION_RESPONSE ||
        session.state_token.includes(":paused")
      );
    },

    async hasDeliveredMessage(idempotencyKey: string): Promise<boolean> {
      return hasDeliveredSmsMessage(supabase, idempotencyKey);
    },

    async sendStepMessage(input: {
      session: ConversationSessionRow;
      payload: OnboardingStepPayload;
    }): Promise<void> {
      const body = ONBOARDING_STEP_BODIES[input.payload.step_id];
      const encryptionKey = requireEnv("SMS_BODY_ENCRYPTION_KEY");
      const fromE164 = requireEnv("TWILIO_FROM_NUMBER");

      const userPhoneE164 = await loadUserPhoneE164ById(supabase, input.session.user_id);
      if (!userPhoneE164) {
        throw new Error("Unable to resolve destination phone number for onboarding step.");
      }

      const encryptedBody = await encryptSmsBody(supabase, {
        plaintext: body,
        key: encryptionKey,
      });

      await sendSms({
        client: twilio.client,
        db: supabase,
        to: userPhoneE164,
        from: fromE164,
        body,
        correlationId: input.payload.idempotency_key,
        purpose: `onboarding_${input.payload.step_id}`,
        idempotencyKey: input.payload.idempotency_key,
        userId: input.session.user_id,
        profileId: input.payload.profile_id,
        messagingServiceSid: twilio.senderIdentity.messagingServiceSid,
        statusCallbackUrl: twilio.statusCallbackUrl,
        bodyCiphertext: encryptedBody,
        keyVersion: 1,
        mediaCount: 0,
        logger: (level, event, metadata) => {
          logEvent({
            level,
            event,
            ...metadata,
          });
        },
      });
    },

    async updateSessionState(sessionId: string, stateToken: string): Promise<void> {
      await updateConversationSessionState(supabase, sessionId, stateToken);
    },

    scheduleOnboardingStep,

    log(event: string, payload: Record<string, unknown>): void {
      logEvent({
        level: "info",
        event,
        ...payload,
      });
    },
  };
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function isStubHarnessStepRequest(request: Request): boolean {
  if (request.headers.get(HARNESS_QSTASH_STUB_HEADER) !== "1") {
    return false;
  }

  const appEnv = readEnv("APP_ENV");
  if (appEnv === "production") {
    return false;
  }

  const mode = readEnv("HARNESS_QSTASH_MODE");
  if (mode === "stub") {
    return true;
  }

  const configuredSecret = readEnv("STAGING_RUNNER_SECRET") ?? readEnv("QSTASH_RUNNER_SECRET");
  const providedSecret = request.headers.get(HARNESS_ADMIN_SECRET_HEADER)?.trim();
  if (!configuredSecret || !providedSecret) {
    return false;
  }

  return timingSafeEqual(configuredSecret, providedSecret);
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
