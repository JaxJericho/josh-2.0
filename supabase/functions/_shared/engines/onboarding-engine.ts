// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  INTERVIEW_ACTIVITY_01_STATE_TOKEN,
  ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
  ONBOARDING_AWAITING_INTERVIEW_START,
  ONBOARDING_AWAITING_OPENING_RESPONSE,
  handleOnboardingInbound,
  startOnboardingForUser,
  type OnboardingOutboundMessageKey,
  type OnboardingOutboundPlanStep,
  type OnboardingStateToken,
} from "../../../../packages/core/src/onboarding/onboarding-engine.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { createSupabaseEntitlementsRepository, evaluateEntitlements } from "../../../../packages/core/src/entitlements/evaluate-entitlements.ts";
import type {
  EngineDispatchInput,
  EngineDispatchResult,
} from "../router/conversation-router.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { SAFETY_HOLD_MESSAGE } from "../waitlist/waitlist-operations.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { runProfileInterviewEngine } from "./profile-interview-engine.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  resolveTwilioStatusCallbackUrl,
  sendTwilioRestMessage,
} from "../twilio/send-message.ts";

type ConversationSessionRow = {
  id: string;
  mode: string;
  state_token: string;
  current_step_id: string | null;
  last_inbound_message_sid: string | null;
};

type OutboundTwilioConfig = {
  accountSid: string;
  authToken: string;
  messagingServiceSid: string | null;
  fromE164: string | null;
  statusCallbackUrl: string | null;
  encryptionKey: string;
};

type ScheduledOnboardingJobInput = {
  messageKey: OnboardingOutboundMessageKey;
  body: string;
  idempotencyKey: string;
  runAtIso: string;
};

