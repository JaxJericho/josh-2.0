import type { ConversationSession } from "../intents/intent-types";
import {
  CHECKIN_ERROR_RECOVERY_MESSAGE,
  SOLO_CHECKIN_BRIDGE_OFFER,
  SOLO_CHECKIN_CLARIFY_ATTENDANCE,
  SOLO_CHECKIN_CLARIFY_DO_AGAIN,
  SOLO_CHECKIN_DO_AGAIN_PROMPT,
  SOLO_CHECKIN_WRAP_ATTENDED,
  SOLO_CHECKIN_WRAP_BRIDGE_ACCEPTED,
  SOLO_CHECKIN_WRAP_BRIDGE_DECLINED,
  SOLO_CHECKIN_WRAP_SKIPPED,
} from "../../../core/src/messages";

export type SoloCheckinStep =
  | "awaiting_attendance"
  | "awaiting_do_again"
  | "awaiting_bridge";

export type SoloSignalType =
  | "solo_activity_attended"
  | "solo_activity_skipped"
  | "solo_do_again_yes"
  | "solo_do_again_no"
  | "solo_bridge_accepted";

type BinaryResponse = "positive" | "negative" | "ambiguous";
type BridgeResponse = "positive" | "non_positive";

export type HandlePostActivityCheckinDependencies = {
  fetchPlanBriefActivityKey: (input: { planBriefId: string }) => Promise<string | null>;
  insertLearningSignal: (input: {
    id: string;
    user_id: string;
    signal_type: SoloSignalType;
    subject_id: string;
    value_bool: boolean;
    meta: { activity_key: string | null };
    occurred_at: string;
    ingested_at: string;
    idempotency_key: string;
  }) => Promise<{ error: { code?: string; message: string } | null }>;
  updateConversationSession: (input: {
    userId: string;
    mode: "post_activity_checkin" | "idle";
    state_token: string;
    updated_at: string;
  }) => Promise<void>;
  sendSms: (input: {
    userId: string;
    body: string;
    correlationId: string;
  }) => Promise<void>;
  log: (input: {
    level: "info" | "warn" | "error";
    event: string;
    payload: Record<string, unknown>;
  }) => void;
  generateUuid: () => string;
  nowIso: () => string;
};

type HandlePostActivityCheckinDependencyOverrides =
  Partial<HandlePostActivityCheckinDependencies>;

const STEP_SET: ReadonlySet<SoloCheckinStep> = new Set([
  "awaiting_attendance",
  "awaiting_do_again",
  "awaiting_bridge",
] as const);

const ATTENDANCE_POSITIVE_PATTERN =
  /^(yes|yeah|yep|yup|went|i went|i did|attended|totally|definitely|sure|great|good|loved|liked|it was great|it was good)\b/;
