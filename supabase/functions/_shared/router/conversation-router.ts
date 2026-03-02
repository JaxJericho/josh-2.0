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
import { handleOpenIntent } from "../../../../packages/messaging/src/handlers/handle-open-intent.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  handlePlanSocialChoice,
  type PlanSocialChoiceAuditAction,
} from "../../../../packages/messaging/src/handlers/handle-plan-social-choice.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  createContactInvitationWithSupabase,
  normalizePhoneToE164,
} from "../invitations/create-contact-invitation.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  PENDING_PLAN_CONFIRMATION_STATE_TOKEN,
  SOCIAL_CHOICE_STATE_TOKEN_PREFIX,
} from "../../../../packages/messaging/src/handlers/social-choice-state.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import type {
  ConversationSession as IntentClassifierSession,
  IntentClassification,
} from "../../../../packages/messaging/src/intents/intent-types.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  createSupabaseSoloActivityRepository,
  suggestSoloActivity,
} from "../../../../packages/core/src/suggestions/suggest-solo-activity.ts";
import {
  elapsedMetricMs,
  emitMetricBestEffort,
  emitRpcFailureMetric,
  nowMetricMs,
} from "../../../../packages/core/src/observability/metrics.ts";

export type ConversationMode =
  | "idle"
  | "interviewing"
  | "awaiting_social_choice"
  | "pending_plan_confirmation"
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
const NAMED_PLAN_INVITE_READY_REPLY =
  "Invite queued. I will send it once invite delivery is enabled.";
const NAMED_PLAN_INVITE_REUSED_REPLY =
  "That invite is already queued. I will send it once invite delivery is enabled.";
const NAMED_PLAN_INVITE_PARSE_REPLY =
  "Share your contact's phone number in E.164 format (for example, +14155550123) and I can queue the invite.";
const NAMED_PLAN_INVITE_CONFIRM_PROMPT =
  "Reply YES to queue this invite, or NO to cancel.";
const NAMED_PLAN_INVITE_CONFIRM_CANCELLED_REPLY =
  "Okay - I will not queue that invite.";
const NAMED_PLAN_INVITE_CONFIRM_REPROMPT =
  "Reply YES to queue the invite, or NO to cancel.";