export async function runOnboardingEngine(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  const session = await fetchOrCreateConversationSession(
    input.supabase,
    input.decision.user_id,
    input.decision.state.mode,
    input.decision.state.state_token,
  );

  if (session.last_inbound_message_sid === input.payload.inbound_message_sid) {
    return {
      engine: "onboarding_engine",
      reply_message: null,
    };
  }

  const profileId = await fetchProfileId(input.supabase, input.decision.user_id);
  if (profileId) {
    const evaluation = await evaluateEntitlements({
      profile_id: profileId,
      repository: createSupabaseEntitlementsRepository(input.supabase),
    });

    if (evaluation.blocked_by_safety_hold) {
      return {
        engine: "onboarding_engine",
        reply_message: SAFETY_HOLD_MESSAGE,
      };
    }
  }

  const user = await fetchUserContact(input.supabase, input.decision.user_id);
  const twilio = readOutboundTwilioConfig();
  const onboardingStateToken = resolveOnboardingStateForInbound({
    routedStateToken: input.decision.state.state_token,
    persistedStateToken: session.state_token,
    userId: input.decision.user_id,
    inboundMessageSid: input.payload.inbound_message_sid,
  });

  if (onboardingStateToken === ONBOARDING_AWAITING_OPENING_RESPONSE) {
    const hasOpeningEvent = await hasConversationEventByIdempotencyKey(
      input.supabase,
      onboardingOpeningEventIdempotencyKey(input.decision.user_id),
    );

    if (!hasOpeningEvent) {
      await startOnboardingForUser({
        firstName: user.first_name,
        currentStateToken: onboardingStateToken,
        hasOpeningBeenSent: false,
        openingIdempotencyKey: onboardingOpeningSendIdempotencyKey(input.decision.user_id),
        sendMessage: async (sendInput) => {
          await sendAndRecordOutboundMessage({
            supabase: input.supabase,
            userId: input.decision.user_id,
            toE164: input.payload.from_e164,
            fallbackFromE164: input.payload.to_e164,
            correlationId: input.payload.inbound_message_id,
            idempotencyKey: sendInput.idempotencyKey,
            messageKey: sendInput.messageKey,
            body: sendInput.body,
            twilio,
          });
        },
        persistState: async (persistInput) => {
          await persistConversationSessionState({
            supabase: input.supabase,
            sessionId: session.id,
            mode: "interviewing",
            stateToken: persistInput.nextStateToken,
            currentStepId: null,
            lastInboundMessageSid: input.payload.inbound_message_sid,
          });
        },
      });

      await insertConversationEvent({
        supabase: input.supabase,
        conversationSessionId: session.id,
        userId: input.decision.user_id,
        eventType: "onboarding_opening_sent",
        stepToken: ONBOARDING_AWAITING_OPENING_RESPONSE,
        twilioMessageSid: input.payload.inbound_message_sid,
        idempotencyKey: onboardingOpeningEventIdempotencyKey(input.decision.user_id),
        payload: {
          source: "onboarding_engine",
        },
      });

      return {
        engine: "onboarding_engine",
        reply_message: null,
      };
    }
  }

  const inboundResult = handleOnboardingInbound({
    stateToken: onboardingStateToken,
    inputText: input.payload.body_raw,
  });

  if (onboardingStateToken === ONBOARDING_AWAITING_EXPLANATION_RESPONSE) {
    await enqueueOnboardingOutboundPlan({
      supabase: input.supabase,
      userId: input.decision.user_id,
      toE164: input.payload.from_e164,
      fallbackFromE164: input.payload.to_e164,
      correlationId: input.payload.inbound_message_id,
      inboundMessageSid: input.payload.inbound_message_sid,
      outboundPlan: inboundResult.outboundPlan,
      twilio,
    });
  } else {
    for (const step of inboundResult.outboundPlan) {
      if (step.kind === "delay") {
        await new Promise((r) => setTimeout(r, step.ms));
        continue;
      }

      await sendAndRecordOutboundMessage({
        supabase: input.supabase,
        userId: input.decision.user_id,
        toE164: input.payload.from_e164,
        fallbackFromE164: input.payload.to_e164,
        correlationId: input.payload.inbound_message_id,
        idempotencyKey: `onboarding:${step.message_key}:${input.decision.user_id}:${input.payload.inbound_message_sid}`,
        messageKey: step.message_key,
        body: step.body,
        twilio,
      });
    }
  }

  await persistConversationSessionState({
    supabase: input.supabase,
    sessionId: session.id,
    mode: "interviewing",
    stateToken: inboundResult.nextStateToken,
    currentStepId: inboundResult.nextStateToken === INTERVIEW_ACTIVITY_01_STATE_TOKEN
      ? "activity_01"
      : null,
    lastInboundMessageSid: input.payload.inbound_message_sid,
  });

  if (
    inboundResult.handoffToInterview &&
    onboardingStateToken !== ONBOARDING_AWAITING_INTERVIEW_START
  ) {
    throw new Error(
      `Onboarding handoff attempted from invalid state '${onboardingStateToken}'.`,
    );
  }

  await insertConversationEvent({
    supabase: input.supabase,
    conversationSessionId: session.id,
    userId: input.decision.user_id,
    eventType: inboundResult.handoffToInterview ? "onboarding_handoff" : "onboarding_step_transition",
    stepToken: inboundResult.nextStateToken,
    twilioMessageSid: input.payload.inbound_message_sid,
    idempotencyKey: `onboarding:transition:${input.decision.user_id}:${input.payload.inbound_message_sid}:${inboundResult.nextStateToken}`,
    payload: {
      source: "onboarding_engine",
      handoff_to_interview: Boolean(inboundResult.handoffToInterview),
      state_before: onboardingStateToken,
      state_after: inboundResult.nextStateToken,
    },
  });

  if (!inboundResult.handoffToInterview) {
    return {
      engine: "onboarding_engine",
      reply_message: null,
    };
  }

  const handoff = await runProfileInterviewEngine({
    ...input,
    decision: {
      ...input.decision,
      route: "profile_interview_engine",
      state: {
        mode: "interviewing",
        state_token: INTERVIEW_ACTIVITY_01_STATE_TOKEN,
      },
      next_transition: INTERVIEW_ACTIVITY_01_STATE_TOKEN,
    },
  });

  return {
    engine: "onboarding_engine",
    reply_message: handoff.reply_message,
  };
}

