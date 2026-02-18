// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { buildInterviewTransitionPlan, type ConversationMode, type InterviewSessionSnapshot } from "../../../../packages/core/src/interview/state.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import type { ProfileRowForInterview, ProfileState } from "../../../../packages/core/src/profile/profile-writer.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { recomputeProfileSignals } from "../../../../packages/core/src/compatibility/compatibility-signal-writer.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { resolveRegionAssignment } from "../../../../packages/core/src/regions/assignment.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { createSupabaseEntitlementsRepository, evaluateEntitlements } from "../../../../packages/core/src/entitlements/evaluate-entitlements.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { enforceWaitlistGate, SAFETY_HOLD_MESSAGE } from "../waitlist/waitlist-operations.ts";
import type {
  EngineDispatchInput,
  EngineDispatchResult,
} from "../router/conversation-router.ts";

type ConversationSessionRow = {
  id: string;
  mode: string;
  state_token: string;
  current_step_id: string | null;
  last_inbound_message_sid: string | null;
};

type ProfileRow = {
  id: string;
  user_id: string;
  country_code: string | null;
  state_code: string | null;
  state: string;
  is_complete_mvp: boolean;
  last_interview_step: string | null;
  preferences: unknown;
  fingerprint: unknown;
  activity_patterns: unknown;
  boundaries: unknown;
  active_intent: unknown;
  completeness_percent: number;
  completed_at: string | null;
  status_reason: string | null;
  state_changed_at: string;
  updated_at: string;
};

const VALID_CONVERSATION_MODES: ReadonlySet<ConversationMode> = new Set([
  "idle",
  "interviewing",
  "linkup_forming",
  "awaiting_invite_reply",
  "safety_hold",
]) as ReadonlySet<ConversationMode>;

const VALID_PROFILE_STATES: ReadonlySet<ProfileState> = new Set([
  "empty",
  "partial",
  "complete_mvp",
  "complete_full",
  "stale",
]) as ReadonlySet<ProfileState>;

function normalizeConversationMode(modeRaw: string): ConversationMode {
  if (!VALID_CONVERSATION_MODES.has(modeRaw as ConversationMode)) {
    throw new Error(`Invalid conversation mode '${modeRaw}' for interview engine.`);
  }
  return modeRaw as ConversationMode;
}

function normalizeProfileState(stateRaw: string): ProfileState {
  if (!VALID_PROFILE_STATES.has(stateRaw as ProfileState)) {
    throw new Error(`Invalid profile state '${stateRaw}' for interview engine.`);
  }
  return stateRaw as ProfileState;
}

function toInterviewSessionSnapshot(row: ConversationSessionRow): InterviewSessionSnapshot {
  return {
    mode: normalizeConversationMode(row.mode),
    state_token: row.state_token,
    current_step_id: row.current_step_id,
    last_inbound_message_sid: row.last_inbound_message_sid,
  };
}

function toProfileRowForInterview(row: ProfileRow): ProfileRowForInterview {
  return {
    id: row.id,
    user_id: row.user_id,
    country_code: row.country_code,
    state_code: row.state_code,
    state: normalizeProfileState(row.state),
    is_complete_mvp: row.is_complete_mvp,
    last_interview_step: row.last_interview_step,
    preferences: row.preferences,
    fingerprint: row.fingerprint,
    activity_patterns: row.activity_patterns,
    boundaries: row.boundaries,
    active_intent: row.active_intent,
    completeness_percent: row.completeness_percent,
    completed_at: row.completed_at,
    status_reason: row.status_reason,
    state_changed_at: row.state_changed_at,
  };
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

export async function runProfileInterviewEngine(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  const nowIso = new Date().toISOString();

  const session = await fetchOrCreateConversationSession(
    input.supabase,
    input.decision.user_id,
    input.decision.state.mode,
    input.decision.state.state_token,
  );

  const profile = await fetchOrCreateProfile(input.supabase, input.decision.user_id);
  const entitlementEvaluation = await evaluateEntitlements({
    profile_id: profile.id,
    repository: createSupabaseEntitlementsRepository(input.supabase),
  });

  if (entitlementEvaluation.blocked_by_safety_hold) {
    return {
      engine: "profile_interview_engine",
      reply_message: SAFETY_HOLD_MESSAGE,
    };
  }

  const transition = await buildInterviewTransitionPlan({
    inbound_message_sid: input.payload.inbound_message_sid,
    inbound_message_text: input.payload.body_raw,
    now_iso: nowIso,
    session: toInterviewSessionSnapshot(session),
    profile: toProfileRowForInterview(profile),
  });

  const persistResult = await persistInterviewTransition({
    supabase: input.supabase,
    userId: input.decision.user_id,
    inboundMessageSid: input.payload.inbound_message_sid,
    inboundMessageId: input.payload.inbound_message_id,
    session,
    profile,
    transition,
  });

  return {
    engine: "profile_interview_engine",
    reply_message: persistResult.reply_message_override ?? transition.reply_message,
  };
}

async function fetchOrCreateConversationSession(
  supabase: EngineDispatchInput["supabase"],
  userId: string,
  fallbackMode: ConversationMode,
  fallbackStateToken: string,
): Promise<ConversationSessionRow> {
  const { data: existing, error } = await supabase
    .from("conversation_sessions")
    .select("id,mode,state_token,current_step_id,last_inbound_message_sid")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to load conversation session for interview engine.");
  }

  if (existing?.id) {
    return {
      id: existing.id,
      mode: existing.mode,
      state_token: existing.state_token,
      current_step_id: existing.current_step_id ?? null,
      last_inbound_message_sid: existing.last_inbound_message_sid ?? null,
    };
  }

  const { data: created, error: createError } = await supabase
    .from("conversation_sessions")
    .insert({
      user_id: userId,
      mode: fallbackMode,
      state_token: fallbackStateToken,
      current_step_id: null,
      last_inbound_message_sid: null,
    })
    .select("id,mode,state_token,current_step_id,last_inbound_message_sid")
    .single();

  if (createError || !created?.id) {
    throw new Error("Unable to create conversation session for interview engine.");
  }

  return {
    id: created.id,
    mode: created.mode,
    state_token: created.state_token,
    current_step_id: created.current_step_id ?? null,
    last_inbound_message_sid: created.last_inbound_message_sid ?? null,
  };
}

