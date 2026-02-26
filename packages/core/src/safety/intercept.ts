import {
  detectSafetyContent,
  type SafetyDetectionResult,
} from "./keyword-detector.ts";
import {
  evaluateStrikeEscalation,
  resolveStrikeIncrement,
  type StrikeEscalationState,
} from "./strike-escalator.ts";
import type { SafetySeverity } from "./keyword-catalog.ts";

export type SafetyInterceptConfig = {
  rate_limit_max_messages: number;
  rate_limit_window_seconds: number;
  strike_escalation_threshold: number;
};

export type SafetyInterceptAction =
  | "none"
  | "replay"
  | "safety_hold"
  | "rate_limit"
  | "keyword"
  | "crisis";

export type SafetyInterceptDecision = {
  intercepted: boolean;
  action: SafetyInterceptAction;
  response_message: string | null;
  severity: SafetySeverity | null;
  keyword_version: string | null;
  matched_term: string | null;
  strike_count: number | null;
  safety_hold: boolean;
  replay: boolean;
};

export type UserSafetyState = {
  strike_count: number;
  safety_hold: boolean;
};

export type AppliedRateLimit = {
  exceeded: boolean;
  rate_limit_window_start: string;
  rate_limit_count: number;
};

export type AppliedStrikes = {
  strike_count: number;
  safety_hold: boolean;
  escalated: boolean;
};

export type SetSafetyHoldResult = {
  strike_count: number;
  safety_hold: boolean;
};

export type SafetyEventInput = {
  user_id: string | null;
  inbound_message_id: string | null;
  inbound_message_sid: string;
  severity: SafetySeverity | null;
  keyword_version: string | null;
  matched_term: string | null;
  action_taken: string;
  metadata?: Record<string, unknown>;
};

export type SafetyInterceptRepository = {
  acquireMessageLock: (params: {
    user_id: string | null;
    inbound_message_id: string | null;
    inbound_message_sid: string;
  }) => Promise<boolean>;
  getUserSafetyState: (userId: string) => Promise<UserSafetyState | null>;
  applyRateLimit: (params: {
    user_id: string;
    window_seconds: number;
    max_messages: number;
    now_iso: string;
  }) => Promise<AppliedRateLimit>;
  applyStrikes: (params: {
    user_id: string;
    increment: number;
    escalation_threshold: number;
    now_iso: string;
  }) => Promise<AppliedStrikes>;
  setSafetyHold: (params: {
    user_id: string;
    now_iso: string;
  }) => Promise<SetSafetyHoldResult>;
  appendSafetyEvent: (event: SafetyEventInput) => Promise<void>;
};

const DEFAULT_CONFIG: SafetyInterceptConfig = {
  rate_limit_max_messages: 10,
  rate_limit_window_seconds: 60,
  strike_escalation_threshold: 3,
};

const RATE_LIMIT_RESPONSE =
  "You're sending messages faster than I can keep up. Try again in a minute.";
const LOW_SEVERITY_RESPONSE =
  "Let's keep things respectful. Reply HELP if you need support.";
const MEDIUM_SEVERITY_RESPONSE =
  "I can't continue with that message. Reply HELP if you need support.";
const HIGH_SEVERITY_RESPONSE =
  "I can't help with harmful content. Reply HELP if you need support.";
const SAFETY_HOLD_RESPONSE =
  "Your account is temporarily paused for safety review. Reply HELP for support.";