export async function startOnboardingForActivatedUser(params: {
  supabase: EngineDispatchInput["supabase"];
  userId: string;
  correlationId: string | null;
  activationIdempotencyKey: string;
}): Promise<"inserted" | "duplicate"> {
  const profileId = await fetchProfileId(params.supabase, params.userId);
  if (!profileId) {
    return "duplicate";
  }
  const evaluation = await evaluateEntitlements({
    profile_id: profileId,
    repository: createSupabaseEntitlementsRepository(params.supabase),
  });

  if (evaluation.blocked_by_safety_hold) {
    return "duplicate";
  }

  const session = await fetchOrCreateConversationSession(
    params.supabase,
    params.userId,
    "interviewing",
    ONBOARDING_AWAITING_OPENING_RESPONSE,
  );
  const user = await fetchUserContact(params.supabase, params.userId);
  const twilio = readOutboundTwilioConfig();

  const hasOpeningEvent = await hasConversationEventByIdempotencyKey(
    params.supabase,
    onboardingOpeningEventIdempotencyKey(params.userId),
  );
  if (
    hasOpeningEvent ||
    session.state_token.startsWith("interview:") ||
    session.state_token === ONBOARDING_AWAITING_EXPLANATION_RESPONSE ||
    session.state_token === ONBOARDING_AWAITING_INTERVIEW_START
  ) {
    return "duplicate";
  }

  await startOnboardingForUser({
    firstName: user.first_name,
    currentStateToken: session.state_token,
    hasOpeningBeenSent: false,
    openingIdempotencyKey: onboardingOpeningSendIdempotencyKey(params.userId),
    sendMessage: async (sendInput) => {
      await sendAndRecordOutboundMessage({
        supabase: params.supabase,
        userId: params.userId,
        toE164: user.phone_e164,
        fallbackFromE164: twilio.fromE164,
        correlationId: params.correlationId,
        idempotencyKey: sendInput.idempotencyKey,
        messageKey: sendInput.messageKey,
        body: sendInput.body,
        twilio,
      });
    },
    persistState: async (persistInput) => {
      await persistConversationSessionState({
        supabase: params.supabase,
        sessionId: session.id,
        mode: "interviewing",
        stateToken: persistInput.nextStateToken,
        currentStepId: null,
        lastInboundMessageSid: session.last_inbound_message_sid,
      });
    },
  });

  await insertConversationEvent({
    supabase: params.supabase,
    conversationSessionId: session.id,
    userId: params.userId,
    eventType: "onboarding_opening_sent",
    stepToken: ONBOARDING_AWAITING_OPENING_RESPONSE,
    twilioMessageSid: null,
    idempotencyKey: onboardingOpeningEventIdempotencyKey(params.userId),
    payload: {
      source: "waitlist_activation",
      activation_idempotency_key: params.activationIdempotencyKey,
    },
  });

  return "inserted";
}

export function resolveOnboardingStateForInbound(params: {
  routedStateToken: string;
  persistedStateToken: string;
  userId: string;
  inboundMessageSid: string;
}): OnboardingStateToken {
  const routedStateToken = assertOnboardingToken(params.routedStateToken);
  const persistedStateToken = params.persistedStateToken?.trim() ?? "";

  if (
    persistedStateToken.length > 0 &&
    persistedStateToken !== routedStateToken
  ) {
    console.warn("onboarding_engine.state_token_drift", {
      user_id: params.userId,
      inbound_message_sid: params.inboundMessageSid,
      routed_state_token: routedStateToken,
      persisted_state_token: persistedStateToken,
    });
  }

  return routedStateToken;
}

function assertOnboardingToken(stateToken: string): OnboardingStateToken {
  if (
    stateToken !== ONBOARDING_AWAITING_OPENING_RESPONSE &&
    stateToken !== ONBOARDING_AWAITING_EXPLANATION_RESPONSE &&
    stateToken !== ONBOARDING_AWAITING_INTERVIEW_START
  ) {
    throw new Error(`Invalid onboarding state token '${stateToken}'.`);
  }

  return stateToken;
}

function onboardingOpeningSendIdempotencyKey(userId: string): string {
  return `onboarding:opening:${userId}`;
}

