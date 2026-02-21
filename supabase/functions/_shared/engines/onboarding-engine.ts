// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  INTERVIEW_ACTIVITY_01_STATE_TOKEN,
  ONBOARDING_AWAITING_BURST,
  ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
  ONBOARDING_AWAITING_INTERVIEW_START,
  ONBOARDING_AWAITING_OPENING_RESPONSE,
  handleOnboardingInbound,
  startOnboardingForUser,
  type OnboardingOutboundMessageKey,
  type OnboardingStateToken,
} from "../../../../packages/core/src/onboarding/onboarding-engine.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import type { OnboardingStepId } from "../../../../packages/core/src/onboarding/step-ids.ts";
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
import { resolveTwilioRuntimeFromEnv, type TwilioEnvClient } from "../../../../packages/messaging/src/client.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { sendSms } from "../../../../packages/messaging/src/sender.ts";

type ConversationSessionRow = {
  id: string;
  mode: string;
  state_token: string;
  current_step_id: string | null;
  last_inbound_message_sid: string | null;
};

type OutboundTwilioConfig = {
  client: TwilioEnvClient["client"];
  messagingServiceSid: string | null;
  fromE164: string | null;
  statusCallbackUrl: string | null;
  encryptionKey: string;
};

type OnboardingStepPayload = {
  profile_id: string;
  session_id: string;
  step_id: OnboardingStepId;
  expected_state_token: string;
  idempotency_key: string;
};

type OnboardingEngineDependencies = {
  scheduleOnboardingStep: (
    payload: OnboardingStepPayload,
    delayMs: number,
  ) => Promise<void>;
};

const HARNESS_QSTASH_MODE_VALUES = new Set(["stub", "real"]);
const HARNESS_QSTASH_STUB_HEADER = "x-harness-qstash-stub";
const BOOLEAN_TRUE_VALUES = new Set(["1", "true"]);
const BOOLEAN_FALSE_VALUES = new Set(["0", "false"]);

const DEFAULT_ONBOARDING_ENGINE_DEPENDENCIES: OnboardingEngineDependencies = {
  scheduleOnboardingStep: scheduleOnboardingStep,
};