async function fetchOrCreateProfile(
  supabase: EngineDispatchInput["supabase"],
  userId: string,
): Promise<ProfileRow> {
  const selectColumns =
    "id,user_id,country_code,state_code,state,is_complete_mvp,last_interview_step,preferences,fingerprint,activity_patterns,boundaries,active_intent,completeness_percent,completed_at,status_reason,state_changed_at,updated_at";

  const { data: existing, error } = await supabase
    .from("profiles")
    .select(selectColumns)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to load profile for interview engine.");
  }

  if (existing?.id) {
    return {
      id: existing.id,
      user_id: existing.user_id,
      country_code: existing.country_code ?? null,
      state_code: existing.state_code ?? null,
      state: existing.state,
      is_complete_mvp: existing.is_complete_mvp,
      last_interview_step: existing.last_interview_step,
      preferences: existing.preferences,
      fingerprint: existing.fingerprint,
      activity_patterns: existing.activity_patterns,
      boundaries: existing.boundaries,
      active_intent: existing.active_intent,
      completeness_percent: existing.completeness_percent,
      completed_at: existing.completed_at,
      status_reason: existing.status_reason,
      state_changed_at: existing.state_changed_at,
      updated_at: existing.updated_at,
    };
  }

  const { data: created, error: createError } = await supabase
    .from("profiles")
    .insert({
      user_id: userId,
      country_code: null,
      state_code: null,
      state: "empty",
      is_complete_mvp: false,
      preferences: {},
      fingerprint: {},
      activity_patterns: [],
      boundaries: {},
      active_intent: null,
      completeness_percent: 0,
      status_reason: "interview_pending",
      last_interview_step: null,
      completed_at: null,
      state_changed_at: new Date().toISOString(),
    })
    .select(selectColumns)
    .single();

  if (createError || !created?.id) {
    throw new Error("Unable to create profile for interview engine.");
  }

  return {
    id: created.id,
    user_id: created.user_id,
    country_code: created.country_code ?? null,
    state_code: created.state_code ?? null,
    state: created.state,
    is_complete_mvp: created.is_complete_mvp,
    last_interview_step: created.last_interview_step,
    preferences: created.preferences,
    fingerprint: created.fingerprint,
    activity_patterns: created.activity_patterns,
    boundaries: created.boundaries,
    active_intent: created.active_intent,
    completeness_percent: created.completeness_percent,
    completed_at: created.completed_at,
    status_reason: created.status_reason,
    state_changed_at: created.state_changed_at,
    updated_at: created.updated_at,
  };
}

