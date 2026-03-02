// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { runDefaultEngine } from "../engines/default-engine.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { runProfileInterviewEngine } from "../engines/profile-interview-engine.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { runOnboardingEngine } from "../engines/onboarding-engine.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { runPostEventEngine } from "../engines/post-event-engine.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { logEvent } from "../../../../packages/core/src/observability/logger.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { classifyIntent } from "../../../../packages/messaging/src/intents/intent-classifier.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import type {
  ConversationSession as IntentClassifierSession,
  IntentClassification,
} from "../../../../packages/messaging/src/intents/intent-types.ts";
import {
  elapsedMetricMs,
  emitMetricBestEffort,
  emitRpcFailureMetric,
  nowMetricMs,
} from "../../../../packages/core/src/observability/metrics.ts";

export type ConversationMode =
  | "idle"
  | "interviewing"
  | "linkup_forming"
  | "awaiting_invite_reply"
  | "post_event"
  | "safety_hold";

export type RouterRoute =
  | "profile_interview_engine"
  | "default_engine"
  | "onboarding_engine"
  | "post_event_engine"
  | "contact_invite_response_handler"
  | "post_activity_checkin_handler"
  | "open_intent_handler"
  | "named_plan_request_handler"
  | "plan_social_choice_handler"
  | "interview_answer_abbreviated_handler"
  | "system_command_handler";

export type ConversationState = {
  mode: ConversationMode;
  state_token: string;
};

export type RoutingDecision = {
  user_id: string;
  state: ConversationState;
  profile_is_complete_mvp: boolean | null;
  route: RouterRoute;
  safety_override_applied: boolean;
  next_transition: string;
};

export type NormalizedInboundMessagePayload = {
  inbound_message_id: string;
  inbound_message_sid: string;
  from_e164: string;
  from_phone_hash?: string | null;
  to_e164: string;
  body_raw: string;
  body_normalized: string;
};

export type EngineDispatchInput = {
  supabase: SupabaseClientLike;
  decision: RoutingDecision;
  payload: NormalizedInboundMessagePayload;
};

export type EngineDispatchResult = {
  engine: RouterRoute;
  reply_message: string | null;
};

type SupabaseClientLike = {
  from: (table: string) => any;
  rpc?: (fn: string, args?: Record<string, unknown>) => Promise<any>;
};

type ConversationSessionRow = {
  id: string;
  mode: string | null;
  state_token: string | null;
  linkup_id: string | null;
};

type ProfileSummary = {
  is_complete_mvp: boolean;
  state: string | null;
};

type ClassifyIntentFn = (
  message: string,
  session: IntentClassifierSession,
) => IntentClassification;

const ONBOARDING_MODE: ConversationMode = "interviewing";
const ONBOARDING_STATE_TOKEN = "onboarding:awaiting_opening_response";
const ONBOARDING_AWAITING_BURST_TOKEN = "onboarding:awaiting_burst";
const ONBOARDING_STATE_TOKENS = [
  "onboarding:awaiting_opening_response",
  "onboarding:awaiting_explanation_response",
  "onboarding:awaiting_burst",
  "onboarding:awaiting_interview_start",
] as const;
const POST_EVENT_STATE_TOKENS = [
  "post_event:attendance",
  "post_event:reflection",
  "post_event:complete",
  "post_event:contact_exchange",
  "post_event:finalized",
] as const;
type OnboardingStateToken = (typeof ONBOARDING_STATE_TOKENS)[number];
type PostEventStateToken = (typeof POST_EVENT_STATE_TOKENS)[number];
type InterviewingStateTokenKind = "onboarding" | "interview";

