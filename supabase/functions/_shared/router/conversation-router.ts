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
import {
  handleInterviewAnswerAbbreviated,
  type AbbreviatedInterviewProfilePatch,
  type AbbreviatedInterviewSessionPatch,
} from "../../../../packages/messaging/src/handlers/handle-interview-answer-abbreviated.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  handleFreeformInbound,
} from "../../../../packages/messaging/src/handlers/handle-freeform-inbound.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  handlePostActivityCheckin,
} from "../../../../packages/messaging/src/handlers/handle-post-activity-checkin.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  handleInvitationResponse,
  INVITATION_RESPONSE_CLARIFIER_STATE_TOKEN,
  maybeEvaluateAcceptedInvitationLinkupQuorum,
  parseInvitationResponse,
} from "../../../../packages/messaging/src/handlers/handle-invitation-response.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  createContactInvitationWithSupabase,
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
  buildInvitedAbbreviatedWelcomeMessage,
  CONTACT_INVITE_DECLINE_CONFIRMATION_MESSAGE,
  CONTACT_INVITE_RESPONSE_CLARIFICATION_MESSAGE,
} from "../../../../packages/core/src/invitations/abbreviated-welcome-messages.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { systemUnknownIntentResponse } from "../../../../packages/messaging/src/templates/system.ts";
import {
  elapsedMetricMs,
  emitMetricBestEffort,
  emitRpcFailureMetric,
  nowMetricMs,
} from "../../../../packages/core/src/observability/metrics.ts";

export type ConversationMode =
  | "idle"
  | "interviewing"
  | "interviewing_abbreviated"
  | "awaiting_social_choice"
  | "pending_plan_confirmation"
  | "pending_contact_invite_confirmation"
  | "linkup_forming"
  | "awaiting_invite_reply"
  | "awaiting_invitation_response"
  | "post_activity_checkin"
  | "post_event"
  | "safety_hold";

export type RouterRoute =
  | "profile_interview_engine"
  | "default_engine"
  | "onboarding_engine"
  | "post_event_engine"
  | "contact_invite_response_handler"
  | "invitation_response_handler"
  | "post_activity_checkin_handler"
  | "freeform_inbound_handler"
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
  last_inbound_message_sid: string | null;
};

type AbbreviatedInterviewSessionRow = {
  id: string;
  mode: string;
  state_token: string;
  current_step_id: string | null;
  last_inbound_message_sid: string | null;
};

type AbbreviatedInterviewProfileRow = {
  id: string;
  user_id: string;
  state: string;
  is_complete_mvp: boolean;
  country_code: string | null;
  state_code: string | null;
  last_interview_step: string | null;
  preferences: unknown;
  coordination_dimensions: unknown;
  activity_patterns: unknown;
  boundaries: unknown;
  active_intent: unknown;
  scheduling_availability: unknown;
  notice_preference: string | null;
  coordination_style: string | null;
  completeness_percent: number;
  completed_at: string | null;
  status_reason: string | null;
  state_changed_at: string;
};

type ProfileSummary = {
  is_complete_mvp: boolean;
  state: string | null;
};

type FreeformProfileRow = {
  id: string;
  user_id: string;
  state: "empty" | "partial" | "complete_invited" | "complete_mvp" | "complete_full" | "stale";
  is_complete_mvp: boolean;
  country_code: string | null;
  state_code: string | null;
  last_interview_step: string | null;
  preferences: unknown;
  coordination_dimensions: unknown;
  activity_patterns: unknown;
  boundaries: unknown;
  active_intent: unknown;
  scheduling_availability: unknown;
  notice_preference: string | null;
  coordination_style: string | null;
  completeness_percent: number;
  completed_at: string | null;
  status_reason: string | null;
  state_changed_at: string;
};

type ContactInvitationResponseRow = {
  id: string;
  inviter_user_id: string;
  status: string;
};

type InvitationResponseRow = {
  id: string;
  invitation_type: "solo" | "linkup";
  activity_key: string;
  proposed_time_window: string;
  linkup_id: string | null;
};

type RecentAcceptedInvitationRow = {
  id: string;
  activity_key: string;
  responded_at: string | null;
};

type ApplyInvitationResponseRpcRow = {
  duplicate?: unknown;
  invitation_id?: unknown;
  invitation_type?: unknown;
  learning_signal_written?: unknown;
  next_mode?: unknown;
  next_state_token?: unknown;
  outbound_job_id?: unknown;
  processed?: unknown;
  reason?: unknown;
  resulting_state?: unknown;
  user_id?: unknown;
};

type ClassifyIntentFn = (
  message: string,
  session: IntentClassifierSession,
) => IntentClassification;

type RoutedIntent =
  | IntentClassification["intent"]
  | "OPEN_INTENT"
  | "NAMED_PLAN_REQUEST"
  | "PLAN_SOCIAL_CHOICE";

const ONBOARDING_MODE: ConversationMode = "interviewing";
const ONBOARDING_STATE_TOKEN = "onboarding:awaiting_opening_response";
const INVITED_ABBREVIATED_MODE: ConversationMode = "interviewing_abbreviated";
const INVITED_ABBREVIATED_STATE_TOKEN = "interview_abbreviated:awaiting_reply";
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
const NAMED_PLAN_INVITE_CONFIRM_CANCELLED_REPLY =
  "Okay - I will not queue that invite.";
const NAMED_PLAN_INVITE_CONFIRM_REPROMPT =
  "Reply YES to queue the invite, or NO to cancel.";
const INVITE_CONFIRMATION_STATE_TOKEN_PREFIX = "invite_confirm:create:v1";
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
const CONTACT_INVITE_ACCEPT_EXACT_MATCHES = new Set([
  "yes",
  "y",
  "ok",
  "okay",
  "sure",
  "accept",
  "join",
]);
const CONTACT_INVITE_DECLINE_EXACT_MATCHES = new Set([
  "no",
  "n",
  "stop",
  "decline",
]);
const HASH_ENCODER = new TextEncoder();

const CONVERSATION_MODES: readonly ConversationMode[] = [
  "idle",
  "interviewing",
  "interviewing_abbreviated",
  "awaiting_social_choice",
  "pending_plan_confirmation",
  "pending_contact_invite_confirmation",
  "linkup_forming",
  "awaiting_invite_reply",
  "awaiting_invitation_response",
  "post_activity_checkin",
  "post_event",
  "safety_hold",
];

const VALID_MODES: ReadonlySet<ConversationMode> = new Set(CONVERSATION_MODES);

