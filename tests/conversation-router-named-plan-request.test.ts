import { describe, expect, it } from "vitest";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  dispatchConversationRoute,
  type NormalizedInboundMessagePayload,
} from "../supabase/functions/_shared/router/conversation-router";

describe("conversation router named plan request flow", () => {
  it("returns contact-not-found guidance for eligible named-plan requests", async () => {
    const supabase = buildNamedPlanSupabaseMock({ subscriptionState: "active" });

    const result = await dispatchConversationRoute({
      supabase,
      decision: namedPlanDecision(),
      payload: {
        ...samplePayload(),
        body_raw: "See if Marcus is free for a hike Saturday",
        body_normalized: "SEE IF MARCUS IS FREE FOR A HIKE SATURDAY",
      },
    });

    expect(result.engine).toBe("named_plan_request_handler");
    expect(result.reply_message).toContain("Marcus");
    expect(result.reply_message).toContain("Reply with their number.");
  });

  it("returns subscription guidance for ineligible named-plan requests", async () => {
    const supabase = buildNamedPlanSupabaseMock({ subscriptionState: "inactive" });

    const result = await dispatchConversationRoute({
      supabase,
      decision: namedPlanDecision(),
      payload: {
        ...samplePayload(),
        body_raw: "See if Marcus is free for a hike Saturday",
        body_normalized: "SEE IF MARCUS IS FREE FOR A HIKE SATURDAY",
      },
    });

    expect(result.engine).toBe("named_plan_request_handler");
    expect(result.reply_message).toContain("active JOSH subscription");
  });

  it("asks for contact clarification when a contact name is missing", async () => {
    const supabase = buildNamedPlanSupabaseMock({ subscriptionState: "active" });

    const result = await dispatchConversationRoute({
      supabase,
      decision: namedPlanDecision(),
      payload: {
        ...samplePayload(),
        body_raw: "Let's make a plan",
        body_normalized: "LET'S MAKE A PLAN",
      },
    });

    expect(result.engine).toBe("named_plan_request_handler");
    expect(result.reply_message).toContain("Who should I reach out to?");
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

function namedPlanDecision() {
  return {
    user_id: "usr_123",
    state: {
      mode: "idle" as const,
      state_token: "idle",
    },
    profile_is_complete_mvp: true,
    route: "named_plan_request_handler" as const,
    safety_override_applied: false,
    next_transition: "idle:awaiting_user_input",
  };
}

function buildNamedPlanSupabaseMock(input: { subscriptionState: string }) {
  return {
    from(table: string) {
      if (table === "subscriptions") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            return {
              data: { state: input.subscriptionState },
              error: null,
            };
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
  };
}