const ONBOARDING_STATE_TOKEN_SET: ReadonlySet<OnboardingStateToken> = new Set(
  ONBOARDING_STATE_TOKENS,
);
const POST_EVENT_STATE_TOKEN_SET: ReadonlySet<PostEventStateToken> = new Set(
  POST_EVENT_STATE_TOKENS,
);
const INTERVIEW_TOKEN_PATTERN = /^interview:[a-z0-9_]+$/;
const ONBOARDING_TOKEN_PATTERN = /^onboarding:[a-z_]+$/;
const POST_EVENT_TOKEN_PATTERN = /^post_event:[a-z0-9_]+$/;
const STOP_HELP_COMMANDS = new Set([
  "STOP",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "HELP",
  "INFO",
]);
const HASH_ENCODER = new TextEncoder();

const CONVERSATION_MODES: readonly ConversationMode[] = [
  "idle",
  "interviewing",
  "linkup_forming",
  "awaiting_invite_reply",
  "post_event",
  "safety_hold",
];

const VALID_MODES: ReadonlySet<ConversationMode> = new Set(CONVERSATION_MODES);

const STATE_TOKEN_PATTERN_BY_MODE: Record<ConversationMode, RegExp> = {
  idle: /^idle$/,
  interviewing: /^[a-z0-9:_-]+$/i,
  linkup_forming: /^[a-z0-9:_-]+$/i,
  awaiting_invite_reply: /^[a-z0-9:_-]+$/i,
  post_event: POST_EVENT_TOKEN_PATTERN,
  safety_hold: /^[a-z0-9:_-]+$/i,
};

const ROUTE_BY_MODE: Record<ConversationMode, RouterRoute> = {
  idle: "default_engine",
  interviewing: "profile_interview_engine",
  linkup_forming: "default_engine",
  awaiting_invite_reply: "default_engine",
  post_event: "post_event_engine",
  safety_hold: "default_engine",
};

const NEXT_TRANSITION_BY_MODE: Record<ConversationMode, string> = {
  idle: "idle:awaiting_user_input",
  interviewing: "interview:awaiting_next_input",
  linkup_forming: "linkup:awaiting_details",
  awaiting_invite_reply: "invite:awaiting_reply",
  post_event: "post_event:attendance",
  safety_hold: "safety:hold_enforced",
};

const LEGAL_TRANSITIONS_BY_MODE: Record<ConversationMode, ReadonlySet<string>> = {
  idle: new Set(["idle:awaiting_user_input", ONBOARDING_STATE_TOKEN]),
  interviewing: new Set(["interview:awaiting_next_input", ...ONBOARDING_STATE_TOKENS]),
  linkup_forming: new Set(["linkup:awaiting_details"]),
  awaiting_invite_reply: new Set(["invite:awaiting_reply"]),
  post_event: new Set(POST_EVENT_STATE_TOKENS),
  safety_hold: new Set(["safety:hold_enforced"]),
};

export class ConversationRouterError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ConversationRouterError";
    this.code = code;
  }
}

