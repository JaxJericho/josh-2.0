import {
  ACTIVE_INTERVIEW_QUESTION_STEP_IDS,
  INTERVIEW_QUESTION_STEP_IDS,
  type InterviewNormalizedAnswer,
  type InterviewQuestionStepId,
} from "../interview/steps.ts";
import {
  getSignalCoverageStatus,
  type InterviewSignalTarget,
  type SignalCoverageStatus,
} from "../interview/signal-coverage.ts";
import type { HolisticExtractOutput } from "../../../db/src/types/index.ts";

export type ProfileState =
  | "empty"
  | "partial"
  | "complete_mvp"
  | "complete_full"
  | "stale";

export type ProfileRowForInterview = {
  id: string;
  user_id: string;
  country_code: string | null;
  state_code: string | null;
  state: ProfileState;
  is_complete_mvp: boolean;
  last_interview_step: string | null;
  preferences: unknown;
  fingerprint: unknown;
  activity_patterns: unknown;
  boundaries: unknown;
  active_intent: unknown;
  completeness_percent: number;
  completed_at: string | null;
  status_reason: string | null;
  state_changed_at: string;
};

export type InterviewProgress = {
  version: number;
  status: "in_progress" | "paused" | "complete";
  step_index: number;
  current_step_id: InterviewQuestionStepId | null;
  completed_step_ids: InterviewQuestionStepId[];
  answers: Record<string, InterviewNormalizedAnswer>;
  updated_at: string;
};

export type ProfileUpdatePatch = {
  state: ProfileState;
  is_complete_mvp: boolean;
  country_code: string | null;
  state_code: string | null;
  last_interview_step: string | null;
  preferences: Record<string, unknown>;
  fingerprint: Record<string, unknown>;
  activity_patterns: Array<Record<string, unknown>>;
  boundaries: Record<string, unknown>;
  active_intent: Record<string, unknown> | null;
  coordination_dimensions?: Record<string, unknown>;
  scheduling_availability?: unknown;
  notice_preference?: string | null;
  coordination_style?: string | null;
  completeness_percent: number;
  completed_at: string | null;
  status_reason: string | null;
  state_changed_at: string;
};

export type StructuredProfileCoreSignals = {
  fingerprint: Record<string, unknown>;
  activity_patterns: Array<Record<string, unknown>>;
  boundaries: Record<string, unknown>;
  preferences: Record<string, unknown>;
  active_intent: Record<string, unknown> | null;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function asObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>;
}

function toInterviewStepIndex(stepId: InterviewQuestionStepId | null): number {
  if (!stepId) {
    return ACTIVE_INTERVIEW_QUESTION_STEP_IDS.length;
  }
  const normalizedStepId = stepId === "intro_01" ? "activity_01" : stepId;
  const index = ACTIVE_INTERVIEW_QUESTION_STEP_IDS.findIndex(
    (candidate) => candidate === normalizedStepId,
  );
  return index >= 0 ? index : 0;
}

function toUniqueStepIds(stepIds: InterviewQuestionStepId[]): InterviewQuestionStepId[] {
  const seen = new Set<InterviewQuestionStepId>();
  const ordered: InterviewQuestionStepId[] = [];
  for (const stepId of stepIds) {
    if (!seen.has(stepId)) {
      seen.add(stepId);
      ordered.push(stepId);
    }
  }
  return ordered;
}

export function readInterviewProgress(preferencesRaw: unknown): InterviewProgress | null {
  const preferences = asObject(preferencesRaw);
  const progressRaw = preferences.interview_progress;
  if (!progressRaw || typeof progressRaw !== "object" || Array.isArray(progressRaw)) {
    return null;
  }

  const progressObject = progressRaw as Record<string, unknown>;
  const completedStepIdsRaw = Array.isArray(progressObject.completed_step_ids)
    ? (progressObject.completed_step_ids as string[])
    : [];

  const completedStepIds = completedStepIdsRaw
    .filter((stepId): stepId is InterviewQuestionStepId =>
      INTERVIEW_QUESTION_STEP_IDS.includes(stepId as InterviewQuestionStepId),
    );

  const answersRaw = progressObject.answers;
  const answers = (answersRaw && typeof answersRaw === "object" && !Array.isArray(answersRaw))
    ? (answersRaw as Record<string, InterviewNormalizedAnswer>)
    : {};

  const currentStepId = typeof progressObject.current_step_id === "string" &&
      INTERVIEW_QUESTION_STEP_IDS.includes(progressObject.current_step_id as InterviewQuestionStepId)
    ? (progressObject.current_step_id as InterviewQuestionStepId)
    : null;

  const status = progressObject.status === "paused" || progressObject.status === "complete"
    ? progressObject.status
    : "in_progress";

  const updatedAt = typeof progressObject.updated_at === "string"
    ? progressObject.updated_at
    : new Date(0).toISOString();

  return {
    version: 1,
    status,
    step_index: typeof progressObject.step_index === "number" ? progressObject.step_index : toInterviewStepIndex(currentStepId),
    current_step_id: currentStepId,
    completed_step_ids: completedStepIds,
    answers,
    updated_at: updatedAt,
  };
}

