import { describe, expect, it } from "vitest";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { runOnboardingEngine } from "../../supabase/functions/_shared/engines/onboarding-engine";

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
