export type DeterministicParseResult<T> =
  | { ok: true; value: T }
  | { ok: false };

export type InterviewValidationContext = {
  collectedAnswers: Record<string, unknown>;
};

export type IntroAnswer = {
  consent: "yes" | "later";
};

export type ActivityAnswer = {
  activity_keys: string[];
};

export type TopActivityAnswer = {
  activity_key: string;
};

export type MotiveAnswer = {
  motive_weights: Record<string, number>;
};

export type StyleAnswer = {
  style_keys: string[];
};

export type PaceAnswer = {
  social_pace: "slow" | "medium" | "fast";
};

export type GroupSizeAnswer = {
  group_size_pref: "2-3" | "4-6" | "7-10";
};

export type ValuesAnswer = {
  values_alignment_importance: "very" | "somewhat" | "not_a_big_deal";
};

export type BoundariesAnswer = {
  no_thanks: string[];
  skipped: boolean;
};

export type TimePreferenceAnswer = {
  time_preferences: Array<"mornings" | "afternoons" | "evenings" | "weekends_only">;
};

const ACTIVITY_ALIAS_MAP: Record<string, string[]> = {
  coffee: ["coffee", "cafe", "espresso", "latte"],
  walk: ["walk", "walking", "stroll"],
  museum: ["museum", "gallery", "exhibit", "art"],
  climbing: ["climbing", "bouldering", "climb"],
  games: ["games", "board game", "board games", "arcade"],
  brunch: ["brunch", "breakfast"],
  hike: ["hike", "hiking", "trail"],
  dinner: ["dinner", "food", "restaurant"],
  music: ["music", "concert", "show"],
};

const PREFER_NOT_PATTERN = /\b(prefer not|rather not|skip|no thanks|pass)\b/i;

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseSingleChoice(
  raw: string,
  options: Record<string, string>,
): string | null {
  const normalized = normalizeText(raw);
  if (!normalized) {
    return null;
  }

  if (options[normalized]) {
    return options[normalized];
  }

  const compact = normalized.replace(/[.\s]/g, "");
  if (options[compact]) {
    return options[compact];
  }

  return null;
}

function parseMultiChoice(
  raw: string,
  options: Record<string, string>,
  maxValues: number,
): string[] {
  const normalized = normalizeText(raw);
  if (!normalized) {
    return [];
  }

  const tokens = normalized
    .split(/[,&/]|\band\b|\+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const selected: string[] = [];
  for (const token of tokens) {
    const parsed = parseSingleChoice(token, options);
    if (parsed && !selected.includes(parsed)) {
      selected.push(parsed);
    }
  }

  return selected.slice(0, maxValues);
}

function extractActivities(raw: string): string[] {
  const normalized = normalizeText(raw);
  if (!normalized) {
    return [];
  }

  const matches = new Set<string>();
  for (const [activityKey, aliases] of Object.entries(ACTIVITY_ALIAS_MAP)) {
    for (const alias of aliases) {
      if (normalized.includes(alias)) {
        matches.add(activityKey);
      }
    }
  }

  return Array.from(matches).slice(0, 3);
}

function parseMotiveWeights(raw: string): Record<string, number> {
  const normalized = normalizeText(raw);
  if (!normalized) {
    return {};
  }

  if (/\b(idk|chill|whatever|not sure)\b/.test(normalized)) {
    return {
      comfort: 0.5,
      restorative: 0.45,
    };
  }

  const weights: Record<string, number> = {};
  const keywords: Array<{ key: string; pattern: RegExp; weight: number }> = [
    { key: "connection", pattern: /\b(deep|deeper|real|conversation|connect)\b/, weight: 0.75 },
    { key: "fun", pattern: /\b(fun|laugh|easygoing|light)\b/, weight: 0.7 },
    { key: "restorative", pattern: /\b(calm|reset|quiet|recharge)\b/, weight: 0.7 },
    { key: "adventure", pattern: /\b(adventure|new|explore|spontaneous)\b/, weight: 0.7 },
    { key: "comfort", pattern: /\b(comfort|cozy|relax)\b/, weight: 0.6 },
  ];

  for (const keyword of keywords) {
    if (keyword.pattern.test(normalized)) {
      weights[keyword.key] = keyword.weight;
    }
  }

  return weights;
}

function getPriorActivities(context: InterviewValidationContext): string[] {
  const previous = context.collectedAnswers["activity_01"] as
    | ActivityAnswer
    | undefined;
  if (!previous || !Array.isArray(previous.activity_keys)) {
    return [];
  }
  return previous.activity_keys;
}

export function parseIntroAnswer(raw: string): DeterministicParseResult<IntroAnswer> {
  const parsed = parseSingleChoice(raw, {
    yes: "yes",
    y: "yes",
    start: "yes",
    ready: "yes",
    later: "later",
    l: "later",
  });

  if (!parsed) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      consent: parsed as IntroAnswer["consent"],
    },
  };
}

export function parseActivityAnswer(raw: string): DeterministicParseResult<ActivityAnswer> {
  const activities = extractActivities(raw);
  if (activities.length === 0) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      activity_keys: activities,
    },
  };
}

