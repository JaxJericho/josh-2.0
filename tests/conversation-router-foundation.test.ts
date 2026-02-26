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

  it("accepts post_event reflection as a legal transition token", () => {
    const state = validateConversationState("post_event", "post_event:reflection");
    const route = resolveRouteForState(state);
    const nextTransition = resolveNextTransition(state, route);

    expect(route).toBe("post_event_engine");
    expect(nextTransition).toBe("post_event:reflection");
  });

  it("accepts post_event finalized as a legal transition token", () => {
    const state = validateConversationState("post_event", "post_event:finalized");
    const route = resolveRouteForState(state);
    const nextTransition = resolveNextTransition(state, route);

    expect(route).toBe("post_event_engine");
    expect(nextTransition).toBe("post_event:finalized");
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

  it("throws explicit error for unknown post-event state tokens", () => {
    expect(() => validateConversationState("post_event", "post_event:do_again"))
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
      supabase: buildSupabaseMock({
        user: { id: "usr_123" },
        session: {
          id: "ses_123",
          mode: "post_event",
          state_token: "post_event:attendance",
          linkup_id: "lnk_123",
        },
        profile: { is_complete_mvp: true, state: "complete_mvp" },
      }),
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
    expect(result.reply_message).toContain("Quick reflection");
  });

  it("dispatches post_event complete-state do-again capture through post-event engine", async () => {
    const supabase = buildSupabaseMock({
      user: { id: "usr_123" },
      session: {
        id: "ses_123",
        mode: "post_event",
        state_token: "post_event:complete",
        linkup_id: "lnk_123",
      },
      profile: { is_complete_mvp: true, state: "complete_mvp" },
    });

    const result = await dispatchConversationRoute({
      supabase,
      decision: {
        user_id: "usr_123",
        state: {
          mode: "post_event",
          state_token: "post_event:complete",
        },
        profile_is_complete_mvp: true,
        route: "post_event_engine",
        safety_override_applied: false,
        next_transition: "post_event:complete",
      },
      payload: {
        ...samplePayload(),
        inbound_message_id: "00000000-0000-0000-0000-000000000123",
        inbound_message_sid: "SM_DO_AGAIN_ROUTER_1",
        body_raw: "A",
        body_normalized: "A",
      },
    });

    expect(result.engine).toBe("post_event_engine");
    expect(result.reply_message).toContain("Post-event follow-up is complete");
    expect(supabase.debugState().postEventDoAgainWrites).toBe(1);
    expect(supabase.debugState().postEventLearningWrites).toBe(1);
    expect(supabase.debugState().session?.state_token).toBe("post_event:finalized");
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
    postEventAttendanceWrites: 0,
    postEventDoAgainWrites: 0,
    postEventLearningWrites: 0,
    attendanceResult: "attended",
    doAgainDecision: null as "yes" | "no" | "unsure" | null,
    processedAttendanceSids: new Set<string>(),
    processedDoAgainSids: new Set<string>(),
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
      if (fn === "capture_post_event_attendance") {
        const inboundMessageSid = typeof args?.p_inbound_message_sid === "string"
          ? args.p_inbound_message_sid
          : "";
        const correlationId = typeof args?.p_correlation_id === "string"
          ? args.p_correlation_id
          : null;
        const attendanceResult = typeof args?.p_attendance_result === "string"
          ? args.p_attendance_result
          : "unclear";
        if (!state.session) {
          return {
            data: null,
            error: new Error("Session not found for post-event attendance capture."),
          };
        }
        if (!inboundMessageSid) {
          return {
            data: null,
            error: new Error("Missing inbound message sid."),
          };
        }
        if (state.processedAttendanceSids.has(inboundMessageSid)) {
          return {
            data: [{
              previous_state_token: state.session.state_token,
              next_state_token: state.session.state_token,
              reason: "duplicate_replay",
              duplicate: true,
              linkup_id: state.session.linkup_id,
              correlation_id: correlationId,
              attendance_result: attendanceResult,
              mode: state.session.mode,
            }],
            error: null,
          };
        }
        if (state.session.state_token !== "post_event:attendance") {
          return {
            data: [{
              previous_state_token: state.session.state_token,
              next_state_token: state.session.state_token,
              reason: "state_not_attendance",
              duplicate: false,
              linkup_id: state.session.linkup_id,
              correlation_id: correlationId,
              attendance_result: attendanceResult,
              mode: state.session.mode,
            }],
            error: null,
          };
        }

        state.postEventAttendanceWrites += 1;
        state.processedAttendanceSids.add(inboundMessageSid);
        state.attendanceResult = attendanceResult;
        state.session = {
          ...state.session,
          state_token: "post_event:reflection",
        };

        return {
          data: [{
            previous_state_token: "post_event:attendance",
            next_state_token: "post_event:reflection",
            reason: "captured",
            duplicate: false,
            linkup_id: state.session.linkup_id,
            correlation_id: correlationId,
            attendance_result: attendanceResult,
            mode: state.session.mode,
          }],
          error: null,
        };
      }

      if (fn === "capture_post_event_do_again") {
        const inboundMessageSid = typeof args?.p_inbound_message_sid === "string"
          ? args.p_inbound_message_sid
          : "";
        const correlationId = typeof args?.p_correlation_id === "string"
          ? args.p_correlation_id
          : null;
        const doAgainRaw = typeof args?.p_do_again === "string"
          ? args.p_do_again
          : "";
        const doAgainDecision =
          doAgainRaw === "yes" || doAgainRaw === "no" || doAgainRaw === "unsure"
            ? doAgainRaw
            : null;

        if (!state.session) {
          return {
            data: null,
            error: new Error("Session not found for post-event do-again capture."),
          };
        }
        if (!inboundMessageSid) {
          return {
            data: null,
            error: new Error("Missing inbound message sid."),
          };
        }
        if (!doAgainDecision) {
          return {
            data: null,
            error: new Error("Invalid do-again decision."),
          };
        }
        if (state.processedDoAgainSids.has(inboundMessageSid)) {
          return {
            data: [{
              previous_state_token: state.session.state_token,
              next_state_token: state.session.state_token,
              attendance_result: state.attendanceResult,
              do_again: state.doAgainDecision ?? doAgainDecision,
              learning_signal_written: false,
              duplicate: true,
              reason: "duplicate_replay",
              correlation_id: correlationId,
              linkup_id: state.session.linkup_id,
              mode: state.session.mode,
            }],
            error: null,
          };
        }
        if (state.session.state_token !== "post_event:complete") {
          return {
            data: [{
              previous_state_token: state.session.state_token,
              next_state_token: state.session.state_token,
              attendance_result: state.attendanceResult,
              do_again: doAgainDecision,
              learning_signal_written: false,
              duplicate: false,
              reason: "state_not_complete",
              correlation_id: correlationId,
              linkup_id: state.session.linkup_id,
              mode: state.session.mode,
            }],
            error: null,
          };
        }

        state.postEventDoAgainWrites += 1;
        state.postEventLearningWrites += 1;
        state.doAgainDecision = doAgainDecision;
        state.processedDoAgainSids.add(inboundMessageSid);
        state.session = {
          ...state.session,
          state_token: "post_event:finalized",
        };

        return {
          data: [{
            previous_state_token: "post_event:complete",
            next_state_token: "post_event:finalized",
            attendance_result: state.attendanceResult,
            do_again: doAgainDecision,
            learning_signal_written: true,
            duplicate: false,
            reason: "captured",
            correlation_id: correlationId,
            linkup_id: state.session.linkup_id,
            mode: state.session.mode,
          }],
          error: null,
        };
      }

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