export async function routeConversationMessage(
  params: {
    supabase: SupabaseClientLike;
    payload: NormalizedInboundMessagePayload;
    safetyOverrideApplied?: boolean;
    classifyIntentFn?: ClassifyIntentFn;
  },
): Promise<RoutingDecision> {
  const startedAt = nowMetricMs();
  let outcome: "success" | "error" = "success";
  try {
    const normalizedBody = params.payload.body_normalized.trim().toUpperCase();
    if (isSystemCommand(normalizedBody)) {
      const fallbackState = validateConversationState("idle", "idle");
      return {
        user_id: "",
        state: fallbackState,
        profile_is_complete_mvp: null,
        route: "system_command_handler",
        safety_override_applied: params.safetyOverrideApplied ?? false,
        next_transition: "idle:awaiting_user_input",
      };
    }

    const phoneHash =
      params.payload.from_phone_hash?.trim() ||
      (await sha256Hex(params.payload.from_e164));
    const pendingInvitation = await fetchPendingInvitationByPhoneHash(
      params.supabase,
      phoneHash,
    );
    if (pendingInvitation) {
      const fallbackState = validateConversationState("idle", "idle");
      return {
        user_id: "",
        state: fallbackState,
        profile_is_complete_mvp: null,
        route: "contact_invite_response_handler",
        safety_override_applied: params.safetyOverrideApplied ?? false,
        next_transition: "idle:awaiting_user_input",
      };
    }

    const user = await fetchUserByPhone(params.supabase, params.payload.from_e164);
    if (!user) {
      throw new ConversationRouterError(
        "MISSING_USER_STATE",
        "No user record found for inbound message."
      );
    }

    const session = await fetchOrCreateConversationSession(params.supabase, user.id);
    const transitionEvaluatedSession = await transitionConversationSessionForCompletedLinkup({
      supabase: params.supabase,
      session,
      inboundMessageId: params.payload.inbound_message_id,
    });
    let state = validateConversationState(
      transitionEvaluatedSession.mode,
      transitionEvaluatedSession.state_token,
    );
    const profile = await fetchProfileSummary(params.supabase, user.id);
    const shouldForceInterview = shouldRouteIdleUserToInterview(state, profile);

    if (shouldForceInterview) {
      const promotedSession = await promoteConversationSessionForOnboarding(
        params.supabase,
        transitionEvaluatedSession.id,
      );
      state = validateConversationState(
        promotedSession.mode,
        promotedSession.state_token,
      );
      if (
        state.mode !== ONBOARDING_MODE ||
        state.state_token !== ONBOARDING_STATE_TOKEN
      ) {
        throw new ConversationRouterError(
          "INVALID_STATE",
          "Session promotion failed to persist deterministic onboarding state."
        );
      }
    }

    const route = shouldForceInterview
      ? "onboarding_engine"
      : resolveRouteForState(state);
    const nextTransition = shouldForceInterview
      ? ONBOARDING_STATE_TOKEN
      : resolveNextTransition(state, route);

    const classifier = params.classifyIntentFn ?? classifyIntent;
    let routedIntent: IntentClassification["intent"] | null = null;
    let dispatchRoute: RouterRoute = route;

    if (!shouldBypassIntentClassificationForState(state)) {
      const classification = classifier(params.payload.body_raw, {
        mode: state.mode,
      });
      routedIntent = classification.intent;
      dispatchRoute = resolveRouteForIntent(classification.intent, state);
    }

    const decision: RoutingDecision = {
      user_id: user.id,
      state,
      profile_is_complete_mvp: profile?.is_complete_mvp ?? null,
      route: dispatchRoute,
      safety_override_applied: params.safetyOverrideApplied ?? false,
      next_transition: nextTransition,
    };

    logEvent({
      event: "conversation.router_decision",
      user_id: decision.user_id,
      correlation_id: params.payload.inbound_message_id,
      payload: {
        inbound_message_id: params.payload.inbound_message_id,
        route: decision.route,
        intent: routedIntent,
        session_mode: decision.state.mode,
        session_state_token: decision.state.state_token,
        profile_is_complete_mvp: decision.profile_is_complete_mvp,
        next_transition: decision.next_transition,
        override_applied: decision.safety_override_applied,
      },
    });

    return decision;
  } catch (error) {
    outcome = "error";
    throw error;
  } finally {
    emitMetricBestEffort({
      metric: "system.request.latency",
      value: elapsedMetricMs(startedAt),
      correlation_id: params.payload.inbound_message_id,
      tags: {
        component: "conversation_router",
        operation: "route_conversation_message",
        outcome,
      },
    });
  }
}

export function validateConversationState(
  modeRaw: string | null | undefined,
  stateTokenRaw: string | null | undefined,
): ConversationState {
  if (!modeRaw) {
    throw new ConversationRouterError(
      "MISSING_STATE",
      "Conversation mode is required."
    );
  }

  if (!isConversationMode(modeRaw)) {
    throw new ConversationRouterError(
      "INVALID_STATE",
      `Unknown conversation mode '${modeRaw}'.`
    );
  }

  const stateToken = stateTokenRaw?.trim() ?? "";
  if (!stateToken) {
    throw new ConversationRouterError(
      "MISSING_STATE",
      "Conversation state token is required."
    );
  }

  const pattern = STATE_TOKEN_PATTERN_BY_MODE[modeRaw];
  if (!pattern.test(stateToken)) {
    throw new ConversationRouterError(
      "INVALID_STATE",
      `State token '${stateToken}' is invalid for mode '${modeRaw}'.`
    );
  }

  if (modeRaw === "interviewing") {
    classifyInterviewingStateToken(stateToken);
  }
  if (modeRaw === "post_event") {
    classifyPostEventStateToken(stateToken);
  }

  return {
    mode: modeRaw,
    state_token: stateToken,
  };
}

