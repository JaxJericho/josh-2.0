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
  extractCoordinationSignals,
  HolisticExtractorError,
} from "../../../llm/src/holistic-extractor.ts";
import type {
  CoordinationDimensionKey,
  CoordinationDimensions,
  HolisticExtractInput,
  HolisticExtractOutput,
} from "../../../db/src/types/index.ts";

export type ConversationMode =
  | "idle"
  | "interviewing"
  | "linkup_forming"
  | "awaiting_invite_reply"
  | "post_event"
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
  llm_extractor?: (input: HolisticExtractInput) => Promise<HolisticExtractOutput>;
  llm_request_guard?: Set<string>;
};

export const ALREADY_COMPLETE_PROFILE_MESSAGE =
  "You're all set. If you want to tweak your profile, text me what to change.";

const INTERVIEW_DEPRECATED_INTRO_STEP_ID: InterviewQuestionStepId = "intro_01";
const INTERVIEW_ACTIVE_START_STEP_ID: InterviewQuestionStepId = "activity_01";

export const ONBOARDING_STATE_TOKENS = [
  "onboarding:awaiting_opening_response",
  "onboarding:awaiting_explanation_response",
  "onboarding:awaiting_burst",
  "onboarding:awaiting_interview_start",
] as const;

export const POST_EVENT_STATE_TOKENS = [
  "post_event:attendance",
  "post_event:reflection",
  "post_event:complete",
  "post_event:contact_exchange",
  "post_event:finalized",
] as const;

export type OnboardingStateToken = (typeof ONBOARDING_STATE_TOKENS)[number];
export type PostEventStateToken = (typeof POST_EVENT_STATE_TOKENS)[number];
export type InterviewOrOnboardingStateToken = InterviewQuestionStepId | OnboardingStateToken;

const ONBOARDING_STATE_TOKEN_SET: ReadonlySet<OnboardingStateToken> = new Set(ONBOARDING_STATE_TOKENS);
const POST_EVENT_STATE_TOKEN_SET: ReadonlySet<PostEventStateToken> = new Set(POST_EVENT_STATE_TOKENS);
const COORDINATION_DIMENSION_KEYS: readonly CoordinationDimensionKey[] = [
  "social_energy",
  "social_pace",
  "conversation_depth",
  "adventure_orientation",
  "group_dynamic",
  "values_proximity",
];

export function toInterviewStateToken(stepId: InterviewQuestionStepId): string {
  return `interview:${stepId}`;
}

export function isOnboardingStateToken(token: string): token is OnboardingStateToken {
  return ONBOARDING_STATE_TOKEN_SET.has(token as OnboardingStateToken);
}

