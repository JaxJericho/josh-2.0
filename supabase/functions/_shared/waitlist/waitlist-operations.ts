// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { resolveWaitlistReplay } from "../../../../packages/core/src/regions/waitlist-routing.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { createSupabaseEntitlementsRepository, evaluateEntitlements } from "../../../../packages/core/src/entitlements/evaluate-entitlements.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { safetyHoldNotification } from "../../../../packages/messaging/src/templates/safety.ts";
import type { EngineDispatchInput } from "../router/conversation-router.ts";

export const WAITLIST_CONFIRMATION_MESSAGE =
  "Thanks - JOSH is live in Washington first. You're on the waitlist for your area. We'll text you when we open.";

export const WAITLIST_FOLLOWUP_MESSAGE =
  "You're on the waitlist for your area. We'll text you when we open.";

export const SAFETY_HOLD_MESSAGE =
  safetyHoldNotification();

type WaitlistGateResult = {
  is_waitlist_region: boolean;
  blocked_by_safety_hold: boolean;
  reply_message: string | null;
};

type ProfileContext = {
  id: string;
  user_id: string;
};

export async function enforceWaitlistGate(params: {
  supabase: EngineDispatchInput["supabase"];
  userId: string;
  allowNotification: boolean;
}): Promise<WaitlistGateResult> {
  const profile = await fetchProfileContext(params.supabase, params.userId);
  if (!profile) {
    return {
      is_waitlist_region: false,
      blocked_by_safety_hold: false,
      reply_message: null,
    };
  }

  const evaluation = await evaluateEntitlements({
    profile_id: profile.id,
    repository: createSupabaseEntitlementsRepository(params.supabase),
  });
  if (evaluation.blocked_by_safety_hold) {
    return {
      is_waitlist_region: false,
      blocked_by_safety_hold: true,
      reply_message: params.allowNotification ? SAFETY_HOLD_MESSAGE : null,
    };
  }

  if (!evaluation.blocked_by_waitlist) {
    return {
      is_waitlist_region: false,
      blocked_by_safety_hold: false,
      reply_message: null,
    };
  }

  const regionId = evaluation.region?.id ?? evaluation.waitlist_entry?.region_id ?? null;
  if (!regionId) {
    throw new Error("Waitlist entitlement gate requires a canonical region assignment.");
  }

  const existing = evaluation.waitlist_entry;
  const nowIso = new Date().toISOString();
  const replay = resolveWaitlistReplay({
    is_active_launch_region: false,
    profile_id: profile.id,
    region_id: regionId,
    now_iso: nowIso,
    existing_entry: existing,
  });

  if (!replay.next_entry) {
    throw new Error("Waitlist replay resolution failed to return an entry.");
  }

  const shouldSendConfirmation = params.allowNotification && replay.should_send_confirmation;
  const status = shouldSendConfirmation
    ? "notified"
    : (existing?.status ?? "waiting");

  const payload: Record<string, unknown> = {
    profile_id: profile.id,
    user_id: profile.user_id,
    region_id: regionId,
    status,
    source: "sms",
    reason: "region_not_supported",
    updated_at: nowIso,
  };

  if (shouldSendConfirmation) {
    payload.last_notified_at = nowIso;
    payload.notified_at = nowIso;
  }

  const { error: upsertError } = await params.supabase
    .from("waitlist_entries")
    .upsert(payload, { onConflict: "profile_id" });

  if (upsertError) {
    throw new Error("Unable to upsert waitlist entry.");
  }

  if (!params.allowNotification) {
    return {
      is_waitlist_region: true,
      blocked_by_safety_hold: false,
      reply_message: null,
    };
  }

  return {
    is_waitlist_region: true,
    blocked_by_safety_hold: false,
    reply_message: shouldSendConfirmation
      ? WAITLIST_CONFIRMATION_MESSAGE
      : WAITLIST_FOLLOWUP_MESSAGE,
  };
}

async function fetchProfileContext(
  supabase: EngineDispatchInput["supabase"],
  userId: string,
): Promise<ProfileContext | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to resolve profile context for waitlist routing.");
  }

  if (!data?.id || !data.user_id) {
    return null;
  }

  return {
    id: data.id,
    user_id: data.user_id,
  };
}
