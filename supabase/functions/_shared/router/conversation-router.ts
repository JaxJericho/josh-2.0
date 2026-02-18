// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { runDefaultEngine } from "../engines/default-engine.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { runProfileInterviewEngine } from "../engines/profile-interview-engine.ts";

export type ConversationMode =
  | "idle"
  | "interviewing"
  | "linkup_forming"
  | "awaiting_invite_reply"
  | "safety_hold";

export type RouterRoute = "profile_interview_engine" | "default_engine";

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
  reply_message: string;
};

type SupabaseClientLike = {
  from: (table: string) => any;
};

type ConversationSessionRow = {
  id: string;
  mode: string | null;
  state_token: string | null;
};

type ProfileSummary = {
  is_complete_mvp: boolean;
  state: string | null;
};

const ONBOARDING_MODE: ConversationMode = "interviewing";
const ONBOARDING_STATE_TOKEN = "onboarding:awaiting_opening_response";
const ONBOARDING_STATE_TOKENS = [
  "onboarding:awaiting_opening_response",
  "onboarding:awaiting_explanation_response",
  "onboarding:awaiting_interview_start",
] as const;
type OnboardingStateToken = (typeof ONBOARDING_STATE_TOKENS)[number];
type InterviewingStateTokenKind = "onboarding" | "interview";

const ONBOARDING_STATE_TOKEN_SET: ReadonlySet<OnboardingStateToken> = new Set(
  ONBOARDING_STATE_TOKENS,
);
const INTERVIEW_TOKEN_PATTERN = /^interview:[a-z0-9_]+$/;
const ONBOARDING_TOKEN_PATTERN = /^onboarding:[a-z_]+$/;

const CONVERSATION_MODES: readonly ConversationMode[] = [
  "idle",
  "interviewing",
  "linkup_forming",
  "awaiting_invite_reply",
  "safety_hold",
];

const VALID_MODES: ReadonlySet<ConversationMode> = new Set(CONVERSATION_MODES);

const STATE_TOKEN_PATTERN_BY_MODE: Record<ConversationMode, RegExp> = {
  idle: /^idle$/,
  interviewing: /^[a-z0-9:_-]+$/i,
  linkup_forming: /^[a-z0-9:_-]+$/i,
  awaiting_invite_reply: /^[a-z0-9:_-]+$/i,
  safety_hold: /^[a-z0-9:_-]+$/i,
};

const ROUTE_BY_MODE: Record<ConversationMode, RouterRoute> = {
  idle: "default_engine",
  interviewing: "profile_interview_engine",
  linkup_forming: "default_engine",
  awaiting_invite_reply: "default_engine",
  safety_hold: "default_engine",
};

const NEXT_TRANSITION_BY_MODE: Record<ConversationMode, string> = {
  idle: "idle:awaiting_user_input",
  interviewing: "interview:awaiting_next_input",
  linkup_forming: "linkup:awaiting_details",
  awaiting_invite_reply: "invite:awaiting_reply",
  safety_hold: "safety:hold_enforced",
};

const LEGAL_TRANSITIONS_BY_MODE: Record<ConversationMode, ReadonlySet<string>> = {
  idle: new Set(["idle:awaiting_user_input", ONBOARDING_STATE_TOKEN]),
  interviewing: new Set(["interview:awaiting_next_input", ...ONBOARDING_STATE_TOKENS]),
  linkup_forming: new Set(["linkup:awaiting_details"]),
  awaiting_invite_reply: new Set(["invite:awaiting_reply"]),
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
  },
): Promise<RoutingDecision> {
  const user = await fetchUserByPhone(params.supabase, params.payload.from_e164);
  if (!user) {
    throw new ConversationRouterError(
      "MISSING_USER_STATE",
      "No user record found for inbound message."
    );
  }

  const session = await fetchOrCreateConversationSession(params.supabase, user.id);
  let state = validateConversationState(session.mode, session.state_token);
  const profile = await fetchProfileSummary(params.supabase, user.id);
  const shouldForceInterview = shouldRouteIdleUserToInterview(state, profile);

  if (shouldForceInterview) {
    const promotedSession = await promoteConversationSessionForOnboarding(
      params.supabase,
      session.id,
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
    ? "profile_interview_engine"
    : resolveRouteForState(state);
  const nextTransition = shouldForceInterview
    ? ONBOARDING_STATE_TOKEN
    : resolveNextTransition(state, route);

  const decision: RoutingDecision = {
    user_id: user.id,
    state,
    profile_is_complete_mvp: profile?.is_complete_mvp ?? null,
    route,
    safety_override_applied: params.safetyOverrideApplied ?? false,
    next_transition: nextTransition,
  };

  console.info("conversation_router.decision", {
    inbound_message_id: params.payload.inbound_message_id,
    user_id: decision.user_id,
    session_mode: decision.state.mode,
    session_state_token: decision.state.state_token,
    profile_is_complete_mvp: decision.profile_is_complete_mvp,
    routing_decision: {
      route: decision.route,
      next_transition: decision.next_transition,
    },
    override_flag: decision.safety_override_applied,
  });

  return decision;
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
  const expectedRoute = ROUTE_BY_MODE[state.mode];
  if (route !== expectedRoute) {
    throw new ConversationRouterError(
      "ILLEGAL_TRANSITION_ATTEMPT",
      `Illegal transition attempt from mode '${state.mode}' via route '${route}'.`
    );
  }

  const nextTransition = state.mode === "interviewing" &&
      classifyInterviewingStateToken(state.state_token) === "onboarding"
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
  // Stub for the dedicated onboarding handler; onboarding currently dispatches
  // through the interview engine until onboarding delivery is implemented.
  return "profile_interview_engine";
}

function resolveInterviewRoute(_stateToken: string): RouterRoute {
  return "profile_interview_engine";
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

export async function dispatchConversationRoute(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  switch (input.decision.route) {
    case "profile_interview_engine": {
      try {
        const result = await runProfileInterviewEngine(input);
        assertDispatchedEngineMatchesRoute(input.decision.route, result.engine);
        return result;
      } catch (error) {
        const err = error as Error;
        console.error("conversation_router.dispatch_failed", {
          user_id: input.decision.user_id,
          route: input.decision.route,
          session_mode: input.decision.state.mode,
          session_state_token: input.decision.state.state_token,
          name: err?.name ?? "Error",
          message: err?.message ?? String(error),
        });
        throw error;
      }
    }
    case "default_engine": {
      const result = await runDefaultEngine(input);
      assertDispatchedEngineMatchesRoute(input.decision.route, result.engine);
      return result;
    }
    default:
      throw new ConversationRouterError(
        "INVALID_ROUTE",
        `Unsupported route '${input.decision.route}'.`
      );
  }
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
    .select("id,mode,state_token")
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
    .select("id,mode,state_token")
    .single();

  if (error || !data?.id) {
    throw new ConversationRouterError(
      "STATE_CREATE_FAILED",
      "Unable to create default conversation state for routing."
    );
  }

  return {
    id: data.id,
    mode: data.mode ?? null,
    state_token: data.state_token ?? null,
  };
}

async function promoteConversationSessionForOnboarding(
  supabase: SupabaseClientLike,
  sessionId: string,
): Promise<{ mode: string | null; state_token: string | null }> {
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

function isConversationMode(value: string): value is ConversationMode {
  return VALID_MODES.has(value as ConversationMode);
}
