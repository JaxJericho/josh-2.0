import { describe, expect, it } from "vitest";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  dispatchConversationRoute,
  parseContactInviteResponseIntent,
  routeConversationMessage,
  type NormalizedInboundMessagePayload,
  type RoutingDecision,
} from "../supabase/functions/_shared/router/conversation-router";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  buildInvitedAbbreviatedWelcomeMessage,
  CONTACT_INVITE_DECLINE_CONFIRMATION_MESSAGE,
  CONTACT_INVITE_RESPONSE_CLARIFICATION_MESSAGE,
} from "../packages/core/src/invitations/abbreviated-welcome-messages";

describe("conversation router contact invite response handler", () => {
  it("parses contact-invite responses deterministically", () => {
    expect(parseContactInviteResponseIntent(" YES ")).toBe("accept");
    expect(parseContactInviteResponseIntent("ok sure")).toBe("accept");
    expect(parseContactInviteResponseIntent("NO")).toBe("decline");
    expect(parseContactInviteResponseIntent("decline please")).toBe("decline");
    expect(parseContactInviteResponseIntent("maybe later")).toBe("unknown");
  });

  it("accepts pending invitees, creates invited registration records once, and sends welcome once", async () => {
    const inviteePhoneHash = "hash_invitee_123";
    const supabase = buildContactInviteSupabaseMock({
      inviteePhoneHash,
      inviterFirstName: "Alex",
    });

    const payload: NormalizedInboundMessagePayload = {
      ...samplePayload(),
      from_phone_hash: inviteePhoneHash,
      body_raw: "YES",
      body_normalized: "YES",
    };

    const decision = await routeConversationMessage({
      supabase,
      payload,
    });

    expect(decision.route).toBe("contact_invite_response_handler");

    const first = await dispatchConversationRoute({
      supabase,
      decision,
      payload,
    });

    expect(first.engine).toBe("contact_invite_response_handler");
    expect(first.reply_message).toBe(
      buildInvitedAbbreviatedWelcomeMessage("Alex"),
    );

    const replay = await dispatchConversationRoute({
      supabase,
      decision,
      payload,
    });

    expect(replay.reply_message).toBeNull();

    const state = supabase.debugState();
    expect(state.invitation.status).toBe("accepted");
    expect(state.invitedUsers).toHaveLength(1);
    expect(state.invitedUsers[0]?.registration_source).toBe("contact_invitation");
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]?.state).toBe("empty");
    expect(state.profiles[0]?.is_complete_mvp).toBe(false);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]?.mode).toBe("interviewing_abbreviated");
    expect(state.sessions[0]?.state_token).toBe("interview_abbreviated:awaiting_reply");

    const acceptedAudit = state.auditLogRows.filter((row) => row.action === "contact_invite_accepted");
    expect(acceptedAudit).toHaveLength(1);

    const receivedAudit = state.auditLogRows.filter((row) => row.action === "contact_invite_response_received");
    expect(receivedAudit).toHaveLength(1);
    expect(
      (receivedAudit[0]?.payload as { idempotency_status?: string } | undefined)?.idempotency_status,
    ).toBe("first_run");
  });

  it("declines pending invites without creating invited registration records", async () => {
    const inviteePhoneHash = "hash_invitee_456";
    const supabase = buildContactInviteSupabaseMock({
      inviteePhoneHash,
      inviterFirstName: "Jordan",
    });

    const decision = decisionForContactInviteResponse();
    const payload: NormalizedInboundMessagePayload = {
      ...samplePayload(),
      from_phone_hash: inviteePhoneHash,
      body_raw: "NO",
      body_normalized: "NO",
    };

    const first = await dispatchConversationRoute({
      supabase,
      decision,
      payload,
    });

    const replay = await dispatchConversationRoute({
      supabase,
      decision,
      payload,
    });

    expect(first.reply_message).toBe(CONTACT_INVITE_DECLINE_CONFIRMATION_MESSAGE);
    expect(replay.reply_message).toBeNull();

    const state = supabase.debugState();
    expect(state.invitation.status).toBe("declined");
    expect(state.invitedUsers).toHaveLength(0);
    expect(state.profiles).toHaveLength(0);
    expect(state.sessions).toHaveLength(0);
  });

  it("prompts for clarification on unknown responses with no side effects", async () => {
    const inviteePhoneHash = "hash_invitee_789";
    const supabase = buildContactInviteSupabaseMock({
      inviteePhoneHash,
      inviterFirstName: "Taylor",
    });

    const result = await dispatchConversationRoute({
      supabase,
      decision: decisionForContactInviteResponse(),
      payload: {
        ...samplePayload(),
        from_phone_hash: inviteePhoneHash,
        body_raw: "what is this?",
        body_normalized: "WHAT IS THIS?",
      },
    });

    expect(result.reply_message).toBe(CONTACT_INVITE_RESPONSE_CLARIFICATION_MESSAGE);

    const state = supabase.debugState();
    expect(state.invitation.status).toBe("pending");
    expect(state.invitedUsers).toHaveLength(0);
    expect(state.profiles).toHaveLength(0);
    expect(state.sessions).toHaveLength(0);
  });

  it("is race-safe under concurrent accept dispatches", async () => {
    const inviteePhoneHash = "hash_invitee_race";
    const supabase = buildContactInviteSupabaseMock({
      inviteePhoneHash,
      inviterFirstName: "Riley",
    });

    const decision = decisionForContactInviteResponse();
    const [first, second] = await Promise.all([
      dispatchConversationRoute({
        supabase,
        decision,
        payload: {
          ...samplePayload(),
          inbound_message_sid: "SM_RACE_1",
          from_phone_hash: inviteePhoneHash,
          body_raw: "YES",
          body_normalized: "YES",
        },
      }),
      dispatchConversationRoute({
        supabase,
        decision,
        payload: {
          ...samplePayload(),
          inbound_message_sid: "SM_RACE_2",
          from_phone_hash: inviteePhoneHash,
          body_raw: "YES",
          body_normalized: "YES",
        },
      }),
    ]);

    const replies = [first.reply_message, second.reply_message].filter(Boolean);
    expect(replies).toHaveLength(1);

    const state = supabase.debugState();
    expect(state.invitation.status).toBe("accepted");
    expect(state.invitedUsers).toHaveLength(1);
    expect(state.profiles).toHaveLength(1);
    expect(state.sessions).toHaveLength(1);
  });
});

