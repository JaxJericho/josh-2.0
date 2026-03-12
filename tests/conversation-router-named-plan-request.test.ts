import { describe, expect, it } from "vitest";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  dispatchConversationRoute,
  type NormalizedInboundMessagePayload,
} from "../supabase/functions/_shared/router/conversation-router";

const UNKNOWN_INTENT_REPLY = "I didn't catch that. Reply HELP if you need support.";

describe("conversation router named plan request flow", () => {
  it("returns the neutral fallback for retired named-plan intents", async () => {
    const supabase = buildConversationSessionSupabaseMock({
      mode: "idle",
      stateToken: "idle",
    });

    const result = await dispatchConversationRoute({
      supabase,
      decision: {
        user_id: "usr_123",
        state: {
          mode: "idle",
          state_token: "idle",
        },
        profile_is_complete_mvp: true,
        route: "named_plan_request_handler",
        safety_override_applied: false,
        next_transition: "idle:awaiting_user_input",
      },
      payload: samplePayload(),
    });

    expect(result.engine).toBe("named_plan_request_handler");
    expect(result.reply_message).toBe(UNKNOWN_INTENT_REPLY);
    expect(supabase.debugState().session).toMatchObject({
      mode: "idle",
      state_token: "idle",
    });
  });

  it("preserves pending contact invite confirmation cancellation", async () => {
    const supabase = buildConversationSessionSupabaseMock({
      mode: "pending_contact_invite_confirmation",
      stateToken: "invite_confirm:create:v1:KzE0MTU1NTUwMTIz:VGF5bG9y",
    });

    const result = await dispatchConversationRoute({
      supabase,
      decision: {
        user_id: "usr_123",
        state: {
          mode: "pending_contact_invite_confirmation",
          state_token: "invite_confirm:create:v1:KzE0MTU1NTUwMTIz:VGF5bG9y",
        },
        profile_is_complete_mvp: true,
        route: "named_plan_request_handler",
        safety_override_applied: false,
        next_transition: "invite_confirm:create:v1:KzE0MTU1NTUwMTIz:VGF5bG9y",
      },
      payload: samplePayload({
        body_raw: "no",
        body_normalized: "NO",
      }),
    });

    expect(result.engine).toBe("named_plan_request_handler");
    expect(result.reply_message).toBe("Okay - I will not queue that invite.");
    expect(supabase.debugState().session).toMatchObject({
      mode: "idle",
      state_token: "idle",
    });
  });
});

function samplePayload(
  overrides: Partial<NormalizedInboundMessagePayload> = {},
): NormalizedInboundMessagePayload {
  return {
    inbound_message_id: "msg_123",
    inbound_message_sid: "SM123",
    from_e164: "+15555550111",
    to_e164: "+15555550222",
    body_raw: "hello",
    body_normalized: "HELLO",
    ...overrides,
  };
}

function buildConversationSessionSupabaseMock(input: {
  mode: string;
  stateToken: string;
}) {
  const state = {
    session: {
      id: "ses_123",
      mode: input.mode,
      state_token: input.stateToken,
      linkup_id: null as string | null,
    },
  };

  return {
    from(table: string) {
      if (table !== "conversation_sessions") {
        throw new Error(`Unexpected table '${table}' in named-plan router test.`);
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
