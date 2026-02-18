import type { WaitlistStatus } from "../regions/waitlist-routing";

export type ProfileEntitlementRow = {
  can_initiate: boolean;
  can_participate: boolean;
  can_exchange_contact: boolean;
  region_override: boolean;
  waitlist_override: boolean;
  safety_override: boolean;
  reason: string | null;
};

export type RegionSnapshot = {
  id: string;
  slug: string;
  is_active: boolean;
  is_launch_region: boolean;
};

export type WaitlistEntrySnapshot = {
  profile_id: string;
  region_id: string;
  status: WaitlistStatus;
  last_notified_at: string | null;
};

export type EntitlementsSnapshot = {
  profile_id: string;
  user_id: string;
  region: RegionSnapshot | null;
  waitlist_entry: WaitlistEntrySnapshot | null;
  has_active_safety_hold: boolean;
  stored_entitlements: ProfileEntitlementRow | null;
};

export type EntitlementsEvaluation = {
  profile_id: string;
  user_id: string;
  can_initiate: boolean;
  can_participate: boolean;
  can_exchange_contact: boolean;
  region_override: boolean;
  waitlist_override: boolean;
  safety_override: boolean;
  reason: string | null;
  is_active_region: boolean;
  is_waitlist_region: boolean;
  has_active_safety_hold: boolean;
  blocked_by_waitlist: boolean;
  blocked_by_safety_hold: boolean;
  region: RegionSnapshot | null;
  waitlist_entry: WaitlistEntrySnapshot | null;
};

export type EntitlementsRepository = {
  fetchProfileContext: (
    profileId: string,
  ) => Promise<{ id: string; user_id: string } | null>;
  fetchRegionContext: (profileId: string) => Promise<RegionSnapshot | null>;
  fetchWaitlistEntry: (profileId: string) => Promise<WaitlistEntrySnapshot | null>;
  fetchStoredEntitlements: (
    profileId: string,
  ) => Promise<ProfileEntitlementRow | null>;
  hasActiveSafetyHold: (userId: string) => Promise<boolean>;
};

type SupabaseClientLike = {
  from: (table: string) => any;
};

const DEFAULT_ENTITLEMENTS: ProfileEntitlementRow = {
  can_initiate: false,
  can_participate: false,
  can_exchange_contact: false,
  region_override: false,
  waitlist_override: false,
  safety_override: false,
  reason: null,
};

const VALID_WAITLIST_STATUSES: ReadonlySet<WaitlistStatus> = new Set<WaitlistStatus>([
  "waiting",
  "onboarded",
  "notified",
  "activated",
  "removed",
]);

export async function evaluateEntitlements(params: {
  profile_id: string;
  repository: EntitlementsRepository;
}): Promise<EntitlementsEvaluation> {
  const profile = await params.repository.fetchProfileContext(params.profile_id);
  if (!profile?.id || !profile.user_id) {
    throw new Error(`Profile '${params.profile_id}' not found for entitlement evaluation.`);
  }

  const [region, waitlistEntry, storedEntitlements, hasActiveSafetyHold] = await Promise.all([
    params.repository.fetchRegionContext(profile.id),
    params.repository.fetchWaitlistEntry(profile.id),
    params.repository.fetchStoredEntitlements(profile.id),
    params.repository.hasActiveSafetyHold(profile.user_id),
  ]);

  return resolveEntitlementsEvaluation({
    profile_id: profile.id,
    user_id: profile.user_id,
    region,
    waitlist_entry: waitlistEntry,
    has_active_safety_hold: hasActiveSafetyHold,
    stored_entitlements: storedEntitlements,
  });
}

