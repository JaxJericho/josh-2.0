export const NORMALIZER_VERSION = "v1";

const ACTIVITY_ORDER = [
  "coffee",
  "walk",
  "museum",
  "climbing",
  "games",
  "brunch",
  "hike",
  "dinner",
  "music",
] as const;

const COORDINATION_DIMENSION_ORDER = [
  "social_energy",
  "social_pace",
  "conversation_depth",
  "adventure_orientation",
  "group_dynamic",
  "values_proximity",
] as const;
const MOTIVE_ORDER = ["connection", "fun", "restorative", "adventure", "comfort"] as const;
const GROUP_SIZE_ORDER = ["2-3", "4-6", "7-10"] as const;
const TIME_WINDOW_ORDER = ["mornings", "afternoons", "evenings", "weekends_only"] as const;

type ActivityKey = (typeof ACTIVITY_ORDER)[number];
type CoordinationDimensionKey = (typeof COORDINATION_DIMENSION_ORDER)[number];
type MotiveKey = (typeof MOTIVE_ORDER)[number];
type GroupSize = (typeof GROUP_SIZE_ORDER)[number];
type TimeWindow = (typeof TIME_WINDOW_ORDER)[number];

type CoordinationDimensionSnapshot = {
  value: number | null;
  confidence: number | null;
};

export type StructuredProfileForCompatibility = {
  profile_id: string;
  user_id: string;
  state: string;
  is_complete_mvp: boolean;
  coordination_dimensions: unknown;
  activity_patterns: unknown;
  boundaries: unknown;
  preferences: unknown;
  active_intent: unknown;
  completed_at: string | null;
  updated_at: string;
};

export type NormalizedSignalVectors = {
  interest_vector: number[];
  trait_vector: number[];
  intent_vector: number[];
  availability_vector: number[];
  metadata: {
    normalizer_version: string;
    activity_order: readonly ActivityKey[];
    trait_order: readonly string[];
    intent_order: readonly string[];
    availability_order: readonly string[];
    coordination_dimensions: Record<CoordinationDimensionKey, CoordinationDimensionSnapshot>;
    trait_vector_source: Array<number | null>;
    defaults_applied: string[];
    ignored_activity_keys: string[];
  };
};

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value;
}

function assertBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function asOptionalRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function assertUnitInterval(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  if (value < 0 || value > 1) {
    throw new Error(`${label} must be in [0, 1].`);
  }
  return round(value);
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function buildOneHotVector<T extends string>(
  order: readonly T[],
  selected: readonly T[],
): number[] {
  const selectedSet = new Set(selected);
  return order.map((entry) => (selectedSet.has(entry) ? 1 : 0));
}

function readEnumValue<T extends string>(params: {
  value: unknown;
  allowed: readonly T[];
  label: string;
}): T {
  const raw = assertString(params.value, params.label);
  if (!params.allowed.includes(raw as T)) {
    throw new Error(`${params.label} must be one of: ${params.allowed.join(", ")}.`);
  }
  return raw as T;
}

function readNullableUnitInterval(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value < 0 || value > 1) {
    return null;
  }
  return round(value);
}

function readCoordinationDimension(params: {
  coordinationDimensions: Record<string, unknown>;
  key: CoordinationDimensionKey;
  defaultsApplied: string[];
}): CoordinationDimensionSnapshot {
  const rawNode = params.coordinationDimensions[params.key];
  if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) {
    params.defaultsApplied.push(
      `coordination_dimensions.${params.key}.value`,
      `coordination_dimensions.${params.key}.confidence`,
    );
    return { value: null, confidence: null };
  }

  const node = rawNode as Record<string, unknown>;
  const value = readNullableUnitInterval(node.value);
  const confidence = readNullableUnitInterval(node.confidence);

  if (value == null) {
    params.defaultsApplied.push(`coordination_dimensions.${params.key}.value`);
  }
  if (confidence == null) {
    params.defaultsApplied.push(`coordination_dimensions.${params.key}.confidence`);
  }

  return { value, confidence };
}

function containsKeyword(items: string[], keywords: RegExp): number {
  for (const item of items) {
    if (keywords.test(item)) {
      return 1;
    }
  }
  return 0;
}

