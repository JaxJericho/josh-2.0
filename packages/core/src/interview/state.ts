import {
  applyInterviewExtractOutputToProfilePatch,
  buildProfilePatchForInterviewAnswer,
  buildProfilePatchForInterviewPause,
  buildProfilePatchForInterviewStart,
  readInterviewProgress,
  type ProfileRowForInterview,
  type ProfileUpdatePatch,
} from "../profile/profile-writer.ts";
import {
  ACTIVE_INTERVIEW_QUESTION_STEP_IDS,
  getInterviewStepById,
  isInterviewQuestionStepId,
  isInterviewStepId,
  type InterviewNormalizedAnswer,
  type InterviewQuestionStepId,
} from "./steps.ts";
import {
  INTERVIEW_DROPOUT_RESUME,
  INTERVIEW_WRAP,
} from "./messages.ts";
import {
  getSignalCoverageStatus,
  selectNextQuestion,
  type NextQuestionSelection,
} from "./signal-coverage.ts";
import {
  extractInterviewSignals,
  InterviewExtractorError,
  type InterviewExtractInput,
} from "../../../llm/src/interview-extractor.ts";
import type { InterviewExtractOutput } from "../../../llm/src/schemas/interview-extract-output.schema.ts";

export type ConversationMode =
  | "idle"
  | "interviewing"
  | "linkup_forming"
  | "awaiting_invite_reply"
  | "safety_hold";

export type InterviewSessionSnapshot = {
  mode: ConversationMode;
  state_token: string;
  current_step_id: string | null;
  last_inbound_message_sid: string | null;
  dropout_nudge_sent_at: string | null;
};

export type InterviewTransitionAction =
  | "idempotent"
  | "start"
  | "retry"
  | "advance"
  | "pause"
  | "resume"
  | "complete";

export type InterviewTransitionPlan = {
  action: InterviewTransitionAction;
  reply_message: string;
  current_step_id: InterviewQuestionStepId | null;
  next_step_id: InterviewQuestionStepId | null;
  next_session: {
    mode: ConversationMode;
    state_token: string;
    current_step_id: InterviewQuestionStepId | null;
    last_inbound_message_sid: string;
    dropout_nudge_sent_at: string | null;
  };
  profile_patch: ProfileUpdatePatch | null;
  profile_event_type: string | null;
  profile_event_step_id: InterviewQuestionStepId | null;
  profile_event_payload: Record<string, unknown> | null;
};

export type BuildInterviewTransitionInput = {
  inbound_message_sid: string;
  inbound_message_text: string;
  now_iso: string;
  session: InterviewSessionSnapshot;
  profile: ProfileRowForInterview;
  llm_extractor?: (input: InterviewExtractInput) => Promise<InterviewExtractOutput>;
  llm_request_guard?: Set<string>;
};

export const ALREADY_COMPLETE_PROFILE_MESSAGE =
  "You're all set. If you want to tweak your profile, text me what to change.";

const INTERVIEW_DEPRECATED_INTRO_STEP_ID: InterviewQuestionStepId = "intro_01";
const INTERVIEW_ACTIVE_START_STEP_ID: InterviewQuestionStepId = "activity_01";

export const ONBOARDING_STATE_TOKENS = [
  "onboarding:awaiting_opening_response",
  "onboarding:awaiting_explanation_response",
  "onboarding:awaiting_interview_start",
] as const;

export type OnboardingStateToken = (typeof ONBOARDING_STATE_TOKENS)[number];
export type InterviewOrOnboardingStateToken = InterviewQuestionStepId | OnboardingStateToken;

const ONBOARDING_STATE_TOKEN_SET: ReadonlySet<OnboardingStateToken> = new Set(ONBOARDING_STATE_TOKENS);

export function toInterviewStateToken(stepId: InterviewQuestionStepId): string {
  return `interview:${stepId}`;
}

export function isOnboardingStateToken(token: string): token is OnboardingStateToken {
  return ONBOARDING_STATE_TOKEN_SET.has(token as OnboardingStateToken);
}

function normalizeDeprecatedInterviewStepId(stepId: InterviewQuestionStepId): InterviewQuestionStepId {
  return stepId === INTERVIEW_DEPRECATED_INTRO_STEP_ID
    ? INTERVIEW_ACTIVE_START_STEP_ID
    : stepId;
}

