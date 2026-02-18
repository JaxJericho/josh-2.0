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

  it("routes onboarding interviewing tokens before interview-token handling", () => {
    const state = validateConversationState(
      "interviewing",
      "onboarding:awaiting_opening_response",
    );
    const route = resolveRouteForState(state);
    const nextTransition = resolveNextTransition(state, route);

    expect(route).toBe("onboarding_engine");
    expect(nextTransition).toBe("onboarding:awaiting_opening_response");
  });

  it("throws explicit error when state token is missing", () => {
    expect(() => validateConversationState("idle", ""))
      .toThrow(ConversationRouterError);
  });

  it("throws explicit error when mode is invalid", () => {
    expect(() => validateConversationState("unknown_mode", "idle"))
      .toThrow(ConversationRouterError);
  });

  it("throws explicit error for unknown onboarding state tokens", () => {
    expect(() => validateConversationState("interviewing", "onboarding:foo"))
      .toThrow(ConversationRouterError);
  });

  it("throws explicit error on illegal transition attempts", () => {
    const state = validateConversationState("idle", "idle");

    expect(() => resolveNextTransition(state, "profile_interview_engine"))
      .toThrow(ConversationRouterError);
  });

  it("routes idle users with incomplete profile into interview engine", async () => {
    const supabase = buildSupabaseMock({
      user: { id: "usr_123" },
      session: { id: "ses_123", mode: "idle", state_token: "idle" },
      profile: { is_complete_mvp: false, state: "partial" },
    });

    const decision = await routeConversationMessage({
      supabase,
      payload: samplePayload(),
    });

    expect(decision.route).toBe("onboarding_engine");
    expect(decision.state.mode).toBe("interviewing");
    expect(decision.state.state_token).toBe("onboarding:awaiting_opening_response");
    expect(decision.next_transition).toBe("onboarding:awaiting_opening_response");
  });

  it("creates default session when conversation state is missing", async () => {
    const supabase = buildSupabaseMock({
      user: { id: "usr_123" },
      session: null,
      profile: null,
    });

    const decision = await routeConversationMessage({
      supabase,
      payload: samplePayload(),
    });

    expect(decision.state.mode).toBe("interviewing");
    expect(decision.state.state_token).toBe("onboarding:awaiting_opening_response");
    expect(decision.route).toBe("onboarding_engine");
  });

  it("dispatches deterministic default engine response", async () => {
    const decision = sampleDecision("default_engine");
    const result = await dispatchConversationRoute({
      supabase: buildSupabaseMock({ user: null, session: null, profile: null }),
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
    profile_is_complete_mvp: null,
    route,
    safety_override_applied: false,
    next_transition: "idle:awaiting_user_input",
  };
}

function buildSupabaseMock(
  data: {
    user: { id: string } | null;
    session: { id: string; mode: string | null; state_token: string | null } | null;
    profile: { is_complete_mvp: boolean; state: string | null } | null;
  },
) {
  const state = {
    user: data.user,
    session: data.session,
    profile: data.profile,
  };

  return {
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
          if (table === "users") {
            return { data: state.user, error: null };
          }
          if (table === "conversation_sessions") {
            return { data: state.session, error: null };
          }
          if (table === "profiles") {
            return { data: state.profile, error: null };
          }
          return { data: null, error: null };
        },
        async single() {
          let sessionRow = state.session;
          if (table === "conversation_sessions" && sessionRow) {
            if (queryState.id && queryState.id !== sessionRow.id) {
              return { data: null, error: null };
            }
            if (queryState.mode && queryState.mode !== sessionRow.mode) {
              return { data: null, error: null };
            }
            const pendingUpdate = queryState.pending_update as
              | { mode: string; state_token: string }
              | undefined;
            if (pendingUpdate) {
              state.session = {
                ...sessionRow,
                mode: pendingUpdate.mode,
                state_token: pendingUpdate.state_token,
              };
              sessionRow = state.session;
            }
            return {
              data: {
                id: sessionRow.id,
                mode: sessionRow.mode,
                state_token: sessionRow.state_token,
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
      };

      return {
        insert(payload: {
          user_id: string;
          mode: string;
          state_token: string;
        }) {
          if (table === "conversation_sessions") {
            state.session = {
              id: "ses_new",
              mode: payload.mode,
              state_token: payload.state_token,
            };
          }
          return query;
        },
        update(payload: {
          mode: string;
          state_token: string;
        }) {
          queryState.pending_update = payload;
          return query;
        },
        select: query.select,
      };
    },
  };
}
