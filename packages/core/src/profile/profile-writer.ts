import {
  ACTIVE_INTERVIEW_QUESTION_STEP_IDS,
  INTERVIEW_QUESTION_STEP_IDS,
  type InterviewNormalizedAnswer,
  type InterviewQuestionStepId,
} from "../interview/steps.ts";

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

function isActiveInterviewStepId(
  stepId: InterviewQuestionStepId,
): stepId is (typeof ACTIVE_INTERVIEW_QUESTION_STEP_IDS)[number] {
  return ACTIVE_INTERVIEW_QUESTION_STEP_IDS.includes(
    stepId as (typeof ACTIVE_INTERVIEW_QUESTION_STEP_IDS)[number],
  );
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

export function buildProfilePatchForInterviewAnswer(params: {
  profile: ProfileRowForInterview;
  stepId: InterviewQuestionStepId;
  answer: InterviewNormalizedAnswer;
  nextStepId: InterviewQuestionStepId | null;
  nowIso: string;
}): ProfileUpdatePatch {
  const fingerprint = asObject(params.profile.fingerprint);
  const boundaries = asObject(params.profile.boundaries);
  const preferences = asObject(params.profile.preferences);
  let activeIntent = asObject(params.profile.active_intent);
  let activityPatterns = asObjectArray(params.profile.activity_patterns);
  let countryCode = params.profile.country_code;
  let stateCode = params.profile.state_code;

  if (params.stepId === "activity_01") {
    const answer = params.answer as { activity_keys: string[] };
    activityPatterns = appendActivityPatterns(activityPatterns, answer.activity_keys);
  }

  if (params.stepId === "activity_02") {
    const answer = params.answer as { activity_key: string };
    activeIntent = {
      ...activeIntent,
      activity_key: answer.activity_key,
    };
  }

  if (params.stepId === "motive_01" || params.stepId === "motive_02") {
    const answer = params.answer as { motive_weights: Record<string, number> };
    activeIntent = {
      ...activeIntent,
      motive_weights: {
        ...(asObject(activeIntent.motive_weights) as Record<string, number>),
        ...answer.motive_weights,
      },
    };

    if (answer.motive_weights.connection) {
      setFingerprintValue(
        fingerprint,
        "connection_depth",
        answer.motive_weights.connection,
        0.62,
      );
    }
  }

  if (params.stepId === "style_01") {
    const answer = params.answer as { style_keys: string[] };
    setFingerprintValue(fingerprint, "interaction_style", answer.style_keys[0], 0.72);
  }

  if (params.stepId === "style_02") {
    const answer = params.answer as { style_keys: string[] };
    setFingerprintValue(fingerprint, "conversation_style", answer.style_keys, 0.7);
  }

  if (params.stepId === "pace_01") {
    const answer = params.answer as { social_pace: string };
    setFingerprintValue(fingerprint, "social_pace", answer.social_pace, 0.8);
  }

  if (params.stepId === "group_01") {
    const answer = params.answer as { group_size_pref: string };
    preferences.group_size_pref = answer.group_size_pref;
  }

  if (params.stepId === "values_01") {
    const answer = params.answer as { values_alignment_importance: string };
    preferences.values_alignment_importance = answer.values_alignment_importance;
  }

  if (params.stepId === "boundaries_01") {
    const answer = params.answer as { no_thanks: string[]; skipped: boolean };
    boundaries.no_thanks = answer.no_thanks;
    boundaries.skipped = answer.skipped;
  }

  if (params.stepId === "constraints_01") {
    const answer = params.answer as { time_preferences: string[] };
    preferences.time_preferences = answer.time_preferences;
  }

  if (params.stepId === "intro_01") {
    const answer = params.answer as { consent: "yes" | "later" };
    preferences.onboarding_consent = answer.consent;
  }

  if (params.stepId === "location_01") {
    const answer = params.answer as { country_code: string; state_code: string | null };
    countryCode = answer.country_code;
    stateCode = answer.state_code;
  }

  const existingProgress = readInterviewProgress(preferences) ?? {
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

  const completedCount = completedStepIds.filter(isActiveInterviewStepId).length;
  const requiredCount = ACTIVE_INTERVIEW_QUESTION_STEP_IDS.length;
  const completenessPercent = Math.round((completedCount / requiredCount) * 100);
  const isComplete = completedCount >= requiredCount;
  const nextState: ProfileState = isComplete ? "complete_mvp" : "partial";

  preferences.interview_progress = {
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
    country_code: countryCode,
    state_code: stateCode,
    last_interview_step: params.stepId,
    preferences,
    fingerprint,
    activity_patterns: activityPatterns,
    boundaries,
    active_intent: activeIntent,
    completeness_percent: completenessPercent,
    completed_at: isComplete ? params.nowIso : params.profile.completed_at,
    status_reason: isComplete ? "interview_complete_mvp" : "interview_in_progress",
    state_changed_at: nextState !== params.profile.state ? params.nowIso : params.profile.state_changed_at,
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