const STATE_TOKEN_PATTERN_BY_MODE: Record<ConversationMode, RegExp> = {
  idle: /^idle$/,
  interviewing: /^[a-z0-9:_-]+$/i,
  interviewing_abbreviated: /^[a-z0-9:_-]+$/i,
  awaiting_social_choice: /^[a-z0-9:_-]+$/i,
  pending_plan_confirmation: /^[a-z0-9:_-]+$/i,
  pending_contact_invite_confirmation: /^[a-z0-9:_-]+$/i,
  linkup_forming: /^[a-z0-9:_-]+$/i,
  awaiting_invite_reply: /^[a-z0-9:_-]+$/i,
  awaiting_invitation_response: /^[a-z0-9:_-]+$/i,
  post_activity_checkin: /^checkin:awaiting_(attendance|do_again|bridge):[a-z0-9-]*$/i,
  post_event: POST_EVENT_TOKEN_PATTERN,
  safety_hold: /^[a-z0-9:_-]+$/i,
};

const ROUTE_BY_MODE: Record<ConversationMode, RouterRoute> = {
  idle: "default_engine",
  interviewing: "profile_interview_engine",
  interviewing_abbreviated: "interview_answer_abbreviated_handler",
  awaiting_social_choice: "default_engine",
  pending_plan_confirmation: "default_engine",
  pending_contact_invite_confirmation: "default_engine",
  linkup_forming: "default_engine",
  awaiting_invite_reply: "default_engine",
  awaiting_invitation_response: "invitation_response_handler",
  post_activity_checkin: "post_activity_checkin_handler",
  post_event: "post_event_engine",
  safety_hold: "default_engine",
};

const NEXT_TRANSITION_BY_MODE: Record<ConversationMode, string> = {
  idle: "idle:awaiting_user_input",
  interviewing: "interview:awaiting_next_input",
  interviewing_abbreviated: "interview_abbreviated:awaiting_next_input",
  awaiting_social_choice: "social:awaiting_choice",
  pending_plan_confirmation: PENDING_PLAN_CONFIRMATION_STATE_TOKEN,
  pending_contact_invite_confirmation: "invite_confirm:awaiting_reply",
  linkup_forming: "linkup:awaiting_details",
  awaiting_invite_reply: "invite:awaiting_reply",
  awaiting_invitation_response: "invitation:awaiting_response",
  post_activity_checkin: "checkin:awaiting_attendance",
  post_event: "post_event:attendance",
  safety_hold: "safety:hold_enforced",
};

