import { describe, expect, it } from "vitest";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  dispatchConversationRoute,
  type NormalizedInboundMessagePayload,
  type RoutingDecision,
} from "../supabase/functions/_shared/router/conversation-router";

describe("conversation router named plan request flow", () => {
  it("creates a draft plan brief, transitions session, and sends confirmation for eligible users with known contacts", async () => {
    const supabase = buildNamedPlanSupabaseMock({
      subscriptionState: "active",
      contacts: [
        {
          id: "contact_123",
          user_id: "usr_123",
          contact_name: "Marcus",
          contact_phone_e164: "+14155550123",
        },
      ],
    });

    const result = await dispatchConversationRoute({
      supabase,
      decision: decisionForState({
        mode: "idle",
        state_token: "idle",
      }),
      payload: {
        ...samplePayload(),
        body_raw: "See if Marcus is free for a hike Saturday",
        body_normalized: "SEE IF MARCUS IS FREE FOR A HIKE SATURDAY",
      },
    });

    expect(result.engine).toBe("named_plan_request_handler");
    expect(result.reply_message).toContain("Marcus");
    expect(result.reply_message).toContain("hike");

    const state = supabase.debugState();
    expect(state.planBriefRows).toHaveLength(1);
    expect(state.planBriefRows[0]).toMatchObject({
      creator_user_id: "usr_123",
      activity_key: "hike",
      proposed_time_window: "Saturday",
      status: "draft",
    });
    expect(state.session.mode).toBe("pending_plan_confirmation");
    expect(state.session.state_token).toMatch(
      /^plan_brief:[a-f0-9-]+:contact:contact_123$/,
    );
  });

  it("returns subscription guidance and does not write plan data for ineligible users", async () => {
    const supabase = buildNamedPlanSupabaseMock({
      subscriptionState: "inactive",
      contacts: [
        {
          id: "contact_123",
          user_id: "usr_123",
          contact_name: "Marcus",
          contact_phone_e164: "+14155550123",
        },
      ],
    });

    const result = await dispatchConversationRoute({
      supabase,
      decision: decisionForState({
        mode: "idle",
        state_token: "idle",
      }),
      payload: {
        ...samplePayload(),
        body_raw: "See if Marcus is free for a hike Saturday",
        body_normalized: "SEE IF MARCUS IS FREE FOR A HIKE SATURDAY",
      },
    });

    expect(result.engine).toBe("named_plan_request_handler");
    expect(result.reply_message).toContain("active JOSH subscription");

    const state = supabase.debugState();
    expect(state.planBriefRows).toHaveLength(0);
    expect(state.session.mode).toBe("idle");
    expect(state.session.state_token).toBe("idle");
  });

  it("returns contact-not-found guidance and does not write plan data when contact is missing", async () => {
    const supabase = buildNamedPlanSupabaseMock({
      subscriptionState: "active",
      contacts: [],
    });

    const result = await dispatchConversationRoute({
      supabase,
      decision: decisionForState({
        mode: "idle",
        state_token: "idle",
      }),
      payload: {
        ...samplePayload(),
        body_raw: "See if Jordan is free for a hike Saturday",
        body_normalized: "SEE IF JORDAN IS FREE FOR A HIKE SATURDAY",
      },
    });

    expect(result.engine).toBe("named_plan_request_handler");
    expect(result.reply_message).toContain("Jordan");
    expect(result.reply_message).toContain("Reply with their number");

    const state = supabase.debugState();
    expect(state.planBriefRows).toHaveLength(0);
    expect(state.session.mode).toBe("idle");
    expect(state.session.state_token).toBe("idle");
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

function buildNamedPlanSupabaseMock(input: {
  subscriptionState: string;
  contacts: Array<{
    id: string;
    user_id: string;
    contact_name: string;
    contact_phone_e164: string | null;
  }>;
}) {
  const state = {
    session: {
      id: "ses_123",
      mode: "idle",
      state_token: "idle",
      linkup_id: null as string | null,
      updated_at: "2026-03-03T00:00:00.000Z",
    },
    subscriptionState: input.subscriptionState,
    contacts: [...input.contacts],
    planBriefRows: [] as Array<Record<string, unknown>>,
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
                      updated_at: String(payload.updated_at ?? state.session.updated_at),
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

      if (table === "subscriptions") {
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
              data: { state: state.subscriptionState },
              error: null,
            };
          },
        };
        return query;
      }

      if (table === "contact_circle") {
        const filters: Record<string, unknown> = {};
        let ilikeValue = "";
        const query = {
          select() {
            return query;
          },
          eq(column: string, value: unknown) {
            filters[column] = value;
            return query;
          },
          ilike(_column: string, value: unknown) {
            ilikeValue = String(value).toLowerCase();
            return query;
          },
          async maybeSingle() {
            const match = state.contacts.find((row) =>
              row.user_id === filters.user_id &&
              row.contact_name.toLowerCase() === ilikeValue
            );
            if (!match) {
              return { data: null, error: null };
            }
            return {
              data: {
                id: match.id,
                contact_name: match.contact_name,
                contact_phone_e164: match.contact_phone_e164,
              },
              error: null,
            };
          },
        };
        return query;
      }

      if (table === "plan_briefs") {
        return {
          async insert(payload: Record<string, unknown>) {
            state.planBriefRows.push({ ...payload });
            return { data: null, error: null };
          },
        };
      }

      throw new Error(`Unexpected table '${table}' in named-plan router test.`);
    },
    async rpc(fn: string, _args?: Record<string, unknown>) {
      return {
        data: null,
        error: { message: `Unexpected rpc function '${fn}'.` },
      };
    },
    debugState() {
      return {
        session: { ...state.session },
        planBriefRows: [...state.planBriefRows],
      };
    },
  };
}