const ATTENDANCE_NEGATIVE_PATTERN =
  /^(no|nope|didn't|did not|skipped|couldn't|could not|couldn't make|nah|not really|missed)\b/;
const DO_AGAIN_POSITIVE_PATTERN =
  /^(yes|yeah|yep|yup|definitely|for sure|sure|absolutely|totally|would|i would)\b/;
const DO_AGAIN_NEGATIVE_PATTERN =
  /^(no|nope|nah|not really|was fine once|once was enough|not my thing|pass)\b/;
const BRIDGE_POSITIVE_PATTERN =
  /^(yes|yeah|yep|yup|sure|please|ok|okay|sounds good|do it)\b/;

const IDEMPOTENCY_SEGMENT_BY_SIGNAL: Record<SoloSignalType, string> = {
  solo_activity_attended: "attended",
  solo_activity_skipped: "skipped",
  solo_do_again_yes: "do_again_yes",
  solo_do_again_no: "do_again_no",
  solo_bridge_accepted: "bridge_accepted",
};

export async function handlePostActivityCheckin(
  userId: string,
  message: string,
  session: ConversationSession,
  correlationId: string,
  overrides?: HandlePostActivityCheckinDependencyOverrides,
): Promise<void> {
  const dependencies = resolveDependencies(overrides);
  const stateToken = session.state_token ?? "";
  const planBriefId = extractPlanBriefId(stateToken);
  if (!planBriefId) {
    dependencies.log({
      level: "error",
      event: "handle_post_activity_checkin.missing_plan_brief_id",
      payload: {
        userId,
        correlationId,
        stateToken,
      },
    });
    await dependencies.sendSms({
      userId,
      body: CHECKIN_ERROR_RECOVERY_MESSAGE,
      correlationId,
    });
    await setSessionIdle({
      userId,
      correlationId,
      finalStep: "missing_plan_brief_id",
      dependencies,
    });
    return;
  }

  const step = extractStep(stateToken);
  dependencies.log({
    level: "info",
    event: "handle_post_activity_checkin.start",
    payload: {
      userId,
      correlationId,
      step: step ?? "unknown",
      planBriefId,
    },
  });

  const activityKey = await dependencies.fetchPlanBriefActivityKey({
    planBriefId,
  });
  if (activityKey === null) {
    dependencies.log({
      level: "warn",
      event: "handle_post_activity_checkin.plan_brief_not_found",
      payload: {
        userId,
        correlationId,
        planBriefId,
      },
    });
  }

  switch (step) {
    case "awaiting_attendance":
      await handleAttendanceStep({
        userId,
        message,
        planBriefId,
        activityKey,
        correlationId,
        dependencies,
      });
      return;
    case "awaiting_do_again":
      await handleDoAgainStep({
        userId,
        message,
        planBriefId,
        activityKey,
        correlationId,
        dependencies,
      });
      return;
    case "awaiting_bridge":
      await handleBridgeStep({
        userId,
        message,
        planBriefId,
        activityKey,
        correlationId,
        dependencies,
      });
      return;
    default:
      dependencies.log({
        level: "error",
        event: "handle_post_activity_checkin.unknown_step",
        payload: {
          userId,
          correlationId,
          stateToken,
        },
      });
      await setSessionIdle({
        userId,
        correlationId,
        finalStep: "unknown_step",
        dependencies,
      });
  }
}

async function handleAttendanceStep(input: {
  userId: string;
  message: string;
  planBriefId: string;
  activityKey: string | null;
  correlationId: string;
  dependencies: HandlePostActivityCheckinDependencies;
}): Promise<void> {
  const response = parseAttendanceResponse(input.message);
  if (response === "ambiguous") {
    input.dependencies.log({
      level: "warn",
      event: "handle_post_activity_checkin.ambiguous_parse",
      payload: {
        userId: input.userId,
        correlationId: input.correlationId,
        step: "awaiting_attendance",
        message: "[redacted]",
      },
    });
    await input.dependencies.sendSms({
      userId: input.userId,
      body: SOLO_CHECKIN_CLARIFY_ATTENDANCE,
      correlationId: input.correlationId,
    });
    return;
  }

  if (response === "positive") {
    await writeSoloSignal({
      userId: input.userId,
      signalType: "solo_activity_attended",
      planBriefId: input.planBriefId,
      activityKey: input.activityKey,
      correlationId: input.correlationId,
      dependencies: input.dependencies,
    });
    await input.dependencies.updateConversationSession({
      userId: input.userId,
      mode: "post_activity_checkin",
      state_token: buildStateToken("awaiting_do_again", input.planBriefId),
      updated_at: input.dependencies.nowIso(),
    });
    await input.dependencies.sendSms({
      userId: input.userId,
      body: SOLO_CHECKIN_DO_AGAIN_PROMPT,
      correlationId: input.correlationId,
    });
    return;
  }

  await writeSoloSignal({
    userId: input.userId,
    signalType: "solo_activity_skipped",
    planBriefId: input.planBriefId,
    activityKey: input.activityKey,
    correlationId: input.correlationId,
    dependencies: input.dependencies,
  });
  await setSessionIdle({
    userId: input.userId,
    correlationId: input.correlationId,
    finalStep: "awaiting_attendance",
    dependencies: input.dependencies,
  });
  await input.dependencies.sendSms({
    userId: input.userId,
    body: SOLO_CHECKIN_WRAP_SKIPPED,
    correlationId: input.correlationId,
  });
}

async function handleDoAgainStep(input: {
  userId: string;
  message: string;
  planBriefId: string;
  activityKey: string | null;
  correlationId: string;
  dependencies: HandlePostActivityCheckinDependencies;
}): Promise<void> {
  const response = parseDoAgainResponse(input.message);
  if (response === "ambiguous") {
    input.dependencies.log({
      level: "warn",
      event: "handle_post_activity_checkin.ambiguous_parse",
      payload: {
        userId: input.userId,
        correlationId: input.correlationId,
        step: "awaiting_do_again",
        message: "[redacted]",
      },
    });
    await input.dependencies.sendSms({
      userId: input.userId,
      body: SOLO_CHECKIN_CLARIFY_DO_AGAIN,
      correlationId: input.correlationId,
    });
    return;
  }

  if (response === "positive") {
    await writeSoloSignal({
      userId: input.userId,
      signalType: "solo_do_again_yes",
      planBriefId: input.planBriefId,
      activityKey: input.activityKey,
      correlationId: input.correlationId,
      dependencies: input.dependencies,
    });
    await input.dependencies.updateConversationSession({
      userId: input.userId,
      mode: "post_activity_checkin",
      state_token: buildStateToken("awaiting_bridge", input.planBriefId),
      updated_at: input.dependencies.nowIso(),
    });
    await input.dependencies.sendSms({
      userId: input.userId,
      body: SOLO_CHECKIN_BRIDGE_OFFER,
      correlationId: input.correlationId,
    });
    return;
  }

  await writeSoloSignal({
    userId: input.userId,
    signalType: "solo_do_again_no",
    planBriefId: input.planBriefId,
    activityKey: input.activityKey,
    correlationId: input.correlationId,
    dependencies: input.dependencies,
  });
  await setSessionIdle({
    userId: input.userId,
    correlationId: input.correlationId,
    finalStep: "awaiting_do_again",
    dependencies: input.dependencies,
  });
  await input.dependencies.sendSms({
    userId: input.userId,
    body: SOLO_CHECKIN_WRAP_ATTENDED,
    correlationId: input.correlationId,
  });
}

async function handleBridgeStep(input: {
  userId: string;
  message: string;
  planBriefId: string;
  activityKey: string | null;
  correlationId: string;
  dependencies: HandlePostActivityCheckinDependencies;
}): Promise<void> {
  const response = parseBridgeResponse(input.message);
  if (response === "positive") {
    await writeSoloSignal({
      userId: input.userId,
      signalType: "solo_bridge_accepted",
      planBriefId: input.planBriefId,
      activityKey: input.activityKey,
      correlationId: input.correlationId,
      dependencies: input.dependencies,
    });
    await setSessionIdle({
      userId: input.userId,
      correlationId: input.correlationId,
      finalStep: "awaiting_bridge",
      dependencies: input.dependencies,
    });
    await input.dependencies.sendSms({
      userId: input.userId,
      body: SOLO_CHECKIN_WRAP_BRIDGE_ACCEPTED,
      correlationId: input.correlationId,
    });
    return;
  }

  await setSessionIdle({
    userId: input.userId,
    correlationId: input.correlationId,
    finalStep: "awaiting_bridge",
    dependencies: input.dependencies,
  });
  await input.dependencies.sendSms({
    userId: input.userId,
    body: SOLO_CHECKIN_WRAP_BRIDGE_DECLINED,
    correlationId: input.correlationId,
  });
}

async function setSessionIdle(input: {
  userId: string;
  correlationId: string;
  finalStep: string;
  dependencies: HandlePostActivityCheckinDependencies;
}): Promise<void> {
  await input.dependencies.updateConversationSession({
    userId: input.userId,
    mode: "idle",
    state_token: "idle",
    updated_at: input.dependencies.nowIso(),
  });
  input.dependencies.log({
    level: "info",
    event: "handle_post_activity_checkin.session_idle",
    payload: {
      userId: input.userId,
      correlationId: input.correlationId,
      finalStep: input.finalStep,
    },
  });
}

async function writeSoloSignal(input: {
  userId: string;
  signalType: SoloSignalType;
  planBriefId: string;
  activityKey: string | null;
  correlationId: string;
  dependencies: HandlePostActivityCheckinDependencies;
}): Promise<void> {
  const idempotencySegment = IDEMPOTENCY_SEGMENT_BY_SIGNAL[input.signalType];
  const idempotencyKey =
    `ls:solo_checkin:${idempotencySegment}:${input.planBriefId}:${input.userId}`;
  const timestamp = input.dependencies.nowIso();
  const { error } = await input.dependencies.insertLearningSignal({
    id: input.dependencies.generateUuid(),
    user_id: input.userId,
    signal_type: input.signalType,
    subject_id: input.planBriefId,
    value_bool: true,
    meta: { activity_key: input.activityKey },
    occurred_at: timestamp,
    ingested_at: timestamp,
    idempotency_key: idempotencyKey,
  });

  if (error?.code === "23505") {
    input.dependencies.log({
      level: "warn",
      event: "handle_post_activity_checkin.duplicate_signal",
      payload: {
        userId: input.userId,
        correlationId: input.correlationId,
        signalType: input.signalType,
        idempotencyKey,
      },
    });
    return;
  }

  if (error) {
    throw new Error(`Failed to write learning signal: ${error.message}`);
  }

  input.dependencies.log({
    level: "info",
    event: "handle_post_activity_checkin.signal_written",
    payload: {
      userId: input.userId,
      correlationId: input.correlationId,
      signalType: input.signalType,
    },
  });
}

function buildStateToken(step: SoloCheckinStep, planBriefId: string): string {
  return `checkin:${step}:${planBriefId}`;
}

function resolveDependencies(
  overrides?: HandlePostActivityCheckinDependencyOverrides,
): HandlePostActivityCheckinDependencies {
  return {
    fetchPlanBriefActivityKey: overrides?.fetchPlanBriefActivityKey ??
      missingDependencyFn("fetchPlanBriefActivityKey"),
    insertLearningSignal: overrides?.insertLearningSignal ??
      missingDependencyFn("insertLearningSignal"),
    updateConversationSession: overrides?.updateConversationSession ??
      missingDependencyFn("updateConversationSession"),
    sendSms: overrides?.sendSms ?? missingDependencyFn("sendSms"),
    log: overrides?.log ?? (() => {}),
    generateUuid: overrides?.generateUuid ?? (() => crypto.randomUUID()),
    nowIso: overrides?.nowIso ?? (() => new Date().toISOString()),
  };
}

function missingDependencyFn<T extends (...args: any[]) => unknown>(name: string): T {
  return ((..._args: any[]) => {
    throw new Error(`handlePostActivityCheckin dependency '${name}' was not provided.`);
  }) as unknown as T;
}

export function extractPlanBriefId(stateToken: string): string | null {
  const segments = stateToken.trim().split(":");
  if (segments.length < 3 || segments[0] !== "checkin") {
    return null;
  }
  const planBriefId = segments[segments.length - 1]?.trim() ?? "";
  return planBriefId.length > 0 ? planBriefId : null;
}

export function extractStep(stateToken: string): SoloCheckinStep | null {
  const segments = stateToken.trim().split(":");
  if (segments.length < 3 || segments[0] !== "checkin") {
    return null;
  }
  const stepCandidate = segments[1]?.trim() ?? "";
  if (!STEP_SET.has(stepCandidate as SoloCheckinStep)) {
    return null;
  }
  return stepCandidate as SoloCheckinStep;
}

export function parseAttendanceResponse(message: string): BinaryResponse {
  return parseBinaryResponse(message, ATTENDANCE_POSITIVE_PATTERN, ATTENDANCE_NEGATIVE_PATTERN);
}

export function parseDoAgainResponse(message: string): BinaryResponse {
  return parseBinaryResponse(message, DO_AGAIN_POSITIVE_PATTERN, DO_AGAIN_NEGATIVE_PATTERN);
}

export function parseBridgeResponse(message: string): BridgeResponse {
  const normalized = normalizeMessage(message);
  if (BRIDGE_POSITIVE_PATTERN.test(normalized)) {
    return "positive";
  }
  return "non_positive";
}

function parseBinaryResponse(
  message: string,
  positivePattern: RegExp,
  negativePattern: RegExp,
): BinaryResponse {
  const normalized = normalizeMessage(message);
  if (negativePattern.test(normalized)) {
    return "negative";
  }
  if (positivePattern.test(normalized)) {
    return "positive";
  }
  return "ambiguous";
}

function normalizeMessage(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}
