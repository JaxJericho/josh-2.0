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

const INTERACTION_STYLE_ORDER = ["curious", "funny", "thoughtful", "energetic"] as const;
const CONVERSATION_STYLE_ORDER = ["ideas", "feelings", "stories", "plans"] as const;
const MOTIVE_ORDER = ["connection", "fun", "restorative", "adventure", "comfort"] as const;
const GROUP_SIZE_ORDER = ["2-3", "4-6", "7-10"] as const;
const TIME_WINDOW_ORDER = ["mornings", "afternoons", "evenings", "weekends_only"] as const;

type ActivityKey = (typeof ACTIVITY_ORDER)[number];
type InteractionStyle = (typeof INTERACTION_STYLE_ORDER)[number];
type ConversationStyle = (typeof CONVERSATION_STYLE_ORDER)[number];
type MotiveKey = (typeof MOTIVE_ORDER)[number];
type GroupSize = (typeof GROUP_SIZE_ORDER)[number];
type TimeWindow = (typeof TIME_WINDOW_ORDER)[number];

export type StructuredProfileForCompatibility = {
  profile_id: string;
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

function asFingerprintNode(
  fingerprint: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const raw = fingerprint[key];
  if (raw == null) {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`fingerprint.${key} must be an object when present.`);
  }
  return raw as Record<string, unknown>;
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

function mapValuesAlignmentToScalar(value: "very" | "somewhat" | "not_a_big_deal"): number {
  switch (value) {
    case "very":
      return 1;
    case "somewhat":
      return 0.6;
    case "not_a_big_deal":
      return 0.25;
    default:
      return 0.6;
  }
}

function mapSocialPaceToScalar(value: "slow" | "medium" | "fast"): number {
  switch (value) {
    case "slow":
      return 0.2;
    case "medium":
      return 0.5;
    case "fast":
      return 0.8;
    default:
      return 0.5;
  }
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

  const fingerprint = assertRecord(profile.fingerprint, "profile.fingerprint");
  const preferences = assertRecord(profile.preferences, "profile.preferences");
  const boundaries = assertRecord(profile.boundaries, "profile.boundaries");
  const activityPatterns = assertArray(profile.activity_patterns, "profile.activity_patterns");
  const activeIntent = profile.active_intent === null
    ? null
    : assertRecord(profile.active_intent, "profile.active_intent");

  const defaultsApplied: string[] = [];
  const ignoredActivityKeys: string[] = [];

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

  const socialPaceNode = asFingerprintNode(fingerprint, "social_pace");
  const socialPace = socialPaceNode?.value == null
    ? "medium"
    : readEnumValue({
      value: socialPaceNode.value,
      allowed: ["slow", "medium", "fast"],
      label: "fingerprint.social_pace.value",
    });
  if (socialPaceNode?.value == null) {
    defaultsApplied.push("fingerprint.social_pace.value");
  }

  const interactionStyleNode = asFingerprintNode(fingerprint, "interaction_style");
  const interactionStyle = interactionStyleNode?.value == null
    ? "thoughtful"
    : readEnumValue({
      value: interactionStyleNode.value,
      allowed: INTERACTION_STYLE_ORDER,
      label: "fingerprint.interaction_style.value",
    });
  if (interactionStyleNode?.value == null) {
    defaultsApplied.push("fingerprint.interaction_style.value");
  }

  const conversationStyleNode = asFingerprintNode(fingerprint, "conversation_style");
  const conversationStyles = conversationStyleNode?.value == null
    ? []
    : assertArray(
      conversationStyleNode.value,
      "fingerprint.conversation_style.value",
    ).map((value, index) => readEnumValue({
      value,
      allowed: CONVERSATION_STYLE_ORDER,
      label: `fingerprint.conversation_style.value[${index}]`,
    }));
  if (conversationStyleNode?.value == null) {
    defaultsApplied.push("fingerprint.conversation_style.value");
  }

  const valuesAlignment = preferences.values_alignment_importance == null
    ? "somewhat"
    : readEnumValue({
      value: preferences.values_alignment_importance,
      allowed: ["very", "somewhat", "not_a_big_deal"],
      label: "preferences.values_alignment_importance",
    });
  if (preferences.values_alignment_importance == null) {
    defaultsApplied.push("preferences.values_alignment_importance");
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

  const traitVector = [
    round(mapSocialPaceToScalar(socialPace)),
    ...buildOneHotVector(INTERACTION_STYLE_ORDER, [interactionStyle]),
    ...buildOneHotVector(CONVERSATION_STYLE_ORDER, conversationStyles),
    round(mapValuesAlignmentToScalar(valuesAlignment)),
  ];

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
      trait_order: [
        "social_pace_scalar",
        ...INTERACTION_STYLE_ORDER.map((key) => `interaction_style:${key}`),
        ...CONVERSATION_STYLE_ORDER.map((key) => `conversation_style:${key}`),
        "values_alignment_importance",
      ],
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
      defaults_applied: defaultsApplied,
      ignored_activity_keys: ignoredActivityKeys,
    },
  };
}
