export type EligibilityActionType =
  | "can_participate_in_linkup"
  | "can_receive_contact_invitation"
  | "can_receive_invitation";

export type EligibilityReason =
  | "INELIGIBLE_REGION"
  | "INELIGIBLE_SUBSCRIPTION"
  | "INELIGIBLE_SAFETY_HOLD"
  | "INELIGIBLE_PROFILE_INCOMPLETE"
  | "INELIGIBLE_ACCOUNT_STATUS"
  | "INELIGIBLE_WEBHOOK_PENDING";

export type EligibilityResult =
  | {
    eligible: true;
    reason?: undefined;
  }
  | {
    eligible: false;
    reason: EligibilityReason;
  };

export type EligibilityRepository = {
  getRegionForUser: (userId: string) => Promise<{ status: string | null } | null>;
  getSubscription: (userId: string) => Promise<{ status: string | null } | null>;
  getProfile: (userId: string) => Promise<{ state: string | null } | null>;
  getSafetyHold: (userId: string) => Promise<string>;
  hasActiveUserRecord: (userId: string) => Promise<boolean>;
};

type SupabaseClientLike = {
  from: (table: string) => any;
};

const ALLOWED_ACTION_TYPES: EligibilityActionType[] = [
  "can_participate_in_linkup",
  "can_receive_contact_invitation",
  "can_receive_invitation",
];

export async function evaluateEligibility(params: {
  userId: string;
  action_type: EligibilityActionType | string;
  repository: EligibilityRepository;
}): Promise<EligibilityResult> {
  const { action_type, repository, userId } = params;

  if (!isEligibilityActionType(action_type)) {
    throw new Error(
      `evaluateEligibility called with unknown action_type: ${action_type}`,
    );
  }

  switch (action_type) {
    case "can_participate_in_linkup": {
      const region = await repository.getRegionForUser(userId);
      if (region?.status !== "open") {
        return { eligible: false, reason: "INELIGIBLE_REGION" };
      }

      const subscription = await repository.getSubscription(userId);
      if (subscription?.status !== "active") {
        return { eligible: false, reason: "INELIGIBLE_SUBSCRIPTION" };
      }

      return { eligible: true };
    }

    case "can_receive_contact_invitation": {
      const hasActiveUserRecord = await repository.hasActiveUserRecord(userId);
      if (!hasActiveUserRecord) {
        return { eligible: false, reason: "INELIGIBLE_ACCOUNT_STATUS" };
      }

      return { eligible: true };
    }

    case "can_receive_invitation": {
      const subscription = await repository.getSubscription(userId);
      if (subscription?.status !== "active") {
        return { eligible: false, reason: "INELIGIBLE_SUBSCRIPTION" };
      }

      const profile = await repository.getProfile(userId);
      if (
        profile?.state !== "complete_mvp" &&
        profile?.state !== "complete_full"
      ) {
        return { eligible: false, reason: "INELIGIBLE_PROFILE_INCOMPLETE" };
      }

      const safetyHold = await repository.getSafetyHold(userId);
      if (safetyHold !== "none") {
        return { eligible: false, reason: "INELIGIBLE_SAFETY_HOLD" };
      }

      return { eligible: true };
    }
  }
}

export function createSupabaseEligibilityRepository(
  supabase: SupabaseClientLike,
): EligibilityRepository {
  return {
    getRegionForUser: async (
      userId: string,
    ): Promise<{ status: string | null } | null> => {
      const profile = await fetchProfileRowByUserId(supabase, userId);
      if (!profile?.id) {
        return null;
      }

      const { data: assignment, error: assignmentError } = await supabase
        .from("profile_region_assignments")
        .select("region_id")
        .eq("profile_id", profile.id)
        .maybeSingle();

      if (assignmentError) {
        throw new Error("Unable to resolve region assignment for eligibility evaluation.");
      }

      if (!assignment?.region_id) {
        return null;
      }

      const { data: region, error: regionError } = await supabase
        .from("regions")
        .select("state")
        .eq("id", assignment.region_id)
        .maybeSingle();

      if (regionError) {
        throw new Error("Unable to resolve region for eligibility evaluation.");
      }

      return {
        status: typeof region?.state === "string" ? region.state : null,
      };
    },

    getSubscription: async (
      userId: string,
    ): Promise<{ status: string | null } | null> => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("status")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to resolve subscription for eligibility evaluation.");
      }

      return {
        status: typeof data?.status === "string" ? data.status : null,
      };
    },

    getProfile: async (
      userId: string,
    ): Promise<{ state: string | null } | null> => {
      const profile = await fetchProfileRowByUserId(supabase, userId);
      if (!profile) {
        return null;
      }

      return {
        state: profile.state,
      };
    },

    getSafetyHold: async (userId: string): Promise<string> => {
      const { data, error } = await supabase
        .from("safety_holds")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle();

      if (error) {
        throw new Error("Unable to resolve safety hold for eligibility evaluation.");
      }

      return data?.id ? "active" : "none";
    },

    hasActiveUserRecord: async (userId: string): Promise<boolean> => {
      const { data, error } = await supabase
        .from("users")
        .select("id")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to resolve user account for eligibility evaluation.");
      }

      return Boolean(data?.id);
    },
  };
}

function isEligibilityActionType(value: string): value is EligibilityActionType {
  return ALLOWED_ACTION_TYPES.includes(value as EligibilityActionType);
}

async function fetchProfileRowByUserId(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<{ id: string; state: string | null } | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,state")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to resolve profile for eligibility evaluation.");
  }

  if (!data?.id) {
    return null;
  }

  return {
    id: data.id,
    state: typeof data.state === "string" ? data.state : null,
  };
}