export function buildProfilePatchForInterviewStart(params: {
  profile: ProfileRowForInterview;
  currentStepId: InterviewQuestionStepId;
  nowIso: string;
}): ProfileUpdatePatch {
  const preferences = asObject(params.profile.preferences);
  const existing = readInterviewProgress(preferences);

  const progress: InterviewProgress = {
    version: 1,
    status: "in_progress",
    step_index: toInterviewStepIndex(params.currentStepId),
    current_step_id: params.currentStepId,
    completed_step_ids: existing?.completed_step_ids ?? [],
    answers: existing?.answers ?? {},
    updated_at: params.nowIso,
  };

  preferences.interview_progress = progress;

  return {
    state: params.profile.state,
    is_complete_mvp: params.profile.is_complete_mvp,
    country_code: params.profile.country_code,
    state_code: params.profile.state_code,
    last_interview_step: params.profile.last_interview_step,
    preferences,
    fingerprint: asObject(params.profile.fingerprint),
    activity_patterns: asObjectArray(params.profile.activity_patterns),
    boundaries: asObject(params.profile.boundaries),
    active_intent: asObject(params.profile.active_intent),
    completeness_percent: params.profile.completeness_percent,
    completed_at: params.profile.completed_at,
    status_reason: params.profile.status_reason,
    state_changed_at: params.profile.state_changed_at,
  };
}

export function buildProfilePatchForInterviewPause(params: {
  profile: ProfileRowForInterview;
  currentStepId: InterviewQuestionStepId;
  nowIso: string;
}): ProfileUpdatePatch {
  const preferences = asObject(params.profile.preferences);
  const progress = readInterviewProgress(preferences) ?? {
    version: 1,
    status: "in_progress" as const,
    step_index: toInterviewStepIndex(params.currentStepId),
    current_step_id: params.currentStepId,
    completed_step_ids: [] as InterviewQuestionStepId[],
    answers: {} as Record<string, InterviewNormalizedAnswer>,
    updated_at: params.nowIso,
  };

  preferences.interview_progress = {
    ...progress,
    status: "paused",
    current_step_id: params.currentStepId,
    step_index: toInterviewStepIndex(params.currentStepId),
    updated_at: params.nowIso,
  };

  return {
    state: params.profile.state,
    is_complete_mvp: params.profile.is_complete_mvp,
    country_code: params.profile.country_code,
    state_code: params.profile.state_code,
    last_interview_step: params.profile.last_interview_step,
    preferences,
    fingerprint: asObject(params.profile.fingerprint),
    activity_patterns: asObjectArray(params.profile.activity_patterns),
    boundaries: asObject(params.profile.boundaries),
    active_intent: asObject(params.profile.active_intent),
    completeness_percent: params.profile.completeness_percent,
    completed_at: params.profile.completed_at,
    status_reason: params.profile.status_reason,
    state_changed_at: params.profile.state_changed_at,
  };
}

function setFingerprintValue(
  fingerprint: Record<string, unknown>,
  key: string,
  value: unknown,
  confidence: number,
): void {
  fingerprint[key] = {
    value,
    confidence,
    source: "interview",
  };
}

function appendActivityPatterns(
  currentPatterns: Array<Record<string, unknown>>,
  activityKeys: string[],
): Array<Record<string, unknown>> {
  const existingKeys = new Set(
    currentPatterns.map((pattern) => String(pattern.activity_key ?? "")).filter(Boolean),
  );

  const nextPatterns = [...currentPatterns];
  for (const activityKey of activityKeys) {
    if (!existingKeys.has(activityKey)) {
      nextPatterns.push({
        activity_key: activityKey,
        confidence: 0.65,
        source: "interview",
      });
    }
  }

  return nextPatterns;
}