const INVITE_CONFIRMATION_STATE_TOKEN_PREFIX = "invite_confirm:create:v1";
const INVITEE_PHONE_CANDIDATE_PATTERN = /(\+?\d[\d().\s-]{7,}\d)/;
const INVITEE_NAME_WITH_PATTERN = /\bwith\s+([a-z][a-z' -]{1,60})/i;
const INVITE_CONFIRM_YES_EXACT_MATCHES = new Set([
  "yes",
  "y",
  "yeah",
  "yep",
  "ok",
  "okay",
  "sure",
  "confirm",
  "send",
  "invite",
  "do it",
]);
const INVITE_CONFIRM_NO_EXACT_MATCHES = new Set([
  "no",
  "n",
  "nope",
  "nah",
  "cancel",
  "stop",
  "dont",
  "don't",
  "decline",
]);
const DIRECT_INVITE_INTENT_PATTERNS = [
  /\binvite\b/i,
  /\bsend(?:\s+an?)?\s+invite\b/i,
  /\btext\b/i,
  /\breach\s+out\b/i,
  /\bqueue\b/i,
];
const HASH_ENCODER = new TextEncoder();

const CONVERSATION_MODES: readonly ConversationMode[] = [
  "idle",
  "interviewing",
  "awaiting_social_choice",
  "pending_plan_confirmation",
  "linkup_forming",
  "awaiting_invite_reply",
  "post_event",
  "safety_hold",
];

const VALID_MODES: ReadonlySet<ConversationMode> = new Set(CONVERSATION_MODES);

const STATE_TOKEN_PATTERN_BY_MODE: Record<ConversationMode, RegExp> = {
  idle: /^idle$/,
  interviewing: /^[a-z0-9:_-]+$/i,
  awaiting_social_choice: /^[a-z0-9:_-]+$/i,
  pending_plan_confirmation: /^[a-z0-9:_-]+$/i,
  linkup_forming: /^[a-z0-9:_-]+$/i,
  awaiting_invite_reply: /^[a-z0-9:_-]+$/i,
  post_event: POST_EVENT_TOKEN_PATTERN,
  safety_hold: /^[a-z0-9:_-]+$/i,
};

const ROUTE_BY_MODE: Record<ConversationMode, RouterRoute> = {
  idle: "default_engine",
  interviewing: "profile_interview_engine",
  awaiting_social_choice: "default_engine",
  pending_plan_confirmation: "default_engine",
  linkup_forming: "default_engine",
  awaiting_invite_reply: "default_engine",
  post_event: "post_event_engine",
  safety_hold: "default_engine",
};

const NEXT_TRANSITION_BY_MODE: Record<ConversationMode, string> = {
  idle: "idle:awaiting_user_input",
  interviewing: "interview:awaiting_next_input",
  awaiting_social_choice: "social:awaiting_choice",
  pending_plan_confirmation: PENDING_PLAN_CONFIRMATION_STATE_TOKEN,
  linkup_forming: "linkup:awaiting_details",
  awaiting_invite_reply: "invite:awaiting_reply",
  post_event: "post_event:attendance",
  safety_hold: "safety:hold_enforced",
};

const LEGAL_TRANSITIONS_BY_MODE: Record<ConversationMode, ReadonlySet<string>> = {
  idle: new Set(["idle:awaiting_user_input", ONBOARDING_STATE_TOKEN]),
  interviewing: new Set(["interview:awaiting_next_input", ...ONBOARDING_STATE_TOKENS]),
  awaiting_social_choice: new Set([SOCIAL_CHOICE_STATE_TOKEN_PREFIX]),
  pending_plan_confirmation: new Set([PENDING_PLAN_CONFIRMATION_STATE_TOKEN]),
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

  if (
    state.mode === "pending_plan_confirmation" &&
    isInviteConfirmationStateToken(state.state_token)
  ) {
    return "named_plan_request_handler";
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
    : state.mode === "pending_plan_confirmation" &&
        isInviteConfirmationStateToken(state.state_token)
    ? state.state_token
    : NEXT_TRANSITION_BY_MODE[state.mode];

  if (
    state.mode === "pending_plan_confirmation" &&
    isInviteConfirmationStateToken(nextTransition)
  ) {
    return nextTransition;
  }

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
    state.mode === "pending_plan_confirmation" ||
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
      return dispatchViaDefaultEnginePlaceholder(resolvedRoute, input);
    case "open_intent_handler":
      return runOpenIntentHandler(input);
    case "plan_social_choice_handler":
      return runPlanSocialChoiceHandler(input);
    case "named_plan_request_handler":
      return runNamedPlanRequestHandler(input);
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

async function runOpenIntentHandler(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  let replyMessage: string | null = null;
  const soloRepository = createSupabaseSoloActivityRepository(input.supabase);

  await handleOpenIntent(
    input.decision.user_id,
    input.payload.body_raw,
    {
      mode: input.decision.state.mode,
      has_user_record: true,
      has_pending_contact_invitation: false,
      is_unknown_number_with_pending_invitation: false,
    },
    {
      evaluateEligibility: ({ userId, action_type }) =>
        evaluateEligibility({
          supabase: input.supabase,
          userId,
          action_type,
        }),
      hasContactCircleEntries: async (userId) => {
        const { data, error } = await input.supabase
          .from("contact_circle")
          .select("id")
          .eq("user_id", userId)
          .limit(1)
          .maybeSingle();

        if (error) {
          throw new ConversationRouterError(
            "CONTACT_CIRCLE_LOOKUP_FAILED",
            "Unable to load contact circle state for open intent handling.",
          );
        }

        return Boolean(data?.id);
      },
      handoffToLinkupFlow: async () => {
        const fallbackDecision: RoutingDecision = {
          ...input.decision,
          route: "default_engine",
        };
        const linkupResult = await runDefaultEngine({
          ...input,
          decision: fallbackDecision,
        });
        replyMessage = linkupResult.reply_message;
        return { took_over: true };
      },
      handoffToNamedPlanFlow: async () => {
        // Named-plan handler is not implemented in this ticket; continue to solo fallback.
        return { took_over: false };
      },
      suggestSoloActivity: (userId) =>
        suggestSoloActivity(userId, {
          repository: soloRepository,
        }),
      sendMessage: async ({ body }) => {
        replyMessage = body;
      },
      updateSessionMode: async ({ userId, mode, stateToken }) => {
        if (mode !== "awaiting_social_choice") {
          throw new ConversationRouterError(
            "INVALID_STATE",
            `Unsupported open intent target mode '${mode}'.`,
          );
        }
        await persistAwaitingSocialChoiceSession({
          supabase: input.supabase,
          userId,
          stateToken,
        });
      },
    },
  );

  return {
    engine: "open_intent_handler",
    reply_message: replyMessage,
  };
}

async function runPlanSocialChoiceHandler(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  let replyMessage: string | null = null;
  const soloRepository = createSupabaseSoloActivityRepository(input.supabase);

  await handlePlanSocialChoice(
    input.decision.user_id,
    input.payload.body_raw,
    {
      mode: input.decision.state.mode,
      state_token: input.decision.state.state_token,
      has_user_record: true,
      has_pending_contact_invitation: false,
      is_unknown_number_with_pending_invitation: false,
    },
    {
      createPlanBrief: async ({ userId, activityKey, notes, status }) => {
        const { data, error } = await input.supabase
          .from("plan_briefs")
          .insert({
            creator_user_id: userId,
            activity_key: activityKey,
            notes,
            status,
          })
          .select("id")
          .single();

        if (error) {
          throw new ConversationRouterError(
            "PLAN_BRIEF_CREATE_FAILED",
            "Unable to create a confirmed plan brief.",
          );
        }

        if (!data?.id) {
          throw new ConversationRouterError(
            "PLAN_BRIEF_CREATE_FAILED",
            "Plan brief insert succeeded without an id.",
          );
        }

        return { id: data.id as string };
      },
      suggestSoloActivity: ({ userId, excludeActivityKeys }) =>
        suggestSoloActivity(userId, {
          repository: soloRepository,
          excludeActivityKeys,
        }),
      sendMessage: async ({ body }) => {
        replyMessage = body;
      },
      updateSessionState: async ({ userId, mode, stateToken }) => {
        await persistConversationSessionState({
          supabase: input.supabase,
          userId,
          mode,
          stateToken,
        });
      },
      writeAuditEvent: async ({
        userId,
        action,
        targetType,
        targetId,
        reason,
        payload,
      }) => {
        const idempotencyKey = buildPlanSocialChoiceAuditIdempotencyKey({
          userId,
          inboundMessageSid: input.payload.inbound_message_sid,
          action,
        });
        const { error } = await input.supabase
          .from("audit_log")
          .insert({
            action,
            target_type: targetType,
            target_id: targetId ?? null,
            reason,
            payload,
            idempotency_key: idempotencyKey,
          });

        if (error && !isDuplicateKeyError(error)) {
          throw new ConversationRouterError(
            "AUDIT_LOG_FAILED",
            "Unable to write social-choice audit event.",
          );
        }
      },
    },
  );

  return {
    engine: "plan_social_choice_handler",
    reply_message: replyMessage,
  };
}

async function runNamedPlanRequestHandler(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  const pendingInviteConfirmation = parseInviteConfirmationState(input.decision.state);
  if (pendingInviteConfirmation) {
    const confirmationDecision = parseInviteConfirmationReply(input.payload.body_raw);
    if (confirmationDecision === "no") {
      await persistConversationSessionState({
        supabase: input.supabase,
        userId: input.decision.user_id,
        mode: "idle",
        stateToken: "idle",
      });
      return {
        engine: "named_plan_request_handler",
        reply_message: NAMED_PLAN_INVITE_CONFIRM_CANCELLED_REPLY,
      };
    }

    if (confirmationDecision === "ambiguous") {
      return {
        engine: "named_plan_request_handler",
        reply_message: NAMED_PLAN_INVITE_CONFIRM_REPROMPT,
      };
    }

    const creationResult = await createInvitationFromPendingConfirmation({
      input,
      inviteePhoneE164: pendingInviteConfirmation.inviteePhoneE164,
      inviteeDisplayName: pendingInviteConfirmation.inviteeDisplayName,
    });

    await persistConversationSessionState({
      supabase: input.supabase,
      userId: input.decision.user_id,
      mode: "idle",
      stateToken: "idle",
    });

    return {
      engine: "named_plan_request_handler",
      reply_message: resolveInviteCreationReply(creationResult),
    };
  }

  const inviteePhoneCandidate = extractInviteePhoneCandidate(input.payload.body_raw);
  if (!inviteePhoneCandidate) {
    return {
      engine: "named_plan_request_handler",
      reply_message: NAMED_PLAN_INVITE_PARSE_REPLY,
    };
  }

  let inviteePhoneE164: string;
  try {
    inviteePhoneE164 = normalizePhoneToE164(inviteePhoneCandidate);
  } catch {
    return {
      engine: "named_plan_request_handler",
      reply_message: NAMED_PLAN_INVITE_PARSE_REPLY,
    };
  }

  const inviteeDisplayName = extractInviteeDisplayName(
    input.payload.body_raw,
    inviteePhoneCandidate,
  );
  if (isDirectInviteIntent(input.payload.body_raw, inviteePhoneCandidate)) {
    const creationResult = await createInvitationFromPendingConfirmation({
      input,
      inviteePhoneE164,
      inviteeDisplayName,
    });
    return {
      engine: "named_plan_request_handler",
      reply_message: resolveInviteCreationReply(creationResult),
    };
  }

  const pendingStateToken = buildInviteConfirmationStateToken({
    inviteePhoneE164,
    inviteeDisplayName,
  });
  await persistConversationSessionState({
    supabase: input.supabase,
    userId: input.decision.user_id,
    mode: "pending_plan_confirmation",
    stateToken: pendingStateToken,
  });

  return {
    engine: "named_plan_request_handler",
    reply_message: NAMED_PLAN_INVITE_CONFIRM_PROMPT,
  };
}

type OpenIntentEligibilityInput = {
  supabase: SupabaseClientLike;
  userId: string;
  action_type: "can_initiate_linkup" | "can_initiate_named_plan";
};

async function evaluateEligibility(
  input: OpenIntentEligibilityInput,
): Promise<{ allowed: boolean; reason_code: string | null; user_message: string | null }> {
  if (input.action_type === "can_initiate_named_plan") {
    const subscription = await fetchActiveSubscriptionState(input.supabase, input.userId);
    const allowed = subscription === "active";
    return {
      allowed,
      reason_code: allowed ? null : "subscription_inactive",
      user_message: null,
    };
  }

  const [entitlements, subscriptionState, profileState] = await Promise.all([
    fetchEntitlementSnapshot(input.supabase, input.userId),
    fetchActiveSubscriptionState(input.supabase, input.userId),
    fetchProfileState(input.supabase, input.userId),
  ]);

  const subscriptionActive = subscriptionState === "active";
  const canInitiateLinkup = entitlements?.can_initiate_linkup === true;
  const profileEligible = profileState === "complete_mvp" || profileState === "complete_full";
  const allowed = subscriptionActive && canInitiateLinkup && profileEligible;

  return {
    allowed,
    reason_code: allowed ? null : "linkup_eligibility_failed",
    user_message: null,
  };
}

async function fetchEntitlementSnapshot(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<{ can_initiate_linkup: boolean } | null> {
  const { data, error } = await supabase
    .from("entitlements")
    .select("can_initiate_linkup")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new ConversationRouterError(
      "ELIGIBILITY_LOOKUP_FAILED",
      "Unable to evaluate LinkUp entitlement state.",
    );
  }

  if (!data) {
    return null;
  }

  return {
    can_initiate_linkup: data.can_initiate_linkup === true,
  };
}

async function fetchActiveSubscriptionState(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("state")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new ConversationRouterError(
      "ELIGIBILITY_LOOKUP_FAILED",
      "Unable to evaluate subscription state.",
    );
  }

  return typeof data?.state === "string" ? data.state : null;
}

async function fetchProfileState(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("state")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new ConversationRouterError(
      "ELIGIBILITY_LOOKUP_FAILED",
      "Unable to evaluate profile completion state.",
    );
  }

  return typeof data?.state === "string" ? data.state : null;
}

async function fetchRequiredProfileId(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new ConversationRouterError(
      "PROFILE_LOOKUP_FAILED",
      "Unable to resolve inviter profile for contact invitation creation.",
    );
  }

  if (!data?.id) {
    throw new ConversationRouterError(
      "PROFILE_LOOKUP_FAILED",
      "Inviter profile is required before creating a contact invitation.",
    );
  }

  return data.id;
}

async function fetchInviterDisplayName(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("users")
    .select("first_name")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new ConversationRouterError(
      "USER_LOOKUP_FAILED",
      "Unable to resolve inviter display name for contact invitation creation.",
    );
  }

  const firstName = typeof data?.first_name === "string" ? data.first_name.trim() : "";
  return firstName.length > 0 ? firstName : "A friend";
}

