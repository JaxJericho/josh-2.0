import {
  NORMALIZER_VERSION,
  normalizeProfileSignals,
  type NormalizedSignalVectors,
  type StructuredProfileForCompatibility,
} from "./normalizer.ts";

export const COMPATIBILITY_SIGNAL_TABLE = "profile_compatibility_signals";

export type CompatibilitySignalRow = {
  user_id: string;
  profile_id: string;
  normalization_version: string;
  interest_vector: number[];
  trait_vector: number[];
  intent_vector: number[];
  availability_vector: number[];
  metadata: Record<string, unknown>;
  source_profile_state: string;
  source_profile_completed_at: string | null;
  source_profile_updated_at: string;
  content_hash: string;
};

export type RecomputeProfileSignalsResult = {
  user_id: string;
  profile_id: string;
  content_hash: string;
  normalized: NormalizedSignalVectors;
};

type SupabaseClientLike = {
  from: (table: string) => any;
};

type ProfileRow = {
  id: string;
  user_id: string;
  state: string;
  is_complete_mvp: boolean;
  fingerprint: unknown;
  activity_patterns: unknown;
  boundaries: unknown;
  preferences: unknown;
  active_intent: unknown;
  completed_at: string | null;
  updated_at: string;
};

export function buildCompatibilitySignalRow(
  profile: StructuredProfileForCompatibility,
): CompatibilitySignalRow {
  const normalized = normalizeProfileSignals(profile);
  const contentHash = hashStableObject({
    normalization_version: NORMALIZER_VERSION,
    normalized,
    source_profile_state: profile.state,
    source_profile_completed_at: profile.completed_at,
    source_profile_updated_at: profile.updated_at,
  });

  return {
    user_id: profile.user_id,
    profile_id: profile.profile_id,
    normalization_version: NORMALIZER_VERSION,
    interest_vector: normalized.interest_vector,
    trait_vector: normalized.trait_vector,
    intent_vector: normalized.intent_vector,
    availability_vector: normalized.availability_vector,
    metadata: normalized.metadata,
    source_profile_state: profile.state,
    source_profile_completed_at: profile.completed_at,
    source_profile_updated_at: profile.updated_at,
    content_hash: contentHash,
  };
}

export async function upsertCompatibilitySignals(params: {
  supabase: SupabaseClientLike;
  row: CompatibilitySignalRow;
}): Promise<void> {
  const { error } = await params.supabase
    .from(COMPATIBILITY_SIGNAL_TABLE)
    .upsert(params.row, {
      onConflict: "user_id",
      ignoreDuplicates: false,
    });

  if (error) {
    throw new Error("Failed to upsert compatibility signal row.");
  }
}

export async function recomputeProfileSignals(params: {
  supabase: SupabaseClientLike;
  user_id: string;
}): Promise<RecomputeProfileSignalsResult> {
  const profile = await fetchProfileForRecompute(params.supabase, params.user_id);

  if (!profile.is_complete_mvp && profile.state !== "complete_full") {
    throw new Error(
      `Cannot normalize incomplete profile for user '${params.user_id}'.`,
    );
  }

  const structuredProfile: StructuredProfileForCompatibility = {
    profile_id: profile.id,
    user_id: profile.user_id,
    state: profile.state,
    is_complete_mvp: profile.is_complete_mvp,
    fingerprint: profile.fingerprint,
    activity_patterns: profile.activity_patterns,
    boundaries: profile.boundaries,
    preferences: profile.preferences,
    active_intent: profile.active_intent,
    completed_at: profile.completed_at,
    updated_at: profile.updated_at,
  };

  const row = buildCompatibilitySignalRow(structuredProfile);

  const { error: deleteError } = await params.supabase
    .from(COMPATIBILITY_SIGNAL_TABLE)
    .delete()
    .eq("user_id", params.user_id);

  if (deleteError) {
    throw new Error("Failed to clear previous compatibility signal rows.");
  }

  await upsertCompatibilitySignals({
    supabase: params.supabase,
    row,
  });

  return {
    user_id: row.user_id,
    profile_id: row.profile_id,
    content_hash: row.content_hash,
    normalized: {
      interest_vector: row.interest_vector,
      trait_vector: row.trait_vector,
      intent_vector: row.intent_vector,
      availability_vector: row.availability_vector,
      metadata: row.metadata as NormalizedSignalVectors["metadata"],
    },
  };
}

async function fetchProfileForRecompute(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<ProfileRow> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id,user_id,state,is_complete_mvp,fingerprint,activity_patterns,boundaries,preferences,active_intent,completed_at,updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load profile for compatibility normalization.");
  }

  if (!data?.id) {
    throw new Error(`Profile not found for user '${userId}'.`);
  }

  return {
    id: data.id,
    user_id: data.user_id,
    state: data.state,
    is_complete_mvp: data.is_complete_mvp,
    fingerprint: data.fingerprint,
    activity_patterns: data.activity_patterns,
    boundaries: data.boundaries,
    preferences: data.preferences,
    active_intent: data.active_intent,
    completed_at: data.completed_at,
    updated_at: data.updated_at,
  };
}

function hashStableObject(value: unknown): string {
  const serialized = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function stableStringify(value: unknown): string {
  if (value === null) {
    return "null";
  }

  const valueType = typeof value;
  if (valueType === "number" || valueType === "boolean") {
    return JSON.stringify(value);
  }

  if (valueType === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (valueType === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(",")}}`;
  }

  throw new Error(`Unsupported value type '${valueType}' in stableStringify.`);
}
