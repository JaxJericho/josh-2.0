import { describe, expect, it, vi } from "vitest";

const sendSmsMock = vi.hoisted(() => vi.fn());
vi.mock("../../packages/messaging/src/sender.ts", () => ({
  sendSms: sendSmsMock,
}));

// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  resolveOnboardingStateForInbound,
  runOnboardingEngine,
  startOnboardingForActivatedUser,
} from "../../supabase/functions/_shared/engines/onboarding-engine";

describe("onboarding engine runtime idempotency", () => {
  it("does not re-advance or resend when inbound MessageSid is replayed", async () => {
    const replaySid = "SM_ONBOARDING_REPLAY_1";
    const supabase = {
      from(table: string) {
        const query = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          async maybeSingle() {
            if (table === "conversation_sessions") {
              return {
                data: {
                  id: "ses_123",
                  mode: "interviewing",
                  state_token: "onboarding:awaiting_opening_response",
                  current_step_id: null,
                  last_inbound_message_sid: replaySid,
                },
                error: null,
              };
            }
            return { data: null, error: null };
          },
        };

        return {
          ...query,
          insert() {
            throw new Error("insert should not be called for replayed inbound sid");
          },
          update() {
            throw new Error("update should not be called for replayed inbound sid");
          },
        };
      },
    };

    const result = await runOnboardingEngine({
      supabase,
      decision: {
        user_id: "usr_123",
        state: {
          mode: "interviewing",
          state_token: "onboarding:awaiting_opening_response",
        },
        profile_is_complete_mvp: false,
        route: "onboarding_engine",
        safety_override_applied: false,
        next_transition: "onboarding:awaiting_opening_response",
      },
      payload: {
        inbound_message_id: "msg_123",
        inbound_message_sid: replaySid,
        from_e164: "+15555550111",
        to_e164: "+15555550222",
        body_raw: "yes",
        body_normalized: "YES",
      },
    });

    expect(result.engine).toBe("onboarding_engine");
    expect(result.reply_message).toBeNull();
  });
});

describe("onboarding runtime state-token resolution", () => {
  it("prefers persisted onboarding token when routed state drifts", () => {
    const resolved = resolveOnboardingStateForInbound({
      routedStateToken: "onboarding:awaiting_interview_start",
      persistedStateToken: "onboarding:awaiting_explanation_response",
      userId: "usr_123",
      inboundMessageSid: "SM_123",
    });

    expect(resolved).toBe("onboarding:awaiting_explanation_response");
  });

  it("falls back to routed onboarding token when persisted token is non-onboarding", () => {
    const resolved = resolveOnboardingStateForInbound({
      routedStateToken: "onboarding:awaiting_opening_response",
      persistedStateToken: "interview:motive_01",
      userId: "usr_123",
      inboundMessageSid: "SM_123",
    });

    expect(resolved).toBe("onboarding:awaiting_opening_response");
  });

  it("throws when routed token is not an onboarding token", () => {
    expect(() =>
      resolveOnboardingStateForInbound({
        routedStateToken: "interview:motive_01",
        persistedStateToken: "onboarding:awaiting_opening_response",
        userId: "usr_123",
        inboundMessageSid: "SM_123",
      }))
      .toThrowError("Invalid onboarding state token 'interview:motive_01'.");
  });
});