async function createInvitationFromPendingConfirmation(input: {
  input: EngineDispatchInput;
  inviteePhoneE164: string;
  inviteeDisplayName: string | null;
}): Promise<Awaited<ReturnType<typeof createContactInvitationWithSupabase>>> {
  const inviterProfileId = await fetchRequiredProfileId(
    input.input.supabase,
    input.input.decision.user_id,
  );
  const inviterDisplayName = await fetchInviterDisplayName(
    input.input.supabase,
    input.input.decision.user_id,
  );
  const smsEncryptionKey = requireSmsEncryptionKey();

  try {
    return await createContactInvitationWithSupabase({
      supabase: input.input.supabase,
      inviter_user_id: input.input.decision.user_id,
      inviter_profile_id: inviterProfileId,
      inviter_display_name: inviterDisplayName,
      invitee_phone_e164: input.inviteePhoneE164,
      invitee_display_name: input.inviteeDisplayName,
      invitation_context: input.input.payload.body_raw,
      sms_encryption_key: smsEncryptionKey,
      audit_idempotency_key:
        `contact_invitation_created:${input.input.decision.user_id}:${input.input.payload.inbound_message_sid}`,
    });
  } catch (error) {
    const err = error as Error;
    throw new ConversationRouterError(
      "CONTACT_INVITATION_CREATE_FAILED",
      err?.message || "Unable to create contact invitation.",
    );
  }
}