export function isPostEventStateToken(token: string): token is PostEventStateToken {
  return POST_EVENT_STATE_TOKEN_SET.has(token as PostEventStateToken);
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

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toUnitInterval(value: number): number {
  return Math.min(1, Math.max(0, value));
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

function readCurrentCoordinationProfile(
  profile: ProfileRowForInterview,
): Partial<CoordinationDimensions> {
  const dimensionsFromProfile = asObject(
    (profile as Record<string, unknown>).coordination_dimensions,
  );
  const parsed: Partial<CoordinationDimensions> = {};

  for (const key of COORDINATION_DIMENSION_KEYS) {
    const node = asObject(dimensionsFromProfile[key]);
    const value = asNumber(node.value);
    const confidence = asNumber(node.confidence);
    if (value == null || confidence == null) {
      continue;
    }

    parsed[key] = {
      value: toUnitInterval(value),
      confidence: toUnitInterval(confidence),
    };
  }

  return parsed;
}

function mapPaceFromDimension(value: number): "slow" | "medium" | "fast" {
  if (value >= 0.67) {
    return "fast";
  }
  if (value <= 0.33) {
    return "slow";
  }
  return "medium";
}

function mapGroupSizeFromDimension(value: number): "2-3" | "4-6" | "7-10" {
  if (value <= 0.33) {
    return "2-3";
  }
  if (value >= 0.67) {
    return "7-10";
  }
  return "4-6";
}

function deriveStoredAnswerFromExtraction(
  stepId: InterviewQuestionStepId,
  extraction: HolisticExtractOutput,
): InterviewNormalizedAnswer {
  const dimensions = extraction.coordinationDimensionUpdates;
  const adventureOrientation = dimensions.adventure_orientation?.value ?? 0.5;
  const valuesProximity = dimensions.values_proximity?.value ?? 0.5;
  const socialEnergy = dimensions.social_energy?.value ?? 0.5;
  const socialPace = dimensions.social_pace?.value ?? 0.5;
  const groupDynamic = dimensions.group_dynamic?.value ?? 0.5;

  switch (stepId) {
    case "activity_01":
      return { activity_keys: [] };
    case "activity_02":
      return { activity_key: "coffee" };
    case "motive_01":
    case "motive_02":
      return {
        motive_weights: {
          connection: toUnitInterval(valuesProximity),
          adventure: toUnitInterval(adventureOrientation),
          restorative: toUnitInterval(1 - socialEnergy),
          comfort: toUnitInterval(groupDynamic),
        },
      };
    case "style_01":
    case "style_02":
      return { style_keys: [] };
    case "pace_01":
      return { social_pace: mapPaceFromDimension(socialPace) };
    case "group_01":
      return { group_size_pref: mapGroupSizeFromDimension(groupDynamic) };
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

function mergeCoordinationDimensionUpdates(params: {
  existing: Record<string, unknown>;
  updates: HolisticExtractOutput["coordinationDimensionUpdates"];
}): Record<string, unknown> {
  const merged = { ...params.existing };

  for (const [key, update] of Object.entries(params.updates)) {
    if (!update) {
      continue;
    }

    const typedKey = key as CoordinationDimensionKey;
    const existingNode = asObject(merged[typedKey]);
    const existingConfidence = asNumber(existingNode.confidence) ?? 0;
    const nextConfidence = Math.max(existingConfidence, toUnitInterval(update.confidence));

    merged[typedKey] = {
      value: toUnitInterval(update.value),
      confidence: nextConfidence,
      source: "llm_holistic",
    };
  }

  return merged;
}

function applyHolisticExtractOutputToProfilePatch(params: {
  profilePatch: ProfileUpdatePatch;
  extractionOutput: HolisticExtractOutput;
}): ProfileUpdatePatch {
  const patch = { ...params.profilePatch } as ProfileUpdatePatch & Record<string, unknown>;
  const fingerprint = asObject(patch.fingerprint);
  const coordinationDimensions = mergeCoordinationDimensionUpdates({
    existing: asObject(patch.coordination_dimensions),
    updates: params.extractionOutput.coordinationDimensionUpdates,
  });

  const mirroredFingerprint = mergeCoordinationDimensionUpdates({
    existing: fingerprint,
    updates: params.extractionOutput.coordinationDimensionUpdates,
  });

  patch.fingerprint = mirroredFingerprint;
  patch.coordination_dimensions = coordinationDimensions;

  if ("scheduling_availability" in params.extractionOutput.coordinationSignalUpdates) {
    patch.scheduling_availability =
      params.extractionOutput.coordinationSignalUpdates.scheduling_availability ?? null;
  }
  if ("notice_preference" in params.extractionOutput.coordinationSignalUpdates) {
    patch.notice_preference = params.extractionOutput.coordinationSignalUpdates.notice_preference ?? null;
  }
  if ("coordination_style" in params.extractionOutput.coordinationSignalUpdates) {
    patch.coordination_style = params.extractionOutput.coordinationSignalUpdates.coordination_style ?? null;
  }

  return patch;
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
}): Promise<{
  extractionOutput: HolisticExtractOutput | null;
  extractionErrorCode: string | null;
}> {
  if (!canAttemptLlmExtraction(params.input)) {
    return {
      extractionOutput: null,
      extractionErrorCode: "rate_limited",
    };
  }

  const extractor = params.input.llm_extractor ?? extractCoordinationSignals;
  try {
    const conversationHistory = buildConversationHistory(
      params.input.profile,
      params.input.inbound_message_text,
    ).map((text) => ({ role: "user" as const, text }));

    const extractionOutput = await extractor({
      conversationHistory,
      currentProfile: readCurrentCoordinationProfile(params.input.profile),
      sessionId: params.input.profile.id,
    });

    return {
      extractionOutput,
      extractionErrorCode: null,
    };
  } catch (error) {
    if (error instanceof HolisticExtractorError) {
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
    : deriveStoredAnswerFromExtraction(currentStepId, extractionOutput as HolisticExtractOutput);

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
    provisionalPatch = applyHolisticExtractOutputToProfilePatch({
      profilePatch: provisionalPatch,
      extractionOutput,
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
    profilePatch = applyHolisticExtractOutputToProfilePatch({
      profilePatch,
      extractionOutput,
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
