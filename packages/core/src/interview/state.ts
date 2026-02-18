import {
  buildProfilePatchForInterviewAnswer,
  buildProfilePatchForInterviewPause,
  buildProfilePatchForInterviewStart,
  readInterviewProgress,
  type ProfileRowForInterview,
  type ProfileUpdatePatch,
} from "../profile/profile-writer.ts";
import {
  ACTIVE_INTERVIEW_QUESTION_STEP_IDS,
  INTERVIEW_WRAP_MESSAGE,
  getInterviewStepById,
  isInterviewQuestionStepId,
  isInterviewStepId,
  type InterviewNormalizedAnswer,
  type InterviewQuestionStepId,
} from "./steps.ts";
import {
  getSignalCoverageStatus,
  selectNextQuestion,
  type NextQuestionSelection,
} from "./signal-coverage.ts";

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
};

export type InterviewTransitionAction =
  | "idempotent"
  | "start"
  | "retry"
  | "advance"
  | "pause"
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
      return INTERVIEW_ACTIVE_START_STEP_ID;
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

export function buildInterviewTransitionPlan(
  input: BuildInterviewTransitionInput,
): InterviewTransitionPlan {
  const coverageStatus = getSignalCoverageStatus(input.profile);
  if (coverageStatus.mvpComplete || input.profile.state === "complete_full") {
    return {
      action: "idempotent",
      reply_message: ALREADY_COMPLETE_PROFILE_MESSAGE,
      current_step_id: null,
      next_step_id: null,
      next_session: {
        mode: "idle",
        state_token: "idle",
        current_step_id: null,
        last_inbound_message_sid: input.inbound_message_sid,
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

  const currentStep = getInterviewStepById(currentStepId);
  if (currentStep.kind !== "question") {
    return {
      action: "complete",
      reply_message: INTERVIEW_WRAP_MESSAGE,
      current_step_id: currentStepId,
      next_step_id: null,
      next_session: {
        mode: "idle",
        state_token: "idle",
        current_step_id: null,
        last_inbound_message_sid: input.inbound_message_sid,
      },
      profile_patch: null,
      profile_event_type: null,
      profile_event_step_id: null,
      profile_event_payload: null,
    };
  }

  const parsed = currentStep.parse(input.inbound_message_text, {
    collectedAnswers: buildCollectedAnswers(input.profile),
  });

  if (!parsed.ok) {
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
      },
      profile_patch: null,
      profile_event_type: null,
      profile_event_step_id: null,
      profile_event_payload: null,
    };
  }

  const normalizedAnswer = parsed.value as InterviewNormalizedAnswer;

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

  const provisionalPatch = buildProfilePatchForInterviewAnswer({
    profile: input.profile,
    stepId: currentStepId,
    answer: normalizedAnswer,
    nextStepId: currentStepId,
    nowIso: input.now_iso,
  });

  const profileAfterAnswer = applyProfilePatch(input.profile, provisionalPatch);
  const nextSelection = selectNextQuestion(
    profileAfterAnswer,
    buildConversationHistory(profileAfterAnswer, input.inbound_message_text),
  );
  const postAnswerCoverage = getSignalCoverageStatus(profileAfterAnswer);
  const nextStepId = postAnswerCoverage.mvpComplete
    ? null
    : (nextSelection?.questionId ?? currentStepId);

  const profilePatch = buildProfilePatchForInterviewAnswer({
    profile: input.profile,
    stepId: currentStepId,
    answer: normalizedAnswer,
    nextStepId,
    nowIso: input.now_iso,
  });

  const isComplete = profilePatch.is_complete_mvp;
  const activeNextStepId = nextStepId ?? currentStepId;
  const plannedNextStepId = isComplete ? null : activeNextStepId;

  return {
    action: isComplete ? "complete" : "advance",
    reply_message: isComplete
      ? INTERVIEW_WRAP_MESSAGE
      : getInterviewStepById(activeNextStepId).prompt,
    current_step_id: currentStepId,
    next_step_id: plannedNextStepId,
    next_session: {
      mode: isComplete ? "idle" : "interviewing",
      state_token: isComplete ? "idle" : toInterviewStateToken(activeNextStepId),
      current_step_id: plannedNextStepId,
      last_inbound_message_sid: input.inbound_message_sid,
    },
    profile_patch: profilePatch,
    profile_event_type: isComplete ? "interview_completed" : "interview_step_saved",
    profile_event_step_id: currentStepId,
    profile_event_payload: {
      step_id: currentStepId,
      answer: normalizedAnswer,
      next_step_id: plannedNextStepId,
      next_signal_target: nextSelection?.signalTarget ?? null,
      skipped_inferable_targets: nextSelection?.metadata?.skippedInferableTargets ?? [],
      profile_state: profilePatch.state,
      is_complete_mvp: profilePatch.is_complete_mvp,
      completeness_percent: profilePatch.completeness_percent,
    },
  };
}
