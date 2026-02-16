import { describe, expect, it } from "vitest";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  ConversationRouterError,
  dispatchConversationRoute,
  resolveNextTransition,
  resolveRouteForState,
  routeConversationMessage,
  validateConversationState,
  type NormalizedInboundMessagePayload,
  type RoutingDecision,
} from "../supabase/functions/_shared/router/conversation-router";

describe("conversation router foundation", () => {
  it("routes interviewing state to the profile interview engine deterministically", () => {
    const state = validateConversationState("interviewing", "interview:step_07");
    const route = resolveRouteForState(state);
    const nextTransition = resolveNextTransition(state, route);

    expect(route).toBe("profile_interview_engine");
    expect(nextTransition).toBe("interview:awaiting_next_input");
  });

  it("throws explicit error when state token is missing", () => {
    expect(() => validateConversationState("idle", ""))
      .toThrow(ConversationRouterError);
  });

  it("throws explicit error when mode is invalid", () => {
    expect(() => validateConversationState("unknown_mode", "idle"))
      .toThrow(ConversationRouterError);
  });

  it("throws explicit error on illegal transition attempts", () => {
    const state = validateConversationState("idle", "idle");

    expect(() => resolveNextTransition(state, "profile_interview_engine"))
      .toThrow(ConversationRouterError);
  });

  it("fails fast when conversation state is missing", async () => {
    const supabase = buildSupabaseMock({
      user: { id: "usr_123" },
      session: null,
    });

    await expect(
      routeConversationMessage({
        supabase,
        payload: samplePayload(),
      })
    ).rejects.toMatchObject({ code: "MISSING_STATE" });
  });

  it("dispatches deterministic default engine response", async () => {
    const decision = sampleDecision("default_engine");
    const result = await dispatchConversationRoute({
      decision,
      payload: samplePayload(),
    });

    expect(result.engine).toBe("default_engine");
    expect(result.reply_message).toContain("default engine selected");
  });
});

function samplePayload(): NormalizedInboundMessagePayload {
  return {
    inbound_message_id: "msg_123",
    inbound_message_sid: "SM123",
    from_e164: "+15555550111",
    to_e164: "+15555550222",
    body_raw: "hello",
    body_normalized: "HELLO",
  };
}

function sampleDecision(route: RoutingDecision["route"]): RoutingDecision {
  return {
    user_id: "usr_123",
    state: {
      mode: "idle",
      state_token: "idle",
    },
    route,
    safety_override_applied: false,
    next_transition: "idle:awaiting_user_input",
  };
}

function buildSupabaseMock(
  data: {
    user: { id: string } | null;
    session: { mode: string | null; state_token: string | null } | null;
  },
) {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  if (table === "users") {
                    return { data: data.user, error: null };
                  }
                  if (table === "conversation_sessions") {
                    return { data: data.session, error: null };
                  }
                  return { data: null, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}
