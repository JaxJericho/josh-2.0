import type {
  ActivityCatalogEntry,
  ActivityCatalogMotiveWeights,
} from "../../../db/src/types/activity-catalog.ts";

type SupabaseClientLike = {
  from: (table: string) => any;
};

export type SoloActivityUserPreferences = {
  regional_availability: string | null;
  motive_weights: Partial<ActivityCatalogMotiveWeights> | null;
  preferred_windows: string[];
};

export type SoloActivityRepository = {
  fetchUserPreferences: (userId: string) => Promise<SoloActivityUserPreferences>;
  listSoloActivities: () => Promise<ActivityCatalogEntry[]>;
};

export async function suggestSoloActivity(
  userId: string,
  options?: {
    repository: SoloActivityRepository;
  },
): Promise<ActivityCatalogEntry> {
  const repository = options?.repository;
  if (!repository) {
    throw new Error("suggestSoloActivity requires a repository.");
  }

  const [preferences, activities] = await Promise.all([
    repository.fetchUserPreferences(userId),
    repository.listSoloActivities(),
  ]);

  const viableActivities = activities.filter((activity) =>
    activity.group_size_fit.includes("solo") &&
    activity.short_description.trim().length > 0
  );

  if (viableActivities.length === 0) {
    throw new Error("No solo activities are available.");
  }

  const regionFiltered = filterByRegionalAvailability(
    viableActivities,
    preferences.regional_availability,
  );
  const candidates = regionFiltered.length > 0 ? regionFiltered : viableActivities;

  const preferredWindows = new Set(
    preferences.preferred_windows.map((window) => window.trim().toLowerCase()).filter(Boolean),
  );

  const ranked = candidates
    .map((activity) => ({
      activity,
      score: scoreActivity(activity, preferences.motive_weights, preferredWindows),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.activity.activity_key.localeCompare(right.activity.activity_key);
    });

  const winner = ranked[0]?.activity;
  if (!winner) {
    throw new Error("Unable to select a solo activity.");
  }
  return winner;
}

export function createSupabaseSoloActivityRepository(
  supabase: SupabaseClientLike,
): SoloActivityRepository {
  return {
    fetchUserPreferences: async (userId: string): Promise<SoloActivityUserPreferences> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("activity_patterns,scheduling_availability")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to load profile preferences for solo activity suggestion.");
      }

      const activityPatterns = isRecord(data?.activity_patterns)
        ? data.activity_patterns
        : {};
      const regionalAvailability = normalizeOptionalString(
        activityPatterns.regional_availability,
      );
      const motiveWeights = normalizeMotiveWeights(activityPatterns.motive_weights);
      const preferredWindows = normalizePreferredWindows(data?.scheduling_availability);

      return {
        regional_availability: regionalAvailability,
        motive_weights: motiveWeights,
        preferred_windows: preferredWindows,
      };
    },

    listSoloActivities: async (): Promise<ActivityCatalogEntry[]> => {
      const { data, error } = await supabase
        .from("activity_catalog")
        .select(
          "id,activity_key,display_name,category,short_description,regional_availability,motive_weights,constraints,preferred_windows,group_size_fit,tags,created_at",
        )
        .contains("group_size_fit", ["solo"]);

      if (error) {
        throw new Error("Unable to load activity catalog for solo activity suggestion.");
      }

      const rows = Array.isArray(data) ? data : [];
      return rows.map((row) => toActivityCatalogEntry(row)).filter(Boolean) as ActivityCatalogEntry[];
    },
  };
}

function filterByRegionalAvailability(
  activities: ActivityCatalogEntry[],
  userRegion: string | null,
): ActivityCatalogEntry[] {
  const normalizedUserRegion = normalizeOptionalString(userRegion);
  if (!normalizedUserRegion || normalizedUserRegion === "anywhere") {
    return activities;
  }

  return activities.filter((activity) => {
    const activityRegion = normalizeOptionalString(activity.regional_availability);
    return activityRegion === "anywhere" || activityRegion === normalizedUserRegion;
  });
}

function scoreActivity(
  activity: ActivityCatalogEntry,
  userMotiveWeights: Partial<ActivityCatalogMotiveWeights> | null,
  preferredWindows: ReadonlySet<string>,
): number {
  const motiveWeights = userMotiveWeights ?? {};
  const motiveScore = Object.entries(activity.motive_weights).reduce((sum, [key, value]) => {
    const userWeight = toFiniteNumber(motiveWeights[key as keyof ActivityCatalogMotiveWeights]);
    const activityWeight = toFiniteNumber(value);
    return sum + userWeight * activityWeight;
  }, 0);

  const scheduleScore = activity.preferred_windows.reduce((count, window) => {
    const normalizedWindow = window.trim().toLowerCase();
    return count + (preferredWindows.has(normalizedWindow) ? 1 : 0);
  }, 0);

  return motiveScore + scheduleScore * 10;
}

function normalizePreferredWindows(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  }

  if (isRecord(value) && Array.isArray(value.preferred_windows)) {
    return value.preferred_windows
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  }

  return [];
}

function normalizeMotiveWeights(
  value: unknown,
): Partial<ActivityCatalogMotiveWeights> | null {
  if (!isRecord(value)) {
    return null;
  }

  const normalized: Partial<ActivityCatalogMotiveWeights> = {};
  for (const [key, raw] of Object.entries(value)) {
    const numeric = toFiniteNumber(raw);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      continue;
    }
    normalized[key as keyof ActivityCatalogMotiveWeights] = numeric;
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function toActivityCatalogEntry(row: unknown): ActivityCatalogEntry | null {
  if (!isRecord(row)) {
    return null;
  }

  const requiredStrings = [
    "id",
    "activity_key",
    "display_name",
    "category",
    "short_description",
    "regional_availability",
    "created_at",
  ] as const;
  for (const key of requiredStrings) {
    if (normalizeOptionalString(row[key]) === null) {
      return null;
    }
  }

  if (!isRecord(row.motive_weights) || !isRecord(row.constraints)) {
    return null;
  }

  const preferredWindows = Array.isArray(row.preferred_windows)
    ? row.preferred_windows.filter((entry) => typeof entry === "string")
    : [];
  const groupSizeFit = Array.isArray(row.group_size_fit)
    ? row.group_size_fit.filter((entry) => typeof entry === "string")
    : [];
  const tags = Array.isArray(row.tags)
    ? row.tags.filter((entry) => typeof entry === "string")
    : null;

  return {
    id: String(row.id),
    activity_key: String(row.activity_key),
    display_name: String(row.display_name),
    category: String(row.category),
    short_description: String(row.short_description),
    regional_availability: String(row.regional_availability) as ActivityCatalogEntry["regional_availability"],
    motive_weights: row.motive_weights as ActivityCatalogEntry["motive_weights"],
    constraints: row.constraints as ActivityCatalogEntry["constraints"],
    preferred_windows: preferredWindows as ActivityCatalogEntry["preferred_windows"],
    group_size_fit: groupSizeFit as ActivityCatalogEntry["group_size_fit"],
    tags,
    created_at: String(row.created_at),
  };
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function toFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