export function fromInterviewStateToken(token: string): InterviewOrOnboardingStateToken | null {
  const normalized = token.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("onboarding:")) {
    if (!isOnboardingStateToken(normalized)) {
      throw new Error(`Unknown onboarding state token '${normalized}'.`);
    }
    return normalized;
  }

  if (!normalized.startsWith("interview:")) {
    return null;
  }

  const stepId = normalized.slice("interview:".length);
  if (!isInterviewStepId(stepId) || !isInterviewQuestionStepId(stepId)) {
    throw new Error(`Unknown interview state token '${normalized}'.`);
  }

  return normalizeDeprecatedInterviewStepId(stepId);
}

function collectHistoryFragments(value: unknown): string[] {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectHistoryFragments(entry));
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .flatMap((entry) => collectHistoryFragments(entry));
  }

  return [];
}

function buildConversationHistory(
  profile: ProfileRowForInterview,
  latestInboundMessageText?: string,
): string[] {
  const progress = readInterviewProgress(profile.preferences);
  const historyFromAnswers = progress
    ? Object.values(progress.answers).flatMap((answer) => collectHistoryFragments(answer))
    : [];

  const latest = typeof latestInboundMessageText === "string"
    ? latestInboundMessageText.trim()
    : "";

  if (latest.length === 0) {
    return historyFromAnswers;
  }

  return [...historyFromAnswers, latest];
}

function pickNextQuestion(profile: ProfileRowForInterview): NextQuestionSelection | null {
  return selectNextQuestion(profile, buildConversationHistory(profile));
}

function shouldSendCompletionWrap(session: InterviewSessionSnapshot): boolean {
  return session.mode === "interviewing" && session.state_token.startsWith("interview:");
}

function shouldSendDropoutResume(session: InterviewSessionSnapshot): boolean {
  return session.mode === "interviewing" && Boolean(session.dropout_nudge_sent_at);
}

function buildDropoutResumeReply(stepId: InterviewQuestionStepId): string {
  return `${INTERVIEW_DROPOUT_RESUME}\n\n${getInterviewStepById(stepId).prompt}`;
}

export function resolveCurrentInterviewStep(params: {
  session: InterviewSessionSnapshot;
  profile: ProfileRowForInterview;
}): InterviewQuestionStepId {
  const tokenFromSession = fromInterviewStateToken(params.session.state_token);
  if (params.session.mode === "interviewing" && tokenFromSession === null) {
    throw new Error(`Unknown interview state token '${params.session.state_token}'.`);
  }

  const sessionCurrent = params.session.current_step_id;
  if (sessionCurrent && isInterviewQuestionStepId(sessionCurrent)) {
    return normalizeDeprecatedInterviewStepId(sessionCurrent);
  }

  if (tokenFromSession) {
    if (isOnboardingStateToken(tokenFromSession)) {
      throw new Error(
        `Onboarding state token '${tokenFromSession}' must be routed to onboarding engine.`,
      );
    }
    return tokenFromSession;
  }

  const progress = readInterviewProgress(params.profile.preferences);
  if (progress?.current_step_id) {
    return normalizeDeprecatedInterviewStepId(progress.current_step_id);
  }

  const selection = pickNextQuestion(params.profile);
  if (selection?.questionId) {
    return selection.questionId;
  }

  return ACTIVE_INTERVIEW_QUESTION_STEP_IDS[0] ?? INTERVIEW_ACTIVE_START_STEP_ID;
}

function buildCollectedAnswers(profile: ProfileRowForInterview): Record<string, unknown> {
  const progress = readInterviewProgress(profile.preferences);
  if (!progress) {
    return {};
  }
  return progress.answers;
}

function applyProfilePatch(
  profile: ProfileRowForInterview,
  patch: ProfileUpdatePatch,
): ProfileRowForInterview {
  return {
    ...profile,
    ...patch,
  };
}

function toQuestionTarget(stepId: InterviewQuestionStepId): string {
  switch (stepId) {
    case "activity_01":
      return "activity_patterns";
    case "activity_02":
      return "top_activity_intent";
    case "motive_01":
      return "connection_depth";
    case "motive_02":
      return "novelty_seeking";
    case "style_01":
      return "social_energy";
    case "style_02":
      return "conversation_style";
    case "pace_01":
      return "social_pace";
    case "group_01":
      return "group_size_pref";
    case "values_01":
      return "values_alignment_importance";
    case "boundaries_01":
      return "boundaries_asked";
    case "constraints_01":
      return "time_preferences";
    case "location_01":
      return "location_capture";
    case "intro_01":
      return "onboarding_consent";
    default:
      return stepId;
  }
}