function samplePayload(): NormalizedInboundMessagePayload {
  return {
    inbound_message_id: "msg_contact_invite_1",
    inbound_message_sid: "SM_CONTACT_INVITE_1",
    from_e164: "+15555550111",
    to_e164: "+15555550222",
    body_raw: "YES",
    body_normalized: "YES",
  };
}

function decisionForContactInviteResponse(): RoutingDecision {
  return {
    user_id: "",
    state: {
      mode: "idle",
      state_token: "idle",
    },
    profile_is_complete_mvp: null,
    route: "contact_invite_response_handler",
    safety_override_applied: false,
    next_transition: "idle:awaiting_user_input",
  };
}

function buildContactInviteSupabaseMock(input: {
  inviteePhoneHash: string;
  inviterFirstName: string;
}) {
  type UserRow = {
    id: string;
    phone_e164: string;
    phone_hash: string;
    first_name: string;
    registration_source: string | null;
  };
  type ProfileRow = {
    id: string;
    user_id: string;
    state: string;
    is_complete_mvp: boolean;
  };
  type SessionRow = {
    id: string;
    user_id: string;
    mode: string;
    state_token: string;
  };
  type AuditRow = {
    action: string;
    payload: Record<string, unknown>;
    idempotency_key?: string | null;
  };

  const state = {
    invitation: {
      id: "inv_123",
      inviter_user_id: "usr_inviter",
      invitee_phone_hash: input.inviteePhoneHash,
      status: "pending",
      created_at: 1,
    },
    users: [
      {
        id: "usr_inviter",
        phone_e164: "+15555550999",
        phone_hash: "hash_inviter",
        first_name: input.inviterFirstName,
        registration_source: null,
      },
    ] as UserRow[],
    profiles: [] as ProfileRow[],
    sessions: [] as SessionRow[],
    auditLogRows: [] as AuditRow[],
    userSeq: 0,
    profileSeq: 0,
    sessionSeq: 0,
  };

  return {
    from(table: string) {
      if (table === "contact_invitations") {
        const filters: Record<string, unknown> = {};
        let inStatuses: string[] | null = null;

        const query = {
          select() {
            return query;
          },
          eq(column: string, value: unknown) {
            filters[column] = value;
            return query;
          },
          in(column: string, values: string[]) {
            if (column === "status") {
              inStatuses = values;
            }
            return query;
          },
          order() {
            return query;
          },
          limit() {
            return query;
          },
          async maybeSingle() {
            const inviteePhoneHash = typeof filters.invitee_phone_hash === "string"
              ? filters.invitee_phone_hash
              : null;
            if (inviteePhoneHash && inviteePhoneHash !== state.invitation.invitee_phone_hash) {
              return { data: null, error: null };
            }

            const status = typeof filters.status === "string" ? filters.status : null;
            if (status && state.invitation.status !== status) {
              return { data: null, error: null };
            }

            if (inStatuses && !inStatuses.includes(state.invitation.status)) {
              return { data: null, error: null };
            }

            return {
              data: {
                id: state.invitation.id,
                inviter_user_id: state.invitation.inviter_user_id,
                status: state.invitation.status,
                created_at: new Date(state.invitation.created_at).toISOString(),
              },
              error: null,
            };
          },
          update(payload: Record<string, unknown>) {
            const updateFilters: Record<string, unknown> = {};
            const updateQuery = {
              eq(column: string, value: unknown) {
                updateFilters[column] = value;
                return updateQuery;
              },
              select() {
                return updateQuery;
              },
              async maybeSingle() {
                const matchesId = !updateFilters.id || updateFilters.id === state.invitation.id;
                const matchesStatus = !updateFilters.status ||
                  updateFilters.status === state.invitation.status;
                if (matchesId && matchesStatus) {
                  state.invitation.status = String(payload.status);
                  return { data: { id: state.invitation.id }, error: null };
                }
                return { data: null, error: null };
              },
            };
            return updateQuery;
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
            const row = state.users.find((candidate) => {
              if (filters.id && candidate.id !== filters.id) {
                return false;
              }
              if (filters.phone_hash && candidate.phone_hash !== filters.phone_hash) {
                return false;
              }
              if (filters.phone_e164 && candidate.phone_e164 !== filters.phone_e164) {
                return false;
              }
              return true;
            });

            if (!row) {
              return { data: null, error: null };
            }

            const selected = {
              id: row.id,
              first_name: row.first_name,
            };
            return { data: selected, error: null };
          },
          insert(payload: Record<string, unknown>) {
            return {
              select() {
                return this;
              },
              async single() {
                const duplicate = state.users.find((candidate) =>
                  candidate.phone_hash === payload.phone_hash ||
                  candidate.phone_e164 === payload.phone_e164
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

                state.userSeq += 1;
                const created = {
                  id: `usr_invited_${state.userSeq}`,
                  phone_e164: String(payload.phone_e164),
                  phone_hash: String(payload.phone_hash),
                  first_name: String(payload.first_name),
                  registration_source:
                    typeof payload.registration_source === "string"
                      ? payload.registration_source
                      : null,
                };
                state.users.push(created);
                return {
                  data: { id: created.id },
                  error: null,
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
            const row = state.profiles.find((candidate) => candidate.user_id === filters.user_id);
            if (!row) {
              return { data: null, error: null };
            }
            return {
              data: { id: row.id },
              error: null,
            };
          },
          insert(payload: Record<string, unknown>) {
            return {
              select() {
                return this;
              },
              async single() {
                const duplicate = state.profiles.find((candidate) =>
                  candidate.user_id === payload.user_id
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

                state.profileSeq += 1;
                const created = {
                  id: `pro_${state.profileSeq}`,
                  user_id: String(payload.user_id),
                  state: String(payload.state),
                  is_complete_mvp: payload.is_complete_mvp === true,
                };
                state.profiles.push(created);
                return {
                  data: { id: created.id },
                  error: null,
                };
              },
            };
          },
        };

        return query;
      }

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
            const row = state.sessions.find((candidate) => candidate.user_id === filters.user_id);
            if (!row) {
              return { data: null, error: null };
            }

            return {
              data: {
                id: row.id,
                mode: row.mode,
                state_token: row.state_token,
                linkup_id: null,
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
                const duplicate = state.sessions.find((candidate) =>
                  candidate.user_id === payload.user_id
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

                state.sessionSeq += 1;
                const created = {
                  id: `ses_${state.sessionSeq}`,
                  user_id: String(payload.user_id),
                  mode: String(payload.mode),
                  state_token: String(payload.state_token),
                };
                state.sessions.push(created);
                return {
                  data: {
                    id: created.id,
                    mode: created.mode,
                    state_token: created.state_token,
                  },
                  error: null,
                };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            const updateFilters: Record<string, unknown> = {};
            const updateQuery = {
              eq(column: string, value: unknown) {
                updateFilters[column] = value;
                return updateQuery;
              },
              select() {
                return updateQuery;
              },
              async maybeSingle() {
                const row = state.sessions.find((candidate) => candidate.id === updateFilters.id);
                if (!row) {
                  return { data: null, error: null };
                }
                row.mode = String(payload.mode);
                row.state_token = String(payload.state_token);
                return {
                  data: {
                    id: row.id,
                    mode: row.mode,
                    state_token: row.state_token,
                  },
                  error: null,
                };
              },
            };
            return updateQuery;
          },
        };

        return query;
      }

      if (table === "audit_log") {
        return {
          async insert(payload: Record<string, unknown>) {
            const idempotencyKey = typeof payload.idempotency_key === "string"
              ? payload.idempotency_key
              : null;
            const duplicate = state.auditLogRows.find((row) =>
              row.idempotency_key && row.idempotency_key === idempotencyKey
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
            state.auditLogRows.push({
              action: typeof payload.action === "string" ? payload.action : "unknown",
              payload: (payload.payload as Record<string, unknown> | null) ?? {},
              idempotency_key: idempotencyKey,
            });
            return { data: null, error: null };
          },
        };
      }

      throw new Error(`Unexpected table '${table}' in contact-invite response test.`);
    },
    debugState() {
      const invitedUsers = state.users.filter((row) => row.id !== "usr_inviter");
      return {
        invitation: { ...state.invitation },
        invitedUsers: [...invitedUsers],
        profiles: [...state.profiles],
        sessions: [...state.sessions],
        auditLogRows: [...state.auditLogRows],
      };
    },
  };
}
