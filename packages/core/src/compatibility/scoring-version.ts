export const COMPATIBILITY_SCORE_VERSION = "scoring-v1";

export const COMPATIBILITY_SCORE_SCALE_MAX = 100;
export const COMPATIBILITY_SCORE_ROUND_DIGITS = 6;

export const COMPATIBILITY_COMPONENT_WEIGHTS = {
  social_energy: 1 / 6,
  social_pace: 1 / 6,
  conversation_depth: 1 / 6,
  adventure_orientation: 1 / 6,
  group_dynamic: 1 / 6,
  values_proximity: 1 / 6,
} as const;

export const COMPATIBILITY_PENALTY_CONFIG = {} as const;

export const COMPATIBILITY_WEIGHT_SUM =
  COMPATIBILITY_COMPONENT_WEIGHTS.social_energy +
  COMPATIBILITY_COMPONENT_WEIGHTS.social_pace +
  COMPATIBILITY_COMPONENT_WEIGHTS.conversation_depth +
  COMPATIBILITY_COMPONENT_WEIGHTS.adventure_orientation +
  COMPATIBILITY_COMPONENT_WEIGHTS.group_dynamic +
  COMPATIBILITY_COMPONENT_WEIGHTS.values_proximity;
