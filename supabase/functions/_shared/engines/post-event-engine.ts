// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  handlePostEventConversation,
  POST_EVENT_CONTACT_EXCHANGE_PROMPT,
  POST_EVENT_DO_AGAIN_PROMPT,
  POST_EVENT_REFLECTION_PROMPT,
  type PostEventAttendanceResult,
  type PostEventDoAgainDecision,
  type PostEventExchangeChoice,
} from "../../../../packages/core/src/conversation/post-event-handler.ts";
import type {
  EngineDispatchInput,
  EngineDispatchResult,
} from "../router/conversation-router.ts";

const POST_EVENT_CONTACT_EXCHANGE_PENDING_ACK =
  "Thanks. I recorded your choice. If others opt in too, JOSH will share contact details.";
const POST_EVENT_CONTACT_EXCHANGE_DECLINED_ACK =
  "Thanks. I recorded that you do not want to exchange contact details right now.";
const POST_EVENT_CONTACT_EXCHANGE_LATER_ACK =
  "Thanks. I recorded that for later. You can opt in when you're ready.";
const POST_EVENT_CONTACT_EXCHANGE_MUTUAL_ACK =
  "Mutual exchange confirmed. I just shared contact details with the people who also opted in.";
const POST_EVENT_CONTACT_EXCHANGE_BLOCKED_ACK =
  "I recorded your choice, but contact exchange is currently unavailable for safety review.";

export async function runPostEventEngine(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  const conversation = handlePostEventConversation({
    user_id: input.decision.user_id,
    session_mode: "post_event",
    session_state_token: input.decision.state.state_token,
    inbound_message_id: input.payload.inbound_message_id,
    inbound_message_sid: input.payload.inbound_message_sid,
    body_raw: input.payload.body_raw,
    body_normalized: input.payload.body_normalized,
    correlation_id: input.payload.inbound_message_id,
  });

  if (conversation.session_state_token === "post_event:attendance") {
    if (!conversation.attendance_result) {
      throw new Error("Post-event attendance state requires parsed attendance_result.");
    }

    const persisted = await persistAttendanceResult({
      supabase: input.supabase,
      userId: input.decision.user_id,
      inboundMessageId: input.payload.inbound_message_id,
      inboundMessageSid: input.payload.inbound_message_sid,
      attendanceResult: conversation.attendance_result,
      correlationId: input.payload.inbound_message_id,
    });

    return {
      engine: "post_event_engine",
      reply_message: persisted.next_state_token === "post_event:reflection"
        ? POST_EVENT_REFLECTION_PROMPT
        : conversation.reply_message,
    };
  }

  if (conversation.session_state_token === "post_event:complete") {
    if (!conversation.do_again_decision) {
      return {
        engine: "post_event_engine",
        reply_message: POST_EVENT_DO_AGAIN_PROMPT,
      };
    }

    const persisted = await persistDoAgainDecision({
      supabase: input.supabase,
      userId: input.decision.user_id,
      inboundMessageId: input.payload.inbound_message_id,
      inboundMessageSid: input.payload.inbound_message_sid,
      doAgain: conversation.do_again_decision,
      correlationId: input.payload.inbound_message_id,
    });

    if (persisted.reason === "state_not_complete") {
      throw new Error("Invalid post-event do-again transition: expected post_event:complete state.");
    }

    const acceptedReason = persisted.reason === "captured" ||
      persisted.reason === "duplicate_replay" ||
      persisted.reason === "already_recorded";
    if (!acceptedReason) {
      throw new Error(`Unable to persist post-event do-again decision: reason=${persisted.reason}`);
    }

    if (persisted.learning_signal_written) {
      console.info("post_event.learning_signal_written", {
        user_id: input.decision.user_id,
        linkup_id: persisted.linkup_id,
        attendance_result: persisted.attendance_result,
        do_again: persisted.do_again,
        correlation_id: persisted.correlation_id,
      });
    }

    return {
      engine: "post_event_engine",
      reply_message: persisted.next_state_token === "post_event:contact_exchange"
        ? POST_EVENT_CONTACT_EXCHANGE_PROMPT
        : conversation.reply_message,
    };
  }

  if (conversation.session_state_token === "post_event:contact_exchange") {
    if (!conversation.exchange_choice) {
      return {
        engine: "post_event_engine",
        reply_message: POST_EVENT_CONTACT_EXCHANGE_PROMPT,
      };
    }

    const persisted = await persistExchangeChoice({
      supabase: input.supabase,
      userId: input.decision.user_id,
      inboundMessageId: input.payload.inbound_message_id,
      inboundMessageSid: input.payload.inbound_message_sid,
      exchangeChoice: conversation.exchange_choice,
      correlationId: input.payload.inbound_message_id,
      smsEncryptionKey: getOptionalDenoEnv("SMS_BODY_ENCRYPTION_KEY"),
    });

    if (persisted.reason === "state_not_contact_exchange") {
      throw new Error(
        "Invalid post-event contact exchange transition: expected post_event:contact_exchange state.",
      );
    }

    const acceptedReason = persisted.reason === "captured" ||
      persisted.reason === "captured_revealed" ||
      persisted.reason === "mutual_already_revealed" ||
      persisted.reason === "blocked_by_safety" ||
      persisted.reason === "duplicate_replay";
    if (!acceptedReason) {
      throw new Error(
        `Unable to persist post-event contact exchange choice: reason=${persisted.reason}`,
      );
    }

    if (persisted.mutual_detected) {
      console.info("post_event.mutual_detected", {
        user_id: input.decision.user_id,
        linkup_id: persisted.linkup_id,
        correlation_id: persisted.correlation_id,
      });
    }

    if (persisted.reveal_sent) {
      console.info("post_event.reveal_sent", {
        user_id: input.decision.user_id,
        linkup_id: persisted.linkup_id,
        correlation_id: persisted.correlation_id,
      });
    }

    if (persisted.blocked_by_safety) {
      console.info("safety.contact_exchange_suppressed", {
        user_id: input.decision.user_id,
        linkup_id: persisted.linkup_id,
        correlation_id: persisted.correlation_id,
      });
    }

    return {
      engine: "post_event_engine",
      reply_message: buildContactExchangeReply(persisted),
    };
  }

  return {
    engine: "post_event_engine",
    reply_message: conversation.reply_message,
  };
}

