import {
  ACTIVE_INTERVIEW_QUESTION_STEP_IDS,
  isInterviewQuestionStepId,
  type InterviewQuestionStepId,
} from "./steps.ts";

export const FINGERPRINT_FACTOR_KEYS = [
  "connection_depth",
  "social_energy",
  "social_pace",
  "novelty_seeking",
  "structure_preference",
  "humor_style",
  "conversation_style",
  "emotional_directness",
  "adventure_comfort",
  "conflict_tolerance",
  "values_alignment_importance",
  "group_vs_1on1_preference",
] as const;

export type FingerprintFactorKey = (typeof FINGERPRINT_FACTOR_KEYS)[number];

export const REQUIRED_COVERAGE_TARGETS = [
  ...FINGERPRINT_FACTOR_KEYS,
  "activity_patterns",
  "group_size_pref",
  "time_preferences",
  "boundaries_asked",
] as const;

export type RequiredCoverageTarget = (typeof REQUIRED_COVERAGE_TARGETS)[number];

export type InterviewSignalTarget =
  | RequiredCoverageTarget
  | "top_activity_intent"
  | "location_capture";

export const SIGNAL_TARGET_TO_QUESTION_ID: Readonly<
  Record<InterviewSignalTarget, InterviewQuestionStepId>
> = {
  activity_patterns: "activity_01",
  top_activity_intent: "activity_02",
  connection_depth: "motive_01",
  novelty_seeking: "motive_02",
  social_energy: "style_01",
  humor_style: "style_01",
  conversation_style: "style_02",
  social_pace: "pace_01",
  structure_preference: "pace_01",
  group_size_pref: "group_01",
  group_vs_1on1_preference: "group_01",
  values_alignment_importance: "values_01",
  boundaries_asked: "boundaries_01",
  conflict_tolerance: "boundaries_01",
  time_preferences: "constraints_01",
  emotional_directness: "motive_01",
  adventure_comfort: "motive_02",
  location_capture: "location_01",
};

export const REQUIRED_TARGET_PRIORITY: readonly RequiredCoverageTarget[] = [
  "activity_patterns",
  "connection_depth",
  "social_energy",
  "conversation_style",
  "social_pace",
  "group_size_pref",
  "values_alignment_importance",
  "boundaries_asked",
  "time_preferences",
  "novelty_seeking",
  "structure_preference",
  "humor_style",
  "emotional_directness",
  "adventure_comfort",
  "conflict_tolerance",
  "group_vs_1on1_preference",
];

export const QUESTION_TARGET_PRIORITY: readonly InterviewSignalTarget[] = [
  "activity_patterns",
  "top_activity_intent",
  "connection_depth",
  "novelty_seeking",
  "social_energy",
  "conversation_style",
  "social_pace",
  "group_size_pref",
  "values_alignment_importance",
  "boundaries_asked",
  "time_preferences",
  "structure_preference",
  "humor_style",
  "emotional_directness",
  "adventure_comfort",
  "conflict_tolerance",
  "group_vs_1on1_preference",
  "location_capture",
];

type SignalCoverageProfile = {
  country_code?: string | null;
  last_interview_step?: string | null;
  fingerprint?: unknown;
  activity_patterns?: unknown;
  boundaries?: unknown;
  preferences?: unknown;
  active_intent?: unknown;
};

export type SignalCoverageStatus = {
  covered: string[];
  uncovered: string[];
  mvpComplete: boolean;
  nextSignalTarget: string | null;
};

export type NextQuestionSelection = {
  questionId: InterviewQuestionStepId;
  signalTarget: InterviewSignalTarget;
  metadata?: {
    skippedInferableTargets: InterviewSignalTarget[];
    skippedAnsweredQuestionTargets: InterviewSignalTarget[];
  };
};

type InterviewProgressSnapshot = {
  completedStepIds: InterviewQuestionStepId[];
  answers: Record<string, unknown>;
};

