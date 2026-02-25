// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { handlePostEventConversation } from "../../../../packages/core/src/conversation/post-event-handler.ts";
import type {
  EngineDispatchInput,
  EngineDispatchResult,
} from "../router/conversation-router.ts";

export async function runPostEventEngine(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  const result = handlePostEventConversation({
    user_id: input.decision.user_id,
    session_mode: "post_event",
    session_state_token: input.decision.state.state_token,
    inbound_message_id: input.payload.inbound_message_id,
    inbound_message_sid: input.payload.inbound_message_sid,
    body_raw: input.payload.body_raw,
    body_normalized: input.payload.body_normalized,
    correlation_id: input.payload.inbound_message_id,
  });

  return {
    engine: "post_event_engine",
    reply_message: result.reply_message,
  };
}