export async function runOnboardingEngine(
  input: EngineDispatchInput,
  dependencies: OnboardingEngineDependencies = DEFAULT_ONBOARDING_ENGINE_DEPENDENCIES,
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

  // Atomic compare-and-swap: claim this inbound SID on the session row.
  // If another concurrent request already claimed this SID, bail out to
  // prevent duplicate processing (Twilio retries, edge function replays).
  const sidClaimed = await claimInboundMessageSid(
    input.supabase,
    session.id,
    session.last_inbound_message_sid,
    input.payload.inbound_message_sid,
  );
  if (!sidClaimed) {
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
  for (const step of inboundResult.outboundPlan) {
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

  const shouldScheduleBurstStart =
    onboardingStateToken === ONBOARDING_AWAITING_EXPLANATION_RESPONSE &&
    inboundResult.nextStateToken === ONBOARDING_AWAITING_BURST;

  if (shouldScheduleBurstStart) {
    if (!profileId) {
      throw new Error("Unable to schedule onboarding burst without a profile id.");
    }

    const stepId: OnboardingStepId = "onboarding_message_1";
    await dependencies.scheduleOnboardingStep(
      {
        profile_id: profileId,
        session_id: session.id,
        step_id: stepId,
        expected_state_token: onboardingStateToken,
        idempotency_key: buildOnboardingStepIdempotencyKey({
          profileId,
          sessionId: session.id,
          stepId,
        }),
      },
      0,
    );
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
    session.state_token === ONBOARDING_AWAITING_BURST ||
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
    stateToken !== ONBOARDING_AWAITING_BURST &&
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

function buildOnboardingStepIdempotencyKey(params: {
  profileId: string;
  sessionId: string;
  stepId: OnboardingStepId;
}): string {
  return `onboarding:${params.profileId}:${params.sessionId}:${params.stepId}`;
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

async function claimInboundMessageSid(
  supabase: EngineDispatchInput["supabase"],
  sessionId: string,
  previousSid: string | null,
  incomingSid: string,
): Promise<boolean> {
  // Atomic UPDATE with WHERE on previous SID value prevents two concurrent
  // requests from both proceeding past the guard.
  let query = supabase
    .from("conversation_sessions")
    .update({ last_inbound_message_sid: incomingSid })
    .eq("id", sessionId);

  if (previousSid) {
    query = query.eq("last_inbound_message_sid", previousSid);
  } else {
    query = query.is("last_inbound_message_sid", null);
  }

  const { data, error } = await query.select("id").maybeSingle();

  if (error) {
    throw new Error("Unable to claim inbound message SID on session.");
  }

  return Boolean(data?.id);
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
  // Pre-send dedupe: skip Twilio call entirely when a job with this
  // idempotency key has already been sent (or is being sent by the runner).
  const existingJob = await fetchOutboundJobByIdempotencyKey(
    params.supabase,
    params.idempotencyKey,
  );
  if (existingJob) {
    return;
  }

  const encryptedBody = await encryptBody(params.supabase, params.body, params.twilio.encryptionKey);

  const fromNumberForTwilio = params.twilio.fromE164 ?? params.fallbackFromE164 ?? "";
  if (!fromNumberForTwilio) {
    throw new Error("Unable to resolve outbound from_e164 for onboarding delivery.");
  }

  const sendResult = await sendSms({
    client: params.twilio.client,
    db: params.supabase,
    to: params.toE164,
    from: fromNumberForTwilio,
    body: params.body,
    correlationId: params.correlationId ?? params.idempotencyKey,
    purpose: onboardingOutboundPurpose(params.messageKey),
    idempotencyKey: params.idempotencyKey,
    messagingServiceSid: params.twilio.messagingServiceSid,
    statusCallbackUrl: params.twilio.statusCallbackUrl,
    bodyCiphertext: encryptedBody,
    keyVersion: 1,
    mediaCount: 0,
    userId: params.userId,
  });

  const outboundTimestampIso = new Date().toISOString();

  const { error: outboundJobError } = await params.supabase
    .from("sms_outbound_jobs")
    .insert(
      {
        user_id: params.userId,
        to_e164: params.toE164,
        from_e164: sendResult.fromE164,
        body_ciphertext: encryptedBody,
        body_iv: null,
        body_tag: null,
        key_version: 1,
        purpose: onboardingOutboundPurpose(params.messageKey),
        status: "sent",
        twilio_message_sid: sendResult.twilioMessageSid,
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
}

async function fetchOutboundJobByIdempotencyKey(
  supabase: EngineDispatchInput["supabase"],
  idempotencyKey: string,
): Promise<{ id: string; status: string } | null> {
  const { data, error } = await supabase
    .from("sms_outbound_jobs")
    .select("id,status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    // Non-fatal: fall through to let the insert's onConflict handle duplicates.
    return null;
  }

  return data?.id ? { id: data.id, status: data.status } : null;
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
  const twilio = resolveTwilioRuntimeFromEnv({
    getEnv: (name) => readEnv(name),
  });

  return {
    client: twilio.client,
    messagingServiceSid: twilio.senderIdentity.messagingServiceSid,
    fromE164: twilio.senderIdentity.from,
    statusCallbackUrl: twilio.statusCallbackUrl,
    encryptionKey: requireEnv("SMS_BODY_ENCRYPTION_KEY"),
  };
}

async function scheduleOnboardingStep(
  payload: OnboardingStepPayload,
  delayMs: number,
): Promise<void> {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error("delayMs must be a non-negative finite number.");
  }

  if (isOnboardingSchedulingDisabled()) {
    return;
  }

  if (resolveHarnessQStashMode() === "stub") {
    const response = await fetch(resolveOnboardingStepUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        [HARNESS_QSTASH_STUB_HEADER]: "1",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(
        `Stub onboarding step invocation failed (status=${response.status})${details ? `: ${details}` : ""}`,
      );
    }

    return;
  }

  const endpoint = resolveQStashPublishEndpoint(resolveOnboardingStepUrl());
  const delaySeconds = Math.ceil(delayMs / 1000);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("QSTASH_TOKEN")}`,
      "content-type": "application/json; charset=utf-8",
      "Upstash-Delay": `${delaySeconds}s`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `QStash publish failed (status=${response.status})${details ? `: ${details}` : ""}`,
    );
  }
}

function isOnboardingSchedulingDisabled(): boolean {
  const raw = readEnv("ONBOARDING_SCHEDULING_DISABLED")?.trim().toLowerCase();
  if (!raw) {
    return false;
  }
  if (BOOLEAN_TRUE_VALUES.has(raw)) {
    return true;
  }
  if (BOOLEAN_FALSE_VALUES.has(raw)) {
    return false;
  }
  throw new Error("ONBOARDING_SCHEDULING_DISABLED must be one of: 1, true, 0, false.");
}

function resolveHarnessQStashMode(): "stub" | "real" {
  const raw = readEnv("HARNESS_QSTASH_MODE")?.trim().toLowerCase();
  if (!raw) {
    return "real";
  }

  if (!HARNESS_QSTASH_MODE_VALUES.has(raw)) {
    throw new Error("HARNESS_QSTASH_MODE must be either 'stub' or 'real'.");
  }

  return raw as "stub" | "real";
}

function resolveQStashPublishEndpoint(targetUrl: string): string {
  const qstashBaseUrl = (readEnv("QSTASH_URL") ?? "https://qstash.upstash.io").replace(/\/$/, "");
  return `${qstashBaseUrl}/v2/publish/${encodeURIComponent(targetUrl)}`;
}

function resolveOnboardingStepUrl(): string {
  return new URL("/api/onboarding/step", resolveAppBaseUrl()).toString();
}

function resolveAppBaseUrl(): string {
  const explicit = readEnv("APP_BASE_URL");
  if (explicit) {
    return normalizeAbsoluteHttpUrl(explicit, "APP_BASE_URL");
  }

  const vercelUrl = readEnv("VERCEL_URL");
  if (vercelUrl) {
    return normalizeAbsoluteHttpUrl(`https://${vercelUrl}`, "VERCEL_URL");
  }

  const appEnv = readEnv("APP_ENV");
  if (appEnv === "staging") {
    return "https://josh-2-0-staging.vercel.app";
  }
  if (appEnv === "production") {
    return "https://www.callmejosh.ai";
  }

  throw new Error("Missing required env var: APP_BASE_URL or VERCEL_URL");
}

function normalizeAbsoluteHttpUrl(value: string, envName: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${envName} must be a valid absolute URL.`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${envName} must use http or https.`);
  }

  if (parsed.search.length > 0) {
    throw new Error(`${envName} must not include query params.`);
  }

  return parsed.origin;
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