const LEGAL_TRANSITIONS_BY_MODE: Record<ConversationMode, ReadonlySet<string>> = {
  idle: new Set(["idle:awaiting_user_input", ONBOARDING_STATE_TOKEN]),
  interviewing: new Set(["interview:awaiting_next_input", ...ONBOARDING_STATE_TOKENS]),
  interviewing_abbreviated: new Set(["interview_abbreviated:awaiting_next_input"]),
  awaiting_social_choice: new Set([SOCIAL_CHOICE_STATE_TOKEN_PREFIX]),
  pending_plan_confirmation: new Set([PENDING_PLAN_CONFIRMATION_STATE_TOKEN]),
  pending_contact_invite_confirmation: new Set(["invite_confirm:create:v1"]),
  linkup_forming: new Set(["linkup:awaiting_details"]),
  awaiting_invite_reply: new Set(["invite:awaiting_reply"]),
  awaiting_invitation_response: new Set(["invitation:awaiting_response"]),
  post_activity_checkin: new Set(["checkin:awaiting_attendance"]),
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
    const duplicateInvitationReplay = transitionEvaluatedSession.last_inbound_message_sid ===
        params.payload.inbound_message_sid
      ? await fetchInvitationReplayByMessageSid(
        params.supabase,
        user.id,
        params.payload.inbound_message_sid,
      )
      : null;

    if (duplicateInvitationReplay) {
      const decision: RoutingDecision = {
        user_id: user.id,
        state,
        profile_is_complete_mvp: null,
        route: "invitation_response_handler",
        safety_override_applied: params.safetyOverrideApplied ?? false,
        next_transition: resolveNextTransition(state, resolveRouteForState(state)),
      };

      logEvent({
        event: "conversation.router_decision",
        user_id: decision.user_id,
        correlation_id: params.payload.inbound_message_id,
        payload: {
          inbound_message_id: params.payload.inbound_message_id,
          route: decision.route,
          intent: "duplicate_replay",
          session_mode: decision.state.mode,
          session_state_token: decision.state.state_token,
          profile_is_complete_mvp: decision.profile_is_complete_mvp,
          next_transition: decision.next_transition,
          override_applied: decision.safety_override_applied,
        },
      });

      return decision;
    }

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

    if (state.mode === "awaiting_invitation_response") {
      const parsedInvitationResponse = parseInvitationResponse(
        params.payload.body_raw,
        state.state_token,
      );
      const decision: RoutingDecision = {
        user_id: user.id,
        state,
        profile_is_complete_mvp: profile?.is_complete_mvp ?? null,
        route: "invitation_response_handler",
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
          intent: parsedInvitationResponse,
          session_mode: decision.state.mode,
          session_state_token: decision.state.state_token,
          profile_is_complete_mvp: decision.profile_is_complete_mvp,
          next_transition: decision.next_transition,
          override_applied: decision.safety_override_applied,
        },
      });

      return decision;
    }

    const classifier = params.classifyIntentFn ?? classifyIntent;
    let routedIntent: IntentClassification["intent"] | null = null;
    let dispatchRoute: RouterRoute = route;

    if (!shouldBypassIntentClassificationForState(state)) {
      const classification = classifier(
        params.payload.body_raw,
        toIntentClassifierSession(state),
      );
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

  if (state.mode === "pending_contact_invite_confirmation") {
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
    : state.mode === "post_activity_checkin"
    ? state.state_token
    : state.mode === "pending_contact_invite_confirmation"
    ? state.state_token
    : NEXT_TRANSITION_BY_MODE[state.mode];

  if (state.mode === "pending_contact_invite_confirmation" ||
    state.mode === "post_activity_checkin") {
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
    state.mode === "interviewing_abbreviated" ||
    state.mode === "pending_plan_confirmation" ||
    state.mode === "pending_contact_invite_confirmation" ||
    state.mode === "linkup_forming" ||
    state.mode === "awaiting_invite_reply" ||
    state.mode === "awaiting_invitation_response" ||
    state.mode === "post_activity_checkin" ||
    state.mode === "post_event" ||
    state.mode === "safety_hold"
  );
}

function toIntentClassifierSession(
  state: ConversationState,
): IntentClassifierSession {
  if (
    state.mode === "awaiting_social_choice" ||
    state.mode === "pending_plan_confirmation"
  ) {
    return {
      mode: "idle",
      state_token: state.state_token,
    };
  }

  return {
    mode: state.mode,
    state_token: state.state_token,
  };
}

function resolveRouteForIntent(
  intent: RoutedIntent,
  state: ConversationState,
): RouterRoute {
  switch (intent) {
    case "CONTACT_INVITE_RESPONSE":
      return "contact_invite_response_handler";
    case "POST_ACTIVITY_CHECKIN":
      return "post_activity_checkin_handler";
    case "HELP":
      return "system_command_handler";
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
    case "INVITE_RESPONSE":
    case "INVITATION_RESPONSE":
    case "PROFILE_UPDATE":
      return resolveRouteForState(state);
    case "UNKNOWN":
      return state.mode === "idle" ? "freeform_inbound_handler" : resolveRouteForState(state);
    default:
      throw new ConversationRouterError(
        "INVALID_ROUTE",
        `Unsupported intent '${intent}'.`,
      );
  }
}

function isIntentHandlerRoute(route: RouterRoute): boolean {
  return (
    route === "contact_invite_response_handler" ||
    route === "invitation_response_handler" ||
    route === "post_activity_checkin_handler" ||
    route === "freeform_inbound_handler" ||
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
      return runContactInviteResponseHandler(input);
    case "invitation_response_handler":
      return runInvitationResponseHandler(input);
    case "post_activity_checkin_handler":
      return runPostActivityCheckinHandler(input);
    case "freeform_inbound_handler":
      return runFreeformInboundHandler(input);
    case "open_intent_handler":
      return runOpenIntentHandler(input);
    case "plan_social_choice_handler":
      return runPlanSocialChoiceHandler(input);
    case "named_plan_request_handler":
      return runNamedPlanRequestHandler(input);
    case "interview_answer_abbreviated_handler": {
      return runInterviewAnswerAbbreviatedHandler(input);
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
    .order("created_at", { ascending: false })
    .limit(1)
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

async function fetchInvitationForInvitationResponse(input: {
  supabase: SupabaseClientLike;
  userId: string;
  action: "accept" | "pass";
  nowIso: string;
  inboundMessageSid: string;
}): Promise<InvitationResponseRow | null> {
  let query = input.supabase
    .from("invitations")
    .select("id,invitation_type,activity_key,proposed_time_window,linkup_id")
    .eq("user_id", input.userId)
    .eq("state", "pending");

  if (input.action === "accept") {
    query = query.gt("expires_at", input.nowIso);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new ConversationRouterError(
      "INVITATION_LOOKUP_FAILED",
      "Unable to load invitation state for invitation response handling.",
    );
  }

  if (
    !data?.id ||
    (data.invitation_type !== "solo" && data.invitation_type !== "linkup") ||
    !data.activity_key ||
    !data.proposed_time_window
  ) {
    const replayData = await fetchInvitationReplayByMessageSid(
      input.supabase,
      input.userId,
      input.inboundMessageSid,
    );
    return replayData;
  }

  return {
    id: data.id,
    invitation_type: data.invitation_type,
    activity_key: data.activity_key,
    proposed_time_window: data.proposed_time_window,
    linkup_id: typeof data.linkup_id === "string" ? data.linkup_id : null,
  };
}

async function fetchInvitationReplayByMessageSid(
  supabase: SupabaseClientLike,
  userId: string,
  inboundMessageSid: string,
): Promise<InvitationResponseRow | null> {
  const { data, error } = await supabase
    .from("invitations")
    .select("id,invitation_type,activity_key,proposed_time_window,linkup_id")
    .eq("user_id", userId)
    .eq("response_message_sid", inboundMessageSid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new ConversationRouterError(
      "INVITATION_LOOKUP_FAILED",
      "Unable to load invitation replay state for invitation response handling.",
    );
  }

  if (
    !data?.id ||
    (data.invitation_type !== "solo" && data.invitation_type !== "linkup") ||
    !data.activity_key ||
    !data.proposed_time_window
  ) {
    return null;
  }

  return {
    id: data.id,
    invitation_type: data.invitation_type,
    activity_key: data.activity_key,
    proposed_time_window: data.proposed_time_window,
    linkup_id: typeof data.linkup_id === "string" ? data.linkup_id : null,
  };
}

async function fetchActivityDisplayName(
  supabase: SupabaseClientLike,
  activityKey: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("activity_catalog")
    .select("display_name")
    .eq("activity_key", activityKey)
    .maybeSingle();

  if (error) {
    throw new ConversationRouterError(
      "ACTIVITY_LOOKUP_FAILED",
      "Unable to resolve activity display name for invitation response handling.",
    );
  }

  if (!data?.display_name || typeof data.display_name !== "string") {
    return null;
  }

  return data.display_name;
}

type ContactInviteResponseIntent = "accept" | "decline" | "unknown";

async function runContactInviteResponseHandler(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  const phoneHash = input.payload.from_phone_hash?.trim() ||
    await sha256Hex(input.payload.from_e164);
  const invitation = await fetchInvitationForContactInviteResponse(
    input.supabase,
    phoneHash,
  );

  if (!invitation) {
    return {
      engine: "contact_invite_response_handler",
      reply_message: null,
    };
  }

  const responseIntent = parseContactInviteResponseIntent(input.payload.body_raw);
  const inboundAuditIdempotencyKey =
    `contact_invite_response:received:${invitation.id}:${input.payload.inbound_message_sid}`;

  if (responseIntent === "unknown") {
    await insertAuditLogRecord({
      supabase: input.supabase,
      action: "contact_invite_clarify_prompted",
      targetType: "contact_invitation",
      targetId: invitation.id,
      reason: "contact_invite_response_clarify_prompted",
      idempotencyKey:
        `contact_invite_response:clarify:${invitation.id}:${input.payload.inbound_message_sid}`,
      payload: {
        invitation_id: invitation.id,
        inviter_user_id: invitation.inviter_user_id,
        invitee_phone_hash: phoneHash,
        idempotency_status: "first_run",
      },
    });
    await insertAuditLogRecord({
      supabase: input.supabase,
      action: "contact_invite_response_received",
      targetType: "contact_invitation",
      targetId: invitation.id,
      reason: "contact_invite_response_received",
      idempotencyKey: inboundAuditIdempotencyKey,
      payload: {
        invitation_id: invitation.id,
        inviter_user_id: invitation.inviter_user_id,
        invitee_phone_hash: phoneHash,
        parsed_response: responseIntent,
        outcome: "clarify_prompted",
        idempotency_status: "first_run",
      },
    });
    return {
      engine: "contact_invite_response_handler",
      reply_message: CONTACT_INVITE_RESPONSE_CLARIFICATION_MESSAGE,
    };
  }

  if (responseIntent === "decline") {
    await transitionInvitationStatusIfPending({
      supabase: input.supabase,
      invitationId: invitation.id,
      status: "declined",
    });

    const declineAudit = await insertAuditLogRecord({
      supabase: input.supabase,
      action: "contact_invite_declined",
      targetType: "contact_invitation",
      targetId: invitation.id,
      reason: "contact_invite_declined",
      idempotencyKey: `contact_invite_response:declined:${invitation.id}`,
      payload: {
        invitation_id: invitation.id,
        inviter_user_id: invitation.inviter_user_id,
        invitee_phone_hash: phoneHash,
      },
    });

    await insertAuditLogRecord({
      supabase: input.supabase,
      action: "contact_invite_response_received",
      targetType: "contact_invitation",
      targetId: invitation.id,
      reason: "contact_invite_response_received",
      idempotencyKey: inboundAuditIdempotencyKey,
      payload: {
        invitation_id: invitation.id,
        inviter_user_id: invitation.inviter_user_id,
        invitee_phone_hash: phoneHash,
        parsed_response: responseIntent,
        outcome: "declined",
        idempotency_status: declineAudit === "inserted" ? "first_run" : "replay",
      },
    });

    return {
      engine: "contact_invite_response_handler",
      reply_message: declineAudit === "inserted"
        ? CONTACT_INVITE_DECLINE_CONFIRMATION_MESSAGE
        : null,
    };
  }

  await transitionInvitationStatusIfPending({
    supabase: input.supabase,
    invitationId: invitation.id,
    status: "accepted",
  });

  const user = await createOrReuseInvitedUser({
    supabase: input.supabase,
    phoneE164: input.payload.from_e164,
    phoneHash,
  });
  const profile = await createOrReuseInvitedProfile(input.supabase, user.id);
  const session = await createOrReuseInvitedSession(input.supabase, user.id);
  const inviterDisplayName = await fetchInviterDisplayName(
    input.supabase,
    invitation.inviter_user_id,
  );

  const acceptedAudit = await insertAuditLogRecord({
    supabase: input.supabase,
    action: "contact_invite_accepted",
    targetType: "contact_invitation",
    targetId: invitation.id,
    reason: "contact_invite_accepted",
    idempotencyKey: `contact_invite_response:accepted:${invitation.id}`,
    payload: {
      invitation_id: invitation.id,
      inviter_user_id: invitation.inviter_user_id,
      invitee_phone_hash: phoneHash,
      accepted_user_id: user.id,
      accepted_profile_id: profile.id,
      accepted_session_id: session.id,
      user_created: user.created,
      user_reused: !user.created,
      profile_created: profile.created,
      profile_reused: !profile.created,
      session_created: session.created,
      session_reused: !session.created,
      session_mode: session.mode,
      session_state_token: session.state_token,
      idempotency_status: "first_run",
    },
  });

  await insertAuditLogRecord({
    supabase: input.supabase,
    action: "contact_invite_response_received",
    targetType: "contact_invitation",
    targetId: invitation.id,
    reason: "contact_invite_response_received",
    idempotencyKey: inboundAuditIdempotencyKey,
    payload: {
      invitation_id: invitation.id,
      inviter_user_id: invitation.inviter_user_id,
      invitee_phone_hash: phoneHash,
      parsed_response: responseIntent,
      outcome: "accepted",
      accepted_user_id: user.id,
      accepted_profile_id: profile.id,
      accepted_session_id: session.id,
      user_created: user.created,
      user_reused: !user.created,
      profile_created: profile.created,
      profile_reused: !profile.created,
      session_created: session.created,
      session_reused: !session.created,
      session_mode: session.mode,
      session_state_token: session.state_token,
      idempotency_status: acceptedAudit === "inserted" ? "first_run" : "replay",
    },
  });

  return {
    engine: "contact_invite_response_handler",
    reply_message: acceptedAudit === "inserted"
      ? buildInvitedAbbreviatedWelcomeMessage(inviterDisplayName)
      : null,
  };
}

async function runInvitationResponseHandler(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  const parsedInvitationResponse = parseInvitationResponse(
    input.payload.body_raw,
    input.decision.state.state_token,
  );

  if (parsedInvitationResponse === "clarify") {
    const invitationDecision = handleInvitationResponse({
      message: input.payload.body_raw,
      stateToken: input.decision.state.state_token,
      invitation: null,
    });

    await persistConversationSessionState({
      supabase: input.supabase,
      userId: input.decision.user_id,
      mode: invitationDecision.nextMode,
      stateToken: invitationDecision.nextStateToken,
      lastInboundMessageSid: input.payload.inbound_message_sid,
    });

    return {
      engine: "invitation_response_handler",
      reply_message: invitationDecision.replyMessage,
    };
  }

  const nowIso = new Date().toISOString();
  const invitation = await fetchInvitationForInvitationResponse({
    supabase: input.supabase,
    userId: input.decision.user_id,
    action: parsedInvitationResponse,
    nowIso,
    inboundMessageSid: input.payload.inbound_message_sid,
  });
  const activityDisplayName = invitation && parsedInvitationResponse === "accept"
    ? await fetchActivityDisplayName(input.supabase, invitation.activity_key)
    : null;
  const resolvedDecision = handleInvitationResponse({
    message: input.payload.body_raw,
    stateToken: input.decision.state.state_token,
    invitation,
    activityDisplayName,
  });

  if (resolvedDecision.kind === "terminal") {
    await persistConversationSessionState({
      supabase: input.supabase,
      userId: input.decision.user_id,
      mode: resolvedDecision.nextMode,
      stateToken: resolvedDecision.nextStateToken,
      lastInboundMessageSid: input.payload.inbound_message_sid,
    });

    return {
      engine: "invitation_response_handler",
      reply_message: resolvedDecision.replyMessage,
    };
  }

  if (!invitation) {
    throw new ConversationRouterError(
      "INVITATION_LOOKUP_FAILED",
      "Invitation response handling could not resolve the target invitation.",
    );
  }

  if (typeof input.supabase.rpc !== "function") {
    throw new ConversationRouterError(
      "INVITATION_RESPONSE_MISCONFIGURED",
      "Router requires Supabase RPC support for invitation response handling.",
    );
  }

  const { data, error } = await input.supabase.rpc("apply_invitation_response", {
    p_invitation_id: invitation.id,
    p_user_id: input.decision.user_id,
    p_inbound_message_id: input.payload.inbound_message_id,
    p_inbound_message_sid: input.payload.inbound_message_sid,
    p_action: resolvedDecision.action,
    p_outbound_message: resolvedDecision.replyMessage,
    p_sms_encryption_key: requireSmsEncryptionKey(),
    p_now: nowIso,
  });

  if (error) {
    emitRpcFailureMetric({
      correlation_id: input.payload.inbound_message_id,
      component: "conversation_router",
      rpc_name: "apply_invitation_response",
    });
    throw new ConversationRouterError(
      "INVITATION_RESPONSE_FAILED",
      "Unable to apply invitation response.",
    );
  }

  const result = (Array.isArray(data) ? data[0] : data) as ApplyInvitationResponseRpcRow | null;
  if (!result) {
    throw new ConversationRouterError(
      "INVITATION_RESPONSE_INVALID_RESPONSE",
      "Invitation response RPC returned no result row.",
    );
  }

  const reason = typeof result.reason === "string" ? result.reason : "unknown";
  const processed = result.processed === true;
  const duplicate = result.duplicate === true;

  await maybeEvaluateAcceptedInvitationLinkupQuorum({
    invitation,
    action: resolvedDecision.action,
    processed,
  });

  if (processed || duplicate || reason === "message_sid_already_used") {
    return {
      engine: "invitation_response_handler",
      reply_message: null,
    };
  }

  const fallback = handleInvitationResponse({
    message: input.payload.body_raw,
    stateToken: INVITATION_RESPONSE_CLARIFIER_STATE_TOKEN,
    invitation: null,
  });

  return {
    engine: "invitation_response_handler",
    reply_message: fallback.kind === "terminal" ? fallback.replyMessage : null,
  };
}

async function fetchInvitationForContactInviteResponse(
  supabase: SupabaseClientLike,
  phoneHash: string,
): Promise<ContactInvitationResponseRow | null> {
  const { data, error } = await supabase
    .from("contact_invitations")
    .select("id,inviter_user_id,status,created_at")
    .eq("invitee_phone_hash", phoneHash)
    .in("status", ["pending", "accepted", "declined"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new ConversationRouterError(
      "INVITATION_LOOKUP_FAILED",
      "Unable to load invitation for contact invite response handling.",
    );
  }

  if (!data?.id || !data?.inviter_user_id || !data?.status) {
    return null;
  }

  return {
    id: data.id,
    inviter_user_id: data.inviter_user_id,
    status: data.status,
  };
}

async function transitionInvitationStatusIfPending(input: {
  supabase: SupabaseClientLike;
  invitationId: string;
  status: "accepted" | "declined";
}): Promise<void> {
  const { error: updateError } = await input.supabase
    .from("contact_invitations")
    .update({ status: input.status })
    .eq("id", input.invitationId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (updateError) {
    throw new ConversationRouterError(
      "INVITATION_UPDATE_FAILED",
      "Unable to persist contact invitation status transition.",
    );
  }
}

async function createOrReuseInvitedUser(input: {
  supabase: SupabaseClientLike;
  phoneE164: string;
  phoneHash: string;
}): Promise<{ id: string; created: boolean }> {
  const existingByHash = await fetchUserByPhoneHash(input.supabase, input.phoneHash);
  if (existingByHash?.id) {
    return {
      id: existingByHash.id,
      created: false,
    };
  }

  const existingByPhone = await fetchUserByPhone(input.supabase, input.phoneE164);
  if (existingByPhone?.id) {
    return {
      id: existingByPhone.id,
      created: false,
    };
  }

  const { data, error } = await input.supabase
    .from("users")
    .insert({
      phone_e164: input.phoneE164,
      phone_hash: input.phoneHash,
      first_name: "Invited",
      last_name: "User",
      birthday: "1970-01-01",
      email: null,
      state: "interviewing",
      sms_consent: true,
      age_consent: true,
      terms_consent: true,
      privacy_consent: true,
      region_id: null,
      deleted_at: null,
      registration_source: "contact_invitation",
    })
    .select("id")
    .single();

  if (error && isDuplicateKeyError(error)) {
    const duplicate = await fetchUserByPhoneHash(input.supabase, input.phoneHash) ||
      await fetchUserByPhone(input.supabase, input.phoneE164);
    if (duplicate?.id) {
      return {
        id: duplicate.id,
        created: false,
      };
    }
  }

  if (error || !data?.id) {
    throw new ConversationRouterError(
      "USER_CREATE_FAILED",
      "Unable to create invited user for contact invitation response.",
    );
  }

  return {
    id: data.id,
    created: true,
  };
}

async function fetchUserByPhoneHash(
  supabase: SupabaseClientLike,
  phoneHash: string,
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("phone_hash", phoneHash)
    .maybeSingle();

  if (error) {
    throw new ConversationRouterError(
      "USER_LOOKUP_FAILED",
      "Unable to load user record by phone hash.",
    );
  }

  if (!data?.id) {
    return null;
  }

  return { id: data.id };
}

async function createOrReuseInvitedProfile(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await fetchProfileIdByUserId(supabase, userId);
  if (existing?.id) {
    return {
      id: existing.id,
      created: false,
    };
  }

  const { data, error } = await supabase
    .from("profiles")
    .insert({
      user_id: userId,
      country_code: null,
      state_code: null,
      state: "empty",
      is_complete_mvp: false,
      preferences: {},
      coordination_dimensions: {},
      activity_patterns: [],
      boundaries: {},
      active_intent: null,
      completeness_percent: 0,
      status_reason: "invited_interview_pending",
      last_interview_step: null,
      completed_at: null,
      state_changed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error && isDuplicateKeyError(error)) {
    const duplicate = await fetchProfileIdByUserId(supabase, userId);
    if (duplicate?.id) {
      return {
        id: duplicate.id,
        created: false,
      };
    }
  }

  if (error || !data?.id) {
    throw new ConversationRouterError(
      "PROFILE_CREATE_FAILED",
      "Unable to create invited profile for contact invitation response.",
    );
  }

  return {
    id: data.id,
    created: true,
  };
}

async function fetchProfileIdByUserId(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new ConversationRouterError(
      "PROFILE_LOOKUP_FAILED",
      "Unable to load profile for contact invite response handling.",
    );
  }

  if (!data?.id) {
    return null;
  }

  return { id: data.id };
}

async function createOrReuseInvitedSession(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<{ id: string; mode: string; state_token: string; created: boolean }> {
  const existing = await fetchConversationSession(supabase, userId);
  if (existing?.id) {
    if (existing.mode === INVITED_ABBREVIATED_MODE && existing.state_token) {
      return {
        id: existing.id,
        mode: existing.mode,
        state_token: existing.state_token,
        created: false,
      };
    }

    const { data, error } = await supabase
      .from("conversation_sessions")
      .update({
        mode: INVITED_ABBREVIATED_MODE,
        state_token: INVITED_ABBREVIATED_STATE_TOKEN,
      })
      .eq("id", existing.id)
      .select("id,mode,state_token")
      .maybeSingle();

    if (error || !data?.id || !data?.mode || !data?.state_token) {
      throw new ConversationRouterError(
        "STATE_UPDATE_FAILED",
        "Unable to update invited conversation session state.",
      );
    }

    return {
      id: data.id,
      mode: data.mode,
      state_token: data.state_token,
      created: false,
    };
  }

  const { data, error } = await supabase
    .from("conversation_sessions")
    .insert({
      user_id: userId,
      mode: INVITED_ABBREVIATED_MODE,
      state_token: INVITED_ABBREVIATED_STATE_TOKEN,
      current_step_id: null,
      last_inbound_message_sid: null,
    })
    .select("id,mode,state_token")
    .single();

  if (error && isDuplicateKeyError(error)) {
    const duplicate = await fetchConversationSession(supabase, userId);
    if (duplicate?.id) {
      return {
        id: duplicate.id,
        mode: duplicate.mode ?? INVITED_ABBREVIATED_MODE,
        state_token: duplicate.state_token ?? INVITED_ABBREVIATED_STATE_TOKEN,
        created: false,
      };
    }
  }

  if (error || !data?.id || !data?.mode || !data?.state_token) {
    throw new ConversationRouterError(
      "STATE_CREATE_FAILED",
      "Unable to create invited conversation session.",
    );
  }

  return {
    id: data.id,
    mode: data.mode,
    state_token: data.state_token,
    created: true,
  };
}

async function insertAuditLogRecord(input: {
  supabase: SupabaseClientLike;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<"inserted" | "duplicate"> {
  const { error } = await input.supabase
    .from("audit_log")
    .insert({
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      reason: input.reason,
      payload: input.payload,
      idempotency_key: input.idempotencyKey,
      correlation_id: input.targetId,
    });

  if (error && isDuplicateKeyError(error)) {
    return "duplicate";
  }

  if (error) {
    throw new ConversationRouterError(
      "AUDIT_LOG_FAILED",
      `Unable to persist '${input.action}' audit event.`,
    );
  }

  return "inserted";
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
    .select("id,mode,state_token,linkup_id,last_inbound_message_sid")
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
    last_inbound_message_sid: data.last_inbound_message_sid ?? null,
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
    .select("id,mode,state_token,linkup_id,last_inbound_message_sid")
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
    last_inbound_message_sid: data.last_inbound_message_sid ?? null,
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

async function fetchAbbreviatedInterviewSession(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<AbbreviatedInterviewSessionRow | null> {
  const { data, error } = await supabase
    .from("conversation_sessions")
    .select("id,mode,state_token,current_step_id,last_inbound_message_sid")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new ConversationRouterError(
      "STATE_LOOKUP_FAILED",
      "Unable to load conversation session for abbreviated interview handling.",
    );
  }

  if (!data?.id || !data.mode || !data.state_token) {
    return null;
  }

  return {
    id: data.id,
    mode: data.mode,
    state_token: data.state_token,
    current_step_id: data.current_step_id ?? null,
    last_inbound_message_sid: data.last_inbound_message_sid ?? null,
  };
}

async function fetchAbbreviatedInterviewProfile(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<AbbreviatedInterviewProfileRow | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      [
        "id",
        "user_id",
        "state",
        "is_complete_mvp",
        "country_code",
        "state_code",
        "last_interview_step",
        "preferences",
        "coordination_dimensions",
        "activity_patterns",
        "boundaries",
        "active_intent",
        "scheduling_availability",
        "notice_preference",
        "coordination_style",
        "completeness_percent",
        "completed_at",
        "status_reason",
        "state_changed_at",
      ].join(","),
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new ConversationRouterError(
      "PROFILE_LOOKUP_FAILED",
      "Unable to load profile for abbreviated interview handling.",
    );
  }

  if (!data?.id || !data.user_id || !data.state) {
    return null;
  }

  return {
    id: data.id,
    user_id: data.user_id,
    state: data.state,
    is_complete_mvp: data.is_complete_mvp ?? false,
    country_code: data.country_code ?? null,
    state_code: data.state_code ?? null,
    last_interview_step: data.last_interview_step ?? null,
    preferences: data.preferences ?? {},
    coordination_dimensions: data.coordination_dimensions ?? {},
    activity_patterns: data.activity_patterns ?? [],
    boundaries: data.boundaries ?? {},
    active_intent: data.active_intent ?? null,
    scheduling_availability: data.scheduling_availability ?? null,
    notice_preference: data.notice_preference ?? null,
    coordination_style: data.coordination_style ?? null,
    completeness_percent: typeof data.completeness_percent === "number" ? data.completeness_percent : 0,
    completed_at: data.completed_at ?? null,
    status_reason: data.status_reason ?? null,
    state_changed_at: data.state_changed_at ?? new Date(0).toISOString(),
  };
}

async function persistAbbreviatedInterviewProfilePatch(input: {
  supabase: SupabaseClientLike;
  profileId: string;
  patch: AbbreviatedInterviewProfilePatch;
}): Promise<void> {
  const { error } = await input.supabase
    .from("profiles")
    .update(input.patch)
    .eq("id", input.profileId)
    .select("id")
    .single();

  if (error) {
    throw new ConversationRouterError(
      "PROFILE_UPDATE_FAILED",
      "Unable to persist abbreviated interview profile patch.",
    );
  }
}

async function persistAbbreviatedInterviewSessionPatch(input: {
  supabase: SupabaseClientLike;
  sessionId: string;
  patch: AbbreviatedInterviewSessionPatch;
}): Promise<void> {
  const { error } = await input.supabase
    .from("conversation_sessions")
    .update({
      mode: input.patch.mode,
      state_token: input.patch.state_token,
      current_step_id: input.patch.current_step_id,
      last_inbound_message_sid: input.patch.last_inbound_message_sid,
    })
    .eq("id", input.sessionId)
    .select("id")
    .single();

  if (error) {
    throw new ConversationRouterError(
      "STATE_UPDATE_FAILED",
      "Unable to persist abbreviated interview session patch.",
    );
  }
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

  if (
    profile.state === "complete_invited" ||
    profile.state === "complete_mvp" ||
    profile.state === "complete_full"
  ) {
    return false;
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

async function runRetiredIntentFallback(
  input: EngineDispatchInput,
  handlerRoute: Extract<
    RouterRoute,
    "open_intent_handler" | "named_plan_request_handler" | "plan_social_choice_handler"
  >,
): Promise<EngineDispatchResult> {
  await persistConversationSessionState({
    supabase: input.supabase,
    userId: input.decision.user_id,
    mode: "idle",
    stateToken: "idle",
  });

  return {
    engine: handlerRoute,
    reply_message: systemUnknownIntentResponse(),
  };
}

async function runOpenIntentHandler(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  return runRetiredIntentFallback(input, "open_intent_handler");
}

async function runPlanSocialChoiceHandler(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  return runRetiredIntentFallback(input, "plan_social_choice_handler");
}

async function runInterviewAnswerAbbreviatedHandler(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  const session = await fetchAbbreviatedInterviewSession(input.supabase, input.decision.user_id);
  if (!session) {
    return {
      engine: "interview_answer_abbreviated_handler",
      reply_message: null,
    };
  }

  if (session.mode !== INVITED_ABBREVIATED_MODE && session.mode !== "idle") {
    throw new ConversationRouterError(
      "INVALID_STATE",
      `Abbreviated interview handler received unsupported mode '${session.mode}'.`,
    );
  }

  const profile = await fetchAbbreviatedInterviewProfile(input.supabase, input.decision.user_id);
  if (!profile) {
    throw new ConversationRouterError(
      "PROFILE_LOOKUP_FAILED",
      "Unable to load profile for abbreviated interview handling.",
    );
  }

  const phoneHash = input.payload.from_phone_hash?.trim() ||
    await sha256Hex(input.payload.from_e164);
  const invitation = await fetchInvitationForContactInviteResponse(input.supabase, phoneHash);
  const inviterDisplayName = invitation
    ? await fetchInviterDisplayName(input.supabase, invitation.inviter_user_id)
    : "A friend";
  const nowIso = new Date().toISOString();

  const transition = await handleInterviewAnswerAbbreviated({
    message: input.payload.body_raw,
    inboundMessageSid: input.payload.inbound_message_sid,
    inviterName: inviterDisplayName,
    nowIso,
    session,
    profile,
  });

  if (transition.profilePatch) {
    await persistAbbreviatedInterviewProfilePatch({
      supabase: input.supabase,
      profileId: profile.id,
      patch: transition.profilePatch,
    });
  }

  if (transition.sessionPatch) {
    await persistAbbreviatedInterviewSessionPatch({
      supabase: input.supabase,
      sessionId: session.id,
      patch: transition.sessionPatch,
    });
  }

  await insertAuditLogRecord({
    supabase: input.supabase,
    action: "interview_abbreviated_answer_processed",
    targetType: "profile",
    targetId: profile.id,
    reason: "interview_abbreviated_answer_processed",
    idempotencyKey: `interview_abbreviated:processed:${session.id}:${input.payload.inbound_message_sid}`,
    payload: {
      profile_id: profile.id,
      session_id: session.id,
      updated_dimension_keys: transition.updatedDimensionKeys,
      updated_signal_keys: transition.updatedSignalKeys,
      completion_snapshot: transition.completionSnapshot,
      idempotency_status: transition.replayed ? "replay" : "first_run",
    },
  });

  if (!transition.completed && !transition.replayed) {
    await insertAuditLogRecord({
      supabase: input.supabase,
      action: "interview_abbreviated_progress_updated",
      targetType: "profile",
      targetId: profile.id,
      reason: "interview_abbreviated_progress_updated",
      idempotencyKey: `interview_abbreviated:progress:${session.id}:${input.payload.inbound_message_sid}`,
      payload: {
        profile_id: profile.id,
        session_id: session.id,
        updated_dimension_keys: transition.updatedDimensionKeys,
        updated_signal_keys: transition.updatedSignalKeys,
        completion_snapshot: transition.completionSnapshot,
        idempotency_status: "first_run",
      },
    });
  }

  let completionAuditStatus: "inserted" | "duplicate" | null = null;
  if (transition.completed) {
    completionAuditStatus = await insertAuditLogRecord({
      supabase: input.supabase,
      action: "interview_abbreviated_completed",
      targetType: "profile",
      targetId: profile.id,
      reason: "interview_abbreviated_completed",
      idempotencyKey: `interview_abbreviated:completed:${profile.id}`,
      payload: {
        profile_id: profile.id,
        session_id: session.id,
        updated_dimension_keys: transition.updatedDimensionKeys,
        updated_signal_keys: transition.updatedSignalKeys,
        completion_snapshot: transition.completionSnapshot,
        idempotency_status: transition.completedNow ? "first_run" : "replay",
      },
    });
  }

  const replyMessage = transition.completed
    ? (transition.completedNow && completionAuditStatus === "inserted"
      ? transition.replyMessage
      : null)
    : transition.replyMessage;

  return {
    engine: "interview_answer_abbreviated_handler",
    reply_message: replyMessage,
  };
}

async function runPostActivityCheckinHandler(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  let replyMessage: string | null = null;

  await handlePostActivityCheckin(
    input.decision.user_id,
    input.payload.body_raw,
    {
      mode: "post_activity_checkin",
      state_token: input.decision.state.state_token,
      has_user_record: true,
      has_pending_contact_invitation: false,
      is_unknown_number_with_pending_invitation: false,
    },
    input.payload.inbound_message_id,
    {
      fetchCheckinActivityKey: async () => null,
      insertLearningSignal: async (signal) => {
        const { error } = await input.supabase.from("learning_signals").insert(signal);
        return {
          error: error
            ? {
              code: typeof error.code === "string" ? error.code : undefined,
              message: error.message,
            }
            : null,
        };
      },
      updateConversationSession: async ({ userId, mode, state_token, updated_at }) => {
        await persistConversationSessionState({
          supabase: input.supabase,
          userId,
          mode,
          stateToken: state_token,
          updatedAt: updated_at,
        });
      },
      sendSms: async ({ body }) => {
        replyMessage = body;
      },
      log: ({ level, event, payload }) => {
        logEvent({
          level,
          event,
          user_id: input.decision.user_id,
          correlation_id: input.payload.inbound_message_id,
          payload: {
            route: "post_activity_checkin_handler",
            session_mode: input.decision.state.mode,
            session_state_token: input.decision.state.state_token,
            ...payload,
          },
        });
      },
    },
  );

  return {
    engine: "post_activity_checkin_handler",
    reply_message: replyMessage,
  };
}

async function runFreeformInboundHandler(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  const nowIso = new Date().toISOString();
  const profile = await fetchFreeformProfile(input.supabase, input.decision.user_id);
  const result = await handleFreeformInbound({
    messageText: input.payload.body_raw,
    correlationId: input.payload.inbound_message_id,
    nowIso,
    profile,
  });

  switch (result.kind) {
    case "availability_signal": {
      await insertFreeformAvailabilitySignal({
        supabase: input.supabase,
        userId: input.decision.user_id,
        inboundMessageSid: input.payload.inbound_message_sid,
        correlationId: input.payload.inbound_message_id,
        rawMessage: input.payload.body_raw,
        summary: result.summary,
        nowIso,
      });
      await persistConversationSessionState({
        supabase: input.supabase,
        userId: input.decision.user_id,
        mode: "idle",
        stateToken: "idle",
        updatedAt: nowIso,
      });
      return {
        engine: "freeform_inbound_handler",
        reply_message: result.replyMessage,
      };
    }
    case "post_event_signal": {
      const invitation = await fetchRecentAcceptedInvitation(input.supabase, input.decision.user_id, nowIso);
      if (!invitation) {
        await persistConversationSessionState({
          supabase: input.supabase,
          userId: input.decision.user_id,
          mode: "idle",
          stateToken: "idle",
          updatedAt: nowIso,
        });
        return {
          engine: "freeform_inbound_handler",
          reply_message:
            "JOSH handles plans and invitations over text — no app needed. JOSH will be in touch with something tailored to you. Reply HELP for options.",
        };
      }

      let replyMessage: string | null = null;
      const synthesizedStateToken = `checkin:awaiting_attendance:${invitation.id}`;
      await handlePostActivityCheckin(
        input.decision.user_id,
        input.payload.body_raw,
        {
          mode: "post_activity_checkin",
          state_token: synthesizedStateToken,
          has_user_record: true,
          has_pending_contact_invitation: false,
          is_unknown_number_with_pending_invitation: false,
        },
        input.payload.inbound_message_id,
        {
          fetchCheckinActivityKey: async () => invitation.activity_key,
          insertLearningSignal: async (signal) => {
            const { error } = await input.supabase.from("learning_signals").insert(signal);
            return {
              error: error
                ? {
                  code: typeof error.code === "string" ? error.code : undefined,
                  message: error.message,
                }
                : null,
            };
          },
          updateConversationSession: async ({ userId, mode, state_token, updated_at }) => {
            await persistConversationSessionState({
              supabase: input.supabase,
              userId,
              mode,
              stateToken: state_token,
              updatedAt: updated_at,
            });
          },
          sendSms: async ({ body }) => {
            replyMessage = body;
          },
          log: ({ level, event, payload }) => {
            logEvent({
              level,
              event,
              user_id: input.decision.user_id,
              correlation_id: input.payload.inbound_message_id,
              payload: {
                route: "post_activity_checkin_handler",
                session_mode: "post_activity_checkin",
                session_state_token: synthesizedStateToken,
                ...payload,
              },
            });
          },
        },
      );

      return {
        engine: "freeform_inbound_handler",
        reply_message: replyMessage,
      };
    }
    case "preference_update": {
      if (profile?.id && result.profilePatch && result.profileEvent) {
        const { error: updateProfileError } = await input.supabase
          .from("profiles")
          .update(result.profilePatch)
          .eq("id", profile.id);

        if (updateProfileError) {
          throw new ConversationRouterError(
            "PROFILE_UPDATE_FAILED",
            "Unable to persist freeform preference update.",
          );
        }

        const { error: profileEventError } = await input.supabase
          .from("profile_events")
          .insert({
            profile_id: profile.id,
            user_id: input.decision.user_id,
            event_type: result.profileEvent.eventType,
            source: "handle_freeform_inbound_handler",
            step_id: null,
            payload: result.profileEvent.payload,
            idempotency_key:
              `profile_event:freeform_preference:${input.decision.user_id}:${input.payload.inbound_message_sid}`,
            correlation_id: input.payload.inbound_message_id,
          });

        if (profileEventError && !isDuplicateKeyError(profileEventError)) {
          throw new ConversationRouterError(
            "PROFILE_EVENT_WRITE_FAILED",
            "Unable to persist freeform preference event.",
          );
        }
      }

      await persistConversationSessionState({
        supabase: input.supabase,
        userId: input.decision.user_id,
        mode: "idle",
        stateToken: "idle",
        updatedAt: nowIso,
      });
      return {
        engine: "freeform_inbound_handler",
        reply_message: result.replyMessage,
      };
    }
    case "general_freeform":
    default:
      await persistConversationSessionState({
        supabase: input.supabase,
        userId: input.decision.user_id,
        mode: "idle",
        stateToken: "idle",
        updatedAt: nowIso,
      });
      return {
        engine: "freeform_inbound_handler",
        reply_message: result.replyMessage,
      };
  }
}

async function runNamedPlanRequestHandler(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  const pendingInviteConfirmation = parseInviteConfirmationState(input.decision.state);
  if (!pendingInviteConfirmation) {
    return runRetiredIntentFallback(input, "named_plan_request_handler");
  }

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

async function fetchFreeformProfile(
  supabase: SupabaseClientLike,
  userId: string,
): Promise<FreeformProfileRow | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, user_id, state, is_complete_mvp, country_code, state_code, last_interview_step, preferences, coordination_dimensions, activity_patterns, boundaries, active_intent, scheduling_availability, notice_preference, coordination_style, completeness_percent, completed_at, status_reason, state_changed_at",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new ConversationRouterError(
      "PROFILE_LOOKUP_FAILED",
      "Unable to load profile for freeform inbound handling.",
    );
  }

  return data as FreeformProfileRow | null;
}

async function fetchRecentAcceptedInvitation(
  supabase: SupabaseClientLike,
  userId: string,
  nowIso: string,
): Promise<RecentAcceptedInvitationRow | null> {
  const cutoff = new Date(new Date(nowIso).getTime() - (7 * 24 * 60 * 60 * 1000)).toISOString();
  const { data, error } = await supabase
    .from("invitations")
    .select("id, activity_key, responded_at")
    .eq("user_id", userId)
    .eq("state", "accepted")
    .gte("responded_at", cutoff)
    .order("responded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new ConversationRouterError(
      "INVITATION_LOOKUP_FAILED",
      "Unable to load recent invitation for freeform inbound handling.",
    );
  }

  return data as RecentAcceptedInvitationRow | null;
}

async function insertFreeformAvailabilitySignal(input: {
  supabase: SupabaseClientLike;
  userId: string;
  inboundMessageSid: string;
  correlationId: string;
  rawMessage: string;
  summary: string;
  nowIso: string;
}): Promise<void> {
  const { error } = await input.supabase
    .from("learning_signals")
    .insert({
      id: crypto.randomUUID(),
      user_id: input.userId,
      signal_type: "availability_expressed",
      value_text: input.summary,
      meta: {
        summary: input.summary,
        raw_message: input.rawMessage,
        correlation_id: input.correlationId,
      },
      occurred_at: input.nowIso,
      ingested_at: input.nowIso,
      idempotency_key: `ls:freeform_availability:${input.userId}:${input.inboundMessageSid}`,
    });

  if (error && !isDuplicateKeyError(error)) {
    throw new ConversationRouterError(
      "LEARNING_SIGNAL_WRITE_FAILED",
      "Unable to persist freeform availability signal.",
    );
  }
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
  if (state.mode !== "pending_contact_invite_confirmation") {
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

export function parseContactInviteResponseIntent(
  message: string,
): ContactInviteResponseIntent {
  const normalized = normalizeIntentText(message);
  if (!normalized) {
    return "unknown";
  }
  if (CONTACT_INVITE_ACCEPT_EXACT_MATCHES.has(normalized)) {
    return "accept";
  }
  if (CONTACT_INVITE_DECLINE_EXACT_MATCHES.has(normalized)) {
    return "decline";
  }

  const tokens = normalized.split(" ").filter(Boolean);
  let sawAccept = false;
  let sawDecline = false;
  for (const token of tokens) {
    if (CONTACT_INVITE_ACCEPT_EXACT_MATCHES.has(token)) {
      sawAccept = true;
    }
    if (CONTACT_INVITE_DECLINE_EXACT_MATCHES.has(token)) {
      sawDecline = true;
    }
  }

  if (sawAccept && !sawDecline) {
    return "accept";
  }
  if (sawDecline && !sawAccept) {
    return "decline";
  }
  return "unknown";
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

async function persistConversationSessionState(input: {
  supabase: SupabaseClientLike;
  userId: string;
  mode:
    | "idle"
    | "awaiting_invitation_response"
    | "post_activity_checkin"
    | "awaiting_social_choice"
    | "pending_plan_confirmation"
    | "pending_contact_invite_confirmation";
  stateToken: string;
  updatedAt?: string;
  lastInboundMessageSid?: string;
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
      ...(input.lastInboundMessageSid
        ? { last_inbound_message_sid: input.lastInboundMessageSid }
        : {}),
      ...(input.updatedAt ? { updated_at: input.updatedAt } : {}),
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