function resolveInviteCreationReply(
  result: Awaited<ReturnType<typeof createContactInvitationWithSupabase>>,
): string {
  if (
    result.invitation_outcome === "reused" &&
    result.outbound_job_outcome === "reused"
  ) {
    return NAMED_PLAN_INVITE_REUSED_REPLY;
  }
  return NAMED_PLAN_INVITE_READY_REPLY;
}

function requireSmsEncryptionKey(): string {
  const denoRuntime = (globalThis as unknown as {
    Deno?: { env?: { get?: (name: string) => string | undefined } };
  }).Deno;
  const denoValue = denoRuntime?.env?.get?.("SMS_BODY_ENCRYPTION_KEY");
  if (typeof denoValue === "string" && denoValue.trim()) {
    return denoValue.trim();
  }

  const nodeRuntime = (globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  const nodeValue = nodeRuntime?.env?.SMS_BODY_ENCRYPTION_KEY;
  if (typeof nodeValue === "string" && nodeValue.trim()) {
    return nodeValue.trim();
  }

  throw new ConversationRouterError(
    "MISSING_SMS_ENCRYPTION_KEY",
    "SMS_BODY_ENCRYPTION_KEY is required to queue contact invitation jobs.",
  );
}

function parseInviteConfirmationState(
  state: ConversationState,
): { inviteePhoneE164: string; inviteeDisplayName: string | null } | null {
  if (state.mode !== "pending_plan_confirmation") {
    return null;
  }
  return parseInviteConfirmationStateToken(state.state_token);
}

function parseInviteConfirmationStateToken(
  stateToken: string,
): { inviteePhoneE164: string; inviteeDisplayName: string | null } | null {
  if (!isInviteConfirmationStateToken(stateToken)) {
    return null;
  }

  const segments = stateToken.split(":");
  if (segments.length !== 5) {
    return null;
  }

  const phoneEncoded = segments[3];
  const nameEncoded = segments[4];
  if (!phoneEncoded) {
    return null;
  }

  const inviteePhoneE164 = decodeStateTokenPart(phoneEncoded);
  if (!inviteePhoneE164) {
    return null;
  }

  const inviteeDisplayName = nameEncoded === "_"
    ? null
    : decodeStateTokenPart(nameEncoded);

  return {
    inviteePhoneE164,
    inviteeDisplayName: inviteeDisplayName && inviteeDisplayName.trim()
      ? inviteeDisplayName.trim()
      : null,
  };
}

function buildInviteConfirmationStateToken(input: {
  inviteePhoneE164: string;
  inviteeDisplayName: string | null;
}): string {
  const phonePart = encodeStateTokenPart(input.inviteePhoneE164);
  const displayName = input.inviteeDisplayName && input.inviteeDisplayName.trim()
    ? input.inviteeDisplayName.trim()
    : null;
  const namePart = displayName ? encodeStateTokenPart(displayName) : "_";
  return `${INVITE_CONFIRMATION_STATE_TOKEN_PREFIX}:${phonePart}:${namePart}`;
}

function parseInviteConfirmationReply(message: string): "yes" | "no" | "ambiguous" {
  const normalized = normalizeIntentText(message);
  if (!normalized) {
    return "ambiguous";
  }
  if (INVITE_CONFIRM_YES_EXACT_MATCHES.has(normalized)) {
    return "yes";
  }
  if (INVITE_CONFIRM_NO_EXACT_MATCHES.has(normalized)) {
    return "no";
  }

  const tokens = normalized.split(" ").filter(Boolean);
  let sawYes = false;
  let sawNo = false;
  for (const token of tokens) {
    if (INVITE_CONFIRM_YES_EXACT_MATCHES.has(token)) {
      sawYes = true;
    }
    if (INVITE_CONFIRM_NO_EXACT_MATCHES.has(token)) {
      sawNo = true;
    }
  }

  if (sawYes && !sawNo) {
    return "yes";
  }
  if (sawNo && !sawYes) {
    return "no";
  }
  return "ambiguous";
}

function isDirectInviteIntent(message: string, phoneCandidate: string): boolean {
  const withoutPhone = message.replace(phoneCandidate, " ");
  return DIRECT_INVITE_INTENT_PATTERNS.some((pattern) => pattern.test(withoutPhone));
}

function isInviteConfirmationStateToken(stateToken: string): boolean {
  return stateToken.startsWith(`${INVITE_CONFIRMATION_STATE_TOKEN_PREFIX}:`);
}

function normalizeIntentText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ");
}

