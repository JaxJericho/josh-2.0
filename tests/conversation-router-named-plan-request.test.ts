import { describe, expect, it } from "vitest";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  dispatchConversationRoute,
  type NormalizedInboundMessagePayload,
} from "../supabase/functions/_shared/router/conversation-router";

describe("conversation router named plan request dispatch", () => {
  it("stores a pending confirmation token and does not create invite rows when intent is ambiguous", async () => {
    const previousKey = process.env.SMS_BODY_ENCRYPTION_KEY;
    process.env.SMS_BODY_ENCRYPTION_KEY = "test_sms_key";

    try {
      const supabase = buildNamedPlanSupabaseMock();

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
        payload: samplePayload("Plan with Taylor at +14155550123"),
      });

      expect(result.engine).toBe("named_plan_request_handler");
      expect(result.reply_message).toBe(
        "Reply YES to queue this invite, or NO to cancel.",
      );

      const state = supabase.debugState();
      expect(state.contactInvitations).toHaveLength(0);
      expect(state.smsOutboundJobs).toHaveLength(0);
      expect(state.session.mode).toBe("pending_plan_confirmation");
      expect(state.session.state_token.startsWith("invite_confirm:create:v1:")).toBe(true);
    } finally {
      process.env.SMS_BODY_ENCRYPTION_KEY = previousKey;
    }
  });

  it("creates invitation only after YES and clears pending state on NO", async () => {
    const previousKey = process.env.SMS_BODY_ENCRYPTION_KEY;
    process.env.SMS_BODY_ENCRYPTION_KEY = "test_sms_key";

    try {
      const supabase = buildNamedPlanSupabaseMock();

      await dispatchConversationRoute({
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
        payload: samplePayload("Plan with Taylor at +14155550123"),
      });

      const decline = await dispatchConversationRoute({
        supabase,
        decision: {
          user_id: "usr_123",
          state: {
            mode: "pending_plan_confirmation",
            state_token: supabase.debugState().session.state_token,
          },
          profile_is_complete_mvp: true,
          route: "named_plan_request_handler",
          safety_override_applied: false,
          next_transition: supabase.debugState().session.state_token,
        },
        payload: samplePayload("NO", "SM_INVITE_NO_1"),
      });

      expect(decline.reply_message).toBe("Okay - I will not queue that invite.");
      expect(supabase.debugState().contactInvitations).toHaveLength(0);
      expect(supabase.debugState().smsOutboundJobs).toHaveLength(0);
      expect(supabase.debugState().session.mode).toBe("idle");
      expect(supabase.debugState().session.state_token).toBe("idle");

      await dispatchConversationRoute({
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
        payload: samplePayload("Plan with Taylor at +14155550123", "SM_INVITE_AMBIG_2"),
      });

      const confirm = await dispatchConversationRoute({
        supabase,
        decision: {
          user_id: "usr_123",
          state: {
            mode: "pending_plan_confirmation",
            state_token: supabase.debugState().session.state_token,
          },
          profile_is_complete_mvp: true,
          route: "named_plan_request_handler",
          safety_override_applied: false,
          next_transition: supabase.debugState().session.state_token,
        },
        payload: samplePayload("YES", "SM_INVITE_YES_1"),
      });

      expect(confirm.reply_message).toBe(
        "Invite queued. I will send it once invite delivery is enabled.",
      );
      expect(supabase.debugState().contactInvitations).toHaveLength(1);
      expect(supabase.debugState().smsOutboundJobs).toHaveLength(1);
      expect(supabase.debugState().session.mode).toBe("idle");
      expect(supabase.debugState().session.state_token).toBe("idle");
    } finally {
      process.env.SMS_BODY_ENCRYPTION_KEY = previousKey;
    }
  });

  it("keeps invite creation idempotent when YES confirmation is replayed", async () => {
    const previousKey = process.env.SMS_BODY_ENCRYPTION_KEY;
    process.env.SMS_BODY_ENCRYPTION_KEY = "test_sms_key";

    try {
      const supabase = buildNamedPlanSupabaseMock();

      await dispatchConversationRoute({
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
        payload: samplePayload("Plan with Taylor at +14155550123", "SM_INVITE_AMBIG_1"),
      });

      const pendingStateToken = supabase.debugState().session.state_token;

      await dispatchConversationRoute({
        supabase,
        decision: {
          user_id: "usr_123",
          state: {
            mode: "pending_plan_confirmation",
            state_token: pendingStateToken,
          },
          profile_is_complete_mvp: true,
          route: "named_plan_request_handler",
          safety_override_applied: false,
          next_transition: pendingStateToken,
        },
        payload: samplePayload("YES", "SM_INVITE_YES_REPLAY"),
      });

      await dispatchConversationRoute({
        supabase,
        decision: {
          user_id: "usr_123",
          state: {
            mode: "pending_plan_confirmation",
            state_token: pendingStateToken,
          },
          profile_is_complete_mvp: true,
          route: "named_plan_request_handler",
          safety_override_applied: false,
          next_transition: pendingStateToken,
        },
        payload: samplePayload("YES", "SM_INVITE_YES_REPLAY"),
      });

      const state = supabase.debugState();
      expect(state.contactInvitations).toHaveLength(1);
      expect(state.smsOutboundJobs).toHaveLength(1);
      expect(state.auditLog).toHaveLength(1);
    } finally {
      process.env.SMS_BODY_ENCRYPTION_KEY = previousKey;
    }
  });

  it("returns deterministic guidance when a named-plan request omits a phone number", async () => {
    const supabase = buildNamedPlanSupabaseMock();

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
      payload: samplePayload("Plan something with Taylor"),
    });

    expect(result.engine).toBe("named_plan_request_handler");
    expect(result.reply_message).toContain("E.164 format");

    const state = supabase.debugState();
    expect(state.contactInvitations).toHaveLength(0);
    expect(state.smsOutboundJobs).toHaveLength(0);
  });
});

