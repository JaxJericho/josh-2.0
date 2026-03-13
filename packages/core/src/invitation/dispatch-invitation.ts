import { createServiceRoleDbClient } from "../../../db/src/client-node.mjs";
import type { DbClient } from "../../../db/src/types";
import { checkInvitationEligibility } from "./frequency-guard.ts";
import {
  INVITATION_EXPIRY_HOURS,
  INVITATION_IDEMPOTENCY_KEY,
} from "./constants";

type DispatchRpcResultRow = {
  invitation_id?: unknown;
  dispatched?: unknown;
  reason?: unknown;
};

type DispatchUserContext = {
  firstName: string;
  regionId: string | null;
};

export type DispatchParams = {
  userId: string;
  invitationType: "solo" | "linkup";
  activityKey: string;
  proposedTimeWindow: string;
  locationHint?: string;
  linkupId?: string;
  correlationId: string;
};

export type DispatchFailureReason =
  | "eligibility_gate"
  | "cooldown"
  | "weekly_cap"
  | "backoff_suppressed"
  | "already_invited_this_week"
  | "quiet_hours";

export type DispatchResult =
  | { dispatched: true; invitationId: string }
  | { dispatched: false; reason: DispatchFailureReason };

const QUIET_HOURS_FALLBACK_TIMEZONE = "America/Los_Angeles";

