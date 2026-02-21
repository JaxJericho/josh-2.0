import type { EngineDispatchInput, EngineDispatchResult } from "../router/conversation-router.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  linkupInviteAccepted,
  linkupInviteCapacityReached,
  linkupInviteClarifier,
  linkupInviteClosed,
  linkupInviteDeclined,
  linkupInviteDuplicateReply,
  linkupInviteExpired,
  linkupInviteFallbackReply,
  linkupInviteNotFound,
  linkupLockConfirmation,
} from "../../../../packages/messaging/src/templates/linkup.ts";

export async function handleInviteReply(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  const linkupId = await resolveActiveLinkupId(input);
  const smsEncryptionKey = readOptionalDenoEnv("SMS_BODY_ENCRYPTION_KEY");

  if (!linkupId) {
    return {
      engine: "default_engine",
      reply_message: linkupInviteNotFound(),
    };
  }

  const supabaseWithRpc = input.supabase as EngineDispatchInput["supabase"] & {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };

  const { data, error } = await supabaseWithRpc.rpc("linkup_apply_invite_reply_with_coordination", {
    p_user_id: input.decision.user_id,
    p_linkup_id: linkupId,
    p_inbound_message_id: input.payload.inbound_message_id,
    p_inbound_message_sid: input.payload.inbound_message_sid,
    p_message_text: input.payload.body_raw,
    p_sms_encryption_key: smsEncryptionKey,
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
      return linkupLockConfirmation();
    case "accepted":
    case "already_accepted":
      return linkupInviteAccepted();
    case "declined":
    case "already_declined":
      return linkupInviteDeclined();
    case "capacity_reached":
      return linkupInviteCapacityReached();
    case "late_after_lock":
    case "invite_closed":
      return linkupInviteClosed();
    case "invite_expired":
    case "expired":
    case "acceptance_window_elapsed":
      return linkupInviteExpired();
    case "unclear_reply":
      return linkupInviteClarifier();
    case "duplicate_replay":
    case "idempotent_replay":
      return linkupInviteDuplicateReply();
    case "no_active_invite":
    case "linkup_missing":
      return linkupInviteNotFound();
    default:
      return linkupInviteFallbackReply();
  }
}

function readOptionalDenoEnv(name: string): string | null {
  const denoGlobal = globalThis as typeof globalThis & {
    Deno?: {
      env?: {
        get?: (envName: string) => string | undefined;
      };
    };
  };

  const value = denoGlobal.Deno?.env?.get?.(name);
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