async function persistInterviewTransition(params: {
  supabase: EngineDispatchInput["supabase"];
  userId: string;
  inboundMessageSid: string;
  inboundMessageId: string;
  session: ConversationSessionRow;
  profile: ProfileRow;
  transition: Awaited<ReturnType<typeof buildInterviewTransitionPlan>>;
}): Promise<{ reply_message_override: string | null }> {
  const conversationIdempotencyKey =
    `profile_interview:conversation:${params.userId}:${params.inboundMessageSid}:${params.transition.action}`;
  let replyMessageOverride: string | null = null;

  if (params.transition.profile_patch) {
    const { error: updateProfileError } = await params.supabase
      .from("profiles")
      .update(params.transition.profile_patch)
      .eq("id", params.profile.id);

    if (updateProfileError) {
      throw new Error("Unable to persist profile interview patch.");
    }

    await upsertProfileRegionAssignment({
      supabase: params.supabase,
      profileId: params.profile.id,
      countryCode: params.transition.profile_patch.country_code ?? params.profile.country_code,
      stateCode: params.transition.profile_patch.state_code ?? params.profile.state_code,
    });

    const waitlistGate = await enforceWaitlistGate({
      supabase: params.supabase,
      userId: params.userId,
      allowNotification: params.transition.action === "complete",
    });
    if (waitlistGate.is_waitlist_region && waitlistGate.reply_message) {
      replyMessageOverride = waitlistGate.reply_message;
    }

    if (params.transition.profile_patch.is_complete_mvp) {
      await recomputeProfileSignals({
        supabase: params.supabase,
        user_id: params.userId,
      });
    }
  }

  if (params.transition.profile_event_type && params.transition.profile_event_step_id && params.transition.profile_event_payload) {
    const profileEventIdempotencyKey =
      `profile_interview:profile_event:${params.userId}:${params.transition.profile_event_step_id}:${params.inboundMessageSid}`;

    const { error: profileEventError } = await params.supabase
      .from("profile_events")
      .insert({
        profile_id: params.profile.id,
        user_id: params.userId,
        event_type: params.transition.profile_event_type,
        source: "profile_interview_engine",
        step_id: params.transition.profile_event_step_id,
        payload: params.transition.profile_event_payload,
        idempotency_key: profileEventIdempotencyKey,
      });

    if (profileEventError && !isDuplicateKeyError(profileEventError)) {
      throw new Error("Unable to persist profile interview event.");
    }
  }

  const { error: sessionUpdateError } = await params.supabase
    .from("conversation_sessions")
    .update({
      mode: params.transition.next_session.mode,
      state_token: params.transition.next_session.state_token,
      current_step_id: params.transition.next_session.current_step_id,
      last_inbound_message_sid: params.transition.next_session.last_inbound_message_sid,
    })
    .eq("id", params.session.id);

  if (sessionUpdateError) {
    throw new Error("Unable to persist interview session transition.");
  }

  const { error: conversationEventError } = await params.supabase
    .from("conversation_events")
    .insert({
      conversation_session_id: params.session.id,
      user_id: params.userId,
      profile_id: params.profile.id,
      event_type: mapConversationEventType(params.transition.action),
      step_token: params.transition.next_session.state_token,
      twilio_message_sid: params.inboundMessageSid,
      payload: {
        inbound_message_id: params.inboundMessageId,
        action: params.transition.action,
        current_step_id: params.transition.current_step_id,
        next_step_id: params.transition.next_step_id,
      },
      idempotency_key: conversationIdempotencyKey,
    });

  if (conversationEventError && !isDuplicateKeyError(conversationEventError)) {
    throw new Error("Unable to persist interview conversation event.");
  }

  if (params.transition.action === "complete" && params.transition.profile_patch?.is_complete_mvp) {
    const auditIdempotencyKey =
      `profile_interview:audit:${params.userId}:${params.inboundMessageSid}:complete`;

    const { error: auditInsertError } = await params.supabase
      .from("audit_log")
      .insert({
        action: "profile_completed_mvp",
        target_type: "profile",
        target_id: params.profile.id,
        reason: "onboarding_interview_complete",
        payload: {
          user_id: params.userId,
          via: "profile_interview_engine",
          inbound_message_sid: params.inboundMessageSid,
        },
        idempotency_key: auditIdempotencyKey,
      });

    if (auditInsertError && !isDuplicateKeyError(auditInsertError)) {
      throw new Error("Unable to write profile completion audit log.");
    }
  }

  return { reply_message_override: replyMessageOverride };
}

async function upsertProfileRegionAssignment(params: {
  supabase: EngineDispatchInput["supabase"];
  profileId: string;
  countryCode: string | null;
  stateCode: string | null;
}): Promise<void> {
  const resolved = resolveRegionAssignment({
    countryCode: params.countryCode,
    stateCode: params.stateCode,
  });

  if (!resolved.normalized_country_code) {
    return;
  }

  const { data: region, error: regionLookupError } = await params.supabase
    .from("regions")
    .select("id,slug")
    .eq("slug", resolved.region_slug)
    .maybeSingle();

  if (regionLookupError) {
    throw new Error("Unable to resolve region for assignment.");
  }

  if (!region?.id) {
    throw new Error(
      `Region slug '${resolved.region_slug}' is not configured for deterministic assignment.`,
    );
  }

  const { error: assignmentError } = await params.supabase
    .from("profile_region_assignments")
    .upsert(
      {
        profile_id: params.profileId,
        region_id: region.id,
        assignment_source: resolved.assignment_source,
        assigned_at: new Date().toISOString(),
      },
      { onConflict: "profile_id" },
    );

  if (assignmentError) {
    throw new Error("Unable to upsert profile region assignment.");
  }
}

function mapConversationEventType(action: string): string {
  switch (action) {
    case "start":
      return "interview_started";
    case "retry":
      return "interview_retry_prompted";
    case "advance":
      return "interview_step_advanced";
    case "pause":
      return "interview_paused";
    case "complete":
      return "interview_completed";
    default:
      return "interview_idempotent";
  }
}
