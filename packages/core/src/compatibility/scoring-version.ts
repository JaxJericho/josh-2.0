export const COMPATIBILITY_SCORE_VERSION = "v1";

export const COMPATIBILITY_SCORE_SCALE_MAX = 100;
export const COMPATIBILITY_SCORE_ROUND_DIGITS = 6;

export const COMPATIBILITY_COMPONENT_WEIGHTS = {
  interests: 0.35,
  traits: 0.25,
  intent: 0.25,
  availability: 0.15,
} as const;

export const COMPATIBILITY_PENALTY_CONFIG = {
  max_penalty_points: 20,
  boundary_flag_indices: [4, 5, 6],
} as const;

export const COMPATIBILITY_WEIGHT_SUM =
  COMPATIBILITY_COMPONENT_WEIGHTS.interests +
  COMPATIBILITY_COMPONENT_WEIGHTS.traits +
  COMPATIBILITY_COMPONENT_WEIGHTS.intent +
  COMPATIBILITY_COMPONENT_WEIGHTS.availability;
