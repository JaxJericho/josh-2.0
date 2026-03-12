import {
  ACTIVE_INTERVIEW_QUESTION_STEP_IDS,
  getInterviewStepById,
} from "../../../core/src/interview/steps.ts";
import { selectNextQuestion } from "../../../core/src/interview/signal-coverage.ts";
import { buildInvitedAbbreviatedWrapMessage } from "../../../core/src/invitations/abbreviated-welcome-messages.ts";
import { extractCoordinationSignals } from "../../../llm/src/holistic-extractor.ts";
import type {
  CoordinationDimensionKey,
  CoordinationDimensions,
  HolisticExtractInput,
  HolisticExtractOutput,
} from "../../../db/src/types/index.ts";

const INVITED_INTERVIEW_MODE = "interviewing_abbreviated" as const;
const INVITED_IDLE_MODE = "idle" as const;
const INVITED_AWAITING_INPUT_TOKEN = "interview_abbreviated:awaiting_next_input" as const;
const INVITED_DIMENSION_CONFIDENCE_THRESHOLD = 0.55;
const INVITED_SIGNAL_CONFIDENCE_THRESHOLD = 0.6;

const COORDINATION_DIMENSION_KEYS: readonly CoordinationDimensionKey[] = [
  "social_energy",
  "social_pace",
  "conversation_depth",
  "adventure_orientation",
  "group_dynamic",
  "values_proximity",
];

const COORDINATION_SIGNAL_KEYS = [
  "scheduling_availability",
  "notice_preference",
  "coordination_style",
] as const;

type CoordinationSignalKey = (typeof COORDINATION_SIGNAL_KEYS)[number];

type DimensionNode = {
  value: number;
  confidence: number;
  source: string;
};

type SignalConfidenceMap = Record<CoordinationSignalKey, number>;

type SignalValues = {
  scheduling_availability: unknown;
  notice_preference: string | null;
  coordination_style: string | null;
};

export type AbbreviatedInterviewSession = {
  id: string;
  mode: string;
  state_token: string;
  current_step_id: string | null;
  last_inbound_message_sid: string | null;
};

export type AbbreviatedInterviewProfile = {
  id: string;
  user_id: string;
  state: string;
  is_complete_mvp: boolean;
  country_code: string | null;
  state_code: string | null;
  last_interview_step: string | null;
  preferences: unknown;
  activity_patterns: unknown;
  boundaries: unknown;
  active_intent: unknown;
  coordination_dimensions: unknown;
  scheduling_availability: unknown;
  notice_preference: string | null;
  coordination_style: string | null;
  completeness_percent: number;
  completed_at: string | null;
  status_reason: string | null;
  state_changed_at: string;
};

export type AbbreviatedInterviewProfilePatch = {
  state: string;
  is_complete_mvp: boolean;
  country_code: string | null;
  state_code: string | null;
  last_interview_step: string | null;
  preferences: Record<string, unknown>;
  activity_patterns: Array<Record<string, unknown>>;
  boundaries: Record<string, unknown>;
  active_intent: Record<string, unknown> | null;
  coordination_dimensions: Record<string, unknown>;
  scheduling_availability: unknown;
  notice_preference: string | null;
  coordination_style: string | null;
  completeness_percent: number;
  completed_at: string | null;
  status_reason: string | null;
  state_changed_at: string;
};

export type AbbreviatedInterviewSessionPatch = {
  mode: typeof INVITED_INTERVIEW_MODE | typeof INVITED_IDLE_MODE;
  state_token: string;
  current_step_id: string | null;
  last_inbound_message_sid: string;
};

export type HandleInterviewAnswerAbbreviatedInput = {
  message: string;
  inboundMessageSid: string;
  inviterName: string;
  nowIso: string;
  session: AbbreviatedInterviewSession;
  profile: AbbreviatedInterviewProfile;
};