export async function runSafetyIntercept(params: {
  repository: SafetyInterceptRepository;
  inbound_message_id: string | null;
  inbound_message_sid: string;
  user_id: string | null;
  from_e164: string;
  body_raw: string;
  now_iso?: string;
  config?: Partial<SafetyInterceptConfig>;
}): Promise<SafetyInterceptDecision> {
  const config = resolveConfig(params.config);
  const nowIso = params.now_iso ?? new Date().toISOString();
  const detection = detectSafetyContent(params.body_raw);

  const lockAcquired = await params.repository.acquireMessageLock({
    user_id: params.user_id,
    inbound_message_id: params.inbound_message_id,
    inbound_message_sid: params.inbound_message_sid,
  });

  if (!lockAcquired) {
    return {
      intercepted: true,
      action: "replay",
      response_message: null,
      severity: null,
      keyword_version: detection.keyword_version,
      matched_term: null,
      strike_count: null,
      safety_hold: false,
      replay: true,
    };
  }

  if (!params.user_id) {
    if (detection.matched && detection.severity === "crisis") {
      return {
        intercepted: true,
        action: "crisis",
        response_message: buildCrisisResponse(params.from_e164),
        severity: detection.severity,
        keyword_version: detection.keyword_version,
        matched_term: detection.matched_term,
        strike_count: null,
        safety_hold: false,
        replay: false,
      };
    }

    return {
      intercepted: false,
      action: "none",
      response_message: null,
      severity: null,
      keyword_version: detection.keyword_version,
      matched_term: null,
      strike_count: null,
      safety_hold: false,
      replay: false,
    };
  }

  const currentState = await params.repository.getUserSafetyState(params.user_id);
  if (currentState?.safety_hold) {
    await params.repository.appendSafetyEvent({
      user_id: params.user_id,
      inbound_message_id: params.inbound_message_id,
      inbound_message_sid: params.inbound_message_sid,
      severity: null,
      keyword_version: null,
      matched_term: null,
      action_taken: "safety_hold_enforced",
    });

    return {
      intercepted: true,
      action: "safety_hold",
      response_message: SAFETY_HOLD_RESPONSE,
      severity: null,
      keyword_version: null,
      matched_term: null,
      strike_count: currentState.strike_count,
      safety_hold: true,
      replay: false,
    };
  }

  const rateLimit = await params.repository.applyRateLimit({
    user_id: params.user_id,
    window_seconds: config.rate_limit_window_seconds,
    max_messages: config.rate_limit_max_messages,
    now_iso: nowIso,
  });

  if (rateLimit.exceeded) {
    await params.repository.appendSafetyEvent({
      user_id: params.user_id,
      inbound_message_id: params.inbound_message_id,
      inbound_message_sid: params.inbound_message_sid,
      severity: null,
      keyword_version: null,
      matched_term: null,
      action_taken: "rate_limit_exceeded",
      metadata: {
        window_start: rateLimit.rate_limit_window_start,
        window_count: rateLimit.rate_limit_count,
        threshold: config.rate_limit_max_messages,
      },
    });

    return {
      intercepted: true,
      action: "rate_limit",
      response_message: RATE_LIMIT_RESPONSE,
      severity: null,
      keyword_version: null,
      matched_term: null,
      strike_count: currentState?.strike_count ?? 0,
      safety_hold: false,
      replay: false,
    };
  }

  if (!detection.matched || !detection.severity) {
    return {
      intercepted: false,
      action: "none",
      response_message: null,
      severity: null,
      keyword_version: detection.keyword_version,
      matched_term: null,
      strike_count: currentState?.strike_count ?? 0,
      safety_hold: false,
      replay: false,
    };
  }

  if (detection.severity === "crisis") {
    const holdUpdate = await params.repository.setSafetyHold({
      user_id: params.user_id,
      now_iso: nowIso,
    });

    await params.repository.appendSafetyEvent({
      user_id: params.user_id,
      inbound_message_id: params.inbound_message_id,
      inbound_message_sid: params.inbound_message_sid,
      severity: detection.severity,
      keyword_version: detection.keyword_version,
      matched_term: detection.matched_term,
      action_taken: "crisis_route",
    });

    return {
      intercepted: true,
      action: "crisis",
      response_message: buildCrisisResponse(params.from_e164),
      severity: detection.severity,
      keyword_version: detection.keyword_version,
      matched_term: detection.matched_term,
      strike_count: holdUpdate.strike_count,
      safety_hold: holdUpdate.safety_hold,
      replay: false,
    };
  }

  const initialStrikeState: StrikeEscalationState = {
    strike_count: currentState?.strike_count ?? 0,
    safety_hold: currentState?.safety_hold ?? false,
  };

  const strikeEvaluation = evaluateStrikeEscalation({
    state: initialStrikeState,
    severity: detection.severity,
    escalation_threshold: config.strike_escalation_threshold,
  });

  const persistedStrikes = strikeEvaluation.strike_increment > 0
    ? await params.repository.applyStrikes({
      user_id: params.user_id,
      increment: strikeEvaluation.strike_increment,
      escalation_threshold: config.strike_escalation_threshold,
      now_iso: nowIso,
    })
    : {
      strike_count: initialStrikeState.strike_count,
      safety_hold: initialStrikeState.safety_hold,
      escalated: false,
    };

  await params.repository.appendSafetyEvent({
    user_id: params.user_id,
    inbound_message_id: params.inbound_message_id,
    inbound_message_sid: params.inbound_message_sid,
    severity: detection.severity,
    keyword_version: detection.keyword_version,
    matched_term: detection.matched_term,
    action_taken: "keyword_intercepted",
    metadata: {
      strike_increment: strikeEvaluation.strike_increment,
    },
  });

  if (persistedStrikes.escalated) {
    await params.repository.appendSafetyEvent({
      user_id: params.user_id,
      inbound_message_id: params.inbound_message_id,
      inbound_message_sid: params.inbound_message_sid,
      severity: detection.severity,
      keyword_version: detection.keyword_version,
      matched_term: detection.matched_term,
      action_taken: "strike_escalation",
      metadata: {
        strike_count: persistedStrikes.strike_count,
        escalation_threshold: config.strike_escalation_threshold,
      },
    });
  }

  return {
    intercepted: true,
    action: "keyword",
    response_message: responseForSeverity(detection.severity),
    severity: detection.severity,
    keyword_version: detection.keyword_version,
    matched_term: detection.matched_term,
    strike_count: persistedStrikes.strike_count,
    safety_hold: persistedStrikes.safety_hold,
    replay: false,
  };
}