describe("onboarding explanation affirmative scheduling", () => {
  it("calls scheduleOnboardingStep exactly once for onboarding_message_1 with delay=0", async () => {
    const {
      scheduleCalls,
    } = await runExplanationAffirmativeScenario();

    expect(scheduleCalls).toHaveLength(1);
    expect(scheduleCalls[0]).toEqual({
      payload: {
        profile_id: "profile_123",
        session_id: "ses_123",
        step_id: "onboarding_message_1",
        expected_state_token: "onboarding:awaiting_burst",
        idempotency_key: "onboarding:profile_123:ses_123:onboarding_message_1",
      },
      delayMs: 0,
    });
  });

  it("persists onboarding:awaiting_burst before scheduling onboarding_message_1", async () => {
    const { callOrder } = await runExplanationAffirmativeScenario();
    const persistIndex = callOrder.indexOf("persist:onboarding:awaiting_burst");
    const scheduleIndex = callOrder.indexOf("schedule:onboarding_message_1");

    expect(persistIndex).toBeGreaterThanOrEqual(0);
    expect(scheduleIndex).toBeGreaterThanOrEqual(0);
    expect(persistIndex).toBeLessThan(scheduleIndex);
  });

  it("creates zero burst sms_outbound_jobs rows and sets state_token to onboarding:awaiting_burst", async () => {
    const {
      insertedJobRows,
      stateTokenUpdates,
    } = await runExplanationAffirmativeScenario();

    expect(insertedJobRows).toHaveLength(0);
    expect(stateTokenUpdates).toContain("onboarding:awaiting_burst");
    expect(stateTokenUpdates).not.toContain("onboarding:awaiting_interview_start");
  });

  it("records onboarding_step_transition to awaiting_burst and never direct-jumps to awaiting_interview_start", async () => {
    const { insertedConversationEvents } = await runExplanationAffirmativeScenario({
      routedStateToken: "onboarding:awaiting_interview_start",
      persistedStateToken: "onboarding:awaiting_explanation_response",
      nextTransition: "onboarding:awaiting_interview_start",
    });

    expect(
      insertedConversationEvents.some(
        (event) =>
          event.event_type === "onboarding_step_transition" &&
          event.step_token === "onboarding:awaiting_burst",
      ),
    ).toBe(true);
    expect(
      insertedConversationEvents.some(
        (event) => event.step_token === "onboarding:awaiting_interview_start",
      ),
    ).toBe(false);
  });
});

describe("onboarding concurrent request dedupe (atomic SID claim)", () => {
  it("rejects a concurrent request when atomic SID claim fails", async () => {
    const supabase = {
      from(table: string) {
        const query = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          is() {
            return query;
          },
          async maybeSingle() {
            if (table === "conversation_sessions") {
              return {
                data: {
                  id: "ses_123",
                  mode: "interviewing",
                  state_token: "onboarding:awaiting_opening_response",
                  current_step_id: null,
                  last_inbound_message_sid: "SM_PREVIOUS",
                },
                error: null,
              };
            }
            return { data: null, error: null };
          },
          update() {
            const updateQuery = {
              eq() { return updateQuery; },
              is() { return updateQuery; },
              select() { return updateQuery; },
              maybeSingle: async () => ({ data: null, error: null }),
            };
            return updateQuery;
          },
          insert() {
            throw new Error("insert should not be called when SID claim fails");
          },
        };
        return query;
      },
    };

    const result = await runOnboardingEngine({
      supabase,
      decision: {
        user_id: "usr_123",
        state: {
          mode: "interviewing",
          state_token: "onboarding:awaiting_opening_response",
        },
        profile_is_complete_mvp: false,
        route: "onboarding_engine",
        safety_override_applied: false,
        next_transition: "onboarding:awaiting_opening_response",
      },
      payload: {
        inbound_message_id: "msg_456",
        inbound_message_sid: "SM_CONCURRENT",
        from_e164: "+15555550111",
        to_e164: "+15555550222",
        body_raw: "yes",
        body_normalized: "YES",
      },
    });

    expect(result.engine).toBe("onboarding_engine");
    expect(result.reply_message).toBeNull();
  });
});