export type HandleInterviewAnswerAbbreviatedResult = {
  replayed: boolean;
  completed: boolean;
  completedNow: boolean;
  replyMessage: string | null;
  profilePatch: AbbreviatedInterviewProfilePatch | null;
  sessionPatch: AbbreviatedInterviewSessionPatch | null;
  updatedDimensionKeys: CoordinationDimensionKey[];
  updatedSignalKeys: CoordinationSignalKey[];
  completionSnapshot: {
    dimensionsAboveThreshold: number;
    signalsAboveThreshold: number;
  };
};

export type HandleInterviewAnswerAbbreviatedDependencies = {
  extractSignals: (input: HolisticExtractInput) => Promise<HolisticExtractOutput>;
};

type HandleInterviewAnswerAbbreviatedDependencyOverrides =
  Partial<HandleInterviewAnswerAbbreviatedDependencies>;

export async function handleInterviewAnswerAbbreviated(
  input: HandleInterviewAnswerAbbreviatedInput,
  overrides?: HandleInterviewAnswerAbbreviatedDependencyOverrides,
): Promise<HandleInterviewAnswerAbbreviatedResult> {
  const dependencies = resolveDependencies(overrides);
  const preferences = asObject(input.profile.preferences);
  const existingDimensions = readCoordinationDimensions(input.profile.coordination_dimensions);
  const existingSignalConfidences = readSignalConfidences(preferences);
  const baselineSignalValues: SignalValues = {
    scheduling_availability: input.profile.scheduling_availability,
    notice_preference: input.profile.notice_preference,
    coordination_style: input.profile.coordination_style,
  };

  const existingSnapshot = evaluateCompletionSnapshot({
    dimensions: existingDimensions,
    signalValues: baselineSignalValues,
    signalConfidences: existingSignalConfidences,
  });

  const alreadyComplete =
    input.profile.state === "complete_invited" ||
    (existingSnapshot.dimensionsAboveThreshold >= 3 &&
      existingSnapshot.signalsAboveThreshold >= 1);

  if (input.session.last_inbound_message_sid === input.inboundMessageSid) {
    return {
      replayed: true,
      completed: alreadyComplete,
      completedNow: false,
      replyMessage: null,
      profilePatch: null,
      sessionPatch: null,
      updatedDimensionKeys: [],
      updatedSignalKeys: [],
      completionSnapshot: existingSnapshot,
    };
  }

  const extractionOutput = await dependencies.extractSignals({
    conversationHistory: buildConversationHistory(preferences, input.message)
      .map((text) => ({ role: "user" as const, text })),
    currentProfile: toExtractorDimensions(existingDimensions),
    sessionId: input.session.id,
  });

  const mergedDimensionsResult = mergeCoordinationDimensions({
    existing: existingDimensions,
    updates: extractionOutput.coordinationDimensionUpdates,
  });

  const mergedSignalsResult = mergeCoordinationSignals({
    existingValues: baselineSignalValues,
    existingConfidences: existingSignalConfidences,
    extractionOutput,
  });

  const completionSnapshot = evaluateCompletionSnapshot({
    dimensions: mergedDimensionsResult.dimensions,
    signalValues: mergedSignalsResult.values,
    signalConfidences: mergedSignalsResult.confidences,
  });

  const completed = completionSnapshot.dimensionsAboveThreshold >= 3 &&
    completionSnapshot.signalsAboveThreshold >= 1;
  const completedNow = completed && !alreadyComplete;

  const mergedPreferences = {
    ...preferences,
    coordination_signal_confidence: mergedSignalsResult.confidences,
  };

  const mergedCoordinationDimensions = mirrorDimensionsIntoCoordinationDimensions({
    existingCoordinationDimensions: input.profile.coordination_dimensions,
    dimensions: mergedDimensionsResult.dimensions,
  });

  const profileForQuestionSelection = {
    country_code: input.profile.country_code,
    last_interview_step: input.profile.last_interview_step,
    coordination_dimensions: mergedCoordinationDimensions,
    activity_patterns: input.profile.activity_patterns,
    boundaries: input.profile.boundaries,
    preferences: mergedPreferences,
    active_intent: input.profile.active_intent,
  };

  const history = buildConversationHistory(mergedPreferences, input.message);
  const nextQuestionSelection = completed
    ? null
    : selectNextQuestion(profileForQuestionSelection, history);
  const nextQuestionId = nextQuestionSelection?.questionId ??
    ACTIVE_INTERVIEW_QUESTION_STEP_IDS[0] ??
    "activity_01";

  const nextState = completed ? "complete_invited" : "partial";
  const completenessPercent = computeInvitedCompletenessPercent(completionSnapshot);

  const profilePatch: AbbreviatedInterviewProfilePatch = {
    state: nextState,
    is_complete_mvp: false,
    country_code: input.profile.country_code,
    state_code: input.profile.state_code,
    last_interview_step: completed ? input.profile.last_interview_step : nextQuestionId,
    preferences: mergedPreferences,
    coordination_dimensions: mergedCoordinationDimensions,
    activity_patterns: asObjectArray(input.profile.activity_patterns),
    boundaries: asObject(input.profile.boundaries),
    active_intent: toNullableObject(input.profile.active_intent),
    scheduling_availability: mergedSignalsResult.values.scheduling_availability,
    notice_preference: mergedSignalsResult.values.notice_preference,
    coordination_style: mergedSignalsResult.values.coordination_style,
    completeness_percent: completed ? 100 : Math.max(completenessPercent, input.profile.completeness_percent),
    completed_at: completed ? (input.profile.completed_at ?? input.nowIso) : input.profile.completed_at,
    status_reason: completed ? "interview_complete_invited" : "interview_abbreviated_in_progress",
    state_changed_at: nextState !== input.profile.state
      ? input.nowIso
      : input.profile.state_changed_at,
  };

  const sessionPatch: AbbreviatedInterviewSessionPatch = {
    mode: completed ? INVITED_IDLE_MODE : INVITED_INTERVIEW_MODE,
    state_token: completed ? "idle" : INVITED_AWAITING_INPUT_TOKEN,
    current_step_id: completed ? null : nextQuestionId,
    last_inbound_message_sid: input.inboundMessageSid,
  };

  return {
    replayed: false,
    completed,
    completedNow,
    replyMessage: completedNow
      ? buildInvitedAbbreviatedWrapMessage(input.inviterName)
      : completed
      ? null
      : getInterviewStepById(nextQuestionId).prompt,
    profilePatch,
    sessionPatch,
    updatedDimensionKeys: mergedDimensionsResult.updatedKeys,
    updatedSignalKeys: mergedSignalsResult.updatedKeys,
    completionSnapshot,
  };
}

