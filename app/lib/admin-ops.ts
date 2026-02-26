import "server-only";

import { deriveExchangeDashboardStatus, type ExchangeDashboardStatus } from "./contact-exchange-status";
import { getSupabaseServiceRoleClient } from "./supabase-service-role";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MODERATION_STATUSES = new Set(["open", "reviewed", "resolved"]);

type DynamicClient = {
  from: (table: string) => {
    select: (columns: string, options?: { count?: "exact" | "planned" | "estimated" }) => any;
    upsert?: (...args: unknown[]) => any;
    update?: (...args: unknown[]) => any;
    insert?: (...args: unknown[]) => any;
  };
};

type UserSummary = {
  id: string;
  first_name: string;
  last_name: string;
  masked_phone: string;
  state: string;
};

export type AdminUserListItem = {
  id: string;
  first_name: string;
  last_name: string;
  masked_phone: string;
  state: string;
  region_id: string | null;
  suspended_at: string | null;
  created_at: string;
  safety_hold: boolean;
  strike_count: number;
};

export type AdminUsersListResult = {
  rows: AdminUserListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminLinkupListItem = {
  id: string;
  state: string;
  region_id: string;
  scheduled_at: string | null;
  event_time: string | null;
  min_size: number;
  max_size: number;
  participant_count: number;
  updated_at: string;
};

export type AdminLinkupsListResult = {
  rows: AdminLinkupListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminLinkupParticipantDetail = {
  user_id: string;
  first_name: string;
  last_name: string;
  masked_phone: string;
  status: string;
  role: string;
  joined_at: string;
  left_at: string | null;
  attendance_response: string | null;
  do_again: boolean | null;
  exchange_status: ExchangeDashboardStatus;
};

export type AdminModerationIncident = {
  id: string;
  reporter_user_id: string;
  reported_user_id: string;
  linkup_id: string | null;
  reason_category: string;
  free_text: string | null;
  status: string;
  created_at: string;
  reporter: UserSummary | null;
  reported: UserSummary | null;
};

export type AdminModerationListResult = {
  rows: AdminModerationIncident[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminSafetyStateRow = {
  user_id: string;
  strike_count: number;
  safety_hold: boolean;
  last_strike_at: string | null;
  last_safety_event_at: string | null;
  user: UserSummary | null;
};

export type AdminSafetyEventRow = {
  id: string;
  user_id: string | null;
  severity: string | null;
  action_taken: string;
  created_at: string;
  user: UserSummary | null;
};

export type AdminSafetyStrikeRow = {
  id: string;
  user_id: string;
  strike_type: string;
  points: number;
  reason: string | null;
  created_at: string;
  user: UserSummary | null;
};

export type AdminSafetyOverviewResult = {
  state_rows: AdminSafetyStateRow[];
  safety_events: AdminSafetyEventRow[];
  strikes: AdminSafetyStrikeRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminContactExchangeRow = {
  id: string;
  linkup_id: string;
  user_a_id: string;
  user_b_id: string;
  revealed_at: string;
  created_at: string;
  blocked_by_safety: boolean;
  user_a: UserSummary | null;
  user_b: UserSummary | null;
};

export type AdminContactExchangeListResult = {
  rows: AdminContactExchangeRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminUserDetailResult = {
  user: {
    id: string;
    first_name: string;
    last_name: string;
    phone_e164: string;
    masked_phone: string;
    state: string;
    region_id: string | null;
    suspended_at: string | null;
    created_at: string;
  } | null;
  admin_role: string | null;
  profile: {
    id: string;
    state: string;
    completeness_percent: number;
    is_complete_mvp: boolean;
    last_interview_step: string | null;
    fingerprint: unknown;
    activity_patterns: unknown;
    preferences: unknown;
    updated_at: string;
  } | null;
  safety_state: {
    strike_count: number;
    safety_hold: boolean;
    last_strike_at: string | null;
    last_safety_event_at: string | null;
  } | null;
  strikes: Array<{
    id: string;
    strike_type: string;
    points: number;
    reason: string | null;
    created_at: string;
  }>;
  safety_events: Array<{
    id: string;
    severity: string | null;
    action_taken: string;
    created_at: string;
  }>;
  conversation_session: {
    id: string;
    mode: string;
    state_token: string;
    linkup_id: string | null;
    updated_at: string;
  } | null;
  conversation_events: Array<{
    id: string;
    event_type: string;
    step_token: string | null;
    created_at: string;
  }>;
  learning_signals: Array<{
    id: string;
    signal_type: string;
    occurred_at: string;
    value_bool: boolean | null;
    value_num: number | null;
    value_text: string | null;
  }>;
  linkups: Array<{
    linkup_id: string;
    state: string;
    status: string;
    role: string;
    joined_at: string;
    event_time: string | null;
    do_again: boolean | null;
    attendance_response: string | null;
    exchange_status: ExchangeDashboardStatus;
  }>;
  blocks: Array<{
    id: string;
    blocker_user_id: string;
    blocked_user_id: string;
    created_at: string;
    blocker: UserSummary | null;
    blocked: UserSummary | null;
  }>;
  admin_audit_history: Array<{
    id: string;
    action: string;
    target_type: string;
    target_id: string | null;
    admin_user_id: string;
    created_at: string;
    metadata_json: unknown;
  }>;
};

export function maskPhoneE164(phone: string | null): string {
  if (!phone) {
    return "hidden";
  }

  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) {
    return "hidden";
  }

  return `***-***-${digits.slice(-4)}`;
}

export async function listAdminUsers(params: {
  query?: string;
  page?: number;
  pageSize?: number;
}): Promise<AdminUsersListResult> {
  const db = getSupabaseServiceRoleClient();
  const dynamicDb = asDynamicClient();
  const query = normalizeSearch(params.query);
  const pagination = resolvePagination(params.page, params.pageSize);

  let usersQuery = db
    .from("users")
    .select("id,first_name,last_name,phone_e164,state,region_id,suspended_at,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(pagination.from, pagination.to);

  if (query) {
    if (isUuid(query)) {
      usersQuery = usersQuery.or(`id.eq.${query},phone_e164.ilike.%${query}%`);
    } else {
      usersQuery = usersQuery.ilike("phone_e164", `%${query}%`);
    }
  }

  const { data: users, error: usersError, count } = await usersQuery;
  if (usersError) {
    throw new Error(`Unable to load admin users list: ${usersError.message}`);
  }

  const userRows = users ?? [];
  const userIds = userRows.map((row) => row.id);
  const safetyByUser = await loadSafetyStateByUserIds(dynamicDb, userIds);

  return {
    rows: userRows.map((row) => {
      const safety = safetyByUser.get(row.id);
      return {
        id: row.id,
        first_name: row.first_name,
        last_name: row.last_name,
        masked_phone: maskPhoneE164(row.phone_e164),
        state: row.state,
        region_id: row.region_id,
        suspended_at: row.suspended_at,
        created_at: row.created_at,
        safety_hold: safety?.safety_hold ?? false,
        strike_count: safety?.strike_count ?? 0,
      };
    }),
    total: count ?? 0,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

export async function getAdminUserDetail(userId: string): Promise<AdminUserDetailResult> {
  const db = getSupabaseServiceRoleClient();
  const dynamicDb = asDynamicClient();

  const {
    data: user,
    error: userError,
  } = await db
    .from("users")
    .select("id,first_name,last_name,phone_e164,state,region_id,suspended_at,created_at")
    .eq("id", userId)
    .maybeSingle();

  if (userError) {
    throw new Error(`Unable to load admin user detail: ${userError.message}`);
  }

  if (!user) {
    return {
      user: null,
      admin_role: null,
      profile: null,
      safety_state: null,
      strikes: [],
      safety_events: [],
      conversation_session: null,
      conversation_events: [],
      learning_signals: [],
      linkups: [],
      blocks: [],
      admin_audit_history: [],
    };
  }

  const [
    profileResult,
    adminRoleResult,
    safetyStateResult,
    strikesResult,
    safetyEventsResult,
    conversationSessionResult,
    learningSignalsResult,
    blocksResult,
    auditResult,
    participationResult,
  ] = await Promise.all([
    db
      .from("profiles")
      .select("id,state,completeness_percent,is_complete_mvp,last_interview_step,fingerprint,activity_patterns,preferences,updated_at")
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("admin_users")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle(),
    dynamicDb
      .from("user_safety_state")
      .select("user_id,strike_count,safety_hold,last_strike_at,last_safety_event_at")
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("user_strikes")
      .select("id,strike_type,points,reason,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(25),
    dynamicDb
      .from("safety_events")
      .select("id,severity,action_taken,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(25),
    db
      .from("conversation_sessions")
      .select("id,mode,state_token,linkup_id,updated_at")
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("learning_signals")
      .select("id,signal_type,occurred_at,value_bool,value_num,value_text")
      .eq("user_id", userId)
      .order("occurred_at", { ascending: false })
      .limit(25),
    db
      .from("user_blocks")
      .select("id,blocker_user_id,blocked_user_id,created_at")
      .or(`blocker_user_id.eq.${userId},blocked_user_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(25),
    db
      .from("admin_audit_log")
      .select("id,action,target_type,target_id,admin_user_id,created_at,metadata_json")
      .eq("target_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("linkup_participants")
      .select("linkup_id,status,role,joined_at,linkups!inner(id,state,event_time)")
      .eq("user_id", userId)
      .order("joined_at", { ascending: false })
      .limit(25),
  ]);

  assertSelectSuccess(profileResult.error, "profile");
  assertSelectSuccess(adminRoleResult.error, "admin role");
  assertSelectSuccess(strikesResult.error, "strike history");
  assertSelectSuccess(learningSignalsResult.error, "learning signals");
  assertSelectSuccess(blocksResult.error, "user blocks");
  assertSelectSuccess(auditResult.error, "admin audit history");
  assertSelectSuccess(participationResult.error, "linkup participation");

  const session = conversationSessionResult.data;
  assertSelectSuccess(conversationSessionResult.error, "conversation session");

  const conversationEventsResult = session
    ? await db
      .from("conversation_events")
      .select("id,event_type,step_token,created_at")
      .eq("conversation_session_id", session.id)
      .order("created_at", { ascending: false })
      .limit(50)
    : { data: [], error: null };
  assertSelectSuccess(conversationEventsResult.error, "conversation events");

  const safetyState = normalizeSafetyStateRow(safetyStateResult.data ?? null);
  const safetyEvents = normalizeSafetyEvents(safetyEventsResult.data ?? []);
  const strikes = normalizeStrikes(strikesResult.data ?? []);

  const linkupRows = normalizeUserLinkups(participationResult.data ?? []);
  const linkupIds = linkupRows.map((row) => row.linkup_id);
  const outcomesByLinkup = await loadLinkupOutcomeByUser(dynamicDb, userId, linkupIds);
  const holdsByUser = await loadSafetyStateByUserIds(dynamicDb, [userId]);
  const hasSafetyHold = holdsByUser.get(userId)?.safety_hold ?? false;

  const linkups = linkupRows.map((row) => {
    const outcome = outcomesByLinkup.get(row.linkup_id);
    return {
      linkup_id: row.linkup_id,
      state: row.state,
      status: row.status,
      role: row.role,
      joined_at: row.joined_at,
      event_time: row.event_time,
      do_again: outcome?.do_again ?? null,
      attendance_response: outcome?.attendance_response ?? null,
      exchange_status: deriveExchangeDashboardStatus({
        exchangeOptIn: outcome?.exchange_opt_in ?? null,
        exchangeRevealedAt: outcome?.exchange_revealed_at ?? null,
        hasSafetySuppression: hasSafetyHold,
      }),
    };
  });

  const blockUserIds = dedupeIds(
    (blocksResult.data ?? []).flatMap((row) => [row.blocked_user_id, row.blocker_user_id]),
  );
  const userSummaries = await loadUserSummariesById(db, blockUserIds);

  return {
    user: {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      phone_e164: user.phone_e164,
      masked_phone: maskPhoneE164(user.phone_e164),
      state: user.state,
      region_id: user.region_id,
      suspended_at: user.suspended_at,
      created_at: user.created_at,
    },
    admin_role: adminRoleResult.data?.role ?? null,
    profile: profileResult.data
      ? {
        id: profileResult.data.id,
        state: profileResult.data.state,
        completeness_percent: profileResult.data.completeness_percent,
        is_complete_mvp: profileResult.data.is_complete_mvp,
        last_interview_step: profileResult.data.last_interview_step,
        fingerprint: profileResult.data.fingerprint,
        activity_patterns: profileResult.data.activity_patterns,
        preferences: profileResult.data.preferences,
        updated_at: profileResult.data.updated_at,
      }
      : null,
    safety_state: safetyState
      ? {
        strike_count: safetyState.strike_count,
        safety_hold: safetyState.safety_hold,
        last_strike_at: safetyState.last_strike_at,
        last_safety_event_at: safetyState.last_safety_event_at,
      }
      : null,
    strikes,
    safety_events: safetyEvents,
    conversation_session: session
      ? {
        id: session.id,
        mode: session.mode,
        state_token: session.state_token,
        linkup_id: session.linkup_id,
        updated_at: session.updated_at,
      }
      : null,
    conversation_events: (conversationEventsResult.data ?? []).map((row) => ({
      id: row.id,
      event_type: row.event_type,
      step_token: row.step_token,
      created_at: row.created_at,
    })),
    learning_signals: (learningSignalsResult.data ?? []).map((row) => ({
      id: row.id,
      signal_type: row.signal_type,
      occurred_at: row.occurred_at,
      value_bool: row.value_bool,
      value_num: row.value_num,
      value_text: row.value_text,
    })),
    linkups,
    blocks: (blocksResult.data ?? []).map((row) => ({
      id: row.id,
      blocker_user_id: row.blocker_user_id,
      blocked_user_id: row.blocked_user_id,
      created_at: row.created_at,
      blocker: userSummaries.get(row.blocker_user_id) ?? null,
      blocked: userSummaries.get(row.blocked_user_id) ?? null,
    })),
    admin_audit_history: (auditResult.data ?? []).map((row) => ({
      id: row.id,
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      admin_user_id: row.admin_user_id,
      created_at: row.created_at,
      metadata_json: row.metadata_json,
    })),
  };
}

export async function listAdminLinkups(params: {
  state?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}): Promise<AdminLinkupsListResult> {
  const db = getSupabaseServiceRoleClient();
  const pagination = resolvePagination(params.page, params.pageSize);

  let query = db
    .from("linkups")
    .select("id,state,region_id,scheduled_at,event_time,min_size,max_size,updated_at", { count: "exact" })
    .order("event_time", { ascending: false })
    .range(pagination.from, pagination.to);

  if (params.state) {
    query = query.eq("state", params.state as any);
  }

  if (params.dateFrom) {
    query = query.gte("event_time", params.dateFrom);
  }

  if (params.dateTo) {
    query = query.lte("event_time", params.dateTo);
  }

  const { data, error, count } = await query;
  if (error) {
    throw new Error(`Unable to load admin linkups list: ${error.message}`);
  }

  const linkups = data ?? [];
  const participantCounts = await countParticipantsByLinkup(linkups.map((row) => row.id));

  return {
    rows: linkups.map((row) => ({
      id: row.id,
      state: row.state,
      region_id: row.region_id,
      scheduled_at: row.scheduled_at,
      event_time: row.event_time,
      min_size: row.min_size,
      max_size: row.max_size,
      participant_count: participantCounts.get(row.id) ?? 0,
      updated_at: row.updated_at,
    })),
    total: count ?? 0,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

export async function getAdminLinkupDetail(linkupId: string): Promise<{
  linkup: {
    id: string;
    state: string;
    region_id: string;
    scheduled_at: string | null;
    event_time: string | null;
    min_size: number;
    max_size: number;
    updated_at: string;
  } | null;
  participants: AdminLinkupParticipantDetail[];
  exchanges: AdminContactExchangeRow[];
  learning_signals: Array<{
    id: string;
    user_id: string;
    signal_type: string;
    occurred_at: string;
    value_bool: boolean | null;
    value_num: number | null;
    value_text: string | null;
  }>;
  conversation_sessions: Array<{
    id: string;
    user_id: string;
    mode: string;
    state_token: string;
    updated_at: string;
  }>;
}> {
  const db = getSupabaseServiceRoleClient();
  const dynamicDb = asDynamicClient();

  const {
    data: linkup,
    error: linkupError,
  } = await db
    .from("linkups")
    .select("id,state,region_id,scheduled_at,event_time,min_size,max_size,updated_at")
    .eq("id", linkupId)
    .maybeSingle();

  if (linkupError) {
    throw new Error(`Unable to load admin linkup detail: ${linkupError.message}`);
  }

  if (!linkup) {
    return {
      linkup: null,
      participants: [],
      exchanges: [],
      learning_signals: [],
      conversation_sessions: [],
    };
  }

  const [participantsResult, outcomesResult, exchangesResult, learningSignalsResult, sessionsResult] = await Promise.all([
    db
      .from("linkup_participants")
      .select("user_id,status,role,joined_at,left_at")
      .eq("linkup_id", linkupId)
      .order("joined_at", { ascending: true }),
    db
      .from("linkup_outcomes")
      .select("user_id,attendance_response,do_again,exchange_opt_in,exchange_revealed_at")
      .eq("linkup_id", linkupId),
    db
      .from("contact_exchanges")
      .select("id,linkup_id,user_a_id,user_b_id,revealed_at,created_at")
      .eq("linkup_id", linkupId),
    db
      .from("learning_signals")
      .select("id,user_id,signal_type,occurred_at,value_bool,value_num,value_text")
      .eq("subject_id", linkupId)
      .order("occurred_at", { ascending: false })
      .limit(50),
    db
      .from("conversation_sessions")
      .select("id,user_id,mode,state_token,updated_at")
      .eq("linkup_id", linkupId)
      .order("updated_at", { ascending: false }),
  ]);

  assertSelectSuccess(participantsResult.error, "linkup participants");
  assertSelectSuccess(outcomesResult.error, "linkup outcomes");
  assertSelectSuccess(exchangesResult.error, "linkup exchanges");
  assertSelectSuccess(learningSignalsResult.error, "linkup learning signals");
  assertSelectSuccess(sessionsResult.error, "linkup conversation sessions");

  const participantRows = participantsResult.data ?? [];
  const participantIds = participantRows.map((row) => row.user_id);
  const userSummaries = await loadUserSummariesById(db, participantIds);
  const safetyStateByUser = await loadSafetyStateByUserIds(dynamicDb, participantIds);
  const outcomesByUser = new Map((outcomesResult.data ?? []).map((row) => [row.user_id, row]));

  const exchangeRows = exchangesResult.data ?? [];
  const exchangeByUser = new Map<string, { revealed_at: string }>();
  for (const exchange of exchangeRows) {
    exchangeByUser.set(exchange.user_a_id, { revealed_at: exchange.revealed_at });
    exchangeByUser.set(exchange.user_b_id, { revealed_at: exchange.revealed_at });
  }

  const participants = participantRows.map((row) => {
    const summary = userSummaries.get(row.user_id);
    const outcome = outcomesByUser.get(row.user_id);
    const revealedAt = outcome?.exchange_revealed_at ?? exchangeByUser.get(row.user_id)?.revealed_at ?? null;
    const exchangeStatus = deriveExchangeDashboardStatus({
      exchangeOptIn: outcome?.exchange_opt_in ?? null,
      exchangeRevealedAt: revealedAt,
      hasSafetySuppression: safetyStateByUser.get(row.user_id)?.safety_hold ?? false,
    });

    return {
      user_id: row.user_id,
      first_name: summary?.first_name ?? "Unknown",
      last_name: summary?.last_name ?? "User",
      masked_phone: summary?.masked_phone ?? "hidden",
      status: row.status,
      role: row.role,
      joined_at: row.joined_at,
      left_at: row.left_at,
      attendance_response: outcome?.attendance_response ?? null,
      do_again: outcome?.do_again ?? null,
      exchange_status: exchangeStatus,
    };
  });

  const exchangeUserIds = dedupeIds(exchangeRows.flatMap((row) => [row.user_a_id, row.user_b_id]));
  const exchangeUserSafety = await loadSafetyStateByUserIds(dynamicDb, exchangeUserIds);
  const exchangeUsers = await loadUserSummariesById(db, exchangeUserIds);

  return {
    linkup: {
      id: linkup.id,
      state: linkup.state,
      region_id: linkup.region_id,
      scheduled_at: linkup.scheduled_at,
      event_time: linkup.event_time,
      min_size: linkup.min_size,
      max_size: linkup.max_size,
      updated_at: linkup.updated_at,
    },
    participants,
    exchanges: exchangeRows.map((row) => ({
      id: row.id,
      linkup_id: row.linkup_id,
      user_a_id: row.user_a_id,
      user_b_id: row.user_b_id,
      revealed_at: row.revealed_at,
      created_at: row.created_at,
      blocked_by_safety: Boolean(
        exchangeUserSafety.get(row.user_a_id)?.safety_hold
          || exchangeUserSafety.get(row.user_b_id)?.safety_hold,
      ),
      user_a: exchangeUsers.get(row.user_a_id) ?? null,
      user_b: exchangeUsers.get(row.user_b_id) ?? null,
    })),
    learning_signals: (learningSignalsResult.data ?? []).map((row) => ({
      id: row.id,
      user_id: row.user_id,
      signal_type: row.signal_type,
      occurred_at: row.occurred_at,
      value_bool: row.value_bool,
      value_num: row.value_num,
      value_text: row.value_text,
    })),
    conversation_sessions: (sessionsResult.data ?? []).map((row) => ({
      id: row.id,
      user_id: row.user_id,
      mode: row.mode,
      state_token: row.state_token,
      updated_at: row.updated_at,
    })),
  };
}

export async function listAdminModerationIncidents(params: {
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<AdminModerationListResult> {
  const db = getSupabaseServiceRoleClient();
  const dynamicDb = asDynamicClient();
  const pagination = resolvePagination(params.page, params.pageSize);
  const status = normalizeModerationStatus(params.status);

  let query = dynamicDb
    .from("moderation_incidents")
    .select("id,reporter_user_id,reported_user_id,linkup_id,reason_category,free_text,status,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(pagination.from, pagination.to);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error, count } = await query;
  if (error) {
    throw new Error(`Unable to load moderation incidents: ${error.message}`);
  }

  const rows = normalizeModerationRows(data ?? []);
  const relatedUserIds = dedupeIds(rows.flatMap((row) => [row.reporter_user_id, row.reported_user_id]));
  const userSummaries = await loadUserSummariesById(db, relatedUserIds);

  return {
    rows: rows.map((row) => ({
      ...row,
      reporter: userSummaries.get(row.reporter_user_id) ?? null,
      reported: userSummaries.get(row.reported_user_id) ?? null,
    })),
    total: count ?? 0,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

export async function listAdminSafetyOverview(params: {
  holdOnly?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<AdminSafetyOverviewResult> {
  const db = getSupabaseServiceRoleClient();
  const dynamicDb = asDynamicClient();
  const pagination = resolvePagination(params.page, params.pageSize);

  let stateQuery = dynamicDb
    .from("user_safety_state")
    .select("user_id,strike_count,safety_hold,last_strike_at,last_safety_event_at,updated_at", { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(pagination.from, pagination.to);

  if (params.holdOnly) {
    stateQuery = stateQuery.eq("safety_hold", true);
  }

  const [stateResult, eventsResult, strikesResult] = await Promise.all([
    stateQuery,
    dynamicDb
      .from("safety_events")
      .select("id,user_id,severity,action_taken,created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("user_strikes")
      .select("id,user_id,strike_type,points,reason,created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (stateResult.error) {
    throw new Error(`Unable to load user safety state: ${stateResult.error.message}`);
  }
  if (eventsResult.error) {
    throw new Error(`Unable to load safety events: ${eventsResult.error.message}`);
  }
  assertSelectSuccess(strikesResult.error, "safety strikes");

  const stateRows = normalizeSafetyStateRows(stateResult.data ?? []);
  const eventRows = normalizeSafetyEventRows(eventsResult.data ?? []);
  const strikeRows = normalizeStrikeRows(strikesResult.data ?? []);

  const userIds = dedupeIds([
    ...stateRows.map((row) => row.user_id),
    ...eventRows.map((row) => row.user_id).filter(Boolean) as string[],
    ...strikeRows.map((row) => row.user_id),
  ]);
  const userSummaries = await loadUserSummariesById(db, userIds);

  return {
    state_rows: stateRows.map((row) => ({
      ...row,
      user: userSummaries.get(row.user_id) ?? null,
    })),
    safety_events: eventRows.map((row) => ({
      ...row,
      user: row.user_id ? userSummaries.get(row.user_id) ?? null : null,
    })),
    strikes: strikeRows.map((row) => ({
      ...row,
      user: userSummaries.get(row.user_id) ?? null,
    })),
    total: stateResult.count ?? 0,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

export async function listAdminContactExchanges(params: {
  blockedBySafetyOnly?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<AdminContactExchangeListResult> {
  const db = getSupabaseServiceRoleClient();
  const dynamicDb = asDynamicClient();
  const pagination = resolvePagination(params.page, params.pageSize);

  const { data, error, count } = await db
    .from("contact_exchanges")
    .select("id,linkup_id,user_a_id,user_b_id,revealed_at,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(pagination.from, pagination.to);

  if (error) {
    throw new Error(`Unable to load contact exchanges: ${error.message}`);
  }

  const exchanges = data ?? [];
  const userIds = dedupeIds(exchanges.flatMap((row) => [row.user_a_id, row.user_b_id]));
  const [summaries, safety] = await Promise.all([
    loadUserSummariesById(db, userIds),
    loadSafetyStateByUserIds(dynamicDb, userIds),
  ]);

  const rows = exchanges.map((row) => ({
    id: row.id,
    linkup_id: row.linkup_id,
    user_a_id: row.user_a_id,
    user_b_id: row.user_b_id,
    revealed_at: row.revealed_at,
    created_at: row.created_at,
    blocked_by_safety: Boolean(safety.get(row.user_a_id)?.safety_hold || safety.get(row.user_b_id)?.safety_hold),
    user_a: summaries.get(row.user_a_id) ?? null,
    user_b: summaries.get(row.user_b_id) ?? null,
  }));

  const filtered = params.blockedBySafetyOnly ? rows.filter((row) => row.blocked_by_safety) : rows;

  return {
    rows: filtered,
    total: count ?? 0,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

function normalizeSearch(value: string | undefined): string {
  return (value ?? "").trim();
}

function normalizeModerationStatus(value: string | undefined): string | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "all") {
    return null;
  }

  return MODERATION_STATUSES.has(normalized) ? normalized : null;
}

function resolvePagination(pageCandidate?: number, pageSizeCandidate?: number): {
  page: number;
  pageSize: number;
  from: number;
  to: number;
} {
  const page = Math.max(1, Number.isFinite(pageCandidate) ? Number(pageCandidate) : 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.isFinite(pageSizeCandidate) ? Number(pageSizeCandidate) : DEFAULT_PAGE_SIZE),
  );

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  return { page, pageSize, from, to };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function assertSelectSuccess(error: { message: string } | null, label: string): void {
  if (!error) {
    return;
  }

  throw new Error(`Unable to load ${label}: ${error.message}`);
}

function asDynamicClient(): DynamicClient {
  return getSupabaseServiceRoleClient() as unknown as DynamicClient;
}

async function loadUserSummariesById(
  db: ReturnType<typeof getSupabaseServiceRoleClient>,
  userIds: string[],
): Promise<Map<string, UserSummary>> {
  const uniqueUserIds = dedupeIds(userIds);
  if (uniqueUserIds.length === 0) {
    return new Map();
  }

  const { data, error } = await db
    .from("users")
    .select("id,first_name,last_name,phone_e164,state")
    .in("id", uniqueUserIds);
  if (error) {
    throw new Error(`Unable to load related user summaries: ${error.message}`);
  }

  const summaryMap = new Map<string, UserSummary>();
  for (const row of data ?? []) {
    summaryMap.set(row.id, {
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      masked_phone: maskPhoneE164(row.phone_e164),
      state: row.state,
    });
  }

  return summaryMap;
}

async function loadSafetyStateByUserIds(
  dynamicDb: DynamicClient,
  userIds: string[],
): Promise<Map<string, { strike_count: number; safety_hold: boolean }>> {
  const uniqueUserIds = dedupeIds(userIds);
  if (uniqueUserIds.length === 0) {
    return new Map();
  }

  const { data, error } = await dynamicDb
    .from("user_safety_state")
    .select("user_id,strike_count,safety_hold")
    .in("user_id", uniqueUserIds);
  if (error) {
    throw new Error(`Unable to load user safety state map: ${error.message}`);
  }

  const results = new Map<string, { strike_count: number; safety_hold: boolean }>();
  for (const row of data ?? []) {
    if (!row?.user_id || typeof row.user_id !== "string") {
      continue;
    }

    results.set(row.user_id, {
      strike_count: typeof row.strike_count === "number" ? row.strike_count : 0,
      safety_hold: Boolean(row.safety_hold),
    });
  }

  return results;
}

async function loadLinkupOutcomeByUser(
  dynamicDb: DynamicClient,
  userId: string,
  linkupIds: string[],
): Promise<Map<string, {
  do_again: boolean | null;
  attendance_response: string | null;
  exchange_opt_in: boolean | null;
  exchange_revealed_at: string | null;
}>> {
  const uniqueLinkupIds = dedupeIds(linkupIds);
  if (uniqueLinkupIds.length === 0) {
    return new Map();
  }

  const { data, error } = await dynamicDb
    .from("linkup_outcomes")
    .select("linkup_id,do_again,attendance_response,exchange_opt_in,exchange_revealed_at")
    .eq("user_id", userId)
    .in("linkup_id", uniqueLinkupIds);
  if (error) {
    throw new Error(`Unable to load linkup outcomes for user detail: ${error.message}`);
  }

  const outcomes = new Map<string, {
    do_again: boolean | null;
    attendance_response: string | null;
    exchange_opt_in: boolean | null;
    exchange_revealed_at: string | null;
  }>();

  for (const row of data ?? []) {
    if (!row?.linkup_id || typeof row.linkup_id !== "string") {
      continue;
    }

    outcomes.set(row.linkup_id, {
      do_again: typeof row.do_again === "boolean" ? row.do_again : null,
      attendance_response: typeof row.attendance_response === "string" ? row.attendance_response : null,
      exchange_opt_in: typeof row.exchange_opt_in === "boolean" ? row.exchange_opt_in : null,
      exchange_revealed_at: typeof row.exchange_revealed_at === "string" ? row.exchange_revealed_at : null,
    });
  }

  return outcomes;
}

async function countParticipantsByLinkup(linkupIds: string[]): Promise<Map<string, number>> {
  const db = getSupabaseServiceRoleClient();
  const uniqueLinkupIds = dedupeIds(linkupIds);
  if (uniqueLinkupIds.length === 0) {
    return new Map();
  }

  const { data, error } = await db
    .from("linkup_participants")
    .select("linkup_id")
    .in("linkup_id", uniqueLinkupIds);
  if (error) {
    throw new Error(`Unable to load linkup participant counts: ${error.message}`);
  }

  const counts = new Map<string, number>();
  for (const linkupId of uniqueLinkupIds) {
    counts.set(linkupId, 0);
  }

  for (const row of data ?? []) {
    counts.set(row.linkup_id, (counts.get(row.linkup_id) ?? 0) + 1);
  }

  return counts;
}

function normalizeUserLinkups(rows: unknown[]): Array<{
  linkup_id: string;
  state: string;
  status: string;
  role: string;
  joined_at: string;
  event_time: string | null;
}> {
  const normalized: Array<{
    linkup_id: string;
    state: string;
    status: string;
    role: string;
    joined_at: string;
    event_time: string | null;
  }> = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const candidate = row as Record<string, any>;
    const nestedLinkup = candidate.linkups as Record<string, any> | null;

    if (typeof candidate.linkup_id !== "string") {
      continue;
    }

    normalized.push({
      linkup_id: candidate.linkup_id,
      state: typeof nestedLinkup?.state === "string" ? nestedLinkup.state : "unknown",
      status: typeof candidate.status === "string" ? candidate.status : "unknown",
      role: typeof candidate.role === "string" ? candidate.role : "participant",
      joined_at: typeof candidate.joined_at === "string" ? candidate.joined_at : "",
      event_time: typeof nestedLinkup?.event_time === "string" ? nestedLinkup.event_time : null,
    });
  }

  return normalized;
}

function normalizeModerationRows(rows: unknown[]): Array<{
  id: string;
  reporter_user_id: string;
  reported_user_id: string;
  linkup_id: string | null;
  reason_category: string;
  free_text: string | null;
  status: string;
  created_at: string;
}> {
  const normalized: Array<{
    id: string;
    reporter_user_id: string;
    reported_user_id: string;
    linkup_id: string | null;
    reason_category: string;
    free_text: string | null;
    status: string;
    created_at: string;
  }> = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const candidate = row as Record<string, unknown>;
    if (
      typeof candidate.id !== "string"
      || typeof candidate.reporter_user_id !== "string"
      || typeof candidate.reported_user_id !== "string"
      || typeof candidate.reason_category !== "string"
      || typeof candidate.status !== "string"
      || typeof candidate.created_at !== "string"
    ) {
      continue;
    }

    normalized.push({
      id: candidate.id,
      reporter_user_id: candidate.reporter_user_id,
      reported_user_id: candidate.reported_user_id,
      linkup_id: typeof candidate.linkup_id === "string" ? candidate.linkup_id : null,
      reason_category: candidate.reason_category,
      free_text: typeof candidate.free_text === "string" ? candidate.free_text : null,
      status: candidate.status,
      created_at: candidate.created_at,
    });
  }

  return normalized;
}

function normalizeSafetyStateRows(rows: unknown[]): Array<{
  user_id: string;
  strike_count: number;
  safety_hold: boolean;
  last_strike_at: string | null;
  last_safety_event_at: string | null;
}> {
  const normalized: Array<{
    user_id: string;
    strike_count: number;
    safety_hold: boolean;
    last_strike_at: string | null;
    last_safety_event_at: string | null;
  }> = [];

  for (const row of rows) {
    const normalizedRow = normalizeSafetyStateRow(row);
    if (normalizedRow) {
      normalized.push(normalizedRow);
    }
  }

  return normalized;
}

function normalizeSafetyStateRow(row: unknown): {
  user_id: string;
  strike_count: number;
  safety_hold: boolean;
  last_strike_at: string | null;
  last_safety_event_at: string | null;
} | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const candidate = row as Record<string, unknown>;
  if (typeof candidate.user_id !== "string") {
    return null;
  }

  return {
    user_id: candidate.user_id,
    strike_count: typeof candidate.strike_count === "number" ? candidate.strike_count : 0,
    safety_hold: Boolean(candidate.safety_hold),
    last_strike_at: typeof candidate.last_strike_at === "string" ? candidate.last_strike_at : null,
    last_safety_event_at: typeof candidate.last_safety_event_at === "string" ? candidate.last_safety_event_at : null,
  };
}

function normalizeSafetyEvents(rows: unknown[]): Array<{
  id: string;
  severity: string | null;
  action_taken: string;
  created_at: string;
}> {
  return normalizeSafetyEventRows(rows).map((row) => ({
    id: row.id,
    severity: row.severity,
    action_taken: row.action_taken,
    created_at: row.created_at,
  }));
}

function normalizeSafetyEventRows(rows: unknown[]): Array<{
  id: string;
  user_id: string | null;
  severity: string | null;
  action_taken: string;
  created_at: string;
}> {
  const normalized: Array<{
    id: string;
    user_id: string | null;
    severity: string | null;
    action_taken: string;
    created_at: string;
  }> = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const candidate = row as Record<string, unknown>;
    if (
      typeof candidate.id !== "string"
      || typeof candidate.action_taken !== "string"
      || typeof candidate.created_at !== "string"
    ) {
      continue;
    }

    normalized.push({
      id: candidate.id,
      user_id: typeof candidate.user_id === "string" ? candidate.user_id : null,
      severity: typeof candidate.severity === "string" ? candidate.severity : null,
      action_taken: candidate.action_taken,
      created_at: candidate.created_at,
    });
  }

  return normalized;
}

function normalizeStrikes(rows: Array<{
  id: string;
  strike_type: string;
  points: number;
  reason: string | null;
  created_at: string;
}>): Array<{
  id: string;
  strike_type: string;
  points: number;
  reason: string | null;
  created_at: string;
}> {
  return rows.map((row) => ({
    id: row.id,
    strike_type: row.strike_type,
    points: row.points,
    reason: row.reason,
    created_at: row.created_at,
  }));
}

function normalizeStrikeRows(rows: Array<{
  id: string;
  user_id: string;
  strike_type: string;
  points: number;
  reason: string | null;
  created_at: string;
}>): Array<{
  id: string;
  user_id: string;
  strike_type: string;
  points: number;
  reason: string | null;
  created_at: string;
}> {
  return rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    strike_type: row.strike_type,
    points: row.points,
    reason: row.reason,
    created_at: row.created_at,
  }));
}

function dedupeIds(ids: Array<string | null | undefined>): string[] {
  const result = new Set<string>();

  for (const id of ids) {
    if (typeof id !== "string" || !id) {
      continue;
    }

    result.add(id);
  }

  return Array.from(result);
}