describe("onboarding activation sender identity", () => {
  it("supports messagingServiceSid-only config without requiring from", async () => {
    const userId = "usr_mg_only";
    const profileId = "pro_mg_only";
    const envMap = new Map<string, string>([
      ["TWILIO_ACCOUNT_SID", "TWILIO_ACCOUNT_SID_PLACEHOLDER"],
      ["TWILIO_AUTH_TOKEN", "auth-token-123"],
      ["SMS_BODY_ENCRYPTION_KEY", "sms-encryption-key-123"],
      ["TWILIO_MESSAGING_SERVICE_SID", "MG1234567890abcdef1234567890abcd"],
      ["PROJECT_REF", "rcqlnfywwfsixznrmzmv"],
    ]);

    sendSmsMock.mockReset();
    sendSmsMock.mockResolvedValue({
      messageId: "msg_mg_only",
      twilioMessageSid: "SM_MG_ONLY",
      status: "queued",
      fromE164: "+15555550123",
      deduplicated: false,
      attempts: 1,
    });

    const { supabase } = createActivationSupabaseStub({
      userId,
      profileId,
      phoneE164: "+15555550010",
      firstName: "Alex",
    });

    await withDenoEnv(envMap, async () => {
      const result = await startOnboardingForActivatedUser({
        supabase,
        userId,
        correlationId: "wle_mg_only",
        activationIdempotencyKey: "waitlist_activation_onboarding:reg:pro_mg_only:onboarding_opening",
      });

      expect(result).toBe("inserted");
    });

    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    const request = sendSmsMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(request.to).toBe("+15555550010");
    expect(typeof request.body).toBe("string");
    expect(request.messagingServiceSid).toBe("MG1234567890abcdef1234567890abcd");
    expect("from" in request).toBe(false);
  });

  it("keeps from-number-only config behavior", async () => {
    const userId = "usr_from_only";
    const profileId = "pro_from_only";
    const envMap = new Map<string, string>([
      ["TWILIO_ACCOUNT_SID", "TWILIO_ACCOUNT_SID_PLACEHOLDER"],
      ["TWILIO_AUTH_TOKEN", "auth-token-123"],
      ["SMS_BODY_ENCRYPTION_KEY", "sms-encryption-key-123"],
      ["TWILIO_FROM_NUMBER", "+15555550123"],
      ["PROJECT_REF", "rcqlnfywwfsixznrmzmv"],
    ]);

    sendSmsMock.mockReset();
    sendSmsMock.mockResolvedValue({
      messageId: "msg_from_only",
      twilioMessageSid: "SM_FROM_ONLY",
      status: "queued",
      fromE164: "+15555550123",
      deduplicated: false,
      attempts: 1,
    });

    const { supabase } = createActivationSupabaseStub({
      userId,
      profileId,
      phoneE164: "+15555550011",
      firstName: "Jordan",
    });

    await withDenoEnv(envMap, async () => {
      const result = await startOnboardingForActivatedUser({
        supabase,
        userId,
        correlationId: "wle_from_only",
        activationIdempotencyKey: "waitlist_activation_onboarding:reg:pro_from_only:onboarding_opening",
      });

      expect(result).toBe("inserted");
    });

    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    const request = sendSmsMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(request.to).toBe("+15555550011");
    expect(typeof request.body).toBe("string");
    expect(request.from).toBe("+15555550123");
    expect(request.messagingServiceSid).toBeNull();
  });
});

async function withDenoEnv<T>(
  envMap: Map<string, string>,
  run: () => Promise<T>,
): Promise<T> {
  const previousDeno = (globalThis as { Deno?: unknown }).Deno;
  (globalThis as { Deno?: unknown }).Deno = {
    env: {
      get: (key: string) => envMap.get(key),
    },
  };

  try {
    return await run();
  } finally {
    if (previousDeno === undefined) {
      delete (globalThis as { Deno?: unknown }).Deno;
    } else {
      (globalThis as { Deno?: unknown }).Deno = previousDeno;
    }
  }
}