export function parseTopActivityAnswer(
  raw: string,
  context: InterviewValidationContext,
): DeterministicParseResult<TopActivityAnswer> {
  const prior = getPriorActivities(context);
  const normalized = normalizeText(raw);

  const rankedChoice = parseSingleChoice(normalized, {
    "1": prior[0] ?? "",
    "2": prior[1] ?? "",
    "3": prior[2] ?? "",
    a: prior[0] ?? "",
    b: prior[1] ?? "",
    c: prior[2] ?? "",
  });

  if (rankedChoice) {
    return {
      ok: true,
      value: {
        activity_key: rankedChoice,
      },
    };
  }

  const direct = extractActivities(raw)[0];
  if (!direct) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      activity_key: direct,
    },
  };
}

export function parseMotiveAnswer(raw: string): DeterministicParseResult<MotiveAnswer> {
  const weights = parseMotiveWeights(raw);
  if (Object.keys(weights).length === 0) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      motive_weights: weights,
    },
  };
}

export function parseMotiveChoiceAnswer(raw: string): DeterministicParseResult<MotiveAnswer> {
  const parsed = parseSingleChoice(raw, {
    a: "connection",
    "optiona": "connection",
    "1": "connection",
    b: "fun",
    "optionb": "fun",
    "2": "fun",
    c: "restorative",
    "optionc": "restorative",
    "3": "restorative",
    d: "adventure",
    "optiond": "adventure",
    "4": "adventure",
  });

  if (!parsed) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      motive_weights: {
        [parsed]: 0.8,
      },
    },
  };
}

export function parseStylePrimaryAnswer(raw: string): DeterministicParseResult<StyleAnswer> {
  const parsed = parseSingleChoice(raw, {
    a: "curious",
    "1": "curious",
    b: "funny",
    "2": "funny",
    c: "thoughtful",
    "3": "thoughtful",
    d: "energetic",
    "4": "energetic",
    curious: "curious",
    funny: "funny",
    thoughtful: "thoughtful",
    energetic: "energetic",
  });

  if (!parsed) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      style_keys: [parsed],
    },
  };
}

export function parseStyleConversationAnswer(raw: string): DeterministicParseResult<StyleAnswer> {
  const selected = parseMultiChoice(raw, {
    a: "ideas",
    "1": "ideas",
    ideas: "ideas",
    idea: "ideas",
    b: "feelings",
    "2": "feelings",
    feelings: "feelings",
    feeling: "feelings",
    c: "stories",
    "3": "stories",
    stories: "stories",
    story: "stories",
    d: "plans",
    "4": "plans",
    plans: "plans",
    plan: "plans",
  }, 2);

  if (selected.length === 0) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      style_keys: selected,
    },
  };
}

export function parsePaceAnswer(raw: string): DeterministicParseResult<PaceAnswer> {
  const parsed = parseSingleChoice(raw, {
    a: "slow",
    "1": "slow",
    slow: "slow",
    b: "medium",
    "2": "medium",
    medium: "medium",
    c: "fast",
    "3": "fast",
    fast: "fast",
  });

  if (!parsed) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      social_pace: parsed as PaceAnswer["social_pace"],
    },
  };
}

export function parseGroupSizeAnswer(raw: string): DeterministicParseResult<GroupSizeAnswer> {
  const parsed = parseSingleChoice(raw, {
    a: "2-3",
    "1": "2-3",
    "2-3": "2-3",
    b: "4-6",
    "2": "4-6",
    "4-6": "4-6",
    c: "7-10",
    "3": "7-10",
    "7-10": "7-10",
  });

  if (!parsed) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      group_size_pref: parsed as GroupSizeAnswer["group_size_pref"],
    },
  };
}

export function parseValuesAnswer(raw: string): DeterministicParseResult<ValuesAnswer> {
  const parsed = parseSingleChoice(raw, {
    a: "very",
    "1": "very",
    very: "very",
    b: "somewhat",
    "2": "somewhat",
    somewhat: "somewhat",
    c: "not_a_big_deal",
    "3": "not_a_big_deal",
    "not a big deal": "not_a_big_deal",
  });

  if (!parsed) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      values_alignment_importance: parsed as ValuesAnswer["values_alignment_importance"],
    },
  };
}

export function parseBoundariesAnswer(raw: string): DeterministicParseResult<BoundariesAnswer> {
  const normalized = normalizeText(raw);
  if (!normalized) {
    return { ok: false };
  }

  if (PREFER_NOT_PATTERN.test(normalized)) {
    return {
      ok: true,
      value: {
        no_thanks: [],
        skipped: true,
      },
    };
  }

  const items = normalized
    .split(/[.,]|\band\b|\//)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);

  if (items.length === 0) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      no_thanks: items,
      skipped: false,
    },
  };
}

export function parseTimePreferenceAnswer(raw: string): DeterministicParseResult<TimePreferenceAnswer> {
  const selected = parseMultiChoice(raw, {
    a: "mornings",
    "1": "mornings",
    mornings: "mornings",
    morning: "mornings",
    b: "afternoons",
    "2": "afternoons",
    afternoons: "afternoons",
    afternoon: "afternoons",
    c: "evenings",
    "3": "evenings",
    evenings: "evenings",
    evening: "evenings",
    d: "weekends_only",
    "4": "weekends_only",
    weekends: "weekends_only",
    weekend: "weekends_only",
  }, 2);

  if (selected.length === 0) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      time_preferences: selected as TimePreferenceAnswer["time_preferences"],
    },
  };
}
