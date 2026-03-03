import type {
  EngineDispatchInput,
  EngineDispatchResult,
} from "../router/conversation-router.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  createSupabaseEntitlementsRepository,
  evaluateEntitlements,
} from "../../../../packages/core/src/entitlements/evaluate-entitlements.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { handleInviteReply } from "../linkup/invite-replies.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { safetyHoldNotification } from "../../../../packages/messaging/src/templates/safety.ts";

const DEFAULT_ENGINE_STUB_REPLY = "JOSH router stub: default engine selected.";
const SAFETY_HOLD_MESSAGE = safetyHoldNotification();

export async function runDefaultEngine(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  const profileId = await fetchProfileId(input.supabase, input.decision.user_id);
  if (profileId) {
    const evaluation = await evaluateEntitlements({
      profile_id: profileId,
      repository: createSupabaseEntitlementsRepository(input.supabase),
    });
    if (evaluation.blocked_by_safety_hold) {
      return {
        engine: "default_engine",
        reply_message: SAFETY_HOLD_MESSAGE,
      };
    }
  }

  if (input.decision.state.mode === "awaiting_invite_reply") {
    return handleInviteReply(input);
  }

  return {
    engine: "default_engine",
    reply_message: DEFAULT_ENGINE_STUB_REPLY,
  };
}

async function fetchProfileId(
  supabase: EngineDispatchInput["supabase"],
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to resolve profile for default engine.");
  }

  if (!data?.id) {
    return null;
  }

  return data.id;
}
