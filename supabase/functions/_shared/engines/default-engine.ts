import type {
  EngineDispatchInput,
  EngineDispatchResult,
} from "../router/conversation-router.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { enforceWaitlistGate } from "../waitlist/waitlist-operations.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { handleInviteReply } from "../linkup/invite-replies.ts";

const DEFAULT_ENGINE_STUB_REPLY = "JOSH router stub: default engine selected.";

export async function runDefaultEngine(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  const waitlistGate = await enforceWaitlistGate({
    supabase: input.supabase,
    userId: input.decision.user_id,
    allowNotification: true,
  });

  if (waitlistGate.reply_message) {
    return {
      engine: "default_engine",
      reply_message: waitlistGate.reply_message,
    };
  }

  if (input.decision.state.mode === "awaiting_invite_reply") {
    return handleInviteReply(input);
  }

  return {
    engine: "default_engine",
    reply_message: DEFAULT_ENGINE_STUB_REPLY,
  };
}
