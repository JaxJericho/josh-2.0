import type { EngineDispatchInput, EngineDispatchResult } from "../router/conversation-router.ts";

const CLARIFY_REPLY = "I didn't catch that. Reply YES to accept or NO to decline.";
const ACCEPTED_REPLY = "You're in. I'll text you when this LinkUp is locked.";
const LOCKED_REPLY = "You're in. This LinkUp is now locked.";
const DECLINED_REPLY = "Got it. You're out for this LinkUp.";
const CLOSED_REPLY = "This LinkUp is already locked, so this invite is closed.";
const EXPIRED_REPLY = "This invite already expired, so I couldn't apply that reply.";
const CAPACITY_REPLY = "This LinkUp just filled up, so I couldn't add you.";
const NO_INVITE_REPLY = "I couldn't find an open invite for you right now.";
const DUPLICATE_REPLY = "Thanks - we already processed that reply.";
const FALLBACK_REPLY = "I couldn't apply that reply right now. Reply HELP for support.";

export async function handleInviteReply(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  const linkupId = await resolveActiveLinkupId(input);

  if (!linkupId) {
    return {
      engine: "default_engine",
      reply_message: NO_INVITE_REPLY,
    };
  }

  const supabaseWithRpc = input.supabase as EngineDispatchInput["supabase"] & {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };

  const { data, error } = await supabaseWithRpc.rpc("linkup_apply_invite_reply", {
    p_user_id: input.decision.user_id,
    p_linkup_id: linkupId,
    p_inbound_message_id: input.payload.inbound_message_id,
    p_inbound_message_sid: input.payload.inbound_message_sid,
    p_message_text: input.payload.body_raw,
  });

  if (error) {
    throw new Error(`Invite reply RPC failed: ${error.message ?? "unknown error"}`);
  }

  const status = readStatus(data);

  return {
    engine: "default_engine",
    reply_message: mapReplyMessage(status),
  };
}

async function resolveActiveLinkupId(
  input: EngineDispatchInput,
): Promise<string | null> {
  const { data: session, error: sessionError } = await input.supabase
    .from("conversation_sessions")
    .select("linkup_id")
    .eq("user_id", input.decision.user_id)
    .maybeSingle();

  if (sessionError) {
    throw new Error("Unable to resolve conversation session for invite replies.");
  }

  const sessionLinkupId = (session as { linkup_id?: string | null } | null)?.linkup_id ?? null;
  if (sessionLinkupId) {
    return sessionLinkupId;
  }

  const { data: inviteRow, error: inviteError } = await input.supabase
    .from("linkup_invites")
    .select("linkup_id,state")
    .eq("invited_user_id", input.decision.user_id)
    .in("state", ["pending", "accepted", "declined"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (inviteError) {
    throw new Error("Unable to resolve active invite for invite replies.");
  }

  return (inviteRow as { linkup_id?: string | null } | null)?.linkup_id ?? null;
}

function readStatus(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "unknown";
  }

  const status = (payload as { status?: unknown }).status;
  return typeof status === "string" ? status : "unknown";
}

function mapReplyMessage(status: string): string {
  switch (status) {
    case "accepted_and_locked":
      return LOCKED_REPLY;
    case "accepted":
    case "already_accepted":
      return ACCEPTED_REPLY;
    case "declined":
    case "already_declined":
      return DECLINED_REPLY;
    case "capacity_reached":
      return CAPACITY_REPLY;
    case "late_after_lock":
    case "invite_closed":
      return CLOSED_REPLY;
    case "invite_expired":
    case "expired":
    case "acceptance_window_elapsed":
      return EXPIRED_REPLY;
    case "unclear_reply":
      return CLARIFY_REPLY;
    case "duplicate_replay":
    case "idempotent_replay":
      return DUPLICATE_REPLY;
    case "no_active_invite":
    case "linkup_missing":
      return NO_INVITE_REPLY;
    default:
      return FALLBACK_REPLY;
  }
}
