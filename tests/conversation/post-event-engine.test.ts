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

  it("captures do-again and advances to contact exchange state", async () => {
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
    expect(result.reply_message).toContain("share your number");
    expect(supabase.debugState().doAgainWrites).toBe(1);
    expect(supabase.debugState().learningWrites).toBe(1);
    expect(supabase.debugState().session.state_token).toBe("post_event:contact_exchange");
    expect(supabase.debugState().doAgainDecision).toBe("yes");
  });

  it("records single opt-in without reveal when no mutual yes exists", async () => {
    const supabase = buildSupabaseMock({
      stateToken: "post_event:contact_exchange",
      counterpartOptIn: false,
    });

    const result = await runPostEventEngine(buildInput({
      supabase,
      stateToken: "post_event:contact_exchange",
      inboundMessageSid: "SM_EXCHANGE_SINGLE_1",
      bodyRaw: "YES",
    }));

    expect(result.engine).toBe("post_event_engine");
    expect(result.reply_message).toContain("recorded your choice");
    expect(supabase.debugState().exchangeWrites).toBe(1);
    expect(supabase.debugState().revealWrites).toBe(0);
    expect(supabase.debugState().session.state_token).toBe("post_event:finalized");
  });

  it("reveals exactly once when mutual opt-in is detected", async () => {
    const supabase = buildSupabaseMock({
      stateToken: "post_event:contact_exchange",
      counterpartOptIn: true,
    });

    const result = await runPostEventEngine(buildInput({
      supabase,
      stateToken: "post_event:contact_exchange",
      inboundMessageSid: "SM_EXCHANGE_MUTUAL_1",
      bodyRaw: "YES",
    }));

    expect(result.engine).toBe("post_event_engine");
    expect(result.reply_message).toContain("Mutual exchange confirmed");
    expect(supabase.debugState().exchangeWrites).toBe(1);
    expect(supabase.debugState().revealWrites).toBe(1);
    expect(supabase.debugState().session.state_token).toBe("post_event:finalized");
  });

  it("does not duplicate reveal when same exchange submission is replayed", async () => {
    const supabase = buildSupabaseMock({
      stateToken: "post_event:contact_exchange",
      counterpartOptIn: true,
    });

    await runPostEventEngine(buildInput({
      supabase,
      stateToken: "post_event:contact_exchange",
      inboundMessageSid: "SM_EXCHANGE_DUP_1",
      bodyRaw: "YES",
    }));

    supabase.setStateToken("post_event:contact_exchange");

    await runPostEventEngine(buildInput({
      supabase,
      stateToken: "post_event:contact_exchange",
      inboundMessageSid: "SM_EXCHANGE_DUP_1",
      bodyRaw: "YES",
    }));

    expect(supabase.debugState().exchangeWrites).toBe(1);
    expect(supabase.debugState().revealWrites).toBe(1);
    expect(supabase.debugState().processedExchangeSids).toEqual(["SM_EXCHANGE_DUP_1"]);
  });

  it("blocks reveal when safety gate denies mutual exchange", async () => {
    const supabase = buildSupabaseMock({
      stateToken: "post_event:contact_exchange",
      counterpartOptIn: true,
      safetyBlocked: true,
    });

    const result = await runPostEventEngine(buildInput({
      supabase,
      stateToken: "post_event:contact_exchange",
      inboundMessageSid: "SM_EXCHANGE_BLOCK_1",
      bodyRaw: "YES",
    }));

    expect(result.engine).toBe("post_event_engine");
    expect(result.reply_message).toContain("safety review");
    expect(supabase.debugState().exchangeWrites).toBe(1);
    expect(supabase.debugState().revealWrites).toBe(0);
  });

  it("rejects invalid contact exchange transition when persistence layer reports non-contact state", async () => {
    const supabase = buildSupabaseMock({
      stateToken: "post_event:reflection",
    });

    await expect(runPostEventEngine(buildInput({
      supabase,
      stateToken: "post_event:contact_exchange",
      inboundMessageSid: "SM_EXCHANGE_BAD_STATE",
      bodyRaw: "YES",
    }))).rejects.toThrow("Invalid post-event contact exchange transition");
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
  counterpartOptIn?: boolean;
  safetyBlocked?: boolean;
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
    exchangeChoice: null as "yes" | "no" | "later" | null,
    counterpartOptIn: params?.counterpartOptIn ?? false,
    safetyBlocked: params?.safetyBlocked ?? false,
    revealAlreadySent: false,
    attendanceWrites: 0,
    doAgainWrites: 0,
    learningWrites: 0,
    exchangeWrites: 0,
    revealWrites: 0,
    processedAttendanceSids: new Set<string>(),
    processedDoAgainSids: new Set<string>(),
    processedExchangeSids: new Set<string>(),
  };

  return {
    async rpc(fn: string, args?: Record<string, unknown>) {
      if (fn === "capture_post_event_attendance") {
        return handleAttendanceRpc(state, args);
      }

      if (fn === "capture_post_event_do_again") {
        return handleDoAgainRpc(state, args);
      }

      if (fn === "capture_post_event_exchange_choice") {
        return handleExchangeChoiceRpc(state, args);
      }

      return {
        data: null,
        error: new Error(`Unexpected rpc function '${fn}'.`),
      };
    },
    debugState() {
      return {
        ...state,
        processedAttendanceSids: Array.from(state.processedAttendanceSids),
        processedDoAgainSids: Array.from(state.processedDoAgainSids),
        processedExchangeSids: Array.from(state.processedExchangeSids),
      };
    },
    setStateToken(nextStateToken: string) {
      state.session.state_token = nextStateToken;
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
  state.doAgainDecision = doAgain;
  state.session.state_token = "post_event:contact_exchange";

  return {
    data: [{
      previous_state_token: "post_event:complete",
      next_state_token: "post_event:contact_exchange",
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

function handleExchangeChoiceRpc(
  state: {
    session: { id: string; mode: string; state_token: string; linkup_id: string };
    exchangeChoice: "yes" | "no" | "later" | null;
    counterpartOptIn: boolean;
    safetyBlocked: boolean;
    revealAlreadySent: boolean;
    exchangeWrites: number;
    revealWrites: number;
    processedExchangeSids: Set<string>;
  },
  args?: Record<string, unknown>,
) {
  const inboundMessageSid = typeof args?.p_inbound_message_sid === "string"
    ? args.p_inbound_message_sid
    : "";
  const exchangeChoiceRaw = typeof args?.p_exchange_choice === "string"
    ? args.p_exchange_choice
    : "";
  const correlationId = typeof args?.p_correlation_id === "string"
    ? args.p_correlation_id
    : "00000000-0000-0000-0000-000000000123";

  const exchangeChoice = exchangeChoiceRaw === "yes" || exchangeChoiceRaw === "no" || exchangeChoiceRaw === "later"
    ? exchangeChoiceRaw
    : null;

  if (!inboundMessageSid) {
    return {
      data: null,
      error: new Error("Missing inbound message sid."),
    };
  }

  if (!exchangeChoice) {
    return {
      data: null,
      error: new Error("Invalid exchange choice."),
    };
  }

  if (state.processedExchangeSids.has(inboundMessageSid)) {
    return {
      data: [{
        previous_state_token: state.session.state_token,
        next_state_token: state.session.state_token,
        exchange_choice: state.exchangeChoice ?? exchangeChoice,
        exchange_opt_in: state.exchangeChoice === "yes" ? true : state.exchangeChoice === "no" ? false : null,
        mutual_detected: state.counterpartOptIn && (state.exchangeChoice ?? exchangeChoice) === "yes",
        reveal_sent: false,
        blocked_by_safety: false,
        duplicate: true,
        reason: "duplicate_replay",
        correlation_id: correlationId,
        linkup_id: state.session.linkup_id,
        mode: state.session.mode,
      }],
      error: null,
    };
  }

  if (state.session.state_token !== "post_event:contact_exchange") {
    return {
      data: [{
        previous_state_token: state.session.state_token,
        next_state_token: state.session.state_token,
        exchange_choice: exchangeChoice,
        exchange_opt_in: exchangeChoice === "yes" ? true : exchangeChoice === "no" ? false : null,
        mutual_detected: false,
        reveal_sent: false,
        blocked_by_safety: false,
        duplicate: false,
        reason: "state_not_contact_exchange",
        correlation_id: correlationId,
        linkup_id: state.session.linkup_id,
        mode: state.session.mode,
      }],
      error: null,
    };
  }

  state.processedExchangeSids.add(inboundMessageSid);
  state.exchangeWrites += 1;
  state.exchangeChoice = exchangeChoice;

  const mutualDetected = exchangeChoice === "yes" && state.counterpartOptIn;
  const blockedBySafety = mutualDetected && state.safetyBlocked;
  const revealSent = mutualDetected && !blockedBySafety && !state.revealAlreadySent;

  if (revealSent) {
    state.revealWrites += 1;
    state.revealAlreadySent = true;
  }

  state.session.state_token = "post_event:finalized";

  return {
    data: [{
      previous_state_token: "post_event:contact_exchange",
      next_state_token: "post_event:finalized",
      exchange_choice: exchangeChoice,
      exchange_opt_in: exchangeChoice === "yes" ? true : exchangeChoice === "no" ? false : null,
      mutual_detected: mutualDetected,
      reveal_sent: revealSent,
      blocked_by_safety: blockedBySafety,
      duplicate: false,
      reason: blockedBySafety
        ? "blocked_by_safety"
        : revealSent
        ? "captured_revealed"
        : mutualDetected
        ? "mutual_already_revealed"
        : "captured",
      correlation_id: correlationId,
      linkup_id: state.session.linkup_id,
      mode: state.session.mode,
    }],
    error: null,
  };
}