export function resolveRouteForState(state: ConversationState): RouterRoute {
  if (state.mode === "interviewing") {
    const interviewingStateKind = classifyInterviewingStateToken(state.state_token);
    if (interviewingStateKind === "onboarding") {
      return resolveOnboardingRoute(state.state_token);
    }
    return resolveInterviewRoute(state.state_token);
  }

  return ROUTE_BY_MODE[state.mode];
}

export function resolveNextTransition(
  state: ConversationState,
  route: RouterRoute,
): string {
  const expectedRoute = resolveRouteForState(state);
  if (route !== expectedRoute) {
    throw new ConversationRouterError(
      "ILLEGAL_TRANSITION_ATTEMPT",
      `Illegal transition attempt from mode '${state.mode}' via route '${route}'.`
    );
  }

  const nextTransition = state.mode === "interviewing" &&
      classifyInterviewingStateToken(state.state_token) === "onboarding"
    ? state.state_token
    : state.mode === "post_event"
    ? state.state_token
    : NEXT_TRANSITION_BY_MODE[state.mode];
  const allowedTransitions = LEGAL_TRANSITIONS_BY_MODE[state.mode];
  if (!allowedTransitions.has(nextTransition)) {
    throw new ConversationRouterError(
      "ILLEGAL_TRANSITION_ATTEMPT",
      `Transition '${nextTransition}' is not legal for mode '${state.mode}'.`
    );
  }

  return nextTransition;
}

function resolveOnboardingRoute(_stateToken: string): RouterRoute {
  return "onboarding_engine";
}

function resolveInterviewRoute(_stateToken: string): RouterRoute {
  return "profile_interview_engine";
}

export function shouldHoldInboundForOnboardingBurst(input: {
  state: ConversationState;
  payload: NormalizedInboundMessagePayload;
}): boolean {
  if (input.state.state_token !== ONBOARDING_AWAITING_BURST_TOKEN) {
    return false;
  }

  // STOP/HELP should be handled in twilio-inbound before router dispatch.
  const normalizedBody = input.payload.body_normalized.trim().toUpperCase();
  return !STOP_HELP_COMMANDS.has(normalizedBody);
}

function classifyInterviewingStateToken(
  stateToken: string,
): InterviewingStateTokenKind {
  if (ONBOARDING_TOKEN_PATTERN.test(stateToken)) {
    if (!ONBOARDING_STATE_TOKEN_SET.has(stateToken as OnboardingStateToken)) {
      throw new ConversationRouterError(
        "INVALID_STATE",
        `Unknown onboarding state token '${stateToken}'.`
      );
    }
    return "onboarding";
  }

  if (INTERVIEW_TOKEN_PATTERN.test(stateToken)) {
    return "interview";
  }

  throw new ConversationRouterError(
    "INVALID_STATE",
    `Unknown interviewing state token '${stateToken}'.`
  );
}

function classifyPostEventStateToken(stateToken: string): PostEventStateToken {
  if (!POST_EVENT_TOKEN_PATTERN.test(stateToken)) {
    throw new ConversationRouterError(
      "INVALID_STATE",
      `Unknown post-event state token '${stateToken}'.`
    );
  }

  if (!POST_EVENT_STATE_TOKEN_SET.has(stateToken as PostEventStateToken)) {
    throw new ConversationRouterError(
      "INVALID_STATE",
      `Unknown post-event state token '${stateToken}'.`
    );
  }

  return stateToken as PostEventStateToken;
}

