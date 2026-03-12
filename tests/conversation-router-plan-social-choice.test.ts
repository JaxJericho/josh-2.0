import { describe, expect, it } from "vitest";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  dispatchConversationRoute,
  type NormalizedInboundMessagePayload,
} from "../supabase/functions/_shared/router/conversation-router";

describe("conversation router plan social choice dispatch", () => {
  it("handles social-choice acceptance and persists session/audit updates", async () => {
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
    expect(result.reply_message).toBe(
      "Great choice. I confirmed that plan and will follow up with next steps shortly.",
    );

    const state = supabase.debugState();
    expect(state.session.mode).toBe("pending_plan_confirmation");
    expect(state.session.state_token).toBe("plan:pending_confirmation");
    expect(state.auditLogs).toHaveLength(1);
    expect(state.auditLogs[0]).toMatchObject({
      action: "social_choice_accepted_plan_confirmed",
      target_type: "plan_brief",
      target_id: "synthetic_plan:usr_123:SM456",
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
    auditLogs: [] as Array<Record<string, unknown>>,
  };

  return {
    from(table: string) {
      if (table === "conversation_sessions") {
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
      }

      if (table === "profiles") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            return {
              data: null,
              error: null,
            };
          },
        };
      }

      if (table === "audit_log") {
        return {
          async insert(payload: Record<string, unknown>) {
            state.auditLogs.push(payload);
            return {
              data: null,
              error: null,
            };
          },
        };
      }

      throw new Error(`Unexpected table '${table}' in plan social choice test.`);
    },
    debugState() {
      return {
        session: { ...state.session },
        auditLogs: [...state.auditLogs],
      };
    },
  };
}
