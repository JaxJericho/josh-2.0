import { describe, expect, it } from "vitest";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  dispatchConversationRoute,
  type NormalizedInboundMessagePayload,
} from "../supabase/functions/_shared/router/conversation-router";

const UNKNOWN_INTENT_REPLY = "I didn't catch that. Reply HELP if you need support.";

describe("conversation router plan social choice dispatch", () => {
  it("resets orphaned social-choice sessions to idle with a neutral reply", async () => {
    const supabase = buildPlanSocialChoiceSupabaseMock();

    const result = await dispatchConversationRoute({
      supabase,
      decision: {
        user_id: "usr_123",
        state: {
          mode: "awaiting_social_choice",
          state_token: "social:awaiting_choice:solo_walk:0",
        },
        profile_is_complete_mvp: true,
        route: "plan_social_choice_handler",
        safety_override_applied: false,
        next_transition: "social:awaiting_choice",
      },
      payload: samplePayload(),
    });

    expect(result.engine).toBe("plan_social_choice_handler");
    expect(result.reply_message).toBe(UNKNOWN_INTENT_REPLY);
    expect(supabase.debugState().session).toMatchObject({
      mode: "idle",
      state_token: "idle",
    });
  });
});

function samplePayload(): NormalizedInboundMessagePayload {
  return {
    inbound_message_id: "msg_456",
    inbound_message_sid: "SM456",
    from_e164: "+15555550111",
    to_e164: "+15555550222",
    body_raw: "yes",
    body_normalized: "YES",
  };
}

function buildPlanSocialChoiceSupabaseMock() {
  const state = {
    session: {
      id: "ses_123",
      mode: "awaiting_social_choice",
      state_token: "social:awaiting_choice:solo_walk:0",
      linkup_id: null as string | null,
    },
  };

  return {
    from(table: string) {
      if (table !== "conversation_sessions") {
        throw new Error(`Unexpected table '${table}' in plan social choice test.`);
      }

      const queryState: Record<string, unknown> = {};

      return {
        select() {
          return this;
        },
        eq(column: string, value: unknown) {
          queryState[column] = value;
          return this;
        },
        async maybeSingle() {
          if (queryState.user_id !== "usr_123") {
            return { data: null, error: null };
          }
          return {
            data: { ...state.session },
            error: null,
          };
        },
        update(payload: Record<string, unknown>) {
          return {
            eq(column: string, value: unknown) {
              return {
                select() {
                  return {
                    async single() {
                      if (column !== "id" || value !== state.session.id) {
                        return {
                          data: null,
                          error: { message: "session_not_found" },
                        };
                      }

                      state.session = {
                        ...state.session,
                        mode: payload.mode as string,
                        state_token: payload.state_token as string,
                      };

                      return {
                        data: { id: state.session.id },
                        error: null,
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    debugState() {
      return {
        session: { ...state.session },
      };
    },
  };
}