function shouldBypassIntentClassificationForState(state: ConversationState): boolean {
  return (
    state.mode === "interviewing" ||
    state.mode === "linkup_forming" ||
    state.mode === "awaiting_invite_reply" ||
    state.mode === "post_event" ||
    state.mode === "safety_hold"
  );
}

function resolveRouteForIntent(
  intent: IntentClassification["intent"],
  state: ConversationState,
): RouterRoute {
  switch (intent) {
    case "CONTACT_INVITE_RESPONSE":
      return "contact_invite_response_handler";
    case "POST_ACTIVITY_CHECKIN":
      return "post_activity_checkin_handler";
    case "OPEN_INTENT":
      return "open_intent_handler";
    case "NAMED_PLAN_REQUEST":
      return "named_plan_request_handler";
    case "PLAN_SOCIAL_CHOICE":
      return "plan_social_choice_handler";
    case "INTERVIEW_ANSWER":
      return resolveRouteForState(state);
    case "INTERVIEW_ANSWER_ABBREVIATED":
      return "interview_answer_abbreviated_handler";
    case "SYSTEM_COMMAND":
      return "system_command_handler";
  }
}

function isIntentHandlerRoute(route: RouterRoute): boolean {
  return (
    route === "contact_invite_response_handler" ||
    route === "post_activity_checkin_handler" ||
    route === "open_intent_handler" ||
    route === "named_plan_request_handler" ||
    route === "plan_social_choice_handler" ||
    route === "interview_answer_abbreviated_handler" ||
    route === "system_command_handler"
  );
}

export async function dispatchConversationRoute(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  const normalizedRoute = resolveRouteForState(input.decision.state);
  const resolvedRoute = isIntentHandlerRoute(input.decision.route)
    ? input.decision.route
    : normalizedRoute;

  if (!isIntentHandlerRoute(input.decision.route) && normalizedRoute !== input.decision.route) {
    logEvent({
      level: "warn",
      event: "system.migration_mismatch_warning",
      user_id: input.decision.user_id,
      correlation_id: input.payload.inbound_message_id,
      payload: {
        warning: "conversation route corrected during dispatch",
        requested_route: input.decision.route,
        resolved_route: resolvedRoute,
        session_mode: input.decision.state.mode,
        session_state_token: input.decision.state.state_token,
      },
    });
  }

  switch (resolvedRoute) {
    case "profile_interview_engine": {
      try {
        const result = await runProfileInterviewEngine(input);
        assertDispatchedEngineMatchesRoute(resolvedRoute, result.engine);
        return result;
      } catch (error) {
        const err = error as Error;
        logEvent({
          level: "error",
          event: "system.unhandled_error",
          user_id: input.decision.user_id,
          correlation_id: input.payload.inbound_message_id,
          payload: {
            phase: "router_dispatch",
            error_name: err?.name ?? "Error",
            error_message: err?.message ?? String(error),
            route: resolvedRoute,
            session_mode: input.decision.state.mode,
            session_state_token: input.decision.state.state_token,
          },
        });
        throw error;
      }
    }
    case "onboarding_engine": {
      if (shouldHoldInboundForOnboardingBurst({
        state: input.decision.state,
        payload: input.payload,
      })) {
        logEvent({
          event: "conversation.state_transition",
          user_id: input.decision.user_id,
          correlation_id: input.payload.inbound_message_id,
          payload: {
            previous_state_token: input.decision.state.state_token,
            next_state_token: input.decision.state.state_token,
            reason: "onboarding_burst_hold",
            inbound_message_sid: input.payload.inbound_message_sid,
          },
        });
        return {
          engine: "onboarding_engine",
          reply_message: null,
        };
      }

      try {
        const result = await runOnboardingEngine(input);
        assertDispatchedEngineMatchesRoute(resolvedRoute, result.engine);
        return result;
      } catch (error) {
        const err = error as Error;
        logEvent({
          level: "error",
          event: "system.unhandled_error",
          user_id: input.decision.user_id,
          correlation_id: input.payload.inbound_message_id,
          payload: {
            phase: "router_dispatch",
            error_name: err?.name ?? "Error",
            error_message: err?.message ?? String(error),
            route: resolvedRoute,
            session_mode: input.decision.state.mode,
            session_state_token: input.decision.state.state_token,
          },
        });
        throw error;
      }
    }
    case "post_event_engine": {
      try {
        const result = await runPostEventEngine(input);
        assertDispatchedEngineMatchesRoute(resolvedRoute, result.engine);
        return result;
      } catch (error) {
        const err = error as Error;
        logEvent({
          level: "error",
          event: "system.unhandled_error",
          user_id: input.decision.user_id,
          correlation_id: input.payload.inbound_message_id,
          payload: {
            phase: "router_dispatch",
            error_name: err?.name ?? "Error",
            error_message: err?.message ?? String(error),
            route: resolvedRoute,
            session_mode: input.decision.state.mode,
            session_state_token: input.decision.state.state_token,
          },
        });
        throw error;
      }
    }
    case "default_engine": {
      const result = await runDefaultEngine(input);
      assertDispatchedEngineMatchesRoute(resolvedRoute, result.engine);
      return result;
    }
    case "contact_invite_response_handler":
      return {
        engine: "contact_invite_response_handler",
        reply_message: null,
      };
    case "post_activity_checkin_handler":
    case "open_intent_handler":
    case "named_plan_request_handler":
    case "plan_social_choice_handler":
    case "interview_answer_abbreviated_handler": {
      return dispatchViaDefaultEnginePlaceholder(resolvedRoute, input);
    }
    case "system_command_handler":
      return {
        engine: "system_command_handler",
        reply_message: null,
      };
    default:
      throw new ConversationRouterError(
        "INVALID_ROUTE",
        `Unsupported route '${input.decision.route}'.`
      );
  }
}

