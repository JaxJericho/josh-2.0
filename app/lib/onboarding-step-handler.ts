import crypto from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createSupabaseEntitlementsRepository,
  evaluateEntitlements,
} from "../../packages/core/src/entitlements/evaluate-entitlements";
import {
  ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
  ONBOARDING_AWAITING_INTERVIEW_START,
  ONBOARDING_AWAITING_OPENING_RESPONSE,
} from "../../packages/core/src/onboarding/onboarding-engine";
import {
  ONBOARDING_MESSAGE_1,
  ONBOARDING_MESSAGE_2,
  ONBOARDING_MESSAGE_3,
  ONBOARDING_MESSAGE_4,
} from "../../packages/core/src/onboarding/messages";
import {
  getNextOnboardingStepId,
  isOnboardingStepId,
  ONBOARDING_STEP_DELAY_MS,
  type OnboardingStepId,
} from "../../packages/core/src/onboarding/step-ids";
import type { Database } from "../../supabase/types/database";
import { logEvent } from "./observability";
import { scheduleOnboardingStep, verifyQStashSignature } from "./qstash";

const ONBOARDING_BURST_STATE_PREFIX = "onboarding:awaiting_burst:";

const ONBOARDING_STEP_BODIES: Record<OnboardingStepId, string> = {
  onboarding_message_1: ONBOARDING_MESSAGE_1,
  onboarding_message_2: ONBOARDING_MESSAGE_2,
  onboarding_message_3: ONBOARDING_MESSAGE_3,
  onboarding_message_4: ONBOARDING_MESSAGE_4,
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

type TwilioSendResult = {
  sid: string;
  status: string | null;
  from: string | null;
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
  return `${ONBOARDING_BURST_STATE_PREFIX}${nextStepId}`;
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
  const signatureValid = await deps.verifyQStashSignature(request);
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

let serviceRoleClient: SupabaseClient<Database> | null = null;

function getServiceRoleClient(): SupabaseClient<Database> {
  if (!serviceRoleClient) {
    serviceRoleClient = createClient<Database>(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }

  return serviceRoleClient;
}

export function createDefaultOnboardingStepHandlerDependencies(): OnboardingStepHandlerDependencies {
  const supabase = getServiceRoleClient();

  return {
    verifyQStashSignature,

    async loadSession(sessionId: string): Promise<ConversationSessionRow | null> {
      const { data, error } = await supabase
        .from("conversation_sessions")
        .select("id,user_id,mode,state_token")
        .eq("id", sessionId)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to load conversation session for onboarding step.");
      }
      if (!data?.id || !data?.user_id || !data?.mode || !data?.state_token) {
        return null;
      }

      return {
        id: data.id,
        user_id: data.user_id,
        mode: data.mode,
        state_token: data.state_token,
      };
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
      const { data, error } = await supabase
        .from("sms_messages")
        .select("id")
        .eq("correlation_id", idempotencyKey)
        .not("twilio_message_sid", "is", null)
        .limit(1);

      if (error) {
        throw new Error("Unable to resolve onboarding idempotency state.");
      }

      return Array.isArray(data) && data.length > 0;
    },

    async sendStepMessage(input: {
      session: ConversationSessionRow;
      payload: OnboardingStepPayload;
    }): Promise<void> {
      const body = ONBOARDING_STEP_BODIES[input.payload.step_id];
      const twilioAccountSid = requireEnv("TWILIO_ACCOUNT_SID");
      const twilioAuthToken = requireEnv("TWILIO_AUTH_TOKEN");
      const encryptionKey = requireEnv("SMS_BODY_ENCRYPTION_KEY");
      const fromE164 = requireEnv("TWILIO_FROM_NUMBER");
      const messagingServiceSid = readEnv("TWILIO_MESSAGING_SERVICE_SID") ?? null;

      const { data: user, error: userError } = await supabase
        .from("users")
        .select("phone_e164")
        .eq("id", input.session.user_id)
        .maybeSingle();

      if (userError || !user?.phone_e164) {
        throw new Error("Unable to resolve destination phone number for onboarding step.");
      }

      const { data: encryptedBody, error: encryptError } = await supabase.rpc("encrypt_sms_body", {
        plaintext: body,
        key: encryptionKey,
      });

      if (encryptError || !encryptedBody) {
        throw new Error("Unable to encrypt onboarding outbound body.");
      }

      const nowIso = new Date().toISOString();
      const { data: pendingRows, error: pendingError } = await supabase
        .from("sms_messages")
        .select("id,from_e164")
        .eq("correlation_id", input.payload.idempotency_key)
        .is("twilio_message_sid", null)
        .order("created_at", { ascending: false })
        .limit(1);

      if (pendingError) {
        throw new Error("Unable to inspect pending onboarding outbound message state.");
      }

      let pendingMessageId: string;
      if (Array.isArray(pendingRows) && pendingRows.length > 0 && pendingRows[0]?.id) {
        pendingMessageId = pendingRows[0].id;
      } else {
        const { data: insertedMessage, error: insertError } = await supabase
          .from("sms_messages")
          .insert({
            user_id: input.session.user_id,
            profile_id: input.payload.profile_id,
            direction: "out",
            from_e164: fromE164,
            to_e164: user.phone_e164,
            twilio_message_sid: null,
            body_ciphertext: encryptedBody,
            body_iv: null,
            body_tag: null,
            key_version: 1,
            media_count: 0,
            status: "queued",
            last_status_at: nowIso,
            correlation_id: input.payload.idempotency_key,
          })
          .select("id")
          .single();

        if (insertError || !insertedMessage?.id) {
          throw new Error("Unable to persist onboarding outbound sms message.");
        }

        pendingMessageId = insertedMessage.id;
      }

      const statusCallbackUrl = resolveTwilioStatusCallbackUrl({
        explicitUrl: readEnv("TWILIO_STATUS_CALLBACK_URL") ?? null,
        projectRef: readEnv("PROJECT_REF") ?? null,
      });

      const sendResult = await sendTwilioRestMessage({
        accountSid: twilioAccountSid,
        authToken: twilioAuthToken,
        idempotencyKey: input.payload.idempotency_key,
        to: user.phone_e164,
        from: fromE164,
        body,
        messagingServiceSid,
        statusCallbackUrl,
      });

      const resolvedFrom = sendResult.from ?? fromE164;
      const { error: updateError } = await supabase
        .from("sms_messages")
        .update({
          from_e164: resolvedFrom,
          twilio_message_sid: sendResult.sid,
          status: sendResult.status ?? "queued",
          last_status_at: new Date().toISOString(),
        })
        .eq("id", pendingMessageId)
        .is("twilio_message_sid", null);

      if (updateError) {
        throw new Error("Unable to finalize onboarding outbound sms message.");
      }
    },

    async updateSessionState(sessionId: string, stateToken: string): Promise<void> {
      const { error } = await supabase
        .from("conversation_sessions")
        .update({ state_token: stateToken })
        .eq("id", sessionId);

      if (error) {
        throw new Error("Unable to persist onboarding session state.");
      }
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

function resolveTwilioStatusCallbackUrl(params: {
  explicitUrl: string | null;
  projectRef: string | null;
}): string | null {
  if (params.explicitUrl) {
    return params.explicitUrl;
  }

  if (!params.projectRef) {
    return null;
  }

  return `https://${params.projectRef}.supabase.co/functions/v1/twilio-status-callback`;
}

async function sendTwilioRestMessage(input: {
  accountSid: string;
  authToken: string;
  idempotencyKey: string;
  to: string;
  from: string;
  body: string;
  messagingServiceSid: string | null;
  statusCallbackUrl: string | null;
}): Promise<TwilioSendResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${input.accountSid}/Messages.json`;
  const payload = new URLSearchParams();
  payload.set("To", input.to);
  payload.set("Body", input.body);

  if (input.messagingServiceSid) {
    payload.set("MessagingServiceSid", input.messagingServiceSid);
  } else {
    payload.set("From", input.from);
  }

  if (input.statusCallbackUrl) {
    payload.set("StatusCallback", input.statusCallbackUrl);
  }

  const auth = Buffer.from(`${input.accountSid}:${input.authToken}`).toString("base64");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Idempotency-Key": input.idempotencyKey,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: payload.toString(),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const code = isNonEmptyString(json?.code) ? `code=${json.code}` : "";
    const detail = isNonEmptyString(json?.message) ? json.message : response.statusText;
    throw new Error([code, detail].filter(Boolean).join(" "));
  }

  const sid = typeof json?.sid === "string" ? json.sid : "";
  if (!sid) {
    throw new Error("Twilio response missing sid.");
  }

  return {
    sid,
    status: typeof json?.status === "string" ? json.status : null,
    from: typeof json?.from === "string" ? json.from : null,
  };
}
