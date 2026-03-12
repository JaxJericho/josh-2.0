import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  dispatchConversationRoute,
  routeConversationMessage,
  type NormalizedInboundMessagePayload,
  type RoutingDecision,
} from "../supabase/functions/_shared/router/conversation-router";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  INVITATION_RESPONSE_CLARIFICATION_MESSAGE,
  INVITATION_RESPONSE_CLARIFIER_STATE_TOKEN,
} from "../packages/messaging/src/handlers/handle-invitation-response";

const ORIGINAL_SMS_KEY = process.env.SMS_BODY_ENCRYPTION_KEY;

describe("conversation router invitation response handler", () => {
  beforeEach(() => {
    process.env.SMS_BODY_ENCRYPTION_KEY = "test-encryption-key";
  });

  afterEach(() => {
    if (typeof ORIGINAL_SMS_KEY === "string") {
      process.env.SMS_BODY_ENCRYPTION_KEY = ORIGINAL_SMS_KEY;
      return;
    }

    delete process.env.SMS_BODY_ENCRYPTION_KEY;
  });

  it("routes awaiting_invitation_response through the dedicated handler via local parse", async () => {
    const supabase = buildInvitationResponseSupabaseMock();

    const decision = await routeConversationMessage({
      supabase,
      payload: samplePayload({ body_raw: "yes", body_normalized: "YES" }),
    });

    expect(decision.route).toBe("invitation_response_handler");
    expect(decision.state.mode).toBe("awaiting_invitation_response");
  });

  it("accepts a pending invitation through the RPC and enqueues exactly one outbound confirmation", async () => {
    const supabase = buildInvitationResponseSupabaseMock();

    const result = await dispatchConversationRoute({
      supabase,
      decision: decisionForAwaitingInvitationResponse(),
      payload: samplePayload({ body_raw: "yes", body_normalized: "YES" }),
    });

    expect(result.engine).toBe("invitation_response_handler");
    expect(result.reply_message).toBeNull();

    const state = supabase.debugState();
    expect(state.invitation?.state).toBe("accepted");
    expect(state.user.invitation_backoff_count).toBe(0);
    expect(state.session.mode).toBe("idle");
    expect(state.session.state_token).toBe("idle");
    expect(state.learningSignals).toHaveLength(1);
    expect(state.learningSignals[0]?.signal_type).toBe("invitation_accepted");
    expect(state.outboundJobs).toHaveLength(1);
  });

  it("passes a pending invitation through the RPC and increments backoff", async () => {
    const supabase = buildInvitationResponseSupabaseMock({
      user: {
        invitation_backoff_count: 2,
      },
    });

    const result = await dispatchConversationRoute({
      supabase,
      decision: decisionForAwaitingInvitationResponse(),
      payload: samplePayload({ body_raw: "pass", body_normalized: "PASS" }),
    });

    expect(result.reply_message).toBeNull();

    const state = supabase.debugState();
    expect(state.invitation?.state).toBe("passed");
    expect(state.user.invitation_backoff_count).toBe(3);
    expect(state.learningSignals).toHaveLength(1);
    expect(state.learningSignals[0]?.signal_type).toBe("invitation_passed");
    expect(state.outboundJobs).toHaveLength(1);
  });

  it("returns expired copy on accept when no unexpired pending invitation remains", async () => {
    const supabase = buildInvitationResponseSupabaseMock({
      invitation: {
        expires_at: "2026-03-10T00:00:00.000Z",
      },
    });

    const result = await dispatchConversationRoute({
      supabase,
      decision: decisionForAwaitingInvitationResponse(),
      payload: samplePayload({ body_raw: "yes", body_normalized: "YES" }),
    });

    expect(result.reply_message).toBe(
      "It looks like that invitation has already expired. JOSH will be in touch with something new soon.",
    );

    const state = supabase.debugState();
    expect(state.invitation?.state).toBe("pending");
    expect(state.learningSignals).toHaveLength(0);
    expect(state.outboundJobs).toHaveLength(0);
    expect(state.session.mode).toBe("idle");
  });

  it("is replay-safe on duplicate MessageSid", async () => {
    const supabase = buildInvitationResponseSupabaseMock();
    const decision = decisionForAwaitingInvitationResponse();
    const payload = samplePayload({ body_raw: "yes", body_normalized: "YES" });

    const first = await dispatchConversationRoute({
      supabase,
      decision,
      payload,
    });
    const second = await dispatchConversationRoute({
      supabase,
      decision,
      payload,
    });

    expect(first.reply_message).toBeNull();
    expect(second.reply_message).toBeNull();

    const state = supabase.debugState();
    expect(state.learningSignals).toHaveLength(1);
    expect(state.outboundJobs).toHaveLength(1);
    expect(state.rpcCalls).toBe(2);
  });

  it("sends one clarification prompt and stores clarifier_pending state", async () => {
    const supabase = buildInvitationResponseSupabaseMock();

    const result = await dispatchConversationRoute({
      supabase,
      decision: decisionForAwaitingInvitationResponse(),
      payload: samplePayload({ body_raw: "maybe later", body_normalized: "MAYBE LATER" }),
    });

    expect(result.reply_message).toBe(INVITATION_RESPONSE_CLARIFICATION_MESSAGE);

    const state = supabase.debugState();
    expect(state.session.mode).toBe("awaiting_invitation_response");
    expect(state.session.state_token).toBe(INVITATION_RESPONSE_CLARIFIER_STATE_TOKEN);
    expect(state.rpcCalls).toBe(0);
  });

  it("treats a second ambiguous reply after clarification as pass", async () => {
    const supabase = buildInvitationResponseSupabaseMock();

    await dispatchConversationRoute({
      supabase,
      decision: decisionForAwaitingInvitationResponse(),
      payload: samplePayload({
        inbound_message_sid: "SM_INVITE_1",
        body_raw: "maybe later",
        body_normalized: "MAYBE LATER",
      }),
    });

    const result = await dispatchConversationRoute({
      supabase,
      decision: decisionForAwaitingInvitationResponse(INVITATION_RESPONSE_CLARIFIER_STATE_TOKEN),
      payload: samplePayload({
        inbound_message_sid: "SM_INVITE_2",
        inbound_message_id: "00000000-0000-0000-0000-000000000002",
        body_raw: "still not sure",
        body_normalized: "STILL NOT SURE",
      }),
    });

    expect(result.reply_message).toBeNull();

    const state = supabase.debugState();
    expect(state.invitation?.state).toBe("passed");
    expect(state.learningSignals).toHaveLength(1);
    expect(state.learningSignals[0]?.signal_type).toBe("invitation_passed");
    expect(state.session.mode).toBe("idle");
  });
});