type InterviewWriteTarget =
  | InterviewSignalTarget
  | "motive_weights"
  | "interaction_style"
  | "values_alignment_preference"
  | "onboarding_consent";

type InterviewSignalWriteContext = {
  fingerprint: Record<string, unknown>;
  boundaries: Record<string, unknown>;
  preferences: Record<string, unknown>;
  activeIntent: Record<string, unknown>;
  activityPatterns: Array<Record<string, unknown>>;
  countryCode: string | null;
  stateCode: string | null;
};

type InterviewSignalWriter = (
  context: InterviewSignalWriteContext,
  answer: InterviewNormalizedAnswer,
) => void;

const STEP_TO_WRITE_TARGETS: Readonly<Record<InterviewQuestionStepId, readonly InterviewWriteTarget[]>> = {
  intro_01: ["onboarding_consent"],
  activity_01: ["activity_patterns"],
  activity_02: ["top_activity_intent"],
  motive_01: [
    "motive_weights",
    "connection_depth",
    "novelty_seeking",
    "emotional_directness",
    "adventure_comfort",
  ],
  motive_02: [
    "motive_weights",
    "connection_depth",
    "novelty_seeking",
    "emotional_directness",
    "adventure_comfort",
  ],
  style_01: ["interaction_style", "social_energy", "humor_style"],
  style_02: ["conversation_style"],
  pace_01: ["social_pace", "structure_preference"],
  group_01: ["group_size_pref", "group_vs_1on1_preference"],
  values_01: ["values_alignment_preference", "values_alignment_importance"],
  boundaries_01: ["boundaries_asked", "conflict_tolerance"],
  constraints_01: ["time_preferences"],
  location_01: ["location_capture"],
};

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readMotiveWeights(answer: InterviewNormalizedAnswer): Record<string, number> {
  const raw = (answer as { motive_weights?: unknown }).motive_weights;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const motiveWeights = raw as Record<string, unknown>;
  const merged: Record<string, number> = {};
  for (const [key, value] of Object.entries(motiveWeights)) {
    const parsed = asNumber(value);
    if (parsed != null) {
      merged[key] = parsed;
    }
  }

  return merged;
}