function onboardingOpeningEventIdempotencyKey(userId: string): string {
  return `onboarding:event:opening:${userId}`;
}

async function fetchProfileId(
  supabase: EngineDispatchInput["supabase"],
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to resolve profile for onboarding engine.");
  }
  if (!data?.id) {
    return null;
  }
  return data.id;
}

async function fetchUserContact(
  supabase: EngineDispatchInput["supabase"],
  userId: string,
): Promise<{ first_name: string; phone_e164: string }> {
  const { data, error } = await supabase
    .from("users")
    .select("first_name,phone_e164")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data?.first_name || !data?.phone_e164) {
    throw new Error("Unable to resolve user contact details for onboarding.");
  }

  return {
    first_name: data.first_name,
    phone_e164: data.phone_e164,
  };
}

async function fetchOrCreateConversationSession(
  supabase: EngineDispatchInput["supabase"],
  userId: string,
  fallbackMode: string,
  fallbackStateToken: string,
): Promise<ConversationSessionRow> {
  const { data: existing, error } = await supabase
    .from("conversation_sessions")
    .select("id,mode,state_token,current_step_id,last_inbound_message_sid")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to load conversation session for onboarding engine.");
  }

  if (existing?.id) {
    return {
      id: existing.id,
      mode: existing.mode,
      state_token: existing.state_token,
      current_step_id: existing.current_step_id ?? null,
      last_inbound_message_sid: existing.last_inbound_message_sid ?? null,
    };
  }

  const { data: created, error: createError } = await supabase
    .from("conversation_sessions")
    .insert({
      user_id: userId,
      mode: fallbackMode,
      state_token: fallbackStateToken,
      current_step_id: null,
      last_inbound_message_sid: null,
    })
    .select("id,mode,state_token,current_step_id,last_inbound_message_sid")
    .single();

  if (createError || !created?.id) {
    throw new Error("Unable to create conversation session for onboarding engine.");
  }

  return {
    id: created.id,
    mode: created.mode,
    state_token: created.state_token,
    current_step_id: created.current_step_id ?? null,
    last_inbound_message_sid: created.last_inbound_message_sid ?? null,
  };
}

async function persistConversationSessionState(params: {
  supabase: EngineDispatchInput["supabase"];
  sessionId: string;
  mode: string;
  stateToken: string;
  currentStepId: string | null;
  lastInboundMessageSid: string | null;
}): Promise<void> {
  const { error } = await params.supabase
    .from("conversation_sessions")
    .update({
      mode: params.mode,
      state_token: params.stateToken,
      current_step_id: params.currentStepId,
      last_inbound_message_sid: params.lastInboundMessageSid,
    })
    .eq("id", params.sessionId);

  if (error) {
    throw new Error("Unable to persist onboarding session state.");
  }
}

async function hasConversationEventByIdempotencyKey(
  supabase: EngineDispatchInput["supabase"],
  idempotencyKey: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("conversation_events")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to resolve onboarding event idempotency state.");
  }

  return Boolean(data?.id);
}

