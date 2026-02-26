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

  it("prompts do-again question while in complete state when reply is not parseable", async () => {
    const supabase = buildSupabaseMock({
      stateToken: "post_event:complete",
    });

    const result = await runPostEventEngine(buildInput({
      supabase,
      stateToken: "post_event:complete",
      inboundMessageSid: "SM_DO_AGAIN_PROMPT_1",
      bodyRaw: "That was interesting",
    }));

    expect(result.engine).toBe("post_event_engine");
    expect(result.reply_message).toContain("Would you want to hang out with this group again?");
    expect(supabase.debugState().doAgainWrites).toBe(0);
    expect(supabase.debugState().learningWrites).toBe(0);
  });

  it("captures do-again and advances to finalized state", async () => {
    const supabase = buildSupabaseMock({
      stateToken: "post_event:complete",
      attendanceResult: "attended",
    });

    const result = await runPostEventEngine(buildInput({
      supabase,
      stateToken: "post_event:complete",
      inboundMessageSid: "SM_DO_AGAIN_1",
      bodyRaw: "A",
    }));

    expect(result.engine).toBe("post_event_engine");
    expect(result.reply_message).toContain("Post-event follow-up is complete");
    expect(supabase.debugState().doAgainWrites).toBe(1);
    expect(supabase.debugState().learningWrites).toBe(1);
    expect(supabase.debugState().session.state_token).toBe("post_event:finalized");
    expect(supabase.debugState().doAgainDecision).toBe("yes");
  });

  it("does not duplicate do-again learning writes when same message is replayed", async () => {
    const supabase = buildSupabaseMock({
      stateToken: "post_event:complete",
      attendanceResult: "attended",
    });

    await runPostEventEngine(buildInput({
      supabase,
      stateToken: "post_event:complete",
      inboundMessageSid: "SM_DO_AGAIN_DUP_1",
      bodyRaw: "B",
    }));
    await runPostEventEngine(buildInput({
      supabase,
      stateToken: "post_event:complete",
      inboundMessageSid: "SM_DO_AGAIN_DUP_1",
      bodyRaw: "B",
    }));

    expect(supabase.debugState().doAgainWrites).toBe(1);
    expect(supabase.debugState().learningWrites).toBe(1);
    expect(supabase.debugState().processedDoAgainSids).toEqual(["SM_DO_AGAIN_DUP_1"]);
    expect(supabase.debugState().session.state_token).toBe("post_event:finalized");
  });

  it("rejects invalid do-again transition when persistence layer reports non-complete state", async () => {
    const supabase = buildSupabaseMock({
      stateToken: "post_event:reflection",
    });

    await expect(runPostEventEngine(buildInput({
      supabase,
      stateToken: "post_event:complete",
      inboundMessageSid: "SM_DO_AGAIN_BAD_STATE",
      bodyRaw: "A",
    }))).rejects.toThrow("Invalid post-event do-again transition");
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
      inbound_message_id: "00000000-0000-0000-0000-000000000123",
      inbound_message_sid: params.inboundMessageSid,
      from_e164: "+15555550111",
      to_e164: "+15555550222",
      body_raw: params.bodyRaw,
      body_normalized: params.bodyRaw.toUpperCase(),
    },
  };
}

function buildSupabaseMock(params?: {
  stateToken?: string;
  attendanceResult?: string;
  learningAlreadyWritten?: boolean;
}) {
  const state = {
    session: {
      id: "ses_123",
      mode: "post_event",
      state_token: params?.stateToken ?? "post_event:attendance",
      linkup_id: "lnk_123",
    },
    attendanceResult: params?.attendanceResult ?? "attended",
    doAgainDecision: null as "yes" | "no" | "unsure" | null,
    attendanceWrites: 0,
    doAgainWrites: 0,
    learningWrites: 0,
    learningAlreadyWritten: params?.learningAlreadyWritten ?? false,
    processedAttendanceSids: new Set<string>(),
    processedDoAgainSids: new Set<string>(),
  };

  return {
    async rpc(fn: string, args?: Record<string, unknown>) {
      if (fn === "capture_post_event_attendance") {
        return handleAttendanceRpc(state, args);
      }

      if (fn === "capture_post_event_do_again") {
        return handleDoAgainRpc(state, args);
      }

      return {
        data: null,
        error: new Error(`Unexpected rpc function '${fn}'.`),
      };
    },
    debugState() {
      return {
        session: { ...state.session },
        attendanceWrites: state.attendanceWrites,
        doAgainWrites: state.doAgainWrites,
        learningWrites: state.learningWrites,
        doAgainDecision: state.doAgainDecision,
        processedAttendanceSids: Array.from(state.processedAttendanceSids),
        processedDoAgainSids: Array.from(state.processedDoAgainSids),
      };
    },
  };
}