function normalizeActivityKeysFromExtraction(
  extraction: InterviewExtractOutput,
): string[] {
  const keys = (extraction.extracted.activityPatternsAdd ?? [])
    .map((entry) => entry.activity_key.trim())
    .filter(Boolean);
  return Array.from(new Set(keys)).slice(0, 3);
}

function deriveStoredAnswerFromExtraction(
  stepId: InterviewQuestionStepId,
  extraction: InterviewExtractOutput,
): InterviewNormalizedAnswer {
  const activityKeys = normalizeActivityKeysFromExtraction(extraction);
  switch (stepId) {
    case "activity_01":
      return { activity_keys: activityKeys };
    case "activity_02":
      return { activity_key: activityKeys[0] ?? "coffee" };
    case "motive_01":
    case "motive_02": {
      const motiveWeights = extraction.extracted.activityPatternsAdd?.[0]?.motive_weights ?? {};
      return { motive_weights: motiveWeights };
    }
    case "style_01":
    case "style_02":
      return { style_keys: [] };
    case "pace_01":
      return { social_pace: "medium" };
    case "group_01":
      return { group_size_pref: "4-6" };
    case "values_01":
      return { values_alignment_importance: "somewhat" };
    case "boundaries_01":
      return { no_thanks: [], skipped: true };
    case "constraints_01":
      return { time_preferences: ["evenings"] };
    case "location_01":
      return { country_code: "US", state_code: null };
    case "intro_01":
      return { consent: "yes" };
    default:
      return { activity_keys: [] };
  }
}

function canAttemptLlmExtraction(input: BuildInterviewTransitionInput): boolean {
  const guard = input.llm_request_guard ?? new Set<string>();
  const key = `${input.profile.user_id}:${input.inbound_message_sid}`;
  if (guard.has(key)) {
    return false;
  }
  guard.add(key);
  return true;
}

async function maybeExtractWithLlm(params: {
  input: BuildInterviewTransitionInput;
  currentStepId: InterviewQuestionStepId;
  currentStepPrompt: string;
}): Promise<{
  extractionOutput: InterviewExtractOutput | null;
  extractionErrorCode: string | null;
}> {
  if (!canAttemptLlmExtraction(params.input)) {
    return {
      extractionOutput: null,
      extractionErrorCode: "rate_limited",
    };
  }

  const extractor = params.input.llm_extractor ?? extractInterviewSignals;
  try {
    const extractionOutput = await extractor({
      userId: params.input.profile.user_id,
      inboundMessageSid: params.input.inbound_message_sid,
      stepId: params.currentStepId,
      questionTarget: toQuestionTarget(params.currentStepId),
      questionText: params.currentStepPrompt,
      userAnswerText: params.input.inbound_message_text,
      recentConversationTurns: buildConversationHistory(params.input.profile)
        .slice(-6)
        .map((text) => ({ role: "user" as const, text })),
      currentProfile: {
        fingerprint: (params.input.profile.fingerprint as Record<string, unknown>) ?? {},
        activityPatterns: (params.input.profile.activity_patterns as Array<Record<string, unknown>>) ?? [],
        boundaries: (params.input.profile.boundaries as Record<string, unknown>) ?? {},
        preferences: (params.input.profile.preferences as Record<string, unknown>) ?? {},
      },
    });

    return {
      extractionOutput,
      extractionErrorCode: null,
    };
  } catch (error) {
    if (error instanceof InterviewExtractorError) {
      return {
        extractionOutput: null,
        extractionErrorCode: error.code,
      };
    }
    return {
      extractionOutput: null,
      extractionErrorCode: "unknown_error",
    };
  }
}