const GROUP_SIZE_VALUES = new Set(["2-3", "4-6", "7-10"]);
const TIME_PREFERENCE_VALUES = new Set([
  "mornings",
  "afternoons",
  "evenings",
  "weekends_only",
]);

const ACTIVITY_KEYWORDS = [
  "coffee",
  "walk",
  "museum",
  "gallery",
  "climbing",
  "bouldering",
  "games",
  "board game",
  "hike",
  "dinner",
  "concert",
  "music",
] as const;

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => entry && typeof entry === "object") as Array<
    Record<string, unknown>
  >;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasValidGroupSizePreference(preferencesRaw: unknown): boolean {
  const preferences = asObject(preferencesRaw);
  const groupSizePref = preferences.group_size_pref;
  if (typeof groupSizePref === "string") {
    return GROUP_SIZE_VALUES.has(groupSizePref);
  }

  // Accept min/max object shape for forward compatibility with spec docs.
  if (groupSizePref && typeof groupSizePref === "object" && !Array.isArray(groupSizePref)) {
    const groupSizeObject = groupSizePref as Record<string, unknown>;
    return asNumber(groupSizeObject.min) != null && asNumber(groupSizeObject.max) != null;
  }

  return false;
}

function hasValidTimePreferences(preferencesRaw: unknown): boolean {
  const preferences = asObject(preferencesRaw);
  const timePreferences = preferences.time_preferences;
  if (!Array.isArray(timePreferences) || timePreferences.length === 0) {
    return false;
  }

  return timePreferences.every((entry) =>
    typeof entry === "string" && TIME_PREFERENCE_VALUES.has(entry)
  );
}

function readInterviewProgress(preferencesRaw: unknown): InterviewProgressSnapshot | null {
  const preferences = asObject(preferencesRaw);
  const interviewProgressRaw = preferences.interview_progress;
  if (
    !interviewProgressRaw ||
    typeof interviewProgressRaw !== "object" ||
    Array.isArray(interviewProgressRaw)
  ) {
    return null;
  }

  const progress = interviewProgressRaw as Record<string, unknown>;
  const completedStepIds = Array.isArray(progress.completed_step_ids)
    ? progress.completed_step_ids
      .filter((stepId): stepId is string => typeof stepId === "string")
      .filter(isInterviewQuestionStepId)
      .map(normalizeQuestionStepId)
    : [];

  const answers = progress.answers &&
      typeof progress.answers === "object" &&
      !Array.isArray(progress.answers)
    ? (progress.answers as Record<string, unknown>)
    : {};

  return {
    completedStepIds,
    answers,
  };
}

function normalizeQuestionStepId(stepId: InterviewQuestionStepId): InterviewQuestionStepId {
  return stepId === "intro_01" ? "activity_01" : stepId;
}

function wasBoundariesQuestionAsked(profile: SignalCoverageProfile): boolean {
  const progress = readInterviewProgress(profile.preferences);
  if (progress) {
    if (progress.completedStepIds.includes("boundaries_01")) {
      return true;
    }
    if ("boundaries_01" in progress.answers) {
      return true;
    }
  }

  const boundaries = asObject(profile.boundaries);
  if (Array.isArray(boundaries.no_thanks)) {
    return true;
  }

  if (typeof boundaries.skipped === "boolean") {
    return true;
  }

  const lastStep = profile.last_interview_step;
  if (typeof lastStep === "string" && isInterviewQuestionStepId(lastStep)) {
    const normalizedLastStep = normalizeQuestionStepId(lastStep);
    const lastIndex = ACTIVE_INTERVIEW_QUESTION_STEP_IDS.findIndex(
      (candidate) => candidate === normalizedLastStep,
    );
    const boundariesIndex = ACTIVE_INTERVIEW_QUESTION_STEP_IDS.findIndex(
      (candidate) => candidate === "boundaries_01",
    );
    if (lastIndex >= 0 && boundariesIndex >= 0 && lastIndex >= boundariesIndex) {
      return true;
    }
  }

  return false;
}