function createActivationSupabaseStub(input: {
  userId: string;
  profileId: string;
  phoneE164: string;
  firstName: string;
}) {
  const supabase = {
    from(table: string) {
      const filters = new Map<string, unknown>();

      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters.set(column, value);
          return query;
        },
        in() {
          return query;
        },
        not() {
          return query;
        },
        is() {
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        async maybeSingle() {
          if (table === "profiles") {
            if (filters.has("user_id")) {
              return { data: { id: input.profileId }, error: null };
            }
            if (filters.has("id")) {
              return { data: { id: input.profileId, user_id: input.userId }, error: null };
            }
          }

          if (table === "profile_region_assignments") {
            return { data: null, error: null };
          }

          if (table === "waitlist_entries") {
            return { data: null, error: null };
          }

          if (table === "profile_entitlements") {
            return { data: null, error: null };
          }

          if (table === "safety_holds") {
            return { data: null, error: null };
          }

          if (table === "conversation_sessions") {
            return {
              data: {
                id: `ses_${input.userId}`,
                mode: "interviewing",
                state_token: "onboarding:awaiting_opening_response",
                current_step_id: null,
                last_inbound_message_sid: null,
              },
              error: null,
            };
          }

          if (table === "users") {
            return {
              data: {
                first_name: input.firstName,
                phone_e164: input.phoneE164,
              },
              error: null,
            };
          }

          if (table === "conversation_events") {
            return { data: null, error: null };
          }

          if (table === "sms_outbound_jobs") {
            return { data: null, error: null };
          }

          return { data: null, error: null };
        },
        single: async () => ({ data: null, error: null }),
        update() {
          const updateQuery = {
            eq() {
              return Promise.resolve({ error: null });
            },
            is() {
              return updateQuery;
            },
            select() {
              return updateQuery;
            },
            maybeSingle: async () => ({ data: null, error: null }),
          };
          return updateQuery;
        },
        insert(payload: Record<string, unknown>) {
          if (table === "sms_outbound_jobs" || table === "conversation_events") {
            return Promise.resolve({ error: null });
          }

          if (table === "conversation_sessions") {
            return {
              select() {
                return this;
              },
              single: async () => ({
                data: payload,
                error: null,
              }),
            };
          }

          return Promise.resolve({ error: null });
        },
      };

      return query;
    },
    rpc: async (fn: string) => {
      if (fn === "encrypt_sms_body") {
        return { data: "ciphertext", error: null };
      }
      throw new Error(`Unexpected rpc call: ${fn}`);
    },
  };

  return { supabase };
}