async function insertConversationEvent(params: {
  supabase: EngineDispatchInput["supabase"];
  conversationSessionId: string;
  userId: string;
  eventType: string;
  stepToken: string;
  twilioMessageSid: string | null;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const { error } = await params.supabase
    .from("conversation_events")
    .insert({
      conversation_session_id: params.conversationSessionId,
      user_id: params.userId,
      profile_id: null,
      event_type: params.eventType,
      step_token: params.stepToken,
      twilio_message_sid: params.twilioMessageSid,
      payload: params.payload,
      idempotency_key: params.idempotencyKey,
    });

  if (error && !isDuplicateKeyError(error)) {
    throw new Error("Unable to persist onboarding conversation event.");
  }
}

export function buildScheduledOnboardingJobInputs(params: {
  userId: string;
  inboundMessageSid: string;
  outboundPlan: OnboardingOutboundPlanStep[];
  baseTimestampMs?: number;
}): ScheduledOnboardingJobInput[] {
  const baseTimestampMs = params.baseTimestampMs ?? Date.now();
  let delayMs = 0;
  const jobs: ScheduledOnboardingJobInput[] = [];

  for (const step of params.outboundPlan) {
    if (step.kind === "delay") {
      delayMs += step.ms;
      continue;
    }

    jobs.push({
      messageKey: step.message_key,
      body: step.body,
      idempotencyKey: `onboarding:${step.message_key}:${params.userId}:${params.inboundMessageSid}`,
      runAtIso: new Date(baseTimestampMs + delayMs).toISOString(),
    });
  }

  return jobs;
}

async function enqueueOnboardingOutboundPlan(params: {
  supabase: EngineDispatchInput["supabase"];
  userId: string;
  toE164: string;
  fallbackFromE164: string | null;
  correlationId: string | null;
  inboundMessageSid: string;
  outboundPlan: OnboardingOutboundPlanStep[];
  twilio: OutboundTwilioConfig;
}): Promise<void> {
  const jobInputs = buildScheduledOnboardingJobInputs({
    userId: params.userId,
    inboundMessageSid: params.inboundMessageSid,
    outboundPlan: params.outboundPlan,
  });

  for (const jobInput of jobInputs) {
    await enqueueAndRecordOutboundMessageJob({
      supabase: params.supabase,
      userId: params.userId,
      toE164: params.toE164,
      fallbackFromE164: params.fallbackFromE164,
      correlationId: params.correlationId,
      idempotencyKey: jobInput.idempotencyKey,
      messageKey: jobInput.messageKey,
      body: jobInput.body,
      runAtIso: jobInput.runAtIso,
      twilio: params.twilio,
    });
  }
}

async function enqueueAndRecordOutboundMessageJob(params: {
  supabase: EngineDispatchInput["supabase"];
  userId: string;
  toE164: string;
  fallbackFromE164: string | null;
  correlationId: string | null;
  idempotencyKey: string;
  messageKey: OnboardingOutboundMessageKey;
  body: string;
  runAtIso: string;
  twilio: OutboundTwilioConfig;
}): Promise<void> {
  const encryptedBody = await encryptBody(params.supabase, params.body, params.twilio.encryptionKey);

  const resolvedFromE164 = params.twilio.fromE164 ?? params.fallbackFromE164 ?? "";
  if (!resolvedFromE164) {
    throw new Error("Unable to resolve outbound from_e164 for onboarding delivery.");
  }

  const { error: outboundJobError } = await params.supabase
    .from("sms_outbound_jobs")
    .insert(
      {
        user_id: params.userId,
        to_e164: params.toE164,
        from_e164: resolvedFromE164,
        body_ciphertext: encryptedBody,
        body_iv: null,
        body_tag: null,
        key_version: 1,
        purpose: onboardingOutboundPurpose(params.messageKey),
        status: "pending",
        twilio_message_sid: null,
        attempts: 0,
        next_attempt_at: null,
        last_error: null,
        last_status_at: null,
        run_at: params.runAtIso,
        correlation_id: params.correlationId,
        idempotency_key: params.idempotencyKey,
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    );

  if (outboundJobError && !isDuplicateKeyError(outboundJobError)) {
    throw new Error("Unable to persist onboarding outbound job.");
  }
}

async function sendAndRecordOutboundMessage(params: {
  supabase: EngineDispatchInput["supabase"];
  userId: string;
  toE164: string;
  fallbackFromE164: string | null;
  correlationId: string | null;
  idempotencyKey: string;
  messageKey: OnboardingOutboundMessageKey;
  body: string;
  twilio: OutboundTwilioConfig;
}): Promise<void> {
  const encryptedBody = await encryptBody(params.supabase, params.body, params.twilio.encryptionKey);

  const fromNumberForTwilio = params.twilio.fromE164 ?? params.fallbackFromE164 ?? "";
  if (!fromNumberForTwilio) {
    throw new Error("Unable to resolve outbound from_e164 for onboarding delivery.");
  }

  const sendResult = await sendTwilioRestMessage({
    accountSid: params.twilio.accountSid,
    authToken: params.twilio.authToken,
    idempotencyKey: params.idempotencyKey,
    to: params.toE164,
    from: fromNumberForTwilio,
    body: params.body,
    messagingServiceSid: params.twilio.messagingServiceSid,
    statusCallbackUrl: params.twilio.statusCallbackUrl,
  });

  if (!sendResult.ok) {
    throw new Error(
      `Onboarding outbound send failed for '${params.messageKey}': ${sendResult.errorMessage}`,
    );
  }

  const resolvedFromE164 = sendResult.from ?? params.fallbackFromE164 ?? params.twilio.fromE164;
  if (!resolvedFromE164) {
    throw new Error("Twilio response did not include a sender number for onboarding delivery.");
  }

  const outboundTimestampIso = new Date().toISOString();

  const { error: outboundJobError } = await params.supabase
    .from("sms_outbound_jobs")
    .insert(
      {
        user_id: params.userId,
        to_e164: params.toE164,
        from_e164: resolvedFromE164,
        body_ciphertext: encryptedBody,
        body_iv: null,
        body_tag: null,
        key_version: 1,
        purpose: onboardingOutboundPurpose(params.messageKey),
        status: "sent",
        twilio_message_sid: sendResult.sid,
        attempts: 1,
        next_attempt_at: null,
        last_error: null,
        last_status_at: outboundTimestampIso,
        run_at: outboundTimestampIso,
        correlation_id: params.correlationId,
        idempotency_key: params.idempotencyKey,
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    );

  if (outboundJobError && !isDuplicateKeyError(outboundJobError)) {
    throw new Error("Unable to persist onboarding outbound job.");
  }

  const { error } = await params.supabase
    .from("sms_messages")
    .insert(
      {
        user_id: params.userId,
        direction: "out",
        from_e164: resolvedFromE164,
        to_e164: params.toE164,
        twilio_message_sid: sendResult.sid,
        body_ciphertext: encryptedBody,
        body_iv: null,
        body_tag: null,
        key_version: 1,
        media_count: 0,
        status: sendResult.status ?? "queued",
        last_status_at: outboundTimestampIso,
        correlation_id: params.correlationId,
      },
      { onConflict: "twilio_message_sid", ignoreDuplicates: true },
    );

  if (error && !isDuplicateKeyError(error)) {
    throw new Error("Unable to persist onboarding outbound sms message.");
  }
}

function onboardingOutboundPurpose(messageKey: OnboardingOutboundMessageKey): string {
  return `onboarding_${messageKey}`;
}

async function encryptBody(
  supabase: EngineDispatchInput["supabase"],
  body: string,
  key: string,
): Promise<string> {
  if (!supabase.rpc) {
    throw new Error("Supabase client does not support RPC for onboarding encryption.");
  }

  const { data, error } = await supabase.rpc("encrypt_sms_body", {
    plaintext: body,
    key,
  });

  if (error || !data) {
    throw new Error("Unable to encrypt onboarding outbound body.");
  }

  return data as string;
}

function readOutboundTwilioConfig(): OutboundTwilioConfig {
  return {
    accountSid: requireEnv("TWILIO_ACCOUNT_SID"),
    authToken: requireEnv("TWILIO_AUTH_TOKEN"),
    messagingServiceSid: readEnv("TWILIO_MESSAGING_SERVICE_SID") ?? null,
    fromE164: readEnv("TWILIO_FROM_NUMBER") ?? null,
    statusCallbackUrl: resolveTwilioStatusCallbackUrl({
      explicitUrl: readEnv("TWILIO_STATUS_CALLBACK_URL") ?? null,
      projectRef: readEnv("PROJECT_REF") ?? null,
    }),
    encryptionKey: requireEnv("SMS_BODY_ENCRYPTION_KEY"),
  };
}

function isDuplicateKeyError(error: { code?: string; message?: string } | null): boolean {
  if (!error) {
    return false;
  }
  if (error.code === "23505") {
    return true;
  }
  const message = error.message ?? "";
  return message.toLowerCase().includes("duplicate key");
}

function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function readEnv(name: string): string | undefined {
  const denoGlobal = (globalThis as {
    Deno?: {
      env: {
        get: (key: string) => string | undefined;
      };
    };
  }).Deno;
  return denoGlobal?.env.get(name);
}