export function normalizeProfileSignals(
  profile: StructuredProfileForCompatibility,
): NormalizedSignalVectors {
  assertString(profile.profile_id, "profile.profile_id");
  assertString(profile.user_id, "profile.user_id");
  assertBoolean(profile.is_complete_mvp, "profile.is_complete_mvp");

  const coordinationDimensions = asOptionalRecord(profile.coordination_dimensions);
  const preferences = assertRecord(profile.preferences, "profile.preferences");
  const boundaries = assertRecord(profile.boundaries, "profile.boundaries");
  const activityPatterns = assertArray(profile.activity_patterns, "profile.activity_patterns");
  const activeIntent = profile.active_intent === null
    ? null
    : assertRecord(profile.active_intent, "profile.active_intent");

  const defaultsApplied: string[] = [];
  const ignoredActivityKeys: string[] = [];

  const dimensionSnapshots = COORDINATION_DIMENSION_ORDER.reduce((accumulator, key) => {
    accumulator[key] = readCoordinationDimension({
      coordinationDimensions,
      key,
      defaultsApplied,
    });
    return accumulator;
  }, {} as Record<CoordinationDimensionKey, CoordinationDimensionSnapshot>);

  const interestByActivity: Record<ActivityKey, number> = {
    coffee: 0,
    walk: 0,
    museum: 0,
    climbing: 0,
    games: 0,
    brunch: 0,
    hike: 0,
    dinner: 0,
    music: 0,
  };

  for (let index = 0; index < activityPatterns.length; index += 1) {
    const pattern = activityPatterns[index];
    if (!pattern || typeof pattern !== "object" || Array.isArray(pattern)) {
      throw new Error(`profile.activity_patterns[${index}] must be an object.`);
    }

    const record = pattern as Record<string, unknown>;
    const activityKey = assertString(
      record.activity_key,
      `profile.activity_patterns[${index}].activity_key`,
    );

    if (!ACTIVITY_ORDER.includes(activityKey as ActivityKey)) {
      ignoredActivityKeys.push(activityKey);
      continue;
    }

    const confidenceRaw = record.confidence;
    const confidence = confidenceRaw == null
      ? 0.5
      : assertUnitInterval(
        confidenceRaw,
        `profile.activity_patterns[${index}].confidence`,
      );

    if (confidenceRaw == null) {
      defaultsApplied.push(`activity_patterns[${index}].confidence`);
    }

    const key = activityKey as ActivityKey;
    interestByActivity[key] = Math.max(interestByActivity[key], confidence);
  }

  const groupSizePreference = preferences.group_size_pref == null
    ? "4-6"
    : readEnumValue({
      value: preferences.group_size_pref,
      allowed: GROUP_SIZE_ORDER,
      label: "preferences.group_size_pref",
    });
  if (preferences.group_size_pref == null) {
    defaultsApplied.push("preferences.group_size_pref");
  }

  const timePreferences = preferences.time_preferences == null
    ? []
    : assertArray(
      preferences.time_preferences,
      "preferences.time_preferences",
    ).map((value, index) => readEnumValue({
      value,
      allowed: TIME_WINDOW_ORDER,
      label: `preferences.time_preferences[${index}]`,
    }));
  if (preferences.time_preferences == null) {
    defaultsApplied.push("preferences.time_preferences");
  }

  const motiveWeightsSource = activeIntent?.motive_weights == null
    ? {}
    : assertRecord(activeIntent.motive_weights, "active_intent.motive_weights");

  const motiveWeights: Record<MotiveKey, number> = {
    connection: 0,
    fun: 0,
    restorative: 0,
    adventure: 0,
    comfort: 0,
  };

  for (const motive of MOTIVE_ORDER) {
    const raw = motiveWeightsSource[motive];
    motiveWeights[motive] = raw == null
      ? 0
      : assertUnitInterval(raw, `active_intent.motive_weights.${motive}`);
    if (raw == null) {
      defaultsApplied.push(`active_intent.motive_weights.${motive}`);
    }
  }

  const noThanks = boundaries.no_thanks == null
    ? []
    : assertArray(boundaries.no_thanks, "boundaries.no_thanks").map((entry, index) =>
      assertString(entry, `boundaries.no_thanks[${index}]`).toLowerCase()
    );
  if (boundaries.no_thanks == null) {
    defaultsApplied.push("boundaries.no_thanks");
  }

  const interestVector = ACTIVITY_ORDER.map((activity) => round(interestByActivity[activity]));

  const traitVectorSource = COORDINATION_DIMENSION_ORDER.map(
    (key) => dimensionSnapshots[key].value,
  );
  const traitVector = traitVectorSource.map((value) => round(value ?? 0.5));

  const intentVector = [
    ...MOTIVE_ORDER.map((motive) => round(motiveWeights[motive])),
    ...buildOneHotVector(GROUP_SIZE_ORDER, [groupSizePreference]),
  ];

  const availabilityVector = [
    ...buildOneHotVector(TIME_WINDOW_ORDER, timePreferences),
    containsKeyword(noThanks, /\bbar|bars|club|drinking\b/),
    containsKeyword(noThanks, /\blate\s*night|late-night|after\s*midnight\b/),
    containsKeyword(noThanks, /\bloud|noisy|crowd(ed)?\b/),
  ].map((value) => round(value));

  return {
    interest_vector: interestVector,
    trait_vector: traitVector,
    intent_vector: intentVector,
    availability_vector: availabilityVector,
    metadata: {
      normalizer_version: NORMALIZER_VERSION,
      activity_order: ACTIVITY_ORDER,
      trait_order: COORDINATION_DIMENSION_ORDER.map((key) => `coordination_dimension:${key}`),
      intent_order: [
        ...MOTIVE_ORDER.map((key) => `motive:${key}`),
        ...GROUP_SIZE_ORDER.map((key) => `group_size:${key}`),
      ],
      availability_order: [
        ...TIME_WINDOW_ORDER.map((key) => `time:${key}`),
        "boundary:no_bars",
        "boundary:no_late_nights",
        "boundary:no_loud_spaces",
      ],
      coordination_dimensions: dimensionSnapshots,
      trait_vector_source: traitVectorSource,
      defaults_applied: defaultsApplied,
      ignored_activity_keys: ignoredActivityKeys,
    },
  };
}