type AttendancePersistResult = {
  previous_state_token: string;
  next_state_token: string;
  reason: string;
  duplicate: boolean;
};

type DoAgainPersistResult = {
  previous_state_token: string;
  next_state_token: string;
  attendance_result: string | null;
  do_again: PostEventDoAgainDecision;
  learning_signal_written: boolean;
  duplicate: boolean;
  reason: string;
  correlation_id: string;
  linkup_id: string | null;
};

type ContactExchangePersistResult = {
  previous_state_token: string;
  next_state_token: string;
  exchange_choice: PostEventExchangeChoice;
  exchange_opt_in: boolean | null;
  mutual_detected: boolean;
  reveal_sent: boolean;
  blocked_by_safety: boolean;
  duplicate: boolean;
  reason: string;
  correlation_id: string;
  linkup_id: string | null;
};

async function persistAttendanceResult(params: {
  supabase: EngineDispatchInput["supabase"];
  userId: string;
  inboundMessageId: string;
  inboundMessageSid: string;
  attendanceResult: PostEventAttendanceResult;
  correlationId: string;
}): Promise<AttendancePersistResult> {
  if (typeof params.supabase.rpc !== "function") {
    throw new Error(
      "Post-event attendance capture requires Supabase RPC support.",
    );
  }

  const { data, error } = await params.supabase.rpc("capture_post_event_attendance", {
    p_user_id: params.userId,
    p_inbound_message_id: params.inboundMessageId,
    p_inbound_message_sid: params.inboundMessageSid,
    p_attendance_result: params.attendanceResult,
    p_correlation_id: params.correlationId,
  });

  if (error) {
    throw new Error(`Unable to persist post-event attendance: ${error.message ?? "unknown error"}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
      previous_state_token?: unknown;
      next_state_token?: unknown;
      reason?: unknown;
      duplicate?: unknown;
      linkup_id?: unknown;
      correlation_id?: unknown;
      attendance_result?: unknown;
      mode?: unknown;
    }
    | null
    | undefined;

  if (!row) {
    throw new Error("Post-event attendance capture returned no result row.");
  }

  const previousStateToken =
    typeof row.previous_state_token === "string" ? row.previous_state_token : "";
  const nextStateToken = typeof row.next_state_token === "string" ? row.next_state_token : "";
  const reason = typeof row.reason === "string" ? row.reason : "unknown";
  const duplicate = row.duplicate === true;
  if (!previousStateToken || !nextStateToken) {
    throw new Error("Post-event attendance capture returned invalid state token values.");
  }

  console.info("post_event.attendance_captured", {
    user_id: params.userId,
    inbound_message_id: params.inboundMessageId,
    inbound_message_sid: params.inboundMessageSid,
    attendance_result: params.attendanceResult,
    previous_state_token: previousStateToken,
    next_state_token: nextStateToken,
    mode: typeof row.mode === "string" ? row.mode : null,
    reason,
    duplicate,
    linkup_id: typeof row.linkup_id === "string" ? row.linkup_id : null,
    correlation_id: typeof row.correlation_id === "string"
      ? row.correlation_id
      : params.correlationId,
  });

  return {
    previous_state_token: previousStateToken,
    next_state_token: nextStateToken,
    reason,
    duplicate,
  };
}

async function persistDoAgainDecision(params: {
  supabase: EngineDispatchInput["supabase"];
  userId: string;
  inboundMessageId: string;
  inboundMessageSid: string;
  doAgain: PostEventDoAgainDecision;
  correlationId: string;
}): Promise<DoAgainPersistResult> {
  if (typeof params.supabase.rpc !== "function") {
    throw new Error(
      "Post-event do-again capture requires Supabase RPC support.",
    );
  }

  const { data, error } = await params.supabase.rpc("capture_post_event_do_again", {
    p_user_id: params.userId,
    p_inbound_message_id: params.inboundMessageId,
    p_inbound_message_sid: params.inboundMessageSid,
    p_do_again: params.doAgain,
    p_correlation_id: params.correlationId,
  });

  if (error) {
    throw new Error(`Unable to persist post-event do-again decision: ${error.message ?? "unknown error"}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
      previous_state_token?: unknown;
      next_state_token?: unknown;
      attendance_result?: unknown;
      do_again?: unknown;
      learning_signal_written?: unknown;
      duplicate?: unknown;
      reason?: unknown;
      correlation_id?: unknown;
      linkup_id?: unknown;
      mode?: unknown;
    }
    | null
    | undefined;

  if (!row) {
    throw new Error("Post-event do-again capture returned no result row.");
  }

  const previousStateToken =
    typeof row.previous_state_token === "string" ? row.previous_state_token : "";
  const nextStateToken = typeof row.next_state_token === "string" ? row.next_state_token : "";
  const doAgainRaw = typeof row.do_again === "string" ? row.do_again : "";
  const reason = typeof row.reason === "string" ? row.reason : "unknown";
  const duplicate = row.duplicate === true;
  const correlationId = typeof row.correlation_id === "string"
    ? row.correlation_id
    : params.correlationId;
  const learningSignalWritten = row.learning_signal_written === true;
  const linkupId = typeof row.linkup_id === "string" ? row.linkup_id : null;
  const attendanceResult = typeof row.attendance_result === "string"
    ? row.attendance_result
    : null;

  if (!previousStateToken || !nextStateToken) {
    throw new Error("Post-event do-again capture returned invalid state token values.");
  }

  if (
    doAgainRaw !== "yes" &&
    doAgainRaw !== "no" &&
    doAgainRaw !== "unsure"
  ) {
    throw new Error("Post-event do-again capture returned invalid do_again value.");
  }

  console.info("post_event.do_again_captured", {
    user_id: params.userId,
    inbound_message_id: params.inboundMessageId,
    inbound_message_sid: params.inboundMessageSid,
    do_again: doAgainRaw,
    previous_state_token: previousStateToken,
    next_state_token: nextStateToken,
    mode: typeof row.mode === "string" ? row.mode : null,
    reason,
    duplicate,
    learning_signal_written: learningSignalWritten,
    attendance_result: attendanceResult,
    linkup_id: linkupId,
    correlation_id: correlationId,
  });

  return {
    previous_state_token: previousStateToken,
    next_state_token: nextStateToken,
    attendance_result: attendanceResult,
    do_again: doAgainRaw,
    learning_signal_written: learningSignalWritten,
    duplicate,
    reason,
    correlation_id: correlationId,
    linkup_id: linkupId,
  };
}

async function persistExchangeChoice(params: {
  supabase: EngineDispatchInput["supabase"];
  userId: string;
  inboundMessageId: string;
  inboundMessageSid: string;
  exchangeChoice: PostEventExchangeChoice;
  correlationId: string;
  smsEncryptionKey: string | null;
}): Promise<ContactExchangePersistResult> {
  if (typeof params.supabase.rpc !== "function") {
    throw new Error(
      "Post-event contact exchange capture requires Supabase RPC support.",
    );
  }

  const { data, error } = await params.supabase.rpc("capture_post_event_exchange_choice", {
    p_user_id: params.userId,
    p_inbound_message_id: params.inboundMessageId,
    p_inbound_message_sid: params.inboundMessageSid,
    p_exchange_choice: params.exchangeChoice,
    p_sms_encryption_key: params.smsEncryptionKey,
    p_correlation_id: params.correlationId,
  });

  if (error) {
    throw new Error(
      `Unable to persist post-event contact exchange choice: ${error.message ?? "unknown error"}`,
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
      previous_state_token?: unknown;
      next_state_token?: unknown;
      exchange_choice?: unknown;
      exchange_opt_in?: unknown;
      mutual_detected?: unknown;
      reveal_sent?: unknown;
      blocked_by_safety?: unknown;
      duplicate?: unknown;
      reason?: unknown;
      correlation_id?: unknown;
      linkup_id?: unknown;
      mode?: unknown;
    }
    | null
    | undefined;

  if (!row) {
    throw new Error("Post-event contact exchange capture returned no result row.");
  }

  const previousStateToken =
    typeof row.previous_state_token === "string" ? row.previous_state_token : "";
  const nextStateToken = typeof row.next_state_token === "string" ? row.next_state_token : "";
  const exchangeChoiceRaw = typeof row.exchange_choice === "string" ? row.exchange_choice : "";
  const reason = typeof row.reason === "string" ? row.reason : "unknown";
  const duplicate = row.duplicate === true;
  const correlationId = typeof row.correlation_id === "string"
    ? row.correlation_id
    : params.correlationId;
  const linkupId = typeof row.linkup_id === "string" ? row.linkup_id : null;

  if (!previousStateToken || !nextStateToken) {
    throw new Error("Post-event contact exchange capture returned invalid state token values.");
  }

  if (
    exchangeChoiceRaw !== "yes" &&
    exchangeChoiceRaw !== "no" &&
    exchangeChoiceRaw !== "later"
  ) {
    throw new Error("Post-event contact exchange capture returned invalid exchange_choice value.");
  }

  const exchangeOptIn = typeof row.exchange_opt_in === "boolean"
    ? row.exchange_opt_in
    : null;
  const mutualDetected = row.mutual_detected === true;
  const revealSent = row.reveal_sent === true;
  const blockedBySafety = row.blocked_by_safety === true;

  console.info("post_event.contact_choice_recorded", {
    user_id: params.userId,
    inbound_message_id: params.inboundMessageId,
    inbound_message_sid: params.inboundMessageSid,
    exchange_choice: exchangeChoiceRaw,
    exchange_opt_in: exchangeOptIn,
    previous_state_token: previousStateToken,
    next_state_token: nextStateToken,
    mode: typeof row.mode === "string" ? row.mode : null,
    reason,
    duplicate,
    mutual_detected: mutualDetected,
    reveal_sent: revealSent,
    blocked_by_safety: blockedBySafety,
    linkup_id: linkupId,
    correlation_id: correlationId,
  });

  return {
    previous_state_token: previousStateToken,
    next_state_token: nextStateToken,
    exchange_choice: exchangeChoiceRaw,
    exchange_opt_in: exchangeOptIn,
    mutual_detected: mutualDetected,
    reveal_sent: revealSent,
    blocked_by_safety: blockedBySafety,
    duplicate,
    reason,
    correlation_id: correlationId,
    linkup_id: linkupId,
  };
}

function buildContactExchangeReply(result: ContactExchangePersistResult): string {
  if (result.blocked_by_safety) {
    return POST_EVENT_CONTACT_EXCHANGE_BLOCKED_ACK;
  }

  if (result.reveal_sent) {
    return POST_EVENT_CONTACT_EXCHANGE_MUTUAL_ACK;
  }

  if (result.exchange_choice === "no") {
    return POST_EVENT_CONTACT_EXCHANGE_DECLINED_ACK;
  }

  if (result.exchange_choice === "later") {
    return POST_EVENT_CONTACT_EXCHANGE_LATER_ACK;
  }

  return POST_EVENT_CONTACT_EXCHANGE_PENDING_ACK;
}

function getOptionalDenoEnv(name: string): string | null {
  const denoRuntime = (globalThis as unknown as {
    Deno?: { env?: { get?: (key: string) => string | undefined } };
  }).Deno;
  const value = denoRuntime?.env?.get?.(name);
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