function samplePayload(
  overrides: Partial<NormalizedInboundMessagePayload> = {},
): NormalizedInboundMessagePayload {
  return {
    inbound_message_id: "00000000-0000-0000-0000-000000000001",
    inbound_message_sid: "SM_INVITE_1",
    from_e164: "+15555550111",
    to_e164: "+15555550222",
    body_raw: "YES",
    body_normalized: "YES",
    ...overrides,
  };
}

function decisionForAwaitingInvitationResponse(
  stateToken = "invitation:awaiting_response",
): RoutingDecision {
  return {
    user_id: "11111111-1111-1111-1111-111111111111",
    state: {
      mode: "awaiting_invitation_response",
      state_token: stateToken,
    },
    profile_is_complete_mvp: true,
    route: "invitation_response_handler",
    safety_override_applied: false,
    next_transition: "invitation:awaiting_response",
  };
}

function buildInvitationResponseSupabaseMock(input?: {
  user?: Partial<{
    id: string;
    phone_e164: string;
    invitation_backoff_count: number;
  }>;
  session?: Partial<{
    id: string;
    user_id: string;
    mode: string;
    state_token: string;
    linkup_id: string | null;
    last_inbound_message_sid: string | null;
  }>;
  profile?: Partial<{
    is_complete_mvp: boolean;
    state: string;
  }>;
  invitation?: Partial<{
    id: string;
    user_id: string;
    invitation_type: "solo" | "group";
    activity_key: string;
    time_window: string;
    state: "pending" | "accepted" | "passed" | "expired";
    expires_at: string;
    responded_at: string | null;
    response_message_sid: string | null;
    linkup_id: string | null;
  }>;
  activityDisplayName?: string | null;
}) {
  const state: {
    user: {
      id: string;
      phone_e164: string;
      invitation_backoff_count: number;
    };
    session: {
      id: string;
      user_id: string;
      mode: string;
      state_token: string;
      linkup_id: string | null;
      last_inbound_message_sid: string | null;
    };
    profile: {
      is_complete_mvp: boolean;
      state: string;
    };
    invitation: {
      id: string;
      user_id: string;
      invitation_type: "solo" | "group";
      activity_key: string;
      time_window: string;
      state: "pending" | "accepted" | "passed" | "expired";
      expires_at: string;
      responded_at: string | null;
      response_message_sid: string | null;
      linkup_id: string | null;
    } | null;
    activityDisplayName: string | null;
    learningSignals: Array<{ signal_type: string }>;
    outboundJobs: Array<{ id: string; idempotency_key: string; body: string }>;
    rpcCalls: number;
  } = {
    user: {
      id: "11111111-1111-1111-1111-111111111111",
      phone_e164: "+15555550111",
      invitation_backoff_count: 0,
      ...input?.user,
    },
    session: {
      id: "22222222-2222-2222-2222-222222222222",
      user_id: "11111111-1111-1111-1111-111111111111",
      mode: "awaiting_invitation_response",
      state_token: "invitation:awaiting_response",
      linkup_id: null,
      last_inbound_message_sid: null,
      ...input?.session,
    },
    profile: {
      is_complete_mvp: true,
      state: "complete_mvp",
      ...input?.profile,
    },
    invitation: {
      id: "33333333-3333-3333-3333-333333333333",
      user_id: "11111111-1111-1111-1111-111111111111",
      invitation_type: "solo",
      activity_key: "coffee_walk",
      time_window: "this Saturday afternoon",
      state: "pending",
      expires_at: "2026-03-20T00:00:00.000Z",
      responded_at: null,
      response_message_sid: null,
      linkup_id: null,
      ...input?.invitation,
    },
    activityDisplayName: input?.activityDisplayName ?? "Coffee Walk",
    learningSignals: [] as Array<{ signal_type: string }>,
    outboundJobs: [] as Array<{ id: string; idempotency_key: string; body: string }>,
    rpcCalls: 0,
  };

  function resolveRows(table: string, query: QueryState) {
    if (table === "users") {
      if (matchesEq(query, "phone_e164", state.user.phone_e164)) {
        return [{ id: state.user.id }];
      }
      if (matchesEq(query, "id", state.user.id)) {
        return [state.user];
      }
      return [];
    }

    if (table === "conversation_sessions") {
      const matchesUserId = matchesEq(query, "user_id", state.session.user_id);
      const matchesId = matchesEq(query, "id", state.session.id);
      if (matchesUserId || matchesId) {
        return [state.session];
      }
      return [];
    }

    if (table === "profiles") {
      if (matchesEq(query, "user_id", state.user.id)) {
        return [state.profile];
      }
      return [];
    }

    if (table === "invitations") {
      if (!state.invitation) {
        return [];
      }
      const matchesUserId = matchesEq(query, "user_id", state.invitation.user_id);
      const matchesState = matchesEq(query, "state", state.invitation.state);
      const matchesResponseSid = matchesEq(
        query,
        "response_message_sid",
        state.invitation.response_message_sid,
      );
      const matchesExpiry = !query.gtValue ||
        (query.gtColumn === "expires_at" && state.invitation.expires_at > query.gtValue);
      if (matchesUserId && matchesState && matchesResponseSid && matchesExpiry) {
        return [state.invitation];
      }
      return [];
    }

    if (table === "activity_catalog") {
      if (
        state.activityDisplayName &&
        matchesEq(query, "activity_key", state.invitation?.activity_key)
      ) {
        return [{ display_name: state.activityDisplayName }];
      }
      return [];
    }

    return [];
  }

  function selectColumns(row: Record<string, unknown>, columns: string | null) {
    if (!columns) {
      return row;
    }

    const selected: Record<string, unknown> = {};
    for (const column of columns.split(",").map((value) => value.trim()).filter(Boolean)) {
      selected[column] = row[column];
    }
    return selected;
  }

  function runMaybeSingle(table: string, query: QueryState) {
    const rows = resolveRows(table, query);
    const row = rows[0] ? selectColumns(rows[0] as Record<string, unknown>, query.selectColumns) : null;
    return Promise.resolve({ data: row, error: null });
  }

  function runSingle(table: string, query: QueryState) {
    if (query.updatePayload) {
      if (table === "conversation_sessions" && matchesEq(query, "id", state.session.id)) {
        state.session = {
          ...state.session,
          ...(query.updatePayload as Record<string, unknown>),
        };
        return Promise.resolve({
          data: selectColumns(state.session as unknown as Record<string, unknown>, query.selectColumns),
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: "update target not found" } });
    }

    return runMaybeSingle(table, query).then(({ data }) => ({ data, error: null }));
  }

  return {
    from(table: string) {
      const query: QueryState = {
        selectColumns: null,
        eqFilters: [],
        gtColumn: null,
        gtValue: null,
        updatePayload: null,
      };

      return {
        select(columns: string) {
          query.selectColumns = columns;
          return this;
        },
        eq(column: string, value: unknown) {
          query.eqFilters.push([column, value]);
          return this;
        },
        gt(column: string, value: string) {
          query.gtColumn = column;
          query.gtValue = value;
          return this;
        },
        order(_column: string, _options: { ascending: boolean }) {
          return this;
        },
        limit(_count: number) {
          return this;
        },
        update(payload: Record<string, unknown>) {
          query.updatePayload = payload;
          return this;
        },
        maybeSingle() {
          return runMaybeSingle(table, query);
        },
        single() {
          return runSingle(table, query);
        },
      };
    },
    async rpc(fn: string, args?: Record<string, unknown>) {
      if (fn === "transition_session_to_post_event_if_linkup_completed") {
        return {
          data: [{
            transitioned: false,
            reason: "unchanged",
            next_mode: state.session.mode,
            state_token: state.session.state_token,
            linkup_id: state.session.linkup_id,
            correlation_id: args?.p_correlation_id ?? null,
            linkup_correlation_id: null,
          }],
          error: null,
        };
      }

      if (fn !== "apply_invitation_response") {
        return { data: null, error: { message: `unsupported rpc ${fn}` } };
      }

      state.rpcCalls += 1;
      const action = String(args?.p_action ?? "");
      const inboundMessageSid = String(args?.p_inbound_message_sid ?? "");
      const invitationId = String(args?.p_invitation_id ?? "");
      const nowIso = String(args?.p_now ?? "2026-03-12T00:00:00.000Z");
      const outboundMessage = String(args?.p_outbound_message ?? "");

      if (!state.invitation || state.invitation.id !== invitationId) {
        state.session.mode = "idle";
        state.session.state_token = "idle";
        state.session.last_inbound_message_sid = inboundMessageSid;
        return {
          data: [{
            invitation_id: invitationId,
            user_id: state.user.id,
            invitation_type: null,
            resulting_state: null,
            duplicate: false,
            processed: false,
            learning_signal_written: false,
            outbound_job_id: null,
            next_mode: "idle",
            next_state_token: "idle",
            reason: "invitation_not_found",
          }],
          error: null,
        };
      }

      if (state.invitation.response_message_sid) {
        if (state.invitation.response_message_sid === inboundMessageSid) {
          const existingJob = state.outboundJobs.find((job) =>
            job.idempotency_key === `invitation_response:sms:${state.invitation?.id}`
          );
          return {
            data: [{
              invitation_id: state.invitation.id,
              user_id: state.user.id,
              invitation_type: state.invitation.invitation_type,
              resulting_state: state.invitation.state,
              duplicate: true,
              processed: false,
              learning_signal_written: false,
              outbound_job_id: existingJob?.id ?? null,
              next_mode: state.session.mode,
              next_state_token: state.session.state_token,
              reason: "duplicate_replay",
            }],
            error: null,
          };
        }

        state.session.mode = "idle";
        state.session.state_token = "idle";
        state.session.last_inbound_message_sid = inboundMessageSid;
        return {
          data: [{
            invitation_id: state.invitation.id,
            user_id: state.user.id,
            invitation_type: state.invitation.invitation_type,
            resulting_state: state.invitation.state,
            duplicate: false,
            processed: false,
            learning_signal_written: false,
            outbound_job_id: null,
            next_mode: "idle",
            next_state_token: "idle",
            reason: `already_${state.invitation.state}`,
          }],
          error: null,
        };
      }

      if (action === "accept" && state.invitation.expires_at <= nowIso) {
        state.session.mode = "idle";
        state.session.state_token = "idle";
        state.session.last_inbound_message_sid = inboundMessageSid;
        return {
          data: [{
            invitation_id: state.invitation.id,
            user_id: state.user.id,
            invitation_type: state.invitation.invitation_type,
            resulting_state: state.invitation.state,
            duplicate: false,
            processed: false,
            learning_signal_written: false,
            outbound_job_id: null,
            next_mode: "idle",
            next_state_token: "idle",
            reason: "accept_window_elapsed",
          }],
          error: null,
        };
      }

      state.invitation.state = action === "accept" ? "accepted" : "passed";
      state.invitation.responded_at = nowIso;
      state.invitation.response_message_sid = inboundMessageSid;
      state.user.invitation_backoff_count = action === "accept"
        ? 0
        : state.user.invitation_backoff_count + 1;
      state.session.mode = "idle";
      state.session.state_token = "idle";
      state.session.last_inbound_message_sid = inboundMessageSid;
      state.learningSignals.push({
        signal_type: action === "accept" ? "invitation_accepted" : "invitation_passed",
      });
      const outboundJob = {
        id: `job_${state.outboundJobs.length + 1}`,
        idempotency_key: `invitation_response:sms:${state.invitation.id}`,
        body: outboundMessage,
      };
      state.outboundJobs.push(outboundJob);

      return {
        data: [{
          invitation_id: state.invitation.id,
          user_id: state.user.id,
          invitation_type: state.invitation.invitation_type,
          resulting_state: state.invitation.state,
          duplicate: false,
          processed: true,
          learning_signal_written: true,
          outbound_job_id: outboundJob.id,
          next_mode: "idle",
          next_state_token: "idle",
          reason: action === "accept" ? "accepted" : "passed",
        }],
        error: null,
      };
    },
    debugState() {
      return state;
    },
  };
}

type QueryState = {
  selectColumns: string | null;
  eqFilters: Array<[string, unknown]>;
  gtColumn: string | null;
  gtValue: string | null;
  updatePayload: Record<string, unknown> | null;
};

function matchesEq(query: QueryState, column: string, expected: unknown): boolean {
  return query.eqFilters.every(([queryColumn, queryValue]) =>
    queryColumn !== column || queryValue === expected
  );
}
