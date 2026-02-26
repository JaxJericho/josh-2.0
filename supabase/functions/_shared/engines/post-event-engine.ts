// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  handlePostEventConversation,
  POST_EVENT_REFLECTION_PROMPT,
  type PostEventAttendanceResult,
} from "../../../../packages/core/src/conversation/post-event-handler.ts";
import type {
  EngineDispatchInput,
  EngineDispatchResult,
} from "../router/conversation-router.ts";

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
