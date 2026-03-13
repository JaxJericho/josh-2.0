import { beforeEach, describe, expect, it, vi } from "vitest";

const { handleFreeformInboundMock } = vi.hoisted(() => ({
  handleFreeformInboundMock: vi.fn(),
}));

vi.mock("../packages/messaging/src/handlers/handle-freeform-inbound.ts", () => ({
  handleFreeformInbound: handleFreeformInboundMock,
}));

// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  dispatchConversationRoute,
  type NormalizedInboundMessagePayload,
} from "../supabase/functions/_shared/router/conversation-router";
import { SOLO_CHECKIN_DO_AGAIN_PROMPT } from "../packages/core/src/messages";

describe("conversation router freeform inbound", () => {
  beforeEach(() => {
    handleFreeformInboundMock.mockReset();
  });

  it("writes availability_expressed and keeps the session idle", async () => {
    handleFreeformInboundMock.mockResolvedValue({
      kind: "availability_signal",
      summary: "User is free this weekend.",
      replyMessage: "Good to know — JOSH will factor that in. Look out for something soon.",
      nextMode: "idle",
      nextStateToken: "idle",
    });
    const supabase = buildFreeformSupabaseMock();

    const result = await dispatchConversationRoute({
      supabase,
      decision: buildDecision(),
      payload: samplePayload("I'm free this weekend."),
    });

    expect(result).toEqual({
      engine: "freeform_inbound_handler",
      reply_message: "Good to know — JOSH will factor that in. Look out for something soon.",
    });
    expect(supabase.debugState().learningSignals).toHaveLength(1);
    expect(supabase.debugState().learningSignals[0]).toMatchObject({
      user_id: "usr_123",
      signal_type: "availability_expressed",
      value_text: "User is free this weekend.",
    });
    expect(supabase.debugState().session).toMatchObject({
      mode: "idle",
      state_token: "idle",
    });
  });

  it("routes post-event signals into post-activity checkin when a recent accepted invitation exists", async () => {
    handleFreeformInboundMock.mockResolvedValue({
      kind: "post_event_signal",
      summary: "User said the event went well.",
    });
    const supabase = buildFreeformSupabaseMock({
      invitations: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          activity_key: "coffee_walk",
          responded_at: "2026-03-10T17:00:00.000Z",
          state: "accepted",
          user_id: "usr_123",
        },
      ],
    });

    const result = await dispatchConversationRoute({
      supabase,
      decision: buildDecision(),
      payload: samplePayload("had a great time last night"),
    });

    expect(result).toEqual({
      engine: "freeform_inbound_handler",
      reply_message: SOLO_CHECKIN_DO_AGAIN_PROMPT,
    });
    expect(supabase.debugState().learningSignals[0]).toMatchObject({
      signal_type: "solo_activity_attended",
      subject_id: "11111111-1111-1111-1111-111111111111",
    });
    expect(supabase.debugState().session).toMatchObject({
      mode: "post_activity_checkin",
      state_token: "checkin:awaiting_do_again:11111111-1111-1111-1111-111111111111",
    });
  });

  it("falls back to the general reply when no recent accepted invitation exists", async () => {
    handleFreeformInboundMock.mockResolvedValue({
      kind: "post_event_signal",
      summary: "User mentioned a recent outing.",
    });
    const supabase = buildFreeformSupabaseMock();

    const result = await dispatchConversationRoute({
      supabase,
      decision: buildDecision(),
      payload: samplePayload("that was fun"),
    });

    expect(result).toEqual({
      engine: "freeform_inbound_handler",
      reply_message:
        "JOSH handles plans and invitations over text — no app needed. JOSH will be in touch with something tailored to you. Reply HELP for options.",
    });
    expect(supabase.debugState().learningSignals).toHaveLength(0);
    expect(supabase.debugState().session).toMatchObject({
      mode: "idle",
      state_token: "idle",
    });
  });

  it("writes profile updates and profile events for preference updates", async () => {
    handleFreeformInboundMock.mockResolvedValue({
      kind: "preference_update",
      summary: "User opted out of hiking.",
      replyMessage: "Noted — JOSH will keep that in mind.",
      nextMode: "idle",
      nextStateToken: "idle",
      profilePatch: {
        state: "complete_mvp",
        is_complete_mvp: true,
        country_code: "US",
        state_code: "CA",
        last_interview_step: "group_01",
        preferences: {
          group_size_pref: "2-3",
        },
        coordination_dimensions: {},
        activity_patterns: [],
        boundaries: {
          no_thanks: ["hiking"],
        },
        active_intent: null,
        scheduling_availability: null,
        notice_preference: null,
        coordination_style: null,
        completeness_percent: 100,
        completed_at: "2026-03-12T18:00:00.000Z",
        status_reason: "interview_complete_mvp",
        state_changed_at: "2026-03-12T18:00:00.000Z",
      },
      profileEvent: {
        eventType: "freeform_preference_updated",
        payload: {
          summary: "User opted out of hiking.",
          boundaries_patch: {
            no_thanks: ["hiking"],
          },
          preferences_patch: {
            group_size_pref: "2-3",
          },
        },
      },
    });
    const supabase = buildFreeformSupabaseMock();

    const result = await dispatchConversationRoute({
      supabase,
      decision: buildDecision(),
      payload: samplePayload("stop sending hiking stuff"),
    });

    expect(result).toEqual({
      engine: "freeform_inbound_handler",
      reply_message: "Noted — JOSH will keep that in mind.",
    });
    expect(supabase.debugState().profile.preferences).toEqual({
      group_size_pref: "2-3",
    });
    expect(supabase.debugState().profile.boundaries).toEqual({
      no_thanks: ["hiking"],
    });
    expect(supabase.debugState().profileEvents).toHaveLength(1);
    expect(supabase.debugState().profileEvents[0]).toMatchObject({
      event_type: "freeform_preference_updated",
      source: "handle_freeform_inbound_handler",
    });
  });

  it("returns the general reply and stays idle for general freeform", async () => {
    handleFreeformInboundMock.mockResolvedValue({
      kind: "general_freeform",
      summary: "User sent a general freeform message.",
      replyMessage:
        "JOSH handles plans and invitations over text — no app needed. JOSH will be in touch with something tailored to you. Reply HELP for options.",
      nextMode: "idle",
      nextStateToken: "idle",
    });
    const supabase = buildFreeformSupabaseMock();

    const result = await dispatchConversationRoute({
      supabase,
      decision: buildDecision(),
      payload: samplePayload("hello"),
    });

    expect(result).toEqual({
      engine: "freeform_inbound_handler",
      reply_message:
        "JOSH handles plans and invitations over text — no app needed. JOSH will be in touch with something tailored to you. Reply HELP for options.",
    });
    expect(supabase.debugState().session).toMatchObject({
      mode: "idle",
      state_token: "idle",
    });
  });
});