async function runExplanationAffirmativeScenario(input?: {
  routedStateToken?: string;
  persistedStateToken?: string;
  nextTransition?: string;
  bodyRaw?: string;
  bodyNormalized?: string;
}): Promise<{
  scheduleCalls: Array<{
    payload: {
      profile_id: string;
      session_id: string;
      step_id: "onboarding_message_1";
      expected_state_token: string;
      idempotency_key: string;
    };
    delayMs: number;
  }>;
  insertedJobRows: Array<Record<string, unknown>>;
  insertedConversationEvents: Array<Record<string, unknown>>;
  stateTokenUpdates: string[];
  callOrder: string[];
}> {
  const previousDeno = (globalThis as { Deno?: unknown }).Deno;
  const envMap = new Map<string, string>([
    ["TWILIO_ACCOUNT_SID", "TWILIO_ACCOUNT_SID_PLACEHOLDER"],
    ["TWILIO_AUTH_TOKEN", "auth-token-123"],
    ["SMS_BODY_ENCRYPTION_KEY", "sms-encryption-key-123"],
    ["TWILIO_FROM_NUMBER", "+15555550123"],
    ["PROJECT_REF", "rcqlnfywwfsixznrmzmv"],
  ]);

  (globalThis as { Deno?: unknown }).Deno = {
    env: {
      get: (key: string) => envMap.get(key),
    },
  };

  const routedStateToken = input?.routedStateToken ?? "onboarding:awaiting_explanation_response";
  const persistedStateToken = input?.persistedStateToken ?? "onboarding:awaiting_explanation_response";
  const nextTransition = input?.nextTransition ?? routedStateToken;
  const bodyRaw = input?.bodyRaw ?? "yes";
  const bodyNormalized = input?.bodyNormalized ?? "YES";

  const insertedJobRows: Array<Record<string, unknown>> = [];
  const insertedConversationEvents: Array<Record<string, unknown>> = [];
  const stateTokenUpdates: string[] = [];
  const callOrder: string[] = [];
  const scheduleCalls: Array<{
    payload: {
      profile_id: string;
      session_id: string;
      step_id: "onboarding_message_1";
      expected_state_token: string;
      idempotency_key: string;
    };
    delayMs: number;
  }> = [];

  let sidClaimed = false;

  const supabase = {
    from(table: string) {
      const query = {
        select() { return query; },
        eq() { return query; },
        is() { return query; },
        neq() { return query; },
        maybeSingle: async () => {
          if (table === "conversation_sessions") {
            if (sidClaimed) {
              return { data: { id: "ses_123" }, error: null };
            }
            return {
              data: {
                id: "ses_123",
                mode: "interviewing",
                state_token: persistedStateToken,
                current_step_id: null,
                last_inbound_message_sid: null,
              },
              error: null,
            };
          }
          if (table === "profiles") {
            return { data: { id: "profile_123", user_id: "usr_123" }, error: null };
          }
          if (table === "users") {
            return { data: { first_name: "Alex", phone_e164: "+15555550999" }, error: null };
          }
          if (table === "conversation_events") {
            return { data: null, error: null };
          }
          if (table === "sms_outbound_jobs") {
            return { data: null, error: null };
          }
          return { data: null, error: null };
        },
        update(payload: Record<string, unknown>) {
          if (table === "conversation_sessions" && payload.last_inbound_message_sid && !payload.state_token) {
            sidClaimed = true;
          }
          if (table === "conversation_sessions" && payload.state_token) {
            stateTokenUpdates.push(String(payload.state_token));
            callOrder.push(`persist:${String(payload.state_token)}`);
          }
          const updateQuery = {
            eq() { return updateQuery; },
            is() { return updateQuery; },
            neq() { return updateQuery; },
            select() { return updateQuery; },
            maybeSingle: async () => {
              if (table === "conversation_sessions") {
                return { data: { id: "ses_123" }, error: null };
              }
              return { error: null };
            },
          };
          return updateQuery;
        },
        insert(payload: Record<string, unknown>) {
          if (table === "sms_outbound_jobs") {
            insertedJobRows.push(payload);
          }
          if (table === "conversation_events") {
            insertedConversationEvents.push(payload);
          }
          return Promise.resolve({ error: null });
        },
      };
      return query;
    },
    rpc: async (fn: string) => {
      if (fn === "encrypt_sms_body") {
        return { data: "ciphertext", error: null };
      }
      throw new Error(`Unexpected rpc call: ${fn}`);
    },
  };

  try {
    const result = await runOnboardingEngine(
      {
        supabase,
        decision: {
          user_id: "usr_123",
          state: {
            mode: "interviewing",
            state_token: routedStateToken,
          },
          profile_is_complete_mvp: false,
          route: "onboarding_engine",
          safety_override_applied: false,
          next_transition: nextTransition,
        },
        payload: {
          inbound_message_id: "msg_123",
          inbound_message_sid: "SM_EXPLAIN_2",
          from_e164: "+15555550111",
          to_e164: "+15555550222",
          body_raw: bodyRaw,
          body_normalized: bodyNormalized,
        },
      },
      {
        scheduleOnboardingStep: async (payload, delayMs) => {
          callOrder.push(`schedule:${String(payload.step_id)}`);
          scheduleCalls.push({
            payload: payload as {
              profile_id: string;
              session_id: string;
              step_id: "onboarding_message_1";
              expected_state_token: string;
              idempotency_key: string;
            },
            delayMs,
          });
        },
      },
    );

    expect(result.engine).toBe("onboarding_engine");
    expect(result.reply_message).toBeNull();

    return {
      scheduleCalls,
      insertedJobRows,
      insertedConversationEvents,
      stateTokenUpdates,
      callOrder,
    };
  } finally {
    if (previousDeno === undefined) {
      delete (globalThis as { Deno?: unknown }).Deno;
    } else {
      (globalThis as { Deno?: unknown }).Deno = previousDeno;
    }
  }
}
