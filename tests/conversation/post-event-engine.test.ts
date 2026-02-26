import { describe, expect, it } from "vitest";

// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { runPostEventEngine } from "../../supabase/functions/_shared/engines/post-event-engine";
import type { EngineDispatchInput } from "../../supabase/functions/_shared/router/conversation-router";

describe("post-event engine", () => {
  it("captures attendance and advances to reflection state", async () => {
    const supabase = buildSupabaseMock();

    const result = await runPostEventEngine(buildInput({
      supabase,
      stateToken: "post_event:attendance",
      inboundMessageSid: "SM_ATTEND_1",
      bodyRaw: "Yes, I made it",
    }));

    expect(result.engine).toBe("post_event_engine");
    expect(result.reply_message).toContain("Quick reflection");
    expect(supabase.debugState().attendanceWrites).toBe(1);
    expect(supabase.debugState().session.state_token).toBe("post_event:reflection");
  });

  it("does not duplicate attendance writes when same message is replayed", async () => {
    const supabase = buildSupabaseMock();

    await runPostEventEngine(buildInput({
      supabase,
      stateToken: "post_event:attendance",
      inboundMessageSid: "SM_DUP_1",
      bodyRaw: "Yes",
    }));
    await runPostEventEngine(buildInput({
      supabase,
      stateToken: "post_event:attendance",
      inboundMessageSid: "SM_DUP_1",
      bodyRaw: "Yes",
    }));

    expect(supabase.debugState().attendanceWrites).toBe(1);
    expect(supabase.debugState().processedMessageSids).toEqual(["SM_DUP_1"]);
    expect(supabase.debugState().session.state_token).toBe("post_event:reflection");
  });

  it("rejects unsupported post-event state transitions", async () => {
    await expect(runPostEventEngine(buildInput({
      supabase: buildSupabaseMock(),
      stateToken: "post_event:do_again",
      inboundMessageSid: "SM_BAD_1",
      bodyRaw: "Yes",
    }))).rejects.toThrow("Unsupported post-event state token");
  });
});

function buildInput(params: {
  supabase: ReturnType<typeof buildSupabaseMock>;
  stateToken: string;
  inboundMessageSid: string;
  bodyRaw: string;
}): EngineDispatchInput {
  return {
    supabase: params.supabase as unknown as EngineDispatchInput["supabase"],
    decision: {
      user_id: "usr_123",
      state: {
        mode: "post_event",
        state_token: params.stateToken,
      },
      profile_is_complete_mvp: true,
      route: "post_event_engine",
      safety_override_applied: false,
      next_transition: params.stateToken,
    },
    payload: {
      inbound_message_id: "msg_123",
      inbound_message_sid: params.inboundMessageSid,
      from_e164: "+15555550111",
      to_e164: "+15555550222",
      body_raw: params.bodyRaw,
      body_normalized: params.bodyRaw.toUpperCase(),
    },
  };
}

function buildSupabaseMock() {
  const state = {
    session: {
      id: "ses_123",
      mode: "post_event",
      state_token: "post_event:attendance",
      linkup_id: "lnk_123",
    },
    attendanceWrites: 0,
    processedMessageSids: new Set<string>(),
  };

  return {
    async rpc(fn: string, args?: Record<string, unknown>) {
      if (fn !== "capture_post_event_attendance") {
        return {
          data: null,
          error: new Error(`Unexpected rpc function '${fn}'.`),
        };
      }

      const inboundMessageSid = typeof args?.p_inbound_message_sid === "string"
        ? args.p_inbound_message_sid
        : "";
      const attendanceResult = typeof args?.p_attendance_result === "string"
        ? args.p_attendance_result
        : "unclear";
      const correlationId = typeof args?.p_correlation_id === "string"
        ? args.p_correlation_id
        : "msg_123";

      if (!inboundMessageSid) {
        return {
          data: null,
          error: new Error("Missing inbound message sid."),
        };
      }

      if (state.processedMessageSids.has(inboundMessageSid)) {
        return {
          data: [{
            previous_state_token: state.session.state_token,
            next_state_token: state.session.state_token,
            reason: "duplicate_replay",
            duplicate: true,
            linkup_id: state.session.linkup_id,
            correlation_id: correlationId,
            attendance_result: attendanceResult,
            mode: state.session.mode,
          }],
          error: null,
        };
      }

      if (state.session.state_token !== "post_event:attendance") {
        return {
          data: [{
            previous_state_token: state.session.state_token,
            next_state_token: state.session.state_token,
            reason: "state_not_attendance",
            duplicate: false,
            linkup_id: state.session.linkup_id,
            correlation_id: correlationId,
            attendance_result: attendanceResult,
            mode: state.session.mode,
          }],
          error: null,
        };
      }

      state.processedMessageSids.add(inboundMessageSid);
      state.attendanceWrites += 1;
      state.session.state_token = "post_event:reflection";

      return {
        data: [{
          previous_state_token: "post_event:attendance",
          next_state_token: "post_event:reflection",
          reason: "captured",
          duplicate: false,
          linkup_id: state.session.linkup_id,
          correlation_id: correlationId,
          attendance_result: attendanceResult,
          mode: state.session.mode,
        }],
        error: null,
      };
    },
    debugState() {
      return {
        session: { ...state.session },
        attendanceWrites: state.attendanceWrites,
        processedMessageSids: Array.from(state.processedMessageSids),
      };
    },
  };
}
