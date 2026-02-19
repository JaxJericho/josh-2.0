import { describe, expect, it } from "vitest";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  buildScheduledOnboardingJobInputs,
  resolveOnboardingStateForInbound,
  runOnboardingEngine,
} from "../../supabase/functions/_shared/engines/onboarding-engine";
import {
  ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
  handleOnboardingInbound,
} from "../../packages/core/src/onboarding/onboarding-engine";

describe("onboarding engine runtime idempotency", () => {
  it("does not re-advance or resend when inbound MessageSid is replayed", async () => {
    const replaySid = "SM_ONBOARDING_REPLAY_1";
    const supabase = {
      from(table: string) {
        const queryState: Record<string, unknown> = {};
        const query = {
          select() {
            return query;
          },
          eq(column: string, value: unknown) {
            queryState[column] = value;
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
  it("prefers routed onboarding token when persisted state drifts", () => {
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

describe("onboarding outbound job scheduling", () => {
  it("builds staggered future run_at timestamps and stable step idempotency keys", () => {
    const outboundPlan = handleOnboardingInbound({
      stateToken: ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
      inputText: "yes",
    }).outboundPlan;

    const jobs = buildScheduledOnboardingJobInputs({
      userId: "usr_123",
      inboundMessageSid: "SM_EXPLAIN_1",
      outboundPlan,
      baseTimestampMs: Date.parse("2026-02-19T00:00:00.000Z"),
    });

    expect(jobs).toHaveLength(4);
    expect(jobs.map((job) => job.messageKey)).toEqual([
      "onboarding_message_1",
      "onboarding_message_2",
      "onboarding_message_3",
      "onboarding_message_4",
    ]);
    expect(jobs.map((job) => job.runAtIso)).toEqual([
      "2026-02-19T00:00:00.000Z",
      "2026-02-19T00:00:08.000Z",
      "2026-02-19T00:00:16.000Z",
      "2026-02-19T00:00:24.000Z",
    ]);
    expect(jobs.map((job) => job.idempotencyKey)).toEqual([
      "onboarding:onboarding_message_1:usr_123:SM_EXPLAIN_1",
      "onboarding:onboarding_message_2:usr_123:SM_EXPLAIN_1",
      "onboarding:onboarding_message_3:usr_123:SM_EXPLAIN_1",
      "onboarding:onboarding_message_4:usr_123:SM_EXPLAIN_1",
    ]);
  });

  it("treats duplicate outbound-job inserts as idempotent during explanation enqueue", async () => {
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

    const insertedJobRows: Array<Record<string, unknown>> = [];
    const supabase = {
      from(table: string) {
        const state: Record<string, unknown> = {};
        const query = {
          select() {
            return query;
          },
          eq(column: string, value: unknown) {
            state[column] = value;
            return query;
          },
          maybeSingle: async () => {
            if (table === "conversation_sessions") {
              return {
                data: {
                  id: "ses_123",
                  mode: "interviewing",
                  state_token: "onboarding:awaiting_explanation_response",
                  current_step_id: null,
                  last_inbound_message_sid: null,
                },
                error: null,
              };
            }
            if (table === "profiles") {
              return { data: null, error: null };
            }
            if (table === "users") {
              return {
                data: {
                  first_name: "Alex",
                  phone_e164: "+15555550999",
                },
                error: null,
              };
            }
            if (table === "conversation_events") {
              return { data: null, error: null };
            }
            return { data: null, error: null };
          },
          update(payload: Record<string, unknown>) {
            return {
              eq: async () => {
                if (table === "conversation_sessions") {
                  expect(payload.state_token).toBe("onboarding:awaiting_interview_start");
                }
                return { error: null };
              },
              neq: async () => ({ error: null }),
            };
          },
          insert(payload: Record<string, unknown>) {
            if (table === "sms_outbound_jobs") {
              insertedJobRows.push(payload);
              const isSecond = insertedJobRows.length === 2;
              return Promise.resolve({
                error: isSecond
                  ? { code: "23505", message: "duplicate key value violates unique constraint" }
                  : null,
              });
            }
            if (table === "conversation_events") {
              return Promise.resolve({ error: null });
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
      const result = await runOnboardingEngine({
        supabase,
        decision: {
          user_id: "usr_123",
          state: {
            mode: "interviewing",
            state_token: "onboarding:awaiting_explanation_response",
          },
          profile_is_complete_mvp: false,
          route: "onboarding_engine",
          safety_override_applied: false,
          next_transition: "onboarding:awaiting_explanation_response",
        },
        payload: {
          inbound_message_id: "msg_123",
          inbound_message_sid: "SM_EXPLAIN_2",
          from_e164: "+15555550111",
          to_e164: "+15555550222",
          body_raw: "yes",
          body_normalized: "YES",
        },
      });

      expect(result.engine).toBe("onboarding_engine");
      expect(result.reply_message).toBeNull();
      expect(insertedJobRows).toHaveLength(4);
      expect(insertedJobRows.map((row) => row.idempotency_key)).toEqual([
        "onboarding:onboarding_message_1:usr_123:SM_EXPLAIN_2",
        "onboarding:onboarding_message_2:usr_123:SM_EXPLAIN_2",
        "onboarding:onboarding_message_3:usr_123:SM_EXPLAIN_2",
        "onboarding:onboarding_message_4:usr_123:SM_EXPLAIN_2",
      ]);
      expect(insertedJobRows.every((row) => row.status === "pending")).toBe(true);
    } finally {
      if (previousDeno === undefined) {
        delete (globalThis as { Deno?: unknown }).Deno;
      } else {
        (globalThis as { Deno?: unknown }).Deno = previousDeno;
      }
    }
  });
});