function readStyleKeys(answer: InterviewNormalizedAnswer): string[] {
  const raw = (answer as { style_keys?: unknown }).style_keys;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function readTopActivity(answer: InterviewNormalizedAnswer): string | null {
  const raw = (answer as { activity_key?: unknown }).activity_key;
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

function readActivityKeys(answer: InterviewNormalizedAnswer): string[] {
  const raw = (answer as { activity_keys?: unknown }).activity_keys;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function readPace(answer: InterviewNormalizedAnswer): "slow" | "medium" | "fast" | null {
  const raw = (answer as { social_pace?: unknown }).social_pace;
  if (raw === "slow" || raw === "medium" || raw === "fast") {
    return raw;
  }
  return null;
}

function readGroupSize(answer: InterviewNormalizedAnswer): "2-3" | "4-6" | "7-10" | null {
  const raw = (answer as { group_size_pref?: unknown }).group_size_pref;
  if (raw === "2-3" || raw === "4-6" || raw === "7-10") {
    return raw;
  }
  return null;
}

function readValuesAlignmentImportance(
  answer: InterviewNormalizedAnswer,
): "very" | "somewhat" | "not_a_big_deal" | null {
  const raw = (answer as { values_alignment_importance?: unknown }).values_alignment_importance;
  if (raw === "very" || raw === "somewhat" || raw === "not_a_big_deal") {
    return raw;
  }
  return null;
}

function readBoundaries(
  answer: InterviewNormalizedAnswer,
): { no_thanks: string[]; skipped: boolean } {
  const rawNoThanks = (answer as { no_thanks?: unknown }).no_thanks;
  const rawSkipped = (answer as { skipped?: unknown }).skipped;
  const noThanks = Array.isArray(rawNoThanks)
    ? rawNoThanks.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    no_thanks: noThanks,
    skipped: typeof rawSkipped === "boolean" ? rawSkipped : false,
  };
}

function readTimePreferences(answer: InterviewNormalizedAnswer): string[] {
  const raw = (answer as { time_preferences?: unknown }).time_preferences;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function readLocation(
  answer: InterviewNormalizedAnswer,
): { country_code: string; state_code: string | null } | null {
  const countryCode = (answer as { country_code?: unknown }).country_code;
  const stateCode = (answer as { state_code?: unknown }).state_code;
  if (typeof countryCode !== "string" || countryCode.length === 0) {
    return null;
  }
  return {
    country_code: countryCode,
    state_code: typeof stateCode === "string" ? stateCode : null,
  };
}

function readConsent(answer: InterviewNormalizedAnswer): "yes" | "later" | null {
  const consent = (answer as { consent?: unknown }).consent;
  if (consent === "yes" || consent === "later") {
    return consent;
  }
  return null;
}

function mergeMotiveWeights(
  activeIntent: Record<string, unknown>,
  answer: InterviewNormalizedAnswer,
): Record<string, unknown> {
  const nextMotiveWeights = readMotiveWeights(answer);
  if (Object.keys(nextMotiveWeights).length === 0) {
    return activeIntent;
  }

  const existing = asObject(activeIntent.motive_weights);
  return {
    ...activeIntent,
    motive_weights: {
      ...existing,
      ...nextMotiveWeights,
    },
  };
}

function deriveNoveltySeeking(answer: InterviewNormalizedAnswer): number | null {
  const weights = readMotiveWeights(answer);
  if (Object.keys(weights).length === 0) {
    return null;
  }

  const adventure = weights.adventure ?? 0;
  const fun = weights.fun ?? 0;
  const novelty = Math.max(adventure, fun * 0.85);
  return novelty > 0 ? Math.min(1, novelty) : null;
}

function deriveAdventureComfort(answer: InterviewNormalizedAnswer): number | null {
  const weights = readMotiveWeights(answer);
  const adventure = weights.adventure ?? 0;
  return adventure > 0 ? Math.min(1, adventure) : null;
}

function deriveEmotionalDirectness(answer: InterviewNormalizedAnswer): number | null {
  const weights = readMotiveWeights(answer);
  if (Object.keys(weights).length === 0) {
    return null;
  }

  const connection = weights.connection ?? 0;
  const restorative = weights.restorative ?? 0;
  const comfort = weights.comfort ?? 0;
  const directness = Math.max(connection, restorative * 0.75, comfort * 0.65);
  return directness > 0 ? Math.min(1, directness) : null;
}

function deriveSocialEnergy(answer: InterviewNormalizedAnswer): number | null {
  const primaryStyle = readStyleKeys(answer)[0];
  if (!primaryStyle) {
    return null;
  }

  const SOCIAL_ENERGY_BY_STYLE: Record<string, number> = {
    curious: 0.6,
    funny: 0.72,
    thoughtful: 0.52,
    energetic: 0.84,
  };

  return SOCIAL_ENERGY_BY_STYLE[primaryStyle] ?? null;
}

function deriveHumorStyle(answer: InterviewNormalizedAnswer): string | null {
  const primaryStyle = readStyleKeys(answer)[0];
  if (!primaryStyle) {
    return null;
  }
  if (primaryStyle === "funny") {
    return "playful";
  }
  return primaryStyle;
}

function deriveStructurePreference(answer: InterviewNormalizedAnswer): string | null {
  const pace = readPace(answer);
  if (!pace) {
    return null;
  }

  const STRUCTURE_BY_PACE: Record<typeof pace, string> = {
    slow: "planned",
    medium: "balanced",
    fast: "spontaneous",
  };

  return STRUCTURE_BY_PACE[pace];
}

function deriveGroupPreference(answer: InterviewNormalizedAnswer): string | null {
  const groupSize = readGroupSize(answer);
  if (!groupSize) {
    return null;
  }

  if (groupSize === "2-3") {
    return "small_group";
  }
  if (groupSize === "4-6") {
    return "balanced_group";
  }
  return "larger_group";
}

function deriveConflictTolerance(answer: InterviewNormalizedAnswer): number {
  const boundaries = readBoundaries(answer);
  if (boundaries.skipped) {
    return 0.5;
  }

  const count = boundaries.no_thanks.length;
  const score = 1 - Math.min(4, count) * 0.15;
  return Math.max(0.3, Math.min(1, score));
}

const TARGET_WRITERS: Readonly<Record<InterviewWriteTarget, InterviewSignalWriter>> = {
  activity_patterns: (context, answer) => {
    context.activityPatterns = appendActivityPatterns(
      context.activityPatterns,
      readActivityKeys(answer),
    );
  },
  top_activity_intent: (context, answer) => {
    const activityKey = readTopActivity(answer);
    if (!activityKey) {
      return;
    }
    context.activeIntent = {
      ...context.activeIntent,
      activity_key: activityKey,
    };
  },
  motive_weights: (context, answer) => {
    context.activeIntent = mergeMotiveWeights(context.activeIntent, answer);
  },
  connection_depth: (context, answer) => {
    const connection = readMotiveWeights(answer).connection;
    if (connection != null) {
      setFingerprintValue(context.fingerprint, "connection_depth", connection, 0.62);
    }
  },
  novelty_seeking: (context, answer) => {
    const noveltySeeking = deriveNoveltySeeking(answer);
    if (noveltySeeking != null) {
      setFingerprintValue(context.fingerprint, "novelty_seeking", noveltySeeking, 0.61);
    }
  },
  emotional_directness: (context, answer) => {
    const emotionalDirectness = deriveEmotionalDirectness(answer);
    if (emotionalDirectness != null) {
      setFingerprintValue(
        context.fingerprint,
        "emotional_directness",
        emotionalDirectness,
        0.58,
      );
    }
  },
  adventure_comfort: (context, answer) => {
    const adventureComfort = deriveAdventureComfort(answer);
    if (adventureComfort != null) {
      setFingerprintValue(context.fingerprint, "adventure_comfort", adventureComfort, 0.6);
    }
  },
  interaction_style: (context, answer) => {
    const primaryStyle = readStyleKeys(answer)[0];
    if (primaryStyle) {
      setFingerprintValue(context.fingerprint, "interaction_style", primaryStyle, 0.72);
    }
  },
  social_energy: (context, answer) => {
    const socialEnergy = deriveSocialEnergy(answer);
    if (socialEnergy != null) {
      setFingerprintValue(context.fingerprint, "social_energy", socialEnergy, 0.68);
    }
  },
  humor_style: (context, answer) => {
    const humorStyle = deriveHumorStyle(answer);
    if (humorStyle) {
      setFingerprintValue(context.fingerprint, "humor_style", humorStyle, 0.6);
    }
  },
  conversation_style: (context, answer) => {
    const styleKeys = readStyleKeys(answer);
    if (styleKeys.length > 0) {
      setFingerprintValue(context.fingerprint, "conversation_style", styleKeys, 0.7);
    }
  },
  social_pace: (context, answer) => {
    const socialPace = readPace(answer);
    if (socialPace) {
      setFingerprintValue(context.fingerprint, "social_pace", socialPace, 0.8);
    }
  },
  structure_preference: (context, answer) => {
    const structurePreference = deriveStructurePreference(answer);
    if (structurePreference) {
      setFingerprintValue(
        context.fingerprint,
        "structure_preference",
        structurePreference,
        0.66,
      );
    }
  },
  group_size_pref: (context, answer) => {
    const groupSizePreference = readGroupSize(answer);
    if (groupSizePreference) {
      context.preferences.group_size_pref = groupSizePreference;
    }
  },
  group_vs_1on1_preference: (context, answer) => {
    const groupPreference = deriveGroupPreference(answer);
    if (groupPreference) {
      setFingerprintValue(
        context.fingerprint,
        "group_vs_1on1_preference",
        groupPreference,
        0.65,
      );
    }
  },
  values_alignment_preference: (context, answer) => {
    const valuesAlignmentImportance = readValuesAlignmentImportance(answer);
    if (valuesAlignmentImportance) {
      context.preferences.values_alignment_importance = valuesAlignmentImportance;
    }
  },
  values_alignment_importance: (context, answer) => {
    const valuesAlignmentImportance = readValuesAlignmentImportance(answer);
    if (valuesAlignmentImportance) {
      setFingerprintValue(
        context.fingerprint,
        "values_alignment_importance",
        valuesAlignmentImportance,
        0.74,
      );
    }
  },
  boundaries_asked: (context, answer) => {
    const boundaries = readBoundaries(answer);
    context.boundaries.no_thanks = boundaries.no_thanks;
    context.boundaries.skipped = boundaries.skipped;
  },
  conflict_tolerance: (context, answer) => {
    setFingerprintValue(
      context.fingerprint,
      "conflict_tolerance",
      deriveConflictTolerance(answer),
      0.58,
    );
  },
  time_preferences: (context, answer) => {
    const timePreferences = readTimePreferences(answer);
    if (timePreferences.length > 0) {
      context.preferences.time_preferences = timePreferences;
    }
  },
  onboarding_consent: (context, answer) => {
    const consent = readConsent(answer);
    if (consent) {
      context.preferences.onboarding_consent = consent;
    }
  },
  location_capture: (context, answer) => {
    const location = readLocation(answer);
    if (!location) {
      return;
    }
    context.countryCode = location.country_code;
    context.stateCode = location.state_code;
  },
};

function computeCoverageCompletenessPercent(coverageStatus: SignalCoverageStatus): number {
  const total = coverageStatus.covered.length + coverageStatus.uncovered.length;
  if (total <= 0) {
    return 0;
  }
  return Math.round((coverageStatus.covered.length / total) * 100);
}

function applySignalWriters(params: {
  stepId: InterviewQuestionStepId;
  answer: InterviewNormalizedAnswer;
  context: InterviewSignalWriteContext;
}): void {
  const targets = STEP_TO_WRITE_TARGETS[params.stepId] ?? [];
  for (const target of targets) {
    TARGET_WRITERS[target](params.context, params.answer);
  }
}

export function buildProfilePatchForInterviewAnswer(params: {
  profile: ProfileRowForInterview;
  stepId: InterviewQuestionStepId;
  answer: InterviewNormalizedAnswer;
  nextStepId: InterviewQuestionStepId | null;
  nowIso: string;
}): ProfileUpdatePatch {
  const context: InterviewSignalWriteContext = {
    fingerprint: asObject(params.profile.fingerprint),
    boundaries: asObject(params.profile.boundaries),
    preferences: asObject(params.profile.preferences),
    activeIntent: asObject(params.profile.active_intent),
    activityPatterns: asObjectArray(params.profile.activity_patterns),
    countryCode: params.profile.country_code,
    stateCode: params.profile.state_code,
  };

  applySignalWriters({
    stepId: params.stepId,
    answer: params.answer,
    context,
  });

  const existingProgress = readInterviewProgress(context.preferences) ?? {
    version: 1,
    status: "in_progress" as const,
    step_index: toInterviewStepIndex(params.stepId),
    current_step_id: params.stepId,
    completed_step_ids: [] as InterviewQuestionStepId[],
    answers: {} as Record<string, InterviewNormalizedAnswer>,
    updated_at: params.nowIso,
  };

  const completedStepIds = toUniqueStepIds([
    ...existingProgress.completed_step_ids,
    params.stepId,
  ]);

  const answers = {
    ...existingProgress.answers,
    [params.stepId]: params.answer,
  };

  const coverageStatus = getSignalCoverageStatus({
    country_code: context.countryCode,
    last_interview_step: params.stepId,
    fingerprint: context.fingerprint,
    activity_patterns: context.activityPatterns,
    boundaries: context.boundaries,
    preferences: context.preferences,
    active_intent: context.activeIntent,
  });

  const isComplete = coverageStatus.mvpComplete;
  const completenessPercent = computeCoverageCompletenessPercent(coverageStatus);
  const nextState: ProfileState = isComplete ? "complete_mvp" : "partial";

  context.preferences.interview_progress = {
    version: 1,
    status: isComplete ? "complete" : "in_progress",
    step_index: toInterviewStepIndex(params.nextStepId),
    current_step_id: params.nextStepId,
    completed_step_ids: completedStepIds,
    answers,
    updated_at: params.nowIso,
  } satisfies InterviewProgress;

  return {
    state: nextState,
    is_complete_mvp: isComplete,
    country_code: context.countryCode,
    state_code: context.stateCode,
    last_interview_step: params.stepId,
    preferences: context.preferences,
    fingerprint: context.fingerprint,
    activity_patterns: context.activityPatterns,
    boundaries: context.boundaries,
    active_intent: context.activeIntent,
    completeness_percent: completenessPercent,
    completed_at: isComplete ? params.nowIso : params.profile.completed_at,
    status_reason: isComplete ? "interview_complete_mvp" : "interview_in_progress",
    state_changed_at: nextState !== params.profile.state ? params.nowIso : params.profile.state_changed_at,
  };
}

function mergeFingerprintFromExtraction(
  fingerprint: Record<string, unknown>,
  extractionOutput: HolisticExtractOutput,
): Record<string, unknown> {
  const nextFingerprint = { ...fingerprint };
  for (const [key, patch] of Object.entries(extractionOutput.coordinationDimensionUpdates)) {
    if (!patch) {
      continue;
    }
    setFingerprintValue(
      nextFingerprint,
      key,
      patch.value,
      patch.confidence,
    );
  }
  return nextFingerprint;
}

function mergeCoordinationDimensionsFromExtraction(
  coordinationDimensionsRaw: Record<string, unknown>,
  extractionOutput: HolisticExtractOutput,
): Record<string, unknown> {
  const nextDimensions = { ...coordinationDimensionsRaw };
  for (const [key, patch] of Object.entries(extractionOutput.coordinationDimensionUpdates)) {
    if (!patch) {
      continue;
    }
    const existing = asObject(nextDimensions[key]);
    const existingConfidence = typeof existing.confidence === "number" ? existing.confidence : 0;
    nextDimensions[key] = {
      value: patch.value,
      confidence: Math.max(existingConfidence, patch.confidence),
      source: "interview_llm",
    };
  }
  return nextDimensions;
}

export function applyHolisticExtractOutputToProfilePatch(params: {
  profilePatch: ProfileUpdatePatch;
  extractionOutput: HolisticExtractOutput;
  nowIso: string;
}): ProfileUpdatePatch {
  const nextPatch = {
    ...params.profilePatch,
  } as ProfileUpdatePatch & Record<string, unknown>;

  const fingerprint = mergeFingerprintFromExtraction(
    asObject(nextPatch.fingerprint),
    params.extractionOutput,
  );
  const coordinationDimensions = mergeCoordinationDimensionsFromExtraction(
    asObject(nextPatch.coordination_dimensions),
    params.extractionOutput,
  );
  const activityPatterns = asObjectArray(nextPatch.activity_patterns);
  const boundaries = asObject(nextPatch.boundaries);
  const preferences = asObject(nextPatch.preferences);
  const activeIntent = asObject(nextPatch.active_intent);

  if ("scheduling_availability" in params.extractionOutput.coordinationSignalUpdates) {
    nextPatch.scheduling_availability =
      params.extractionOutput.coordinationSignalUpdates.scheduling_availability ?? null;
  }
  if ("notice_preference" in params.extractionOutput.coordinationSignalUpdates) {
    nextPatch.notice_preference = params.extractionOutput.coordinationSignalUpdates.notice_preference ?? null;
  }
  if ("coordination_style" in params.extractionOutput.coordinationSignalUpdates) {
    nextPatch.coordination_style = params.extractionOutput.coordinationSignalUpdates.coordination_style ?? null;
  }

  const coverageStatus = getSignalCoverageStatus({
    country_code: nextPatch.country_code,
    last_interview_step: nextPatch.last_interview_step,
    fingerprint,
    activity_patterns: activityPatterns,
    boundaries,
    preferences,
    active_intent: activeIntent,
  });

  const isComplete = coverageStatus.mvpComplete;
  const nextState: ProfileState = isComplete ? "complete_mvp" : "partial";

  return {
    ...nextPatch,
    state: nextState,
    is_complete_mvp: isComplete,
    fingerprint,
    coordination_dimensions: coordinationDimensions,
    activity_patterns: activityPatterns,
    boundaries,
    preferences,
    active_intent: activeIntent,
    completeness_percent: computeCoverageCompletenessPercent(coverageStatus),
    completed_at: isComplete
      ? (params.profilePatch.completed_at ?? params.nowIso)
      : params.profilePatch.completed_at,
    status_reason: isComplete ? "interview_complete_mvp" : "interview_in_progress",
    state_changed_at: nextState !== params.profilePatch.state
      ? params.nowIso
      : params.profilePatch.state_changed_at,
  };
}

export function buildStructuredProfileCoreSignals(input: {
  fingerprint: unknown;
  activity_patterns: unknown;
  boundaries: unknown;
  preferences: unknown;
  active_intent: unknown;
}): StructuredProfileCoreSignals {
  return {
    fingerprint: asObject(input.fingerprint),
    activity_patterns: asObjectArray(input.activity_patterns),
    boundaries: asObject(input.boundaries),
    preferences: asObject(input.preferences),
    active_intent: input.active_intent == null ? null : asObject(input.active_intent),
  };
}
