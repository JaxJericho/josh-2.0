import { describe, expect, it } from "vitest";
// @ts-ignore: Deno runtime file is imported in Node tests.
import {
  createContactInvitationWithSupabase,
  type CreateContactInvitationInput,
} from "../supabase/functions/_shared/invitations/create-contact-invitation";

describe("contact invitation creation flow", () => {
  it("creates one invitation row and one gated outbound job row", async () => {
    const supabase = buildContactInvitationSupabaseMock();

    const result = await createContactInvitationWithSupabase({
      ...baseInput(),
      supabase,
      invitee_phone_e164: "(415) 555-0123",
      invitee_display_name: "Taylor",
      audit_idempotency_key: "audit:invite:1",
    });

    const state = supabase.debugState();

    expect(result.invitation_outcome).toBe("created");
    expect(result.outbound_job_outcome).toBe("created");
    expect(result.invitee_phone_e164).toBe("+14155550123");

    expect(state.contactInvitations).toHaveLength(1);
    expect(state.contactInvitations[0]).toMatchObject({
      inviter_user_id: "usr_123",
      status: "pending",
    });

    expect(state.smsOutboundJobs).toHaveLength(1);
    expect(state.smsOutboundJobs[0]).toMatchObject({
      purpose: "contact_invitation_invite_v1",
      status: "pending",
      run_at: "2099-01-01T00:00:00.000Z",
      correlation_id: state.contactInvitations[0].id,
    });

    expect(state.auditLog).toHaveLength(1);
    const serializedAuditPayload = JSON.stringify(state.auditLog[0].payload);
    expect(serializedAuditPayload).toContain(result.invitee_phone_hash);
    expect(serializedAuditPayload).not.toContain("+14155550123");
    expect(state.contactCircle).toHaveLength(1);
  });

  it("reuses invitation and outbound job for replayed inviter/invitee pairs", async () => {
    const supabase = buildContactInvitationSupabaseMock();

    await createContactInvitationWithSupabase({
      ...baseInput(),
      supabase,
      invitee_phone_e164: "+14155550123",
      audit_idempotency_key: "audit:invite:1",
    });

    const replay = await createContactInvitationWithSupabase({
      ...baseInput(),
      supabase,
      invitee_phone_e164: "+14155550123",
      audit_idempotency_key: "audit:invite:2",
    });

    const state = supabase.debugState();
    expect(replay.invitation_outcome).toBe("reused");
    expect(replay.outbound_job_outcome).toBe("reused");
    expect(state.contactInvitations).toHaveLength(1);
    expect(state.smsOutboundJobs).toHaveLength(1);
  });

  it("creates separate invitation and job rows for different invitees", async () => {
    const supabase = buildContactInvitationSupabaseMock();

    await createContactInvitationWithSupabase({
      ...baseInput(),
      supabase,
      invitee_phone_e164: "+14155550123",
      audit_idempotency_key: "audit:invite:1",
    });

    await createContactInvitationWithSupabase({
      ...baseInput(),
      supabase,
      invitee_phone_e164: "+14155550124",
      audit_idempotency_key: "audit:invite:2",
    });

    const state = supabase.debugState();
    expect(state.contactInvitations).toHaveLength(2);
    expect(state.smsOutboundJobs).toHaveLength(2);
  });
});

function baseInput(): Omit<CreateContactInvitationInput, "supabase" | "invitee_phone_e164"> {
  return {
    inviter_user_id: "usr_123",
    inviter_profile_id: "pro_123",
    inviter_display_name: "Sam",
    invitation_context: "plan with Taylor at +14155550123",
    sms_encryption_key: "test_sms_key",
  };
}

function buildContactInvitationSupabaseMock() {
  const state = {
    contactCircle: [] as Array<Record<string, unknown>>,
    contactInvitations: [] as Array<Record<string, unknown>>,
    smsOutboundJobs: [] as Array<Record<string, unknown>>,
    auditLog: [] as Array<Record<string, unknown>>,
    invitationCounter: 0,
    outboundJobCounter: 0,
  };

  return {
    from(table: string) {
      if (table === "contact_circle") {
        return {
          async insert(payload: Record<string, unknown>, options?: { ignoreDuplicates?: boolean }) {
            const duplicate = state.contactCircle.find((row) =>
              row.user_id === payload.user_id && row.contact_phone_hash === payload.contact_phone_hash
            );
            if (duplicate) {
              if (options?.ignoreDuplicates) {
                return { data: null, error: null };
              }
              return { data: null, error: duplicateError() };
            }
            state.contactCircle.push({ ...payload, id: `circle_${state.contactCircle.length + 1}` });
            return { data: null, error: null };
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
                      return {
                        data: null,
                        error: duplicateError(),
                      };
                    }

                    state.invitationCounter += 1;
                    const status = typeof payload.status === "string" ? payload.status : null;
                    const row = {
                      ...payload,
                      status,
                      id: `00000000-0000-0000-0000-${String(state.invitationCounter).padStart(12, "0")}`,
                      created_at: new Date(2026, 1, state.invitationCounter).toISOString(),
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
      return { data: null, error: { message: `Unexpected RPC '${fn}'` } };
    },

    debugState() {
      return {
        contactCircle: [...state.contactCircle],
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