function samplePayload(body: string, inboundSid = "SM_NAMED_1"): NormalizedInboundMessagePayload {
  return {
    inbound_message_id: "msg_named_1",
    inbound_message_sid: inboundSid,
    from_e164: "+15555550111",
    to_e164: "+15555550222",
    body_raw: body,
    body_normalized: body.toUpperCase(),
  };
}

function buildNamedPlanSupabaseMock() {
  const state = {
    session: {
      id: "ses_123",
      mode: "idle",
      state_token: "idle",
      linkup_id: null,
    },
    contactCircle: [] as Array<Record<string, unknown>>,
    contactInvitations: [] as Array<Record<string, unknown>>,
    smsOutboundJobs: [] as Array<Record<string, unknown>>,
    auditLog: [] as Array<Record<string, unknown>>,
    invitationCounter: 0,
    outboundJobCounter: 0,
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
            if (queryState.user_id && queryState.user_id !== "usr_123") {
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
                          return { data: null, error: { message: "session_not_found" } };
                        }
                        state.session = {
                          ...state.session,
                          mode: String(payload.mode),
                          state_token: String(payload.state_token),
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
              data: { id: "pro_123" },
              error: null,
            };
          },
        };
      }

      if (table === "users") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            return {
              data: { first_name: "Sam" },
              error: null,
            };
          },
        };
      }

      if (table === "contact_circle") {
        return {
          async insert(payload: Record<string, unknown>) {
            const duplicate = state.contactCircle.find((row) =>
              row.user_id === payload.user_id && row.contact_phone_hash === payload.contact_phone_hash
            );
            if (!duplicate) {
              state.contactCircle.push(payload);
            }
            return {
              data: null,
              error: null,
            };
          },
        };
      }

      if (table === "contact_invitations") {
        const filters: Record<string, unknown> = {};
        return {
          select() {
            return this;
          },
          eq(column: string, value: unknown) {
            filters[column] = value;
            return this;
          },
          order() {
            return this;
          },
          limit() {
            return this;
          },
          async maybeSingle() {
            const row = state.contactInvitations.find((candidate) =>
              Object.entries(filters).every(([column, value]) => candidate[column] === value)
            );
            return {
              data: row
                ? {
                    id: row.id,
                    status: row.status,
                    created_at: row.created_at,
                  }
                : null,
              error: null,
            };
          },
          insert(payload: Record<string, unknown>) {
            return {
              select() {
                return {
                  async single() {
                    const duplicate = state.contactInvitations.find((row) =>
                      row.inviter_user_id === payload.inviter_user_id &&
                      row.invitee_phone_hash === payload.invitee_phone_hash &&
                      row.status === "pending"
                    );
                    if (duplicate) {
                      return { data: null, error: duplicateError() };
                    }

                    state.invitationCounter += 1;
                    const status = typeof payload.status === "string" ? payload.status : null;
                    const row = {
                      ...payload,
                      status,
                      id: `00000000-0000-0000-0000-${String(state.invitationCounter).padStart(12, "0")}`,
                      created_at: new Date().toISOString(),
                    };
                    state.contactInvitations.push(row);
                    return {
                      data: {
                        id: row.id,
                        status,
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "sms_outbound_jobs") {
        const filters: Record<string, unknown> = {};
        return {
          select() {
            return this;
          },
          eq(column: string, value: unknown) {
            filters[column] = value;
            return this;
          },
          async maybeSingle() {
            const row = state.smsOutboundJobs.find((candidate) =>
              Object.entries(filters).every(([column, value]) => candidate[column] === value)
            );
            return {
              data: row ? { id: row.id } : null,
              error: null,
            };
          },
          async insert(payload: Record<string, unknown>, options?: { ignoreDuplicates?: boolean }) {
            const duplicate = state.smsOutboundJobs.find((row) =>
              row.idempotency_key === payload.idempotency_key
            );
            if (duplicate) {
              if (options?.ignoreDuplicates) {
                return { data: null, error: null };
              }
              return { data: null, error: duplicateError() };
            }

            state.outboundJobCounter += 1;
            state.smsOutboundJobs.push({
              ...payload,
              id: `job_${state.outboundJobCounter}`,
            });
            return { data: null, error: null };
          },
        };
      }

      if (table === "audit_log") {
        return {
          async insert(payload: Record<string, unknown>) {
            const duplicate = state.auditLog.find((row) =>
              row.idempotency_key === payload.idempotency_key && payload.idempotency_key
            );
            if (duplicate) {
              return { data: null, error: duplicateError() };
            }

            state.auditLog.push(payload);
            return { data: null, error: null };
          },
        };
      }

      throw new Error(`Unexpected table '${table}'`);
    },

    async rpc(fn: string, args?: Record<string, unknown>) {
      if (fn === "encrypt_sms_body") {
        return {
          data: `enc:${String(args?.plaintext ?? "")}`,
          error: null,
        };
      }

      return {
        data: null,
        error: { message: `Unexpected rpc call '${fn}'` },
      };
    },

    debugState() {
      return {
        session: { ...state.session },
        contactInvitations: [...state.contactInvitations],
        smsOutboundJobs: [...state.smsOutboundJobs],
        auditLog: [...state.auditLog],
      };
    },
  };
}

function duplicateError() {
  return {
    code: "23505",
    message: "duplicate key value violates unique constraint",
  };
}
