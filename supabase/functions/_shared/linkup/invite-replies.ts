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
import {
  emitMetricBestEffort,
  emitRpcFailureMetric,
} from "../../../../packages/core/src/observability/metrics.ts";

const SEEN_LINKUP_IDS: Set<string> = new Set();
const SEEN_LINKUP_ORDER: string[] = [];
const MAX_TRACKED_LINKUPS = 5_000;

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
    emitRpcFailureMetric({
      correlation_id: input.payload.inbound_message_id,
      component: "linkup_invite_replies",
      rpc_name: "linkup_apply_invite_reply_with_coordination",
    });
    throw new Error(`Invite reply RPC failed: ${error.message ?? "unknown error"}`);
  }

  const status = readStatus(data);
  const resolvedLinkupId = readLinkupId(data) ?? linkupId;
  emitLinkupCreatedOnce(resolvedLinkupId, input.payload.inbound_message_id);
  if (status === "accepted_and_locked") {
    emitMetricBestEffort({
      metric: "conversation.linkup.completed",
      value: 1,
      correlation_id: input.payload.inbound_message_id,
      tags: {
        component: "linkup_invite_replies",
        source: "invite_reply_locked",
      },
    });
  }

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

function readLinkupId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as { linkup_id?: unknown }).linkup_id;
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
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

function emitLinkupCreatedOnce(
  linkupId: string,
  correlationId: string,
): void {
  if (SEEN_LINKUP_IDS.has(linkupId)) {
    return;
  }

  SEEN_LINKUP_IDS.add(linkupId);
  SEEN_LINKUP_ORDER.push(linkupId);
  if (SEEN_LINKUP_ORDER.length > MAX_TRACKED_LINKUPS) {
    const oldest = SEEN_LINKUP_ORDER.shift();
    if (oldest) {
      SEEN_LINKUP_IDS.delete(oldest);
    }
  }

  emitMetricBestEffort({
    metric: "conversation.linkup.created",
    value: 1,
    correlation_id: correlationId,
    tags: {
      component: "linkup_invite_replies",
      source: "invite_reply_observed",
    },
  });
}