export async function executeWithSafetyIntercept<T>(params: {
  intercept_input: Parameters<typeof runSafetyIntercept>[0];
  run_router: () => Promise<T>;
}): Promise<{
  decision: SafetyInterceptDecision;
  router_result: T | null;
}> {
  const decision = await runSafetyIntercept(params.intercept_input);
  if (decision.intercepted) {
    return {
      decision,
      router_result: null,
    };
  }

  const routerResult = await params.run_router();
  return {
    decision,
    router_result: routerResult,
  };
}

function resolveConfig(
  config: Partial<SafetyInterceptConfig> | undefined,
): SafetyInterceptConfig {
  const merged = {
    ...DEFAULT_CONFIG,
    ...(config ?? {}),
  };

  if (merged.rate_limit_max_messages <= 0) {
    throw new Error("rate_limit_max_messages must be greater than zero.");
  }

  if (merged.rate_limit_window_seconds <= 0) {
    throw new Error("rate_limit_window_seconds must be greater than zero.");
  }

  if (merged.strike_escalation_threshold <= 0) {
    throw new Error("strike_escalation_threshold must be greater than zero.");
  }

  return merged;
}

function responseForSeverity(severity: SafetySeverity): string {
  switch (severity) {
    case "low":
      return LOW_SEVERITY_RESPONSE;
    case "medium":
      return MEDIUM_SEVERITY_RESPONSE;
    case "high":
      return HIGH_SEVERITY_RESPONSE;
    case "crisis":
      return buildCrisisResponse("+10000000000");
    default: {
      const exhaustiveCheck: never = severity;
      throw new Error(`Unsupported severity '${exhaustiveCheck}'.`);
    }
  }
}

function buildCrisisResponse(fromE164: string): string {
  const region = resolveCrisisRegion(fromE164);
  if (region === "UK") {
    return "I'm concerned about you. If you're in immediate danger, call your local emergency number now. You can contact Samaritans by calling 116 123 (free, 24/7 in the UK and ROI).";
  }

  if (region === "AU") {
    return "I'm concerned about you. If you're in immediate danger, call 000 now. You can contact Lifeline at 13 11 14 (24/7 in Australia).";
  }

  return "I'm concerned about you. If you're in crisis, please reach out to the 988 Suicide and Crisis Lifeline by calling or texting 988. They're available 24/7. You can also text HOME to 741741 for the Crisis Text Line.";
}

function resolveCrisisRegion(fromE164: string): "US" | "UK" | "AU" {
  if (fromE164.startsWith("+44")) {
    return "UK";
  }

  if (fromE164.startsWith("+61")) {
    return "AU";
  }

  return "US";
}

export function mapDetectionToStrikeIncrement(
  detection: SafetyDetectionResult,
): number {
  if (!detection.matched || !detection.severity) {
    return 0;
  }

  return resolveStrikeIncrement(detection.severity);
}
