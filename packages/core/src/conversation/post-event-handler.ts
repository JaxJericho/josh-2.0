export type PostEventConversationInput = {
  user_id: string;
  session_mode: "post_event";
  session_state_token: string;
  inbound_message_id: string;
  inbound_message_sid: string;
  body_raw: string;
  body_normalized: string;
  correlation_id: string;
};

export type PostEventConversationResult = {
  reply_message: string | null;
};

const POST_EVENT_STUB_REPLY =
  "Thanks for the update. Post-event follow-up is initializing.";

export function handlePostEventConversation(
  input: PostEventConversationInput,
): PostEventConversationResult {
  console.info("conversation.post_event_handler_entered", {
    user_id: input.user_id,
    session_mode: input.session_mode,
    session_state_token: input.session_state_token,
    inbound_message_id: input.inbound_message_id,
    inbound_message_sid: input.inbound_message_sid,
    correlation_id: input.correlation_id,
  });

  return {
    reply_message: POST_EVENT_STUB_REPLY,
  };
}
