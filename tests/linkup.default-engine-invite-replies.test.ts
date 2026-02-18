import { describe, expect, it } from "vitest";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { runDefaultEngine } from "../supabase/functions/_shared/engines/default-engine";

describe("default engine invite reply routing", () => {
  it("returns locked confirmation when accept causes lock", async () => {
    const supabase = buildSupabaseMock({
      sessionLinkupId: "linkup_1",
      inviteLinkupId: null,
      rpcStatus: "accepted_and_locked",
    });

    const result = await runDefaultEngine({
      supabase,
      decision: decision("awaiting_invite_reply"),
      payload: payload("yes"),
    });

    expect(result.engine).toBe("default_engine");
    expect(result.reply_message).toBe("You're in. This LinkUp is now locked.");
  });

  it("falls back to invite lookup when session.linkup_id is empty", async () => {
    const supabase = buildSupabaseMock({
      sessionLinkupId: null,
      inviteLinkupId: "linkup_2",
      rpcStatus: "declined",
    });

    const result = await runDefaultEngine({
      supabase,
      decision: decision("awaiting_invite_reply"),
      payload: payload("no"),
    });

    expect(result.reply_message).toBe("Got it. You're out for this LinkUp.");
  });

  it("returns no-invite guidance when no active linkup can be resolved", async () => {
    const supabase = buildSupabaseMock({
      sessionLinkupId: null,
      inviteLinkupId: null,
      rpcStatus: "accepted",
    });

    const result = await runDefaultEngine({
      supabase,
      decision: decision("awaiting_invite_reply"),
      payload: payload("yes"),
    });

    expect(result.reply_message).toBe("I couldn't find an open invite for you right now.");
  });

  it("returns clarifier for unclear invite text", async () => {
    const supabase = buildSupabaseMock({
      sessionLinkupId: "linkup_3",
      inviteLinkupId: null,
      rpcStatus: "unclear_reply",
    });

    const result = await runDefaultEngine({
      supabase,
      decision: decision("awaiting_invite_reply"),
      payload: payload("maybe"),
    });

    expect(result.reply_message).toBe("I didn't catch that. Reply YES to accept or NO to decline.");
  });
});

function decision(mode: "awaiting_invite_reply" | "idle") {
  return {
    user_id: "usr_linkup_1",
    state: {
      mode,
      state_token: mode === "awaiting_invite_reply" ? "invite:awaiting_reply" : "idle",
    },
    route: "default_engine" as const,
    safety_override_applied: false,
    next_transition: mode === "awaiting_invite_reply"
      ? "invite:awaiting_reply"
      : "idle:awaiting_user_input",
  };
}

function payload(rawText: string) {
  return {
    inbound_message_id: "msg_linkup_1",
    inbound_message_sid: "SM_LINKUP_1",
    from_e164: "+15550000011",
    to_e164: "+15551110000",
    body_raw: rawText,
    body_normalized: rawText.trim().toUpperCase(),
  };
}

function buildSupabaseMock(params: {
  sessionLinkupId: string | null;
  inviteLinkupId: string | null;
  rpcStatus: string;
}) {
  return {
    from(table: string) {
      const state: Record<string, unknown> = {};
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          state[column] = value;
          return query;
        },
        in(column: string, values: unknown[]) {
          state[column] = values;
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        async maybeSingle() {
          if (table === "profiles") {
            return { data: null, error: null };
          }

          if (table === "conversation_sessions") {
            return {
              data: params.sessionLinkupId
                ? { linkup_id: params.sessionLinkupId }
                : { linkup_id: null },
              error: null,
            };
          }

          if (table === "linkup_invites") {
            if (!params.inviteLinkupId) {
              return { data: null, error: null };
            }
            return {
              data: {
                linkup_id: params.inviteLinkupId,
                state: "pending",
              },
              error: null,
            };
          }

          return { data: null, error: null };
        },
      };

      return query;
    },
    async rpc() {
      return {
        data: {
          status: params.rpcStatus,
        },
        error: null,
      };
    },
  };
}