export function resolveEntitlementsEvaluation(
  snapshot: EntitlementsSnapshot,
): EntitlementsEvaluation {
  const stored = snapshot.stored_entitlements ?? DEFAULT_ENTITLEMENTS;

  const isActiveRegion = isActiveLaunchRegion(snapshot.region);
  const isWaitlistRegion = !isActiveRegion && (Boolean(snapshot.region) || Boolean(snapshot.waitlist_entry));

  let canInitiate = stored.can_initiate;
  let canParticipate = stored.can_participate;
  let canExchangeContact = stored.can_exchange_contact;
  let blockedByWaitlist = false;
  let blockedBySafetyHold = false;

  if (snapshot.has_active_safety_hold && !stored.safety_override) {
    blockedBySafetyHold = true;
    canInitiate = false;
    canParticipate = false;
    canExchangeContact = false;
  } else {
    if (isWaitlistRegion && !stored.waitlist_override && !stored.region_override) {
      blockedByWaitlist = true;
      canInitiate = false;
      canParticipate = false;
    }

    if (!blockedByWaitlist && (isActiveRegion || stored.waitlist_override || stored.region_override)) {
      canParticipate = true;
    }
  }

  if (!stored.can_exchange_contact) {
    canExchangeContact = false;
  }

  return {
    profile_id: snapshot.profile_id,
    user_id: snapshot.user_id,
    can_initiate: canInitiate,
    can_participate: canParticipate,
    can_exchange_contact: canExchangeContact,
    region_override: stored.region_override,
    waitlist_override: stored.waitlist_override,
    safety_override: stored.safety_override,
    reason: stored.reason,
    is_active_region: isActiveRegion,
    is_waitlist_region: isWaitlistRegion,
    has_active_safety_hold: snapshot.has_active_safety_hold,
    blocked_by_waitlist: blockedByWaitlist,
    blocked_by_safety_hold: blockedBySafetyHold,
    region: snapshot.region,
    waitlist_entry: snapshot.waitlist_entry,
  };
}

export function createSupabaseEntitlementsRepository(
  supabase: SupabaseClientLike,
): EntitlementsRepository {
  return {
    fetchProfileContext: async (
      profileId: string,
    ): Promise<{ id: string; user_id: string } | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,user_id")
        .eq("id", profileId)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to resolve profile for entitlement evaluation.");
      }

      if (!data?.id || !data.user_id) {
        return null;
      }

      return {
        id: data.id,
        user_id: data.user_id,
      };
    },

    fetchRegionContext: async (profileId: string): Promise<RegionSnapshot | null> => {
      const { data, error } = await supabase
        .from("profile_region_assignments")
        .select("region_id,regions!inner(id,slug,is_active,is_launch_region)")
        .eq("profile_id", profileId)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to resolve profile region assignment for entitlement evaluation.");
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
    },

    fetchWaitlistEntry: async (profileId: string): Promise<WaitlistEntrySnapshot | null> => {
      const { data, error } = await supabase
        .from("waitlist_entries")
        .select("profile_id,region_id,status,last_notified_at")
        .eq("profile_id", profileId)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to resolve waitlist state for entitlement evaluation.");
      }

      if (!data?.profile_id || !data?.region_id || !data?.status) {
        return null;
      }

      if (!VALID_WAITLIST_STATUSES.has(data.status as WaitlistStatus)) {
        throw new Error("Waitlist entry contains an unknown status value.");
      }

      return {
        profile_id: data.profile_id,
        region_id: data.region_id,
        status: data.status as WaitlistStatus,
        last_notified_at: data.last_notified_at ?? null,
      };
    },

    fetchStoredEntitlements: async (
      profileId: string,
    ): Promise<ProfileEntitlementRow | null> => {
      const { data, error } = await supabase
        .from("profile_entitlements")
        .select(
          "can_initiate,can_participate,can_exchange_contact,region_override,waitlist_override,safety_override,reason",
        )
        .eq("profile_id", profileId)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to resolve stored profile entitlements.");
      }

      if (!data) {
        return null;
      }

      return {
        can_initiate: Boolean(data.can_initiate),
        can_participate: Boolean(data.can_participate),
        can_exchange_contact: Boolean(data.can_exchange_contact),
        region_override: Boolean(data.region_override),
        waitlist_override: Boolean(data.waitlist_override),
        safety_override: Boolean(data.safety_override),
        reason: typeof data.reason === "string" ? data.reason : null,
      };
    },

    hasActiveSafetyHold: async (userId: string): Promise<boolean> => {
      const { data, error } = await supabase
        .from("safety_holds")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle();

      if (error) {
        throw new Error("Unable to resolve safety hold state for entitlement evaluation.");
      }

      return Boolean(data?.id);
    },
  };
}

function isActiveLaunchRegion(region: RegionSnapshot | null): boolean {
  if (!region) {
    return false;
  }

  return region.slug === "us-wa" || (region.is_active && region.is_launch_region);
}
