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
};

export type EntitlementsSnapshot = {
  profile_id: string;
  user_id: string;
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
  has_active_safety_hold: boolean;
  blocked_by_safety_hold: boolean;
};

export type EntitlementsRepository = {
  fetchProfileContext: (
    profileId: string,
  ) => Promise<{ id: string; user_id: string } | null>;
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

export async function evaluateEntitlements(params: {
  profile_id: string;
  repository: EntitlementsRepository;
}): Promise<EntitlementsEvaluation> {
  const profile = await params.repository.fetchProfileContext(params.profile_id);
  if (!profile?.id || !profile.user_id) {
    throw new Error(`Profile '${params.profile_id}' not found for entitlement evaluation.`);
  }

  const [storedEntitlements, hasActiveSafetyHold] = await Promise.all([
    params.repository.fetchStoredEntitlements(profile.id),
    params.repository.hasActiveSafetyHold(profile.user_id),
  ]);

  return resolveEntitlementsEvaluation({
    profile_id: profile.id,
    user_id: profile.user_id,
    has_active_safety_hold: hasActiveSafetyHold,
    stored_entitlements: storedEntitlements,
  });
}

export function resolveEntitlementsEvaluation(
  snapshot: EntitlementsSnapshot,
): EntitlementsEvaluation {
  const stored = snapshot.stored_entitlements ?? DEFAULT_ENTITLEMENTS;

  let canInitiate = stored.can_initiate;
  let canParticipate = stored.can_participate;
  let canExchangeContact = stored.can_exchange_contact;
  let blockedBySafetyHold = false;

  if (snapshot.has_active_safety_hold && !stored.safety_override) {
    blockedBySafetyHold = true;
    canInitiate = false;
    canParticipate = false;
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
    has_active_safety_hold: snapshot.has_active_safety_hold,
    blocked_by_safety_hold: blockedBySafetyHold,
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