function buildDecision() {
  return {
    user_id: "usr_123",
    state: {
      mode: "idle" as const,
      state_token: "idle",
    },
    profile_is_complete_mvp: true,
    route: "freeform_inbound_handler" as const,
    safety_override_applied: false,
    next_transition: "idle:awaiting_user_input",
  };
}

function samplePayload(bodyRaw: string): NormalizedInboundMessagePayload {
  return {
    inbound_message_id: "msg_123",
    inbound_message_sid: "SM123",
    from_e164: "+15555550111",
    to_e164: "+15555550222",
    body_raw: bodyRaw,
    body_normalized: bodyRaw.toUpperCase(),
  };
}

function buildFreeformSupabaseMock(input?: {
  invitations?: Array<{
    id: string;
    activity_key: string;
    responded_at: string | null;
    state: string;
    user_id: string;
  }>;
}) {
  const state = {
    session: {
      id: "ses_123",
      user_id: "usr_123",
      mode: "idle",
      state_token: "idle",
      linkup_id: null as string | null,
      last_inbound_message_sid: null as string | null,
    },
    profile: {
      id: "pro_123",
      user_id: "usr_123",
      state: "complete_mvp",
      is_complete_mvp: true,
      country_code: "US",
      state_code: "CA",
      last_interview_step: "group_01",
      preferences: {},
      coordination_dimensions: {},
      activity_patterns: [],
      boundaries: {},
      active_intent: null,
      scheduling_availability: null,
      notice_preference: null as string | null,
      coordination_style: null as string | null,
      completeness_percent: 100,
      completed_at: "2026-03-12T18:00:00.000Z",
      status_reason: "interview_complete_mvp",
      state_changed_at: "2026-03-12T18:00:00.000Z",
    },
    invitations: [...(input?.invitations ?? [])],
    learningSignals: [] as Array<Record<string, unknown>>,
    profileEvents: [] as Array<Record<string, unknown>>,
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
        gte(column: string, value: unknown) {
          queryState[`gte:${column}`] = value;
          return query;
        },
        order(column: string, options?: { ascending?: boolean }) {
          queryState.orderBy = column;
          queryState.ascending = options?.ascending ?? true;
          return query;
        },
        limit(value: number) {
          queryState.limit = value;
          return query;
        },
        async maybeSingle() {
          if (table === "conversation_sessions") {
            if (queryState.user_id !== state.session.user_id) {
              return { data: null, error: null };
            }
            return { data: { ...state.session }, error: null };
          }

          if (table === "profiles") {
            if (queryState.user_id !== state.profile.user_id) {
              return { data: null, error: null };
            }
            return { data: { ...state.profile }, error: null };
          }

          if (table === "invitations") {
            const filtered = state.invitations
              .filter((invitation) =>
                (!queryState.user_id || invitation.user_id === queryState.user_id) &&
                (!queryState.state || invitation.state === queryState.state) &&
                (!queryState["gte:responded_at"] ||
                  (invitation.responded_at != null &&
                    invitation.responded_at >= queryState["gte:responded_at"]))
              )
              .sort((left, right) => (right.responded_at ?? "").localeCompare(left.responded_at ?? ""));
            return {
              data: filtered[0]
                ? {
                    id: filtered[0].id,
                    activity_key: filtered[0].activity_key,
                    responded_at: filtered[0].responded_at,
                  }
                : null,
              error: null,
            };
          }

          return { data: null, error: null };
        },
      };

      if (table === "learning_signals") {
        return {
          async insert(payload: Record<string, unknown>) {
            state.learningSignals.push({ ...payload });
            return { error: null };
          },
        };
      }

      if (table === "profile_events") {
        return {
          async insert(payload: Record<string, unknown>) {
            state.profileEvents.push({ ...payload });
            return { error: null };
          },
        };
      }

      if (table === "profiles") {
        return {
          ...query,
          update(payload: Record<string, unknown>) {
            return {
              async eq(column: string, value: unknown) {
                if (column !== "id" || value !== state.profile.id) {
                  return { error: { message: "profile_not_found" } };
                }
                state.profile = {
                  ...state.profile,
                  ...payload,
                };
                return { error: null };
              },
            };
          },
        };
      }

      if (table === "conversation_sessions") {
        return {
          ...query,
          update(payload: Record<string, unknown>) {
            return {
              eq(column: string, value: unknown) {
                return {
                  select() {
                    return {
                      async single() {
                        if (column !== "id" || value !== state.session.id) {
                          return { data: null, error: { message: "session_not_found" } };
                        }
                        state.session = {
                          ...state.session,
                          mode: payload.mode as string,
                          state_token: payload.state_token as string,
                          last_inbound_message_sid:
                            (payload.last_inbound_message_sid as string | null | undefined) ??
                            state.session.last_inbound_message_sid,
                        };
                        return { data: { id: state.session.id }, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "invitations") {
        return query;
      }

      throw new Error(`Unexpected table '${table}' in freeform router test.`);
    },
    debugState() {
      return {
        session: { ...state.session },
        profile: { ...state.profile },
        learningSignals: [...state.learningSignals],
        profileEvents: [...state.profileEvents],
      };
    },
  };
}