export async function buildInterviewTransitionPlan(
  input: BuildInterviewTransitionInput,
): Promise<InterviewTransitionPlan> {
  const coverageStatus = getSignalCoverageStatus(input.profile);
  if (coverageStatus.mvpComplete || input.profile.state === "complete_full") {
    const shouldWrap = shouldSendCompletionWrap(input.session);
    return {
      action: shouldWrap ? "complete" : "idempotent",
      reply_message: shouldWrap ? INTERVIEW_WRAP : ALREADY_COMPLETE_PROFILE_MESSAGE,
      current_step_id: null,
      next_step_id: null,
      next_session: {
        mode: "idle",
        state_token: "idle",
        current_step_id: null,
        last_inbound_message_sid: input.inbound_message_sid,
        dropout_nudge_sent_at: null,
      },
      profile_patch: null,
      profile_event_type: null,
      profile_event_step_id: null,
      profile_event_payload: null,
    };
  }

  const currentStepId = resolveCurrentInterviewStep({
    session: input.session,
    profile: input.profile,
  });

  if (input.session.last_inbound_message_sid === input.inbound_message_sid) {
    return {
      action: "idempotent",
      reply_message: getInterviewStepById(currentStepId).prompt,
      current_step_id: currentStepId,
      next_step_id: currentStepId,
      next_session: {
        mode: "interviewing",
        state_token: toInterviewStateToken(currentStepId),
        current_step_id: currentStepId,
        last_inbound_message_sid: input.inbound_message_sid,
        dropout_nudge_sent_at: input.session.dropout_nudge_sent_at,
      },
      profile_patch: null,
      profile_event_type: null,
      profile_event_step_id: null,
      profile_event_payload: null,
    };
  }

  if (input.session.mode !== "interviewing") {
    return {
      action: "start",
      reply_message: getInterviewStepById(currentStepId).prompt,
      current_step_id: currentStepId,
      next_step_id: currentStepId,
      next_session: {
        mode: "interviewing",
        state_token: toInterviewStateToken(currentStepId),
        current_step_id: currentStepId,
        last_inbound_message_sid: input.inbound_message_sid,
        dropout_nudge_sent_at: null,
      },
      profile_patch: buildProfilePatchForInterviewStart({
        profile: input.profile,
        currentStepId,
        nowIso: input.now_iso,
      }),
      profile_event_type: null,
      profile_event_step_id: null,
      profile_event_payload: null,
    };
  }

  if (shouldSendDropoutResume(input.session)) {
    const nextSelection = pickNextQuestion(input.profile);
    const resumeStepId = nextSelection?.questionId ?? currentStepId;

    return {
      action: "resume",
      reply_message: buildDropoutResumeReply(resumeStepId),
      current_step_id: currentStepId,
      next_step_id: resumeStepId,
      next_session: {
        mode: "interviewing",
        state_token: toInterviewStateToken(resumeStepId),
        current_step_id: resumeStepId,
        last_inbound_message_sid: input.inbound_message_sid,
        dropout_nudge_sent_at: null,
      },
      profile_patch: buildProfilePatchForInterviewStart({
        profile: input.profile,
        currentStepId: resumeStepId,
        nowIso: input.now_iso,
      }),
      profile_event_type: null,
      profile_event_step_id: null,
      profile_event_payload: null,
    };
  }

  const currentStep = getInterviewStepById(currentStepId);
  if (currentStep.kind !== "question") {
    return {
      action: "complete",
      reply_message: INTERVIEW_WRAP,
      current_step_id: currentStepId,
      next_step_id: null,
      next_session: {
        mode: "idle",
        state_token: "idle",
        current_step_id: null,
        last_inbound_message_sid: input.inbound_message_sid,
        dropout_nudge_sent_at: null,
      },
      profile_patch: null,
      profile_event_type: null,
      profile_event_step_id: null,
      profile_event_payload: null,
    };
  }

  const deterministicParsed = currentStep.parse(input.inbound_message_text, {
    collectedAnswers: buildCollectedAnswers(input.profile),
  });

  const llmExtraction = await maybeExtractWithLlm({
    input,
    currentStepId,
    currentStepPrompt: currentStep.prompt,
  });

  const extractionOutput = llmExtraction.extractionOutput;
  const extractionSource = extractionOutput ? "llm" : "deterministic";
  const extractionFailureCode = llmExtraction.extractionErrorCode;

  if (!extractionOutput && !deterministicParsed.ok) {
    return {
      action: "retry",
      reply_message: currentStep.retry_prompt,
      current_step_id: currentStepId,
      next_step_id: currentStepId,
      next_session: {
        mode: "interviewing",
        state_token: toInterviewStateToken(currentStepId),
        current_step_id: currentStepId,
        last_inbound_message_sid: input.inbound_message_sid,
        dropout_nudge_sent_at: input.session.dropout_nudge_sent_at,
      },
      profile_patch: null,
      profile_event_type: null,
      profile_event_step_id: null,
      profile_event_payload: null,
    };
  }

  const normalizedAnswer = deterministicParsed.ok
    ? (deterministicParsed.value as InterviewNormalizedAnswer)
    : deriveStoredAnswerFromExtraction(currentStepId, extractionOutput as InterviewExtractOutput);

  if (currentStepId === "intro_01" && (normalizedAnswer as { consent?: string }).consent === "later") {
    return {
      action: "pause",
      reply_message: "No problem. Text me whenever you're ready and I'll pick up right here.",
      current_step_id: currentStepId,
      next_step_id: currentStepId,
      next_session: {
        mode: "interviewing",
        state_token: toInterviewStateToken(currentStepId),
        current_step_id: currentStepId,
        last_inbound_message_sid: input.inbound_message_sid,
        dropout_nudge_sent_at: input.session.dropout_nudge_sent_at,
      },
      profile_patch: buildProfilePatchForInterviewPause({
        profile: input.profile,
        currentStepId,
        nowIso: input.now_iso,
      }),
      profile_event_type: null,
      profile_event_step_id: null,
      profile_event_payload: null,
    };
  }

  let provisionalPatch = buildProfilePatchForInterviewAnswer({
    profile: input.profile,
    stepId: currentStepId,
    answer: normalizedAnswer,
    nextStepId: currentStepId,
    nowIso: input.now_iso,
  });

  if (extractionOutput) {
    provisionalPatch = applyInterviewExtractOutputToProfilePatch({
      profilePatch: provisionalPatch,
      extractionOutput,
      nowIso: input.now_iso,
    });
  }

  const profileAfterAnswer = applyProfilePatch(input.profile, provisionalPatch);
  const nextSelection = selectNextQuestion(
    profileAfterAnswer,
    buildConversationHistory(profileAfterAnswer, input.inbound_message_text),
  );
  const postAnswerCoverage = getSignalCoverageStatus(profileAfterAnswer);
  const nextStepId = postAnswerCoverage.mvpComplete
    ? null
    : (nextSelection?.questionId ?? currentStepId);

  let profilePatch = buildProfilePatchForInterviewAnswer({
    profile: input.profile,
    stepId: currentStepId,
    answer: normalizedAnswer,
    nextStepId,
    nowIso: input.now_iso,
  });

  if (extractionOutput) {
    profilePatch = applyInterviewExtractOutputToProfilePatch({
      profilePatch,
      extractionOutput,
      nowIso: input.now_iso,
    });
  }

  const isComplete = profilePatch.is_complete_mvp;
  const activeNextStepId = nextStepId ?? currentStepId;
  const plannedNextStepId = isComplete ? null : activeNextStepId;

  return {
    action: isComplete ? "complete" : "advance",
    reply_message: isComplete
      ? INTERVIEW_WRAP
      : getInterviewStepById(activeNextStepId).prompt,
    current_step_id: currentStepId,
    next_step_id: plannedNextStepId,
    next_session: {
      mode: isComplete ? "idle" : "interviewing",
      state_token: isComplete ? "idle" : toInterviewStateToken(activeNextStepId),
      current_step_id: plannedNextStepId,
      last_inbound_message_sid: input.inbound_message_sid,
      dropout_nudge_sent_at: isComplete ? null : input.session.dropout_nudge_sent_at,
    },
    profile_patch: profilePatch,
    profile_event_type: isComplete ? "interview_completed" : "interview_step_saved",
    profile_event_step_id: currentStepId,
    profile_event_payload: {
      step_id: currentStepId,
      answer: normalizedAnswer,
      next_step_id: plannedNextStepId,
      next_signal_target: nextSelection?.signalTarget ?? null,
      extraction_source: extractionSource,
      extraction_fallback_reason: extractionFailureCode,
      skipped_inferable_targets: nextSelection?.metadata?.skippedInferableTargets ?? [],
      profile_state: profilePatch.state,
      is_complete_mvp: profilePatch.is_complete_mvp,
      completeness_percent: profilePatch.completeness_percent,
    },
  };
}
