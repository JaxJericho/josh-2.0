import { describe, expect, it } from "vitest";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  ConversationRouterError,
  dispatchConversationRoute,
  resolveNextTransition,
  resolveRouteForState,
  routeConversationMessage,
  shouldHoldInboundForOnboardingBurst,
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

  it("accepts onboarding:awaiting_burst as a valid interviewing onboarding token", () => {
    const state = validateConversationState(
      "interviewing",
      "onboarding:awaiting_burst",
    );
    const route = resolveRouteForState(state);
    const nextTransition = resolveNextTransition(state, route);

    expect(route).toBe("onboarding_engine");
    expect(nextTransition).toBe("onboarding:awaiting_burst");
  });

  it("routes post_event state to the post-event engine deterministically", () => {
    const state = validateConversationState("post_event", "post_event:attendance");
    const route = resolveRouteForState(state);
    const nextTransition = resolveNextTransition(state, route);

    expect(route).toBe("post_event_engine");
    expect(nextTransition).toBe("post_event:attendance");
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

  it("transitions to post_event mode when linked linkup reaches completed", async () => {
    const supabase = buildSupabaseMock({
      user: { id: "usr_123" },
      session: {
        id: "ses_123",
        mode: "awaiting_invite_reply",
        state_token: "invite:awaiting_reply",
        linkup_id: "lnk_123",
      },
      profile: { is_complete_mvp: true, state: "complete_mvp" },
      linkupStates: { lnk_123: "completed" },
    });

    const decision = await routeConversationMessage({
      supabase,
      payload: samplePayload(),
    });

    expect(decision.state.mode).toBe("post_event");
    expect(decision.state.state_token).toBe("post_event:attendance");
    expect(decision.route).toBe("post_event_engine");
    expect(supabase.debugState().postEventTransitionWrites).toBe(1);
  });

  it("does not transition to post_event when linked linkup is not completed", async () => {
    const supabase = buildSupabaseMock({
      user: { id: "usr_123" },
      session: {
        id: "ses_123",
        mode: "awaiting_invite_reply",
        state_token: "invite:awaiting_reply",
        linkup_id: "lnk_123",
      },
      profile: { is_complete_mvp: true, state: "complete_mvp" },
      linkupStates: { lnk_123: "locked" },
    });

    const decision = await routeConversationMessage({
      supabase,
      payload: samplePayload(),
    });

    expect(decision.state.mode).toBe("awaiting_invite_reply");
    expect(decision.route).toBe("default_engine");
    expect(supabase.debugState().postEventTransitionWrites).toBe(0);
  });

  it("enforces idempotent transition writes when post_event transition is evaluated twice", async () => {
    const supabase = buildSupabaseMock({
      user: { id: "usr_123" },
      session: {
        id: "ses_123",
        mode: "awaiting_invite_reply",
        state_token: "invite:awaiting_reply",
        linkup_id: "lnk_123",
      },
      profile: { is_complete_mvp: true, state: "complete_mvp" },
      linkupStates: { lnk_123: "completed" },
    });

    const first = await routeConversationMessage({
      supabase,
      payload: samplePayload(),
    });
    const second = await routeConversationMessage({
      supabase,
      payload: samplePayload(),
    });

    expect(first.state.mode).toBe("post_event");
    expect(second.state.mode).toBe("post_event");
    expect(supabase.debugState().postEventTransitionWrites).toBe(1);
    expect(supabase.debugState().postEventTransitionCalls).toBe(2);
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

  it("dispatches deterministic post-event engine response", async () => {
    const result = await dispatchConversationRoute({
      supabase: buildSupabaseMock({ user: null, session: null, profile: null }),
      decision: {
        user_id: "usr_123",
        state: {
          mode: "post_event",
          state_token: "post_event:attendance",
        },
        profile_is_complete_mvp: true,
        route: "post_event_engine",
        safety_override_applied: false,
        next_transition: "post_event:attendance",
      },
      payload: samplePayload(),
    });

    expect(result.engine).toBe("post_event_engine");
    expect(result.reply_message).toContain("Post-event follow-up is initializing");
  });

  it("dispatches by normalized state route when decision route is stale", async () => {
    const decision = sampleDecision("profile_interview_engine");
    const result = await dispatchConversationRoute({
      supabase: buildSupabaseMock({ user: null, session: null, profile: null }),
      decision,
      payload: samplePayload(),
    });

    expect(result.engine).toBe("default_engine");
  });

  it("holds inbound during onboarding:awaiting_burst so it is not dispatched to interview engine", async () => {
    const result = await dispatchConversationRoute({
      supabase: {
        from() {
          throw new Error("hold path should not query Supabase");
        },
      },
      decision: {
        user_id: "usr_123",
        state: {
          mode: "interviewing",
          state_token: "onboarding:awaiting_burst",
        },
        profile_is_complete_mvp: false,
        route: "onboarding_engine",
        safety_override_applied: false,
        next_transition: "onboarding:awaiting_burst",
      },
      payload: {
        ...samplePayload(),
        body_raw: "hello?",
        body_normalized: "HELLO",
      },
    });

    expect(result.engine).toBe("onboarding_engine");
    expect(result.reply_message).toBeNull();
  });

  it("does not hold STOP while in onboarding:awaiting_burst so upstream STOP handler can take precedence", () => {
    const hold = shouldHoldInboundForOnboardingBurst({
      state: {
        mode: "interviewing",
        state_token: "onboarding:awaiting_burst",
      },
      payload: {
        ...samplePayload(),
        body_raw: "STOP",
        body_normalized: "STOP",
      },
    });

    expect(hold).toBe(false);
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
    session: {
      id: string;
      mode: string | null;
      state_token: string | null;
      linkup_id?: string | null;
    } | null;
    profile: { is_complete_mvp: boolean; state: string | null } | null;
    linkupStates?: Record<string, string>;
  },
) {
  const state = {
    user: data.user,
    session: data.session
      ? {
          ...data.session,
          linkup_id: data.session.linkup_id ?? null,
        }
      : null,
    profile: data.profile,
    linkupStates: data.linkupStates ?? {},
    postEventTransitionCalls: 0,
    postEventTransitionWrites: 0,
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
                linkup_id: sessionRow.linkup_id ?? null,
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
              linkup_id: null,
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
    async rpc(fn: string, args?: Record<string, unknown>) {
      if (fn !== "transition_session_to_post_event_if_linkup_completed") {
        return {
          data: null,
          error: new Error(`Unexpected rpc function '${fn}'.`),
        };
      }

      state.postEventTransitionCalls += 1;

      const sessionId = typeof args?.p_session_id === "string"
        ? args.p_session_id
        : "";
      if (!state.session || state.session.id !== sessionId) {
        return {
          data: null,
          error: new Error("Session not found for post-event transition."),
        };
      }

      const correlationId = typeof args?.p_correlation_id === "string"
        ? args.p_correlation_id
        : null;
      const linkupId = state.session.linkup_id;
      const linkupState = linkupId ? state.linkupStates[linkupId] ?? null : null;
      const previousMode = state.session.mode;
      const stateToken = state.session.state_token;
      const linkupCorrelationId = linkupId ? `corr_${linkupId}` : null;

      if (!linkupId) {
        return {
          data: [{
            transitioned: false,
            reason: "no_linkup",
            next_mode: previousMode,
            state_token: stateToken,
            linkup_id: null,
            linkup_state: null,
            correlation_id: correlationId,
            linkup_correlation_id: null,
          }],
          error: null,
        };
      }

      if (linkupState !== "completed") {
        return {
          data: [{
            transitioned: false,
            reason: "linkup_not_completed",
            next_mode: previousMode,
            state_token: stateToken,
            linkup_id: linkupId,
            linkup_state: linkupState,
            correlation_id: correlationId,
            linkup_correlation_id: linkupCorrelationId,
          }],
          error: null,
        };
      }

      if (previousMode === "post_event") {
        return {
          data: [{
            transitioned: false,
            reason: "already_post_event",
            next_mode: previousMode,
            state_token: stateToken,
            linkup_id: linkupId,
            linkup_state: linkupState,
            correlation_id: correlationId,
            linkup_correlation_id: linkupCorrelationId,
          }],
          error: null,
        };
      }

      if (
        previousMode !== "idle" &&
        previousMode !== "linkup_forming" &&
        previousMode !== "awaiting_invite_reply"
      ) {
        return {
          data: [{
            transitioned: false,
            reason: "mode_protected",
            next_mode: previousMode,
            state_token: stateToken,
            linkup_id: linkupId,
            linkup_state: linkupState,
            correlation_id: correlationId,
            linkup_correlation_id: linkupCorrelationId,
          }],
          error: null,
        };
      }

      state.session = {
        ...state.session,
        mode: "post_event",
        state_token: "post_event:attendance",
      };
      state.postEventTransitionWrites += 1;

      return {
        data: [{
          transitioned: true,
          reason: "transitioned",
          next_mode: "post_event",
          state_token: "post_event:attendance",
          linkup_id: linkupId,
          linkup_state: linkupState,
          correlation_id: correlationId,
          linkup_correlation_id: linkupCorrelationId,
        }],
        error: null,
      };
    },
    debugState() {
      return {
        ...state,
      };
    },
  };
}
