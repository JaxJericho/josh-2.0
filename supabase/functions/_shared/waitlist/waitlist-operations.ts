// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { resolveWaitlistReplay, type WaitlistEntrySnapshot } from "../../../../packages/core/src/regions/waitlist-routing.ts";
import type { EngineDispatchInput } from "../router/conversation-router.ts";

export const WAITLIST_CONFIRMATION_MESSAGE =
  "Thanks - JOSH is live in Washington first. You're on the waitlist for your area. We'll text you when we open.";

export const WAITLIST_FOLLOWUP_MESSAGE =
  "You're on the waitlist for your area. We'll text you when we open.";

type WaitlistGateResult = {
  is_waitlist_region: boolean;
  reply_message: string | null;
};

type ProfileContext = {
  id: string;
  user_id: string;
};

type RegionContext = {
  id: string;
  slug: string;
  is_active: boolean;
  is_launch_region: boolean;
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
      reply_message: null,
    };
  }

  const region = await fetchRegionContext(params.supabase, profile.id);
  if (!region) {
    return {
      is_waitlist_region: false,
      reply_message: null,
    };
  }

  const isActiveLaunchRegion = region.slug === "us-wa" ||
    (region.is_active && region.is_launch_region);

  if (isActiveLaunchRegion) {
    return {
      is_waitlist_region: false,
      reply_message: null,
    };
  }

  const existing = await fetchExistingWaitlistEntry(params.supabase, profile.id);
  const nowIso = new Date().toISOString();
  const replay = resolveWaitlistReplay({
    is_active_launch_region: false,
    profile_id: profile.id,
    region_id: region.id,
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
    region_id: region.id,
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
      reply_message: null,
    };
  }

  return {
    is_waitlist_region: true,
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

async function fetchRegionContext(
  supabase: EngineDispatchInput["supabase"],
  profileId: string,
): Promise<RegionContext | null> {
  const { data, error } = await supabase
    .from("profile_region_assignments")
    .select("region_id,regions!inner(id,slug,is_active,is_launch_region)")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to resolve profile region assignment for waitlist routing.");
  }

  if (!data) {
    return null;
  }

  const regionRaw = Array.isArray(data.regions)
    ? data.regions[0]
    : data.regions;

  if (!regionRaw?.id || !regionRaw?.slug) {
    throw new Error("Region assignment is missing canonical region details.");
  }

  return {
    id: regionRaw.id,
    slug: regionRaw.slug,
    is_active: Boolean(regionRaw.is_active),
    is_launch_region: Boolean(regionRaw.is_launch_region),
  };
}

async function fetchExistingWaitlistEntry(
  supabase: EngineDispatchInput["supabase"],
  profileId: string,
): Promise<WaitlistEntrySnapshot | null> {
  const { data, error } = await supabase
    .from("waitlist_entries")
    .select("profile_id,region_id,status,last_notified_at")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to read existing waitlist entry.");
  }

  if (!data?.profile_id || !data?.region_id || !data?.status) {
    return null;
  }

  return {
    profile_id: data.profile_id,
    region_id: data.region_id,
    status: data.status,
    last_notified_at: data.last_notified_at ?? null,
  };
}
