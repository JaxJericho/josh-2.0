import { describe, expect, it } from "vitest";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { createContactInvitationWithSupabase } from "../supabase/functions/_shared/invitations/create-contact-invitation";

describe("contact invitation creation flow", () => {
  it("creates a single invitation and outbound job and reuses both on replay", async () => {
    const supabase = buildInvitationSupabaseMock();

    const first = await createContactInvitationWithSupabase({
      supabase,
      inviter_user_id: "usr_123",
      inviter_profile_id: "pro_123",
      inviter_display_name: "Alex",
      invitee_phone_e164: "(415) 555-0123",
      invitee_display_name: "Sam",
      invitation_context: "invite Sam",
      sms_encryption_key: "sms-encryption-key",
      audit_idempotency_key: "audit:invitation:SM123",
    });

    const second = await createContactInvitationWithSupabase({
      supabase,
      inviter_user_id: "usr_123",
      inviter_profile_id: "pro_123",
      inviter_display_name: "Alex",
      invitee_phone_e164: "+1 415 555 0123",
      invitee_display_name: "Sam",
      invitation_context: "invite Sam",
      sms_encryption_key: "sms-encryption-key",
      audit_idempotency_key: "audit:invitation:SM123",
    });

    expect(first.invitation_outcome).toBe("created");
    expect(first.outbound_job_outcome).toBe("created");
    expect(first.invitee_phone_e164).toBe("+14155550123");

    expect(second.invitation_outcome).toBe("reused");
    expect(second.outbound_job_outcome).toBe("reused");
    expect(second.invitation_id).toBe(first.invitation_id);
    expect(second.outbound_job_id).toBe(first.outbound_job_id);

    const state = supabase.debugState();
    expect(state.contactCircleRows).toHaveLength(1);
    expect(state.contactInvitationRows).toHaveLength(1);
    expect(state.smsOutboundJobRows).toHaveLength(1);
    expect(state.auditLogRows).toHaveLength(1);
    expect(state.smsOutboundJobRows[0]?.status).toBe("pending");
    expect(state.smsOutboundJobRows[0]?.run_at).toBe("2099-01-01T00:00:00.000Z");
    expect(state.smsOutboundJobRows[0]?.last_error).toContain("A2P_GATE_BLOCKED");

    const serializedAuditPayload = JSON.stringify(state.auditLogRows[0]?.payload ?? {});
    expect(serializedAuditPayload).not.toContain("+14155550123");
    expect(serializedAuditPayload).toContain(first.invitee_phone_hash);
  });
});

function buildInvitationSupabaseMock() {
  const state = {
    contactCircleRows: [] as Array<Record<string, unknown>>,
    contactInvitationRows: [] as Array<
      {
        id: string;
        inviter_user_id: string;
        invitee_phone_hash: string;
        status: string;
        created_at: number;
      }
    >,
    smsOutboundJobRows: [] as Array<Record<string, unknown>>,
    auditLogRows: [] as Array<Record<string, unknown>>,
    invitationSequence: 0,
    outboundJobSequence: 0,
  };

  return {
    from(table: string) {
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
            const match = state.contactInvitationRows.find((row) =>
              row.inviter_user_id === filters.inviter_user_id &&
              row.invitee_phone_hash === filters.invitee_phone_hash &&
              row.status === filters.status
            );
            if (!match) {
              return { data: null, error: null };
            }
            return {
              data: {
                id: match.id,
                status: match.status,
                created_at: new Date(match.created_at).toISOString(),
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
                const row = {
                  id: `inv_${state.invitationSequence}`,
                  inviter_user_id: String(payload.inviter_user_id),
                  invitee_phone_hash: String(payload.invitee_phone_hash),
                  status: String(payload.status ?? "pending"),
                  created_at: Date.now(),
                };
                state.contactInvitationRows.push(row);
                return {
                  data: { id: row.id, status: row.status },
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
            const existing = state.smsOutboundJobRows.find((row) =>
              row.idempotency_key === payload.idempotency_key
            );
            if (!existing) {
              state.outboundJobSequence += 1;
              state.smsOutboundJobRows.push({
                id: `job_${state.outboundJobSequence}`,
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

      throw new Error(`Unexpected table '${table}' in invitation flow test.`);
    },
    async rpc(fn: string, args?: Record<string, unknown>) {
      if (fn !== "encrypt_sms_body") {
        return {
          data: null,
          error: { message: `Unexpected rpc function '${fn}'.` },
        };
      }
      const plaintext = String(args?.plaintext ?? "");
      return {
        data: `cipher:${plaintext}`,
        error: null,
      };
    },
    debugState() {
      return {
        contactCircleRows: [...state.contactCircleRows],
        contactInvitationRows: [...state.contactInvitationRows],
        smsOutboundJobRows: [...state.smsOutboundJobRows],
        auditLogRows: [...state.auditLogRows],
      };
    },
  };
}