async function fetchPendingInvitationByPhoneHash(
  supabase: SupabaseClientLike,
  phoneHash: string,
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("contact_invitations")
    .select("id")
    .eq("invitee_phone_hash", phoneHash)
    .eq("status", "pending")
    .maybeSingle();

  if (error) {
    throw new ConversationRouterError(
      "INVITATION_LOOKUP_FAILED",
      "Unable to load contact invitation state for routing.",
    );
  }

  if (!data?.id) {
    return null;
  }

  return { id: data.id };
}

async function fetchUserByPhone(
  supabase: SupabaseClientLike,
  phoneE164: string,
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("phone_e164", phoneE164)
    .maybeSingle();

  if (error) {
    throw new ConversationRouterError(
      "USER_LOOKUP_FAILED",
      "Unable to load user record for routing."
    );
  }

  if (!data?.id) {
    return null;
  }

  return { id: data.id };
}

async function fetchConversationSession(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<ConversationSessionRow | null> {
  const { data, error } = await supabase
    .from("conversation_sessions")
    .select("id,mode,state_token,linkup_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new ConversationRouterError(
      "STATE_LOOKUP_FAILED",
      "Unable to load conversation state for routing."
    );
  }

  if (!data?.id) {
    return null;
  }

  return {
    id: data.id,
    mode: data.mode ?? null,
    state_token: data.state_token ?? null,
    linkup_id: data.linkup_id ?? null,
  };
}