function handleAttendanceRpc(
  state: {
    session: { id: string; mode: string; state_token: string; linkup_id: string };
    attendanceResult: string;
    attendanceWrites: number;
    processedAttendanceSids: Set<string>;
  },
  args?: Record<string, unknown>,
) {
  const inboundMessageSid = typeof args?.p_inbound_message_sid === "string"
    ? args.p_inbound_message_sid
    : "";
  const attendanceResult = typeof args?.p_attendance_result === "string"
    ? args.p_attendance_result
    : state.attendanceResult;
  const correlationId = typeof args?.p_correlation_id === "string"
    ? args.p_correlation_id
    : "00000000-0000-0000-0000-000000000123";

  if (!inboundMessageSid) {
    return {
      data: null,
      error: new Error("Missing inbound message sid."),
    };
  }

  if (state.processedAttendanceSids.has(inboundMessageSid)) {
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

  state.processedAttendanceSids.add(inboundMessageSid);
  state.attendanceWrites += 1;
  state.session.state_token = "post_event:reflection";
  state.attendanceResult = attendanceResult;

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
}

function handleDoAgainRpc(
  state: {
    session: { id: string; mode: string; state_token: string; linkup_id: string };
    attendanceResult: string;
    doAgainDecision: "yes" | "no" | "unsure" | null;
    doAgainWrites: number;
    learningWrites: number;
    learningAlreadyWritten: boolean;
    processedDoAgainSids: Set<string>;
  },
  args?: Record<string, unknown>,
) {
  const inboundMessageSid = typeof args?.p_inbound_message_sid === "string"
    ? args.p_inbound_message_sid
    : "";
  const doAgainRaw = typeof args?.p_do_again === "string" ? args.p_do_again : "";
  const correlationId = typeof args?.p_correlation_id === "string"
    ? args.p_correlation_id
    : "00000000-0000-0000-0000-000000000123";

  const doAgain = doAgainRaw === "yes" || doAgainRaw === "no" || doAgainRaw === "unsure"
    ? doAgainRaw
    : null;

  if (!inboundMessageSid) {
    return {
      data: null,
      error: new Error("Missing inbound message sid."),
    };
  }

  if (!doAgain) {
    return {
      data: null,
      error: new Error("Invalid do_again value."),
    };
  }

  if (state.processedDoAgainSids.has(inboundMessageSid)) {
    return {
      data: [{
        previous_state_token: state.session.state_token,
        next_state_token: state.session.state_token,
        attendance_result: state.attendanceResult,
        do_again: state.doAgainDecision ?? doAgain,
        learning_signal_written: false,
        duplicate: true,
        reason: "duplicate_replay",
        correlation_id: correlationId,
        linkup_id: state.session.linkup_id,
        mode: state.session.mode,
      }],
      error: null,
    };
  }

  if (state.learningAlreadyWritten) {
    state.processedDoAgainSids.add(inboundMessageSid);
    state.session.state_token = "post_event:finalized";

    return {
      data: [{
        previous_state_token: "post_event:complete",
        next_state_token: "post_event:finalized",
        attendance_result: state.attendanceResult,
        do_again: state.doAgainDecision ?? doAgain,
        learning_signal_written: false,
        duplicate: false,
        reason: "already_recorded",
        correlation_id: correlationId,
        linkup_id: state.session.linkup_id,
        mode: state.session.mode,
      }],
      error: null,
    };
  }

  if (state.session.state_token !== "post_event:complete") {
    return {
      data: [{
        previous_state_token: state.session.state_token,
        next_state_token: state.session.state_token,
        attendance_result: state.attendanceResult,
        do_again: doAgain,
        learning_signal_written: false,
        duplicate: false,
        reason: "state_not_complete",
        correlation_id: correlationId,
        linkup_id: state.session.linkup_id,
        mode: state.session.mode,
      }],
      error: null,
    };
  }

  state.processedDoAgainSids.add(inboundMessageSid);
  state.doAgainWrites += 1;
  state.learningWrites += 1;
  state.learningAlreadyWritten = true;
  state.doAgainDecision = doAgain;
  state.session.state_token = "post_event:finalized";

  return {
    data: [{
      previous_state_token: "post_event:complete",
      next_state_token: "post_event:finalized",
      attendance_result: state.attendanceResult,
      do_again: doAgain,
      learning_signal_written: true,
      duplicate: false,
      reason: "captured",
      correlation_id: correlationId,
      linkup_id: state.session.linkup_id,
      mode: state.session.mode,
    }],
    error: null,
  };
}
