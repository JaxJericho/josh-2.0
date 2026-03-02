import { describe, expect, it } from "vitest";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  dispatchConversationRoute,
  type NormalizedInboundMessagePayload,
  type RoutingDecision,
} from "../supabase/functions/_shared/router/conversation-router";

describe("conversation router named plan request confirmation flow", () => {
  it("stores pending contact invite confirmation when phone is detected but invite intent is ambiguous", async () => {
    const supabase = buildNamedPlanSupabaseMock();

    const result = await dispatchConversationRoute({
      supabase,
      decision: decisionForState({
        mode: "idle",
        state_token: "idle",
      }),
      payload: {
        ...samplePayload(),
        body_raw: "Sam +14155550123",
        body_normalized: "SAM +14155550123",
      },
    });

    expect(result.engine).toBe("named_plan_request_handler");
    expect(result.reply_message).toBe(
      "Reply YES to queue this invite, or NO to cancel.",
    );

    const state = supabase.debugState();
    expect(state.session.mode).toBe("pending_contact_invite_confirmation");
    expect(state.session.state_token).toMatch(/^invite_confirm:create:v1:/);
    expect(state.contactInvitationRows).toHaveLength(0);
    expect(state.smsOutboundJobRows).toHaveLength(0);
  });

  it("creates invite and outbound job only after YES and does not duplicate rows on replay", async () => {
    const supabase = buildNamedPlanSupabaseMock();
    const previousSmsKey = process.env.SMS_BODY_ENCRYPTION_KEY;
    process.env.SMS_BODY_ENCRYPTION_KEY = "sms-encryption-key";

    try {
      await dispatchConversationRoute({
        supabase,
        decision: decisionForState({
          mode: "idle",
          state_token: "idle",
        }),
        payload: {
          ...samplePayload(),
          inbound_message_sid: "SM_AMBIG_1",
          body_raw: "Sam +14155550123",
          body_normalized: "SAM +14155550123",
        },
      });

      const pendingToken = supabase.debugState().session.state_token;
      const firstYes = await dispatchConversationRoute({
        supabase,
        decision: decisionForState({
          mode: "pending_contact_invite_confirmation",
          state_token: pendingToken,
        }),
        payload: {
          ...samplePayload(),
          inbound_message_sid: "SM_YES_1",
          body_raw: "YES",
          body_normalized: "YES",
        },
      });

      expect(firstYes.reply_message).toBe(
        "Invite queued. I will send it once invite delivery is enabled.",
      );

      let state = supabase.debugState();
      expect(state.session.mode).toBe("idle");
      expect(state.session.state_token).toBe("idle");
      expect(state.contactInvitationRows).toHaveLength(1);
      expect(state.smsOutboundJobRows).toHaveLength(1);

      const replayYes = await dispatchConversationRoute({
        supabase,
        decision: decisionForState({
          mode: "pending_contact_invite_confirmation",
          state_token: pendingToken,
        }),
        payload: {
          ...samplePayload(),
          inbound_message_sid: "SM_YES_1",
          body_raw: "YES",
          body_normalized: "YES",
        },
      });

      expect(replayYes.reply_message).toBe(
        "That invite is already queued. I will send it once invite delivery is enabled.",
      );

      state = supabase.debugState();
      expect(state.contactInvitationRows).toHaveLength(1);
      expect(state.smsOutboundJobRows).toHaveLength(1);
      expect(state.auditLogRows).toHaveLength(1);
    } finally {
      if (typeof previousSmsKey === "string") {
        process.env.SMS_BODY_ENCRYPTION_KEY = previousSmsKey;
      } else {
        delete process.env.SMS_BODY_ENCRYPTION_KEY;
      }
    }
  });

  it("clears pending contact invite confirmation on NO without creating invitation rows", async () => {
    const supabase = buildNamedPlanSupabaseMock();

    await dispatchConversationRoute({
      supabase,
      decision: decisionForState({
        mode: "idle",
        state_token: "idle",
      }),
      payload: {
        ...samplePayload(),
        body_raw: "Sam +14155550123",
        body_normalized: "SAM +14155550123",
      },
    });

    const pendingToken = supabase.debugState().session.state_token;
    const noResult = await dispatchConversationRoute({
      supabase,
      decision: decisionForState({
        mode: "pending_contact_invite_confirmation",
        state_token: pendingToken,
      }),
      payload: {
        ...samplePayload(),
        inbound_message_sid: "SM_NO_1",
        body_raw: "NO",
        body_normalized: "NO",
      },
    });

    expect(noResult.reply_message).toBe("Okay - I will not queue that invite.");

    const state = supabase.debugState();
    expect(state.session.mode).toBe("idle");
    expect(state.session.state_token).toBe("idle");
    expect(state.contactInvitationRows).toHaveLength(0);
    expect(state.smsOutboundJobRows).toHaveLength(0);
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

function decisionForState(
  state: RoutingDecision["state"],
): RoutingDecision {
  return {
    user_id: "usr_123",
    state,
    profile_is_complete_mvp: true,
    route: "named_plan_request_handler",
    safety_override_applied: false,
    next_transition: "idle:awaiting_user_input",
  };
}

function buildNamedPlanSupabaseMock() {
  const state = {
    session: {
      id: "ses_123",
      mode: "idle",
      state_token: "idle",
      linkup_id: null as string | null,
    },
    contactCircleRows: [] as Array<Record<string, unknown>>,
    contactInvitationRows: [] as Array<
      {
        id: string;
        inviter_user_id: string;
        invitee_phone_hash: string;
        status: string;
      }
    >,
    smsOutboundJobRows: [] as Array<Record<string, unknown>>,
    auditLogRows: [] as Array<Record<string, unknown>>,
    invitationSequence: 0,
    outboundSequence: 0,
  };

  return {
    from(table: string) {
      if (table === "conversation_sessions") {
        const filters: Record<string, unknown> = {};
        const query = {
          select() {
            return query;
          },
          eq(column: string, value: unknown) {
            filters[column] = value;
            return query;
          },
          async maybeSingle() {
            if (filters.user_id && filters.user_id !== "usr_123") {
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
                    return this;
                  },
                  async single() {
                    if (column !== "id" || value !== state.session.id) {
                      return {
                        data: null,
                        error: { message: "session_not_found" },
                      };
                    }
                    state.session = {
                      ...state.session,
                      mode: String(payload.mode),
                      state_token: String(payload.state_token),
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
        return query;
      }

      if (table === "profiles") {
        const filters: Record<string, unknown> = {};
        const query = {
          select() {
            return query;
          },
          eq(column: string, value: unknown) {
            filters[column] = value;
            return query;
          },
          async maybeSingle() {
            if (filters.user_id !== "usr_123") {
              return { data: null, error: null };
            }
            return {
              data: { id: "pro_123" },
              error: null,
            };
          },
        };
        return query;
      }

      if (table === "users") {
        const filters: Record<string, unknown> = {};
        const query = {
          select() {
            return query;
          },
          eq(column: string, value: unknown) {
            filters[column] = value;
            return query;
          },
          async maybeSingle() {
            if (filters.id !== "usr_123") {
              return { data: null, error: null };
            }
            return {
              data: { first_name: "Alex" },
              error: null,
            };
          },
        };
        return query;
      }

      if (table === "contact_circle") {
        return {
          async insert(payload: Record<string, unknown>) {
            const exists = state.contactCircleRows.some((row) =>
              row.user_id === payload.user_id &&
              row.contact_phone_hash === payload.contact_phone_hash
            );
            if (!exists) {
              state.contactCircleRows.push({ ...payload });
            }
            return { data: null, error: null };
          },
        };
      }

      if (table === "contact_invitations") {
        const filters: Record<string, unknown> = {};
        const query = {
          select() {
            return query;
          },
          eq(column: string, value: unknown) {
            filters[column] = value;
            return query;
          },
          order() {
            return query;
          },
          limit() {
            return query;
          },
          async maybeSingle() {
            const row = state.contactInvitationRows.find((candidate) =>
              candidate.inviter_user_id === filters.inviter_user_id &&
              candidate.invitee_phone_hash === filters.invitee_phone_hash &&
              candidate.status === filters.status
            );
            if (!row) {
              return { data: null, error: null };
            }
            return {
              data: {
                id: row.id,
                status: row.status,
                created_at: new Date().toISOString(),
              },
              error: null,
            };
          },
          insert(payload: Record<string, unknown>) {
            return {
              select() {
                return this;
              },
              async single() {
                const duplicate = state.contactInvitationRows.find((row) =>
                  row.inviter_user_id === payload.inviter_user_id &&
                  row.invitee_phone_hash === payload.invitee_phone_hash &&
                  row.status === "pending"
                );
                if (duplicate) {
                  return {
                    data: null,
                    error: {
                      code: "23505",
                      message: "duplicate key value violates unique constraint",
                    },
                  };
                }
                state.invitationSequence += 1;
                const created = {
                  id: `inv_${state.invitationSequence}`,
                  inviter_user_id: String(payload.inviter_user_id),
                  invitee_phone_hash: String(payload.invitee_phone_hash),
                  status: String(payload.status ?? "pending"),
                };
                state.contactInvitationRows.push(created);
                return {
                  data: {
                    id: created.id,
                    status: created.status,
                  },
                  error: null,
                };
              },
            };
          },
        };
        return query;
      }

      if (table === "sms_outbound_jobs") {
        const filters: Record<string, unknown> = {};
        const query = {
          select() {
            return query;
          },
          eq(column: string, value: unknown) {
            filters[column] = value;
            return query;
          },
          async maybeSingle() {
            const match = state.smsOutboundJobRows.find((row) =>
              row.idempotency_key === filters.idempotency_key
            );
            if (!match) {
              return { data: null, error: null };
            }
            return {
              data: { id: match.id },
              error: null,
            };
          },
          async insert(payload: Record<string, unknown>) {
            const duplicate = state.smsOutboundJobRows.find((row) =>
              row.idempotency_key === payload.idempotency_key
            );
            if (!duplicate) {
              state.outboundSequence += 1;
              state.smsOutboundJobRows.push({
                id: `job_${state.outboundSequence}`,
                ...payload,
              });
            }
            return { data: null, error: null };
          },
        };
        return query;
      }

      if (table === "audit_log") {
        return {
          async insert(payload: Record<string, unknown>) {
            const duplicate = state.auditLogRows.find((row) =>
              row.idempotency_key && row.idempotency_key === payload.idempotency_key
            );
            if (duplicate) {
              return {
                data: null,
                error: {
                  code: "23505",
                  message: "duplicate key value violates unique constraint",
                },
              };
            }
            state.auditLogRows.push(payload);
            return { data: null, error: null };
          },
        };
      }

      throw new Error(`Unexpected table '${table}' in named-plan router test.`);
    },
    async rpc(fn: string, _args?: Record<string, unknown>) {
      if (fn !== "encrypt_sms_body") {
        return {
          data: null,
          error: { message: `Unexpected rpc function '${fn}'.` },
        };
      }
      return { data: "ciphertext", error: null };
    },
    debugState() {
      return {
        session: { ...state.session },
        contactCircleRows: [...state.contactCircleRows],
        contactInvitationRows: [...state.contactInvitationRows],
        smsOutboundJobRows: [...state.smsOutboundJobRows],
        auditLogRows: [...state.auditLogRows],
      };
    },
  };
}