async function fetchOrCreateConversationSession(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<ConversationSessionRow> {
  const existing = await fetchConversationSession(supabase, userId);
  if (existing) {
    return existing;
  }

  const { data, error } = await supabase
    .from("conversation_sessions")
    .insert({
      user_id: userId,
      mode: "idle",
      state_token: "idle",
      current_step_id: null,
      last_inbound_message_sid: null,
    })
    .select("id,mode,state_token,linkup_id")
    .single();

  if (error || !data?.id) {
    throw new ConversationRouterError(
      "STATE_CREATE_FAILED",
      "Unable to create default conversation state for routing."
    );
  }

  emitMetricBestEffort({
    metric: "conversation.session.started",
    value: 1,
    tags: {
      component: "conversation_router",
      route: "session_create",
    },
  });

  return {
    id: data.id,
    mode: data.mode ?? null,
    state_token: data.state_token ?? null,
    linkup_id: data.linkup_id ?? null,
  };
}

async function transitionConversationSessionForCompletedLinkup(
  params: {
    supabase: SupabaseClientLike;
    session: ConversationSessionRow;
    inboundMessageId: string;
  },
): Promise<ConversationSessionRow> {
  if (!params.session.linkup_id) {
    return params.session;
  }

  if (typeof params.supabase.rpc !== "function") {
    throw new ConversationRouterError(
      "STATE_TRANSITION_MISCONFIGURED",
      "Router requires Supabase RPC support for post-event session transitions.",
    );
  }

  const { data, error } = await params.supabase.rpc(
    "transition_session_to_post_event_if_linkup_completed",
    {
      p_session_id: params.session.id,
      p_correlation_id: params.inboundMessageId,
    },
  );

  if (error) {
    emitRpcFailureMetric({
      correlation_id: params.inboundMessageId,
      component: "conversation_router",
      rpc_name: "transition_session_to_post_event_if_linkup_completed",
    });
    throw new ConversationRouterError(
      "STATE_TRANSITION_FAILED",
      "Unable to evaluate post-event session transition.",
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
      transitioned?: unknown;
      reason?: unknown;
      next_mode?: unknown;
      state_token?: unknown;
      linkup_id?: unknown;
      linkup_state?: unknown;
      correlation_id?: unknown;
      linkup_correlation_id?: unknown;
    }
    | null
    | undefined;

  if (!row) {
    throw new ConversationRouterError(
      "STATE_TRANSITION_INVALID_RESPONSE",
      "Post-event session transition returned no result row.",
    );
  }

  const nextMode =
    typeof row.next_mode === "string" ? row.next_mode : params.session.mode;
  const nextStateToken =
    typeof row.state_token === "string" ? row.state_token : params.session.state_token;

  if (!nextMode || !isConversationMode(nextMode)) {
    throw new ConversationRouterError(
      "STATE_TRANSITION_INVALID_RESPONSE",
      "Post-event session transition returned an invalid mode.",
    );
  }

  if (!nextStateToken || typeof nextStateToken !== "string") {
    throw new ConversationRouterError(
      "STATE_TRANSITION_INVALID_RESPONSE",
      "Post-event session transition returned an invalid state token.",
    );
  }

  const previousMode = params.session.mode ?? "unknown";
  const previousStateToken = params.session.state_token ?? "unknown";
  const transitionReason = typeof row.reason === "string" && row.reason.trim()
    ? row.reason
    : "unchanged";
  const transitionCorrelationId = typeof row.correlation_id === "string"
    ? row.correlation_id
    : params.inboundMessageId;
  const linkupId = typeof row.linkup_id === "string" ? row.linkup_id : params.session.linkup_id;

  logEvent({
    event: "conversation.mode_transition",
    correlation_id: transitionCorrelationId,
    linkup_id: linkupId ?? null,
    payload: {
      previous_mode: previousMode,
      next_mode: nextMode,
      reason: transitionReason,
      session_id: params.session.id,
      linkup_state: typeof row.linkup_state === "string" ? row.linkup_state : null,
      transitioned: row.transitioned === true,
      linkup_correlation_id: typeof row.linkup_correlation_id === "string"
        ? row.linkup_correlation_id
        : null,
    },
  });

  logEvent({
    event: "conversation.state_transition",
    correlation_id: transitionCorrelationId,
    linkup_id: linkupId ?? null,
    payload: {
      previous_state_token: previousStateToken,
      next_state_token: nextStateToken,
      reason: transitionReason,
      mode: nextMode,
      session_id: params.session.id,
      transitioned: row.transitioned === true,
    },
  });

  return {
    ...params.session,
    mode: nextMode,
    state_token: nextStateToken,
  };
}

async function promoteConversationSessionForOnboarding(
  supabase: SupabaseClientLike,
  sessionId: string,
): Promise<{ mode: string | null; state_token: string | null }> {
  const existingSession = await supabase
    .from("conversation_sessions")
    .select("mode,state_token")
    .eq("id", sessionId)
    .maybeSingle();
  const previousMode = typeof existingSession?.data?.mode === "string"
    ? existingSession.data.mode
    : "idle";
  const previousStateToken = typeof existingSession?.data?.state_token === "string"
    ? existingSession.data.state_token
    : "idle";

  const { data, error } = await supabase
    .from("conversation_sessions")
    .update({
      mode: ONBOARDING_MODE,
      state_token: ONBOARDING_STATE_TOKEN,
    })
    .eq("id", sessionId)
    .eq("mode", "idle")
    .select("mode,state_token")
    .single();

  if (error || !data) {
    throw new ConversationRouterError(
      "STATE_PROMOTION_FAILED",
      "Unable to persist deterministic onboarding conversation state."
    );
  }

  logEvent({
    event: "conversation.mode_transition",
    payload: {
      previous_mode: previousMode,
      next_mode: data.mode ?? ONBOARDING_MODE,
      reason: "idle_user_promoted_for_onboarding",
      session_id: sessionId,
    },
  });
  logEvent({
    event: "conversation.state_transition",
    payload: {
      previous_state_token: previousStateToken,
      next_state_token: data.state_token ?? ONBOARDING_STATE_TOKEN,
      reason: "idle_user_promoted_for_onboarding",
      mode: data.mode ?? ONBOARDING_MODE,
      session_id: sessionId,
    },
  });

  return {
    mode: data.mode ?? null,
    state_token: data.state_token ?? null,
  };
}

async function fetchProfileSummary(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<ProfileSummary | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("is_complete_mvp,state")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new ConversationRouterError(
      "PROFILE_LOOKUP_FAILED",
      "Unable to load profile completeness for routing."
    );
  }

  if (!data) {
    return null;
  }

  return {
    is_complete_mvp: data.is_complete_mvp ?? false,
    state: data.state ?? null,
  };
}

function shouldRouteIdleUserToInterview(
  state: ConversationState,
  profile: ProfileSummary | null,
): boolean {
  if (state.mode !== "idle") {
    return false;
  }

  if (!profile) {
    return true;
  }

  return !profile.is_complete_mvp;
}

function assertDispatchedEngineMatchesRoute(
  route: RouterRoute,
  engine: RouterRoute,
): void {
  if (route !== engine) {
    throw new ConversationRouterError(
      "ENGINE_ROUTE_MISMATCH",
      `Dispatch returned engine '${engine}' for route '${route}'.`
    );
  }
}

async function dispatchViaDefaultEnginePlaceholder(
  handlerRoute: Extract<
    RouterRoute,
    | "contact_invite_response_handler"
    | "post_activity_checkin_handler"
    | "open_intent_handler"
    | "named_plan_request_handler"
    | "plan_social_choice_handler"
    | "interview_answer_abbreviated_handler"
  >,
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  const fallbackDecision: RoutingDecision = {
    ...input.decision,
    route: "default_engine",
  };
  const fallbackResult = await runDefaultEngine({
    ...input,
    decision: fallbackDecision,
  });

  return {
    engine: handlerRoute,
    reply_message: fallbackResult.reply_message,
  };
}

function isSystemCommand(normalizedBody: string): boolean {
  return STOP_HELP_COMMANDS.has(normalizedBody);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", HASH_ENCODER.encode(value));
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let index = 0; index < bytes.length; index += 1) {
    hex += bytes[index].toString(16).padStart(2, "0");
  }
  return hex;
}

function isConversationMode(value: string): value is ConversationMode {
  return VALID_MODES.has(value as ConversationMode);
}
