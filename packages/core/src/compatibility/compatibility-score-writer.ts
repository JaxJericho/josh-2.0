import { COMPATIBILITY_SIGNAL_TABLE } from "./compatibility-signal-writer";
import { scorePair, type CompatibilityScoreResult, type CompatibilitySignalSnapshot } from "./scorer";

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
};

type EntitlementRow = {
  user_id: string;
  can_receive_intro: boolean;
};

type SignalRow = {
  user_id: string;
  interest_vector: number[];
  trait_vector: number[];
  intent_vector: number[];
  availability_vector: number[];
  metadata: Record<string, unknown>;
  content_hash: string;
};

export type ComputeAndUpsertScoreResult = CompatibilityScoreResult & {
  user_a_id: string;
  user_b_id: string;
  upserted: true;
};

export async function getSignalsForUser(params: {
  supabase: SupabaseClientLike;
  user_id: string;
}): Promise<SignalRow> {
  const { data, error } = await params.supabase
    .from(COMPATIBILITY_SIGNAL_TABLE)
    .select(
      "user_id,interest_vector,trait_vector,intent_vector,availability_vector,metadata,content_hash",
    )
    .eq("user_id", params.user_id)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load compatibility signals for user '${params.user_id}'.`,
    );
  }

  if (!data?.user_id) {
    throw new Error(
      `Compatibility signals not found for user '${params.user_id}'.`,
    );
  }

  return {
    user_id: data.user_id,
    interest_vector: data.interest_vector,
    trait_vector: data.trait_vector,
    intent_vector: data.intent_vector,
    availability_vector: data.availability_vector,
    metadata: (data.metadata ?? {}) as Record<string, unknown>,
    content_hash: data.content_hash,
  };
}

export async function computeAndUpsertScore(params: {
  supabase: SupabaseClientLike;
  user_a_id: string;
  user_b_id: string;
}): Promise<ComputeAndUpsertScoreResult> {
  const pair = canonicalizePair(params.user_a_id, params.user_b_id);

  const leftContext = await loadEligibleUserContext(params.supabase, pair.user_a_id);
  const rightContext = await loadEligibleUserContext(params.supabase, pair.user_b_id);

  const score = scorePair(
    toSignalSnapshot(leftContext.signals),
    toSignalSnapshot(rightContext.signals),
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
): Promise<{ signals: SignalRow }> {
  await assertUserIsEligible(supabase, userId);
  const signals = await getSignalsForUser({
    supabase,
    user_id: userId,
  });
  return { signals };
}

async function assertUserIsEligible(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<void> {
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

  const entitlements = await fetchEntitlements(supabase, userId);
  if (!entitlements.can_receive_intro) {
    throw new Error(
      `User '${userId}' is not eligible: can_receive_intro is false.`,
    );
  }

  await assertNoActiveSafetyHold(supabase, userId);
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
    .select("id,user_id,state,is_complete_mvp")
    .eq("user_id", userId)
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
  };
}

async function fetchEntitlements(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<EntitlementRow> {
  const { data, error } = await supabase
    .from("entitlements")
    .select("user_id,can_receive_intro")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load entitlements for user '${userId}'.`);
  }

  if (!data?.user_id) {
    throw new Error(`Entitlements not found for user '${userId}'.`);
  }

  return {
    user_id: data.user_id,
    can_receive_intro: data.can_receive_intro,
  };
}

async function assertNoActiveSafetyHold(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("safety_holds")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load safety hold state for user '${userId}'.`);
  }

  if (data?.id) {
    throw new Error(
      `User '${userId}' is not eligible: active safety hold present.`,
    );
  }
}

function toSignalSnapshot(row: SignalRow): CompatibilitySignalSnapshot {
  return {
    interest_vector: row.interest_vector,
    trait_vector: row.trait_vector,
    intent_vector: row.intent_vector,
    availability_vector: row.availability_vector,
    content_hash: row.content_hash,
    metadata: row.metadata,
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