function encodeStateTokenPart(value: string): string {
  const bytes = HASH_ENCODER.encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeStateTokenPart(value: string): string | null {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  try {
    const binary = atob(`${normalized}${padding}`);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function extractInviteePhoneCandidate(message: string): string | null {
  const match = INVITEE_PHONE_CANDIDATE_PATTERN.exec(message);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim();
}

function extractInviteeDisplayName(message: string, phoneCandidate: string): string | null {
  const withoutPhone = message.replace(phoneCandidate, " ").replace(/\s+/g, " ").trim();
  const match = INVITEE_NAME_WITH_PATTERN.exec(withoutPhone);
  if (!match?.[1]) {
    return null;
  }
  const trimmed = match[1].replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function persistAwaitingSocialChoiceSession(input: {
  supabase: SupabaseClientLike;
  userId: string;
  stateToken: string;
}): Promise<void> {
  await persistConversationSessionState({
    supabase: input.supabase,
    userId: input.userId,
    mode: "awaiting_social_choice",
    stateToken: input.stateToken,
  });
}

async function persistConversationSessionState(input: {
  supabase: SupabaseClientLike;
  userId: string;
  mode: "idle" | "awaiting_social_choice" | "pending_plan_confirmation";
  stateToken: string;
}): Promise<void> {
  const session = await fetchConversationSession(input.supabase, input.userId);
  if (!session?.id) {
    throw new ConversationRouterError(
      "STATE_LOOKUP_FAILED",
      "Unable to locate conversation session for social-choice transition.",
    );
  }

  if (
    session.mode === input.mode &&
    session.state_token === input.stateToken
  ) {
    return;
  }

  const { error } = await input.supabase
    .from("conversation_sessions")
    .update({
      mode: input.mode,
      state_token: input.stateToken,
    })
    .eq("id", session.id)
    .select("id")
    .single();

  if (error) {
    throw new ConversationRouterError(
      "STATE_UPDATE_FAILED",
      "Unable to persist conversation session state transition.",
    );
  }
}

function buildPlanSocialChoiceAuditIdempotencyKey(input: {
  userId: string;
  inboundMessageSid: string;
  action: PlanSocialChoiceAuditAction;
}): string {
  return `plan_social_choice:audit:${input.userId}:${input.inboundMessageSid}:${input.action}`;
}

function isDuplicateKeyError(error: { code?: string; message?: string } | null): boolean {
  if (!error) {
    return false;
  }
  if (error.code === "23505") {
    return true;
  }
  const message = error.message ?? "";
  return message.toLowerCase().includes("duplicate key");
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