export async function dispatchInvitation(
  params: DispatchParams,
): Promise<DispatchResult> {
  validateDispatchParams(params);

  const eligibility = await checkInvitationEligibility(params.userId);
  if (!eligibility.eligible) {
    return {
      dispatched: false,
      reason: eligibility.reason,
    };
  }

  const db = createServiceRoleDbClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const idempotencyKey = INVITATION_IDEMPOTENCY_KEY(
    params.userId,
    params.activityKey,
    formatIsoWeek(now),
  );

  const existingInvitation = await findInvitationByIdempotencyKey(db, idempotencyKey);
  if (existingInvitation) {
    return {
      dispatched: false,
      reason: "already_invited_this_week",
    };
  }

  const user = await fetchDispatchUserContext(db, params.userId);
  const userTimezone = await resolveUserTimezone(db, user.regionId);
  if (isQuietHours(now, userTimezone)) {
    return {
      dispatched: false,
      reason: "quiet_hours",
    };
  }

  const activityDisplayName = await fetchActivityDisplayName(db, params.activityKey);
  const outboundMessage = buildInvitationSms({
    firstName: user.firstName,
    invitationType: params.invitationType,
    activityKey: params.activityKey,
    activityDisplayName,
    proposedTimeWindow: params.proposedTimeWindow,
  });

  const { data, error } = await db.rpc("dispatch_invitation", {
    p_user_id: params.userId,
    p_invitation_type: params.invitationType,
    p_activity_key: params.activityKey,
    p_proposed_time_window: params.proposedTimeWindow,
    p_expiry_hours: INVITATION_EXPIRY_HOURS,
    p_location_hint: normalizeOptionalText(params.locationHint),
    p_linkup_id: params.invitationType === "linkup" ? params.linkupId ?? null : null,
    p_correlation_id: params.correlationId,
    p_idempotency_key: idempotencyKey,
    p_outbound_message: outboundMessage,
    p_sms_encryption_key: requireSmsEncryptionKey(),
    p_now: nowIso,
  });

  if (error) {
    throw new Error(`Unable to dispatch invitation: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as DispatchRpcResultRow | null;
  if (!row) {
    throw new Error("dispatch_invitation RPC returned no result row.");
  }

  if (row.dispatched === true && typeof row.invitation_id === "string") {
    return {
      dispatched: true,
      invitationId: row.invitation_id,
    };
  }

  if (typeof row.reason === "string" && isDispatchFailureReason(row.reason)) {
    return {
      dispatched: false,
      reason: row.reason,
    };
  }

  throw new Error("dispatch_invitation RPC returned an unexpected result.");
}

async function findInvitationByIdempotencyKey(
  db: DbClient,
  idempotencyKey: string,
): Promise<{ id: string } | null> {
  const { data, error } = await db
    .from("invitations")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to resolve invitation idempotency state.");
  }

  if (!data?.id || typeof data.id !== "string") {
    return null;
  }

  return { id: data.id };
}

async function fetchDispatchUserContext(
  db: DbClient,
  userId: string,
): Promise<DispatchUserContext> {
  const { data, error } = await db
    .from("users")
    .select("first_name,region_id")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to load user context for invitation dispatch.");
  }

  if (!data?.first_name || typeof data.first_name !== "string") {
    throw new Error(`User '${userId}' not found for invitation dispatch.`);
  }

  return {
    firstName: data.first_name,
    regionId: typeof data.region_id === "string" ? data.region_id : null,
  };
}

async function resolveUserTimezone(
  _db: DbClient,
  _regionId: string | null,
): Promise<string> {
  // TODO: Replace this Seattle-beta fallback once regions.timezone exists.
  return QUIET_HOURS_FALLBACK_TIMEZONE;
}

async function fetchActivityDisplayName(
  db: DbClient,
  activityKey: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("activity_catalog")
    .select("display_name")
    .eq("activity_key", activityKey)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to load activity catalog entry for invitation dispatch.");
  }

  if (!data?.display_name || typeof data.display_name !== "string") {
    return null;
  }

  return data.display_name.trim();
}

function buildInvitationSms(input: {
  firstName: string;
  invitationType: "solo" | "linkup";
  activityKey: string;
  activityDisplayName: string | null;
  proposedTimeWindow: string;
}): string {
  const activityDisplayName = resolveActivityDisplayName(
    input.activityKey,
    input.activityDisplayName,
  );

  if (input.invitationType === "solo") {
    return `Hey ${input.firstName} — JOSH found something for you: ${activityDisplayName} ${input.proposedTimeWindow}. Interested? Reply YES to confirm or PASS to skip.`;
  }

  return `Hey ${input.firstName} — JOSH found a group activity that fits you: ${activityDisplayName} ${input.proposedTimeWindow} with a small group. Reply YES to join or PASS to skip.`;
}

function resolveActivityDisplayName(
  activityKey: string,
  activityDisplayName: string | null,
): string {
  if (typeof activityDisplayName === "string" && activityDisplayName.trim()) {
    return activityDisplayName.trim();
  }

  return activityKey
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");
}

function validateDispatchParams(params: DispatchParams): void {
  if (params.invitationType === "linkup" && !params.linkupId) {
    throw new Error("dispatchInvitation requires linkupId for linkup invitations.");
  }

  if (params.invitationType === "solo" && params.linkupId) {
    throw new Error("dispatchInvitation does not accept linkupId for solo invitations.");
  }
}

function isQuietHours(now: Date, timeZone: string): boolean {
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    timeZone,
  });
  const hour = Number.parseInt(formatter.format(now), 10);

  return hour >= 22 || hour < 8;
}

function formatIsoWeek(input: Date): string {
  const utcDate = new Date(Date.UTC(
    input.getUTCFullYear(),
    input.getUTCMonth(),
    input.getUTCDate(),
  ));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

  return `${utcDate.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

function normalizeOptionalText(value: string | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return value.trim();
}

function isDispatchFailureReason(value: string): value is DispatchFailureReason {
  return value === "eligibility_gate" ||
    value === "cooldown" ||
    value === "weekly_cap" ||
    value === "backoff_suppressed" ||
    value === "already_invited_this_week" ||
    value === "quiet_hours";
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

  throw new Error("SMS_BODY_ENCRYPTION_KEY is required to queue invitation jobs.");
}

export const __private__ = {
  buildInvitationSms,
  formatIsoWeek,
  isQuietHours,
  resolveActivityDisplayName,
};