function getCoveredFingerprintFactors(fingerprintRaw: unknown): Set<FingerprintFactorKey> {
  const fingerprint = asObject(fingerprintRaw);
  const covered = new Set<FingerprintFactorKey>();

  for (const key of FINGERPRINT_FACTOR_KEYS) {
    const node = asObject(fingerprint[key]);
    const confidence = asNumber(node.confidence);
    if (confidence != null && confidence >= 0.55) {
      covered.add(key);
    }
  }

  return covered;
}

function getCoveredActivityCount(activityPatternsRaw: unknown): number {
  const patterns = asObjectArray(activityPatternsRaw);
  const coveredKeys = new Set<string>();

  for (const pattern of patterns) {
    const activityKey = typeof pattern.activity_key === "string"
      ? pattern.activity_key.trim()
      : "";
    const confidence = asNumber(pattern.confidence);
    if (activityKey && confidence != null && confidence >= 0.6) {
      coveredKeys.add(activityKey);
    }
  }

  return coveredKeys.size;
}

function getCoverageSet(profile: SignalCoverageProfile): Set<RequiredCoverageTarget> {
  const coveredTargets = new Set<RequiredCoverageTarget>();
  const fingerprintCovered = getCoveredFingerprintFactors(profile.fingerprint);

  for (const key of Array.from(fingerprintCovered)) {
    coveredTargets.add(key);
  }

  if (getCoveredActivityCount(profile.activity_patterns) >= 3) {
    coveredTargets.add("activity_patterns");
  }

  if (hasValidGroupSizePreference(profile.preferences)) {
    coveredTargets.add("group_size_pref");
  }

  if (hasValidTimePreferences(profile.preferences)) {
    coveredTargets.add("time_preferences");
  }

  if (wasBoundariesQuestionAsked(profile)) {
    coveredTargets.add("boundaries_asked");
  }

  return coveredTargets;
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeHistory(conversationHistory: readonly string[]): string {
  return conversationHistory
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.toLowerCase().trim())
    .filter(Boolean)
    .join(" ");
}

function countDistinctActivityMentions(history: string): number {
  const matches = new Set<string>();
  for (const keyword of ACTIVITY_KEYWORDS) {
    if (history.includes(keyword)) {
      matches.add(keyword);
    }
  }
  return matches.size;
}

function isTargetInferableFromHistory(
  target: InterviewSignalTarget,
  normalizedHistory: string,
): boolean {
  if (!normalizedHistory) {
    return false;
  }

  switch (target) {
    case "activity_patterns":
      return countDistinctActivityMentions(normalizedHistory) >= 2;
    case "top_activity_intent":
      return countDistinctActivityMentions(normalizedHistory) >= 1 &&
        /\b(this week|this weekend|today|tonight)\b/.test(normalizedHistory);
    case "group_size_pref":
      return /\b(2-3|4-6|7-10|one on one|1:1|small group|large group)\b/.test(normalizedHistory);
    case "time_preferences":
      return /\b(morning|mornings|afternoon|afternoons|evening|evenings|weekend|weekends)\b/.test(
        normalizedHistory,
      );
    case "values_alignment_importance":
      return /\b(share values|same values|values matter|not a big deal)\b/.test(normalizedHistory);
    default:
      return false;
  }
}

function isQuestionAlreadyAnswered(
  questionId: InterviewQuestionStepId,
  profile: SignalCoverageProfile,
): boolean {
  const normalizedQuestionId = normalizeQuestionStepId(questionId);
  const progress = readInterviewProgress(profile.preferences);
  if (progress?.completedStepIds.includes(normalizedQuestionId)) {
    return true;
  }

  const lastStep = profile.last_interview_step;
  if (!lastStep || !isInterviewQuestionStepId(lastStep)) {
    return false;
  }

  return normalizeQuestionStepId(lastStep) === normalizedQuestionId;
}

