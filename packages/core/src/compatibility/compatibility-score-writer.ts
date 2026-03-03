import { scorePair, type CompatibilityScoreResult, type CompatibilitySignalSnapshot } from "./scorer.ts";
import {
  createSupabaseEntitlementsRepository,
  evaluateEntitlements,
} from "../entitlements/evaluate-entitlements.ts";

export const COMPATIBILITY_SCORE_TABLE = "profile_compatibility_scores";

type SupabaseClientLike = {
  from: (table: string) => any;
};

type UserRow = {
  id: string;
  state: string;
  deleted_at: string | null;
};

type ProfileRow = {
  id: string;
  user_id: string;
  state: string;
  is_complete_mvp: boolean;
  coordination_dimensions: unknown;
};

export type ComputeAndUpsertScoreResult = CompatibilityScoreResult & {
  user_a_id: string;
  user_b_id: string;
  upserted: true;
};

export async function computeAndUpsertScore(params: {
  supabase: SupabaseClientLike;
  user_a_id: string;
  user_b_id: string;
}): Promise<ComputeAndUpsertScoreResult> {
  const pair = canonicalizePair(params.user_a_id, params.user_b_id);

  const leftContext = await loadEligibleUserContext(params.supabase, pair.user_a_id);
  const rightContext = await loadEligibleUserContext(params.supabase, pair.user_b_id);

  const score = scorePair(
    toSignalSnapshot(leftContext.profile),
    toSignalSnapshot(rightContext.profile),
  );

  const row = {
    user_a_id: pair.user_a_id,
    user_b_id: pair.user_b_id,
    a_hash: score.a_hash,
    b_hash: score.b_hash,
    score_version: score.version,
    score_total: score.score,
    breakdown_json: score.breakdown,
  };

  const { error } = await params.supabase
    .from(COMPATIBILITY_SCORE_TABLE)
    .upsert(row, {
      onConflict: "user_a_id,user_b_id,a_hash,b_hash,score_version",
      ignoreDuplicates: false,
    });

  if (error) {
    throw new Error(
      `Failed to upsert compatibility score for pair '${pair.user_a_id}' and '${pair.user_b_id}'.`,
    );
  }

  return {
    ...score,
    user_a_id: pair.user_a_id,
    user_b_id: pair.user_b_id,
    upserted: true,
  };
}

async function loadEligibleUserContext(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<{ profile: ProfileRow }> {
  const profile = await assertUserIsEligible(supabase, userId);
  return { profile };
}

async function assertUserIsEligible(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<ProfileRow> {
  const user = await fetchUser(supabase, userId);
  if (user.state !== "active") {
    throw new Error(
      `User '${userId}' is not eligible: expected users.state='active', got '${user.state}'.`,
    );
  }

  if (user.deleted_at !== null) {
    throw new Error(`User '${userId}' is not eligible: account is deleted.`);
  }

  const profile = await fetchProfile(supabase, userId);
  if (!profile.is_complete_mvp && profile.state !== "complete_full") {
    throw new Error(
      `User '${userId}' is not eligible: profile must be complete before scoring.`,
    );
  }

  const entitlements = await evaluateEntitlements({
    profile_id: profile.id,
    repository: createSupabaseEntitlementsRepository(supabase),
  });
  if (!entitlements.can_participate) {
    if (entitlements.blocked_by_safety_hold) {
      throw new Error(
        `User '${userId}' is not eligible: active safety hold present.`,
      );
    }
    if (entitlements.blocked_by_waitlist) {
      throw new Error(
        `User '${userId}' is not eligible: waitlist gating is active.`,
      );
    }
    throw new Error(
      `User '${userId}' is not eligible: can_participate is false.`,
    );
  }

  return profile;
}

async function fetchUser(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<UserRow> {
  const { data, error } = await supabase
    .from("users")
    .select("id,state,deleted_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load user '${userId}' for compatibility scoring.`);
  }

  if (!data?.id) {
    throw new Error(`User '${userId}' not found.`);
  }

  return {
    id: data.id,
    state: data.state,
    deleted_at: data.deleted_at,
  };
}

async function fetchProfile(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<ProfileRow> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,user_id,state,is_complete_mvp,coordination_dimensions")
    .eq("user_id", userId)
    // complete_invited hard filter: never relax
    .neq("state", "complete_invited")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load profile for user '${userId}'.`);
  }

  if (!data?.id) {
    throw new Error(`Profile not found for user '${userId}'.`);
  }

  return {
    id: data.id,
    user_id: data.user_id,
    state: data.state,
    is_complete_mvp: data.is_complete_mvp,
    coordination_dimensions: data.coordination_dimensions ?? null,
  };
}

function toSignalSnapshot(row: ProfileRow): CompatibilitySignalSnapshot {
  return {
    coordination_dimensions: row.coordination_dimensions,
  };
}

function canonicalizePair(
  leftUserId: string,
  rightUserId: string,
): { user_a_id: string; user_b_id: string } {
  if (typeof leftUserId !== "string" || leftUserId.length === 0) {
    throw new Error("user_a_id must be a non-empty string.");
  }
  if (typeof rightUserId !== "string" || rightUserId.length === 0) {
    throw new Error("user_b_id must be a non-empty string.");
  }
  if (leftUserId === rightUserId) {
    throw new Error("Cannot compute compatibility score for the same user twice.");
  }

  if (leftUserId < rightUserId) {
    return {
      user_a_id: leftUserId,
      user_b_id: rightUserId,
    };
  }

  return {
    user_a_id: rightUserId,
    user_b_id: leftUserId,
  };
}