function resolveDependencies(
  overrides?: HandleInterviewAnswerAbbreviatedDependencyOverrides,
): HandleInterviewAnswerAbbreviatedDependencies {
  return {
    extractSignals: overrides?.extractSignals ?? extractCoordinationSignals,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function toNullableObject(value: unknown): Record<string, unknown> | null {
  if (value == null) {
    return null;
  }
  return asObject(value);
}

function asObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry) => entry && typeof entry === "object") as Array<Record<string, unknown>>;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toUnitInterval(value: number): number {
  return Math.min(1, Math.max(0, value));
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

function buildConversationHistory(preferences: Record<string, unknown>, latestMessage: string): string[] {
  const progress = asObject(preferences.interview_progress);
  const answers = asObject(progress.answers);
  const historyFromAnswers = Object.values(answers).flatMap((answer) => collectHistoryFragments(answer));

  const latest = latestMessage.trim();
  if (!latest) {
    return historyFromAnswers;
  }

  return [...historyFromAnswers, latest];
}

function readDimensionNode(value: unknown): DimensionNode | null {
  const node = asObject(value);
  const maybeValue = asNumber(node.value);
  const maybeConfidence = asNumber(node.confidence);

  if (maybeValue == null || maybeConfidence == null) {
    return null;
  }

  return {
    value: toUnitInterval(maybeValue),
    confidence: toUnitInterval(maybeConfidence),
    source: typeof node.source === "string" && node.source.trim().length > 0
      ? node.source
      : "interview_llm",
  };
}

function readCoordinationDimensions(raw: unknown): Record<CoordinationDimensionKey, DimensionNode> {
  const parsed = asObject(raw);
  const dimensions = {} as Record<CoordinationDimensionKey, DimensionNode>;

  for (const key of COORDINATION_DIMENSION_KEYS) {
    const node = readDimensionNode(parsed[key]);
    if (!node) {
      continue;
    }
    dimensions[key] = node;
  }

  return dimensions;
}

function toExtractorDimensions(
  dimensions: Record<CoordinationDimensionKey, DimensionNode>,
): Partial<CoordinationDimensions> {
  const output: Partial<CoordinationDimensions> = {};

  for (const key of COORDINATION_DIMENSION_KEYS) {
    const node = dimensions[key];
    if (!node) {
      continue;
    }

    output[key] = {
      value: node.value,
      confidence: node.confidence,
    };
  }

  return output;
}

function mergeCoordinationDimensions(params: {
  existing: Record<CoordinationDimensionKey, DimensionNode>;
  updates: HolisticExtractOutput["coordinationDimensionUpdates"];
}): {
  dimensions: Record<CoordinationDimensionKey, DimensionNode>;
  updatedKeys: CoordinationDimensionKey[];
} {
  const next = { ...params.existing };
  const updatedKeys: CoordinationDimensionKey[] = [];

  for (const key of COORDINATION_DIMENSION_KEYS) {
    const existing = params.existing[key];
    const incoming = params.updates[key];

    if (!incoming) {
      continue;
    }

    const incomingValue = toUnitInterval(incoming.value);
    const incomingConfidence = toUnitInterval(incoming.confidence);

    const nextNode: DimensionNode = {
      value: incomingValue,
      confidence: Math.max(existing?.confidence ?? 0, incomingConfidence),
      source: existing?.source ?? "interview_llm",
    };

    next[key] = nextNode;

    if (
      !existing ||
      existing.value !== nextNode.value ||
      existing.confidence !== nextNode.confidence
    ) {
      updatedKeys.push(key);
    }
  }

  return {
    dimensions: next,
    updatedKeys,
  };
}

function readSignalConfidences(preferences: Record<string, unknown>): SignalConfidenceMap {
  const raw = asObject(preferences.coordination_signal_confidence);
  return {
    scheduling_availability: toUnitInterval(asNumber(raw.scheduling_availability) ?? 0),
    notice_preference: toUnitInterval(asNumber(raw.notice_preference) ?? 0),
    coordination_style: toUnitInterval(asNumber(raw.coordination_style) ?? 0),
  };
}

function mergeCoordinationSignals(params: {
  existingValues: SignalValues;
  existingConfidences: SignalConfidenceMap;
  extractionOutput: HolisticExtractOutput;
}): {
  values: SignalValues;
  confidences: SignalConfidenceMap;
  updatedKeys: CoordinationSignalKey[];
} {
  const nextValues: SignalValues = {
    ...params.existingValues,
  };

  const nextConfidences: SignalConfidenceMap = {
    ...params.existingConfidences,
  };

  const updatedKeys: CoordinationSignalKey[] = [];

  for (const key of COORDINATION_SIGNAL_KEYS) {
    const existingConfidence = params.existingConfidences[key];
    const existingValue = params.existingValues[key];
    const signalCoverage = params.extractionOutput.coverageSummary.signals[key];
    const incomingConfidence = signalCoverage
      ? toUnitInterval(signalCoverage.confidence)
      : existingConfidence;

    const hasIncomingValue = Object.prototype.hasOwnProperty.call(
      params.extractionOutput.coordinationSignalUpdates,
      key,
    );
    const incomingValue = params.extractionOutput.coordinationSignalUpdates[key];

    const nextConfidence = Math.max(existingConfidence, incomingConfidence);
    nextConfidences[key] = nextConfidence;

    let nextValue = existingValue;
    if (hasIncomingValue && incomingValue != null) {
      const normalizedIncomingValue = normalizeIncomingSignalValue(key, incomingValue);
      if (incomingConfidence >= existingConfidence || existingValue == null) {
        if (normalizedIncomingValue != null) {
          nextValue = normalizedIncomingValue;
        }
      }
    }

    if (key === "scheduling_availability") {
      nextValues.scheduling_availability = nextValue;
    } else if (key === "notice_preference") {
      nextValues.notice_preference = typeof nextValue === "string"
        ? nextValue
        : params.existingValues.notice_preference;
    } else {
      nextValues.coordination_style = typeof nextValue === "string"
        ? nextValue
        : params.existingValues.coordination_style;
    }

    if (nextConfidence !== existingConfidence || nextValue !== existingValue) {
      updatedKeys.push(key);
    }
  }

  return {
    values: nextValues,
    confidences: nextConfidences,
    updatedKeys,
  };
}

function normalizeIncomingSignalValue(
  key: CoordinationSignalKey,
  value: unknown,
): unknown {
  if (key === "scheduling_availability") {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  return null;
}

function hasSignalValue(key: CoordinationSignalKey, values: SignalValues): boolean {
  const value = values[key];

  if (value == null) {
    return false;
  }

  if (key === "scheduling_availability") {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (typeof value === "object") {
      return Object.keys(asObject(value)).length > 0;
    }
    return true;
  }

  return typeof value === "string" && value.trim().length > 0;
}

function evaluateCompletionSnapshot(input: {
  dimensions: Record<CoordinationDimensionKey, DimensionNode>;
  signalValues: SignalValues;
  signalConfidences: SignalConfidenceMap;
}): {
  dimensionsAboveThreshold: number;
  signalsAboveThreshold: number;
} {
  let dimensionsAboveThreshold = 0;
  for (const key of COORDINATION_DIMENSION_KEYS) {
    const confidence = input.dimensions[key]?.confidence ?? 0;
    if (confidence >= INVITED_DIMENSION_CONFIDENCE_THRESHOLD) {
      dimensionsAboveThreshold += 1;
    }
  }

  let signalsAboveThreshold = 0;
  for (const key of COORDINATION_SIGNAL_KEYS) {
    const confidence = input.signalConfidences[key];
    if (confidence >= INVITED_SIGNAL_CONFIDENCE_THRESHOLD && hasSignalValue(key, input.signalValues)) {
      signalsAboveThreshold += 1;
    }
  }

  return {
    dimensionsAboveThreshold,
    signalsAboveThreshold,
  };
}

function mirrorDimensionsIntoCoordinationDimensions(params: {
  existingCoordinationDimensions: unknown;
  dimensions: Record<CoordinationDimensionKey, DimensionNode>;
}): Record<string, unknown> {
  const nextCoordinationDimensions = asObject(params.existingCoordinationDimensions);

  for (const key of COORDINATION_DIMENSION_KEYS) {
    const node = params.dimensions[key];
    if (!node) {
      continue;
    }

    nextCoordinationDimensions[key] = {
      value: node.value,
      confidence: node.confidence,
      source: "interview_abbreviated_llm",
    };
  }

  return nextCoordinationDimensions;
}

function computeInvitedCompletenessPercent(snapshot: {
  dimensionsAboveThreshold: number;
  signalsAboveThreshold: number;
}): number {
  const dimensionProgress = Math.min(1, snapshot.dimensionsAboveThreshold / 3);
  const signalProgress = Math.min(1, snapshot.signalsAboveThreshold / 1);
  return Math.round(((dimensionProgress + signalProgress) / 2) * 100);
}