function isTargetCovered(
  target: InterviewSignalTarget,
  coveredRequiredTargets: Set<RequiredCoverageTarget>,
  profile: SignalCoverageProfile,
): boolean {
  if ((REQUIRED_COVERAGE_TARGETS as readonly string[]).includes(target)) {
    return coveredRequiredTargets.has(target as RequiredCoverageTarget);
  }

  if (target === "top_activity_intent") {
    const activeIntent = asObject(profile.active_intent);
    return isNonEmptyString(activeIntent.activity_key);
  }

  if (target === "location_capture") {
    return isNonEmptyString(profile.country_code);
  }

  return false;
}

export function getSignalCoverageStatus(profile: SignalCoverageProfile): SignalCoverageStatus {
  const coveredSet = getCoverageSet(profile);
  const covered = REQUIRED_COVERAGE_TARGETS.filter((target) => coveredSet.has(target));
  const uncovered = REQUIRED_COVERAGE_TARGETS.filter((target) => !coveredSet.has(target));
  const fingerprintCoveredCount = FINGERPRINT_FACTOR_KEYS.filter((key) => coveredSet.has(key))
    .length;
  const mvpComplete = fingerprintCoveredCount >= 8 &&
    coveredSet.has("activity_patterns") &&
    coveredSet.has("group_size_pref") &&
    coveredSet.has("time_preferences") &&
    coveredSet.has("boundaries_asked");

  const nextSignalTarget = mvpComplete
    ? null
    : (REQUIRED_TARGET_PRIORITY.find((target) => !coveredSet.has(target)) ?? null);

  return {
    covered,
    uncovered,
    mvpComplete,
    nextSignalTarget,
  };
}

export function selectNextQuestion(
  profile: SignalCoverageProfile,
  conversationHistory: readonly string[],
): NextQuestionSelection | null {
  const coverage = getSignalCoverageStatus(profile);
  if (coverage.mvpComplete) {
    return null;
  }

  const coveredRequiredTargets = new Set(
    coverage.covered.filter((target): target is RequiredCoverageTarget =>
      (REQUIRED_COVERAGE_TARGETS as readonly string[]).includes(target)
    ),
  );

  const normalizedHistory = normalizeHistory(conversationHistory);
  const skippedInferableTargets: InterviewSignalTarget[] = [];
  const skippedAnsweredQuestionTargets: InterviewSignalTarget[] = [];
  let fallbackInferableTarget: InterviewSignalTarget | null = null;
  let fallbackAnsweredTarget: InterviewSignalTarget | null = null;

  for (const target of QUESTION_TARGET_PRIORITY) {
    if (isTargetCovered(target, coveredRequiredTargets, profile)) {
      continue;
    }

    const questionId = SIGNAL_TARGET_TO_QUESTION_ID[target];
    const alreadyAnswered = isQuestionAlreadyAnswered(questionId, profile);
    const inferable = isTargetInferableFromHistory(target, normalizedHistory);

    if (inferable) {
      skippedInferableTargets.push(target);
      if (!alreadyAnswered && fallbackInferableTarget === null) {
        fallbackInferableTarget = target;
      }
      continue;
    }

    if (alreadyAnswered) {
      skippedAnsweredQuestionTargets.push(target);
      if (fallbackAnsweredTarget === null) {
        fallbackAnsweredTarget = target;
      }
      continue;
    }

    return {
      questionId,
      signalTarget: target,
      metadata: {
        skippedInferableTargets,
        skippedAnsweredQuestionTargets,
      },
    };
  }

  const fallbackTarget = fallbackInferableTarget ?? fallbackAnsweredTarget;
  if (!fallbackTarget) {
    return null;
  }

  return {
    questionId: SIGNAL_TARGET_TO_QUESTION_ID[fallbackTarget],
    signalTarget: fallbackTarget,
    metadata: {
      skippedInferableTargets,
      skippedAnsweredQuestionTargets,
    },
  };
}
