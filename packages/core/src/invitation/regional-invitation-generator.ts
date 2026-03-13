import type { DbClient, DbInsert, DbRow, GroupSizePreference } from "../../../db/src/types";
import { createServiceRoleDbClient } from "../../../db/src/client-node.mjs";
import { logEvent } from "../observability/logger.ts";
import { MAX_CLUSTER_SIZE } from "./constants";
import { detectClusters, type Cluster, type EligibleUser } from "./cluster-detector.ts";
import { dispatchInvitation } from "./dispatch-invitation.ts";
import { checkInvitationEligibility } from "./frequency-guard.ts";
import { selectSoloInvitation } from "./solo-invitation-selector.ts";

const DEFAULT_GROUP_SIZE_PREFERENCE: GroupSizePreference = { min: 2, max: 10 };
const QUIET_HOURS_FALLBACK_TIMEZONE = "America/Los_Angeles";
const COLD_START_ROUTE_PATH = "/api/invitations/cold-start";
const GENERATOR_RUN_LOCK_UNAVAILABLE_EVENT = "generator_run.lock_unavailable";
const GENERATOR_RUN_COMPLETE_EVENT = "generator_run.complete";

type DbClientLike = Pick<DbClient, "from" | "rpc">;

type GeneratorProfileRow = Pick<
  DbRow<"profiles">,
  | "user_id"
  | "state"
  | "coordination_dimensions"
  | "activity_patterns"
  | "scheduling_availability"
  | "boundaries"
  | "interest_signatures"
  | "relational_context"
  | "group_size_preference"
>;

type GeneratorUserRow = Pick<DbRow<"users">, "id">;
type GeneratorSubscriptionRow = Pick<DbRow<"subscriptions">, "user_id">;
type GeneratorConversationSessionRow = Pick<
  DbRow<"conversation_sessions">,
  "user_id" | "mode"
>;

type SystemLinkup = {
  id: string;
  replayed: boolean;
};

export type GeneratorRunResult = {
  regionId: string;
  eligibleUserCount: number;
  clustersFormed: number;
  clusterMembersDispatched: number;
  soloInvitationsDispatched: number;
  groupInvitationsDispatched: number;
  skippedQuietHours: number;
  skippedActivityUnresolvable: number;
  skippedTimeWindowUnresolvable: number;
  errors: string[];
  durationMs: number;
};

export async function runRegionalGenerator(
  regionId: string,
): Promise<GeneratorRunResult> {
  const db = createServiceRoleDbClient();
  const startedAt = Date.now();
  const correlationId = crypto.randomUUID();
  const result = createEmptyResult(regionId);
  let lockAcquired = false;

  try {
    lockAcquired = await tryAcquireRegionalGeneratorLock(db, regionId);
    if (!lockAcquired) {
      logEvent({
        event: GENERATOR_RUN_LOCK_UNAVAILABLE_EVENT,
        correlation_id: correlationId,
        payload: {
          regionId,
        },
      });
      return result;
    }

    const eligibleUsers = await loadEligibleUsers(db, regionId);
    result.eligibleUserCount = eligibleUsers.length;

    const clusters = await detectClusters(eligibleUsers);
    result.clustersFormed = clusters.length;

    const clusteredUserIds = new Set(clusters.flatMap((cluster) => cluster.members));
    const soloFallbackUserIds = new Set(
      eligibleUsers
        .filter((user) => !clusteredUserIds.has(user.userId))
        .map((user) => user.userId),
    );

    for (const cluster of clusters) {
      if (cluster.activityUnresolvable || !cluster.activityKey) {
        result.skippedActivityUnresolvable += cluster.members.length;
        for (const userId of cluster.members) {
          soloFallbackUserIds.add(userId);
        }
        continue;
      }

      if (cluster.timeWindowUnresolvable || !cluster.proposedTimeWindow) {
        result.skippedTimeWindowUnresolvable += cluster.members.length;
        for (const userId of cluster.members) {
          soloFallbackUserIds.add(userId);
        }
        continue;
      }

      try {
        const linkup = await findOrCreateSystemLinkup(db, {
          regionId,
          cluster,
          correlationId,
        });
        result.groupInvitationsDispatched += 1;

        for (const userId of cluster.members) {
          try {
            const dispatchResult = await dispatchInvitation({
              userId,
              invitationType: "linkup",
              activityKey: cluster.activityKey,
              proposedTimeWindow: cluster.proposedTimeWindow,
              linkupId: linkup.id,
              correlationId,
            });

            await applyDispatchResult({
              result,
              dispatchResult,
              userId,
            });

            if (dispatchResult.dispatched) {
              result.clusterMembersDispatched += 1;
            }
          } catch (error) {
            result.errors.push(`cluster member ${userId}: ${toErrorMessage(error)}`);
          }
        }
      } catch (error) {
        result.errors.push(
          `cluster ${cluster.members.join(",")}: ${toErrorMessage(error)}`,
        );
      }
    }

    for (const userId of Array.from(soloFallbackUserIds)) {
      try {
        const candidate = await selectSoloInvitation(userId);
        if (!candidate) {
          continue;
        }

        const dispatchResult = await dispatchInvitation({
          userId,
          invitationType: "solo",
          activityKey: candidate.activityKey,
          proposedTimeWindow: candidate.proposedTimeWindow,
          locationHint: candidate.locationHint ?? undefined,
          correlationId,
        });

        await applyDispatchResult({
          result,
          dispatchResult,
          userId,
        });

        if (dispatchResult.dispatched) {
          result.soloInvitationsDispatched += 1;
        }
      } catch (error) {
        result.errors.push(`solo user ${userId}: ${toErrorMessage(error)}`);
      }
    }
  } catch (error) {
    result.errors.push(toErrorMessage(error));
  } finally {
    if (lockAcquired) {
      try {
        await unlockRegionalGenerator(db, regionId);
      } catch (error) {
        result.errors.push(`unlock: ${toErrorMessage(error)}`);
      }
    }

    result.durationMs = Date.now() - startedAt;
  }

  if (lockAcquired) {
    logEvent({
      event: GENERATOR_RUN_COMPLETE_EVENT,
      correlation_id: correlationId,
      payload: result,
    });
  }

  return result;
}

async function loadEligibleUsers(
  db: DbClientLike,
  regionId: string,
): Promise<EligibleUser[]> {
  const candidateUserIds = await fetchCandidateUserIds(db, regionId);
  if (candidateUserIds.length === 0) {
    return [];
  }

  const [profiles, subscribedUserIds, interviewingUserIds] = await Promise.all([
    fetchEligibleProfiles(db, candidateUserIds),
    fetchActiveSubscribedUserIds(db, candidateUserIds),
    fetchInterviewingUserIds(db, candidateUserIds),
  ]);

  const subscribedUserIdSet = new Set(subscribedUserIds);
  const interviewingUserIdSet = new Set(interviewingUserIds);
  const eligibleUsers: EligibleUser[] = [];

  for (const profile of profiles) {
    if (!subscribedUserIdSet.has(profile.user_id)) {
      continue;
    }

    if (interviewingUserIdSet.has(profile.user_id)) {
      continue;
    }

    const eligibility = await checkInvitationEligibility(profile.user_id);
    if (!eligibility.eligible) {
      continue;
    }

    const eligibleProfile = {
      coordination_dimensions: profile.coordination_dimensions,
      activity_patterns: profile.activity_patterns,
      scheduling_availability: profile.scheduling_availability,
      boundaries: profile.boundaries,
      interest_signatures: profile.interest_signatures,
      relational_context: profile.relational_context,
    } as EligibleUser["profile"];

    eligibleUsers.push({
      userId: profile.user_id,
      groupSizePreference: normalizeGroupSizePreference(profile.group_size_preference),
      profile: eligibleProfile,
    });
  }

  return eligibleUsers;
}

async function fetchCandidateUserIds(
  db: DbClientLike,
  regionId: string,
): Promise<string[]> {
  const { data, error } = await db
    .from("users")
    .select("id")
    .eq("region_id", regionId)
    .eq("state", "active");

  if (error) {
    throw new Error("Unable to load candidate users for regional invitation generation.");
  }

  return (data ?? [])
    .map((row) => normalizeId((row as GeneratorUserRow).id))
    .filter((value): value is string => value !== null);
}

async function fetchEligibleProfiles(
  db: DbClientLike,
  userIds: string[],
): Promise<GeneratorProfileRow[]> {
  const { data, error } = await db
    .from("profiles")
    .select(
      "user_id,state,coordination_dimensions,activity_patterns,scheduling_availability,boundaries,interest_signatures,relational_context,group_size_preference",
    )
    .in("user_id", userIds)
    .in("state", ["complete_mvp", "complete_full"])
    // complete_invited hard filter: never relax
    .neq("state", "complete_invited");

  if (error) {
    throw new Error("Unable to load eligible profiles for regional invitation generation.");
  }

  return (data ?? []).map((row) => ({
    user_id: String(row.user_id),
    state: row.state as GeneratorProfileRow["state"],
    coordination_dimensions: row.coordination_dimensions,
    activity_patterns: row.activity_patterns,
    scheduling_availability: row.scheduling_availability,
    boundaries: row.boundaries,
    interest_signatures: row.interest_signatures,
    relational_context: row.relational_context,
    group_size_preference: row.group_size_preference,
  }));
}

async function fetchActiveSubscribedUserIds(
  db: DbClientLike,
  userIds: string[],
): Promise<string[]> {
  const { data, error } = await db
    .from("subscriptions")
    .select("user_id")
    .in("user_id", userIds)
    .eq("status", "active");

  if (error) {
    throw new Error("Unable to load active subscriptions for regional invitation generation.");
  }

  return Array.from(
    new Set(
      (data ?? [])
        .map((row) => normalizeId((row as GeneratorSubscriptionRow).user_id))
        .filter((value): value is string => value !== null),
    ),
  );
}

async function fetchInterviewingUserIds(
  db: DbClientLike,
  userIds: string[],
): Promise<string[]> {
  const { data, error } = await db
    .from("conversation_sessions")
    .select("user_id,mode")
    .in("user_id", userIds)
    .eq("mode", "interviewing");

  if (error) {
    throw new Error("Unable to load active interviewing sessions for regional invitation generation.");
  }

  return Array.from(
    new Set(
      (data ?? [])
        .map((row) => normalizeId((row as GeneratorConversationSessionRow).user_id))
        .filter((value): value is string => value !== null),
    ),
  );
}

async function findOrCreateSystemLinkup(
  db: DbClientLike,
  input: {
    regionId: string;
    cluster: Cluster;
    correlationId: string;
  },
): Promise<SystemLinkup> {
  const activityKey = input.cluster.activityKey;
  const proposedTimeWindow = input.cluster.proposedTimeWindow;
  if (!activityKey || !proposedTimeWindow) {
    throw new Error("Resolvable cluster must include activityKey and proposedTimeWindow.");
  }

  const linkupCreateKey = buildLinkupCreateKey(
    input.regionId,
    input.cluster.members,
    activityKey,
    proposedTimeWindow,
  );

  const { data: existing, error: existingError } = await db
    .from("linkups")
    .select("id")
    .eq("linkup_create_key", linkupCreateKey)
    .maybeSingle();

  if (existingError) {
    throw new Error("Unable to resolve existing regional generator LinkUp.");
  }

  if (typeof existing?.id === "string" && existing.id.length > 0) {
    return {
      id: existing.id,
      replayed: true,
    };
  }

  const insertRow = {
    brief: {
      source: "regional_generator",
      activity_key: activityKey,
      proposed_time_window: proposedTimeWindow,
      member_user_ids: [...input.cluster.members].sort(),
    },
    initiator_user_id: null,
    region_id: input.regionId,
    state: "broadcasting",
    min_size: 2,
    max_size: MAX_CLUSTER_SIZE,
    correlation_id: input.correlationId,
    linkup_create_key: linkupCreateKey,
    system_created: true,
    activity_key: activityKey,
    proposed_time_window: proposedTimeWindow,
  } satisfies DbInsert<"linkups"> & Record<string, unknown>;

  const { data: inserted, error: insertError } = await db
    .from("linkups")
    .insert(insertRow as never)
    .select("id")
    .maybeSingle();

  if (insertError) {
    throw new Error(`Unable to create regional generator LinkUp: ${insertError.message}`);
  }

  if (typeof inserted?.id !== "string" || inserted.id.length === 0) {
    throw new Error("Regional generator LinkUp insert returned no id.");
  }

  return {
    id: inserted.id,
    replayed: false,
  };
}

async function applyDispatchResult(input: {
  result: GeneratorRunResult;
  dispatchResult: Awaited<ReturnType<typeof dispatchInvitation>>;
  userId: string;
}): Promise<void> {
  if (input.dispatchResult.dispatched) {
    return;
  }

  if (input.dispatchResult.reason === "quiet_hours") {
    await enqueueQuietHoursRetry(input.userId);
    input.result.skippedQuietHours += 1;
  }
}

async function enqueueQuietHoursRetry(userId: string): Promise<void> {
  const delaySeconds = computeQuietHoursRetryDelaySeconds(
    new Date(),
    QUIET_HOURS_FALLBACK_TIMEZONE,
  );

  const response = await fetch(resolveQStashPublishEndpoint(resolveColdStartTargetUrl()), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("QSTASH_TOKEN")}`,
      "content-type": "application/json; charset=utf-8",
      "Upstash-Delay": `${delaySeconds}s`,
    },
    body: JSON.stringify({ userId }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `Regional generator QStash publish failed (status=${response.status})${details ? `: ${details}` : ""}`,
    );
  }
}

async function tryAcquireRegionalGeneratorLock(
  db: DbClientLike,
  regionId: string,
): Promise<boolean> {
  const { data, error } = await db.rpc("regional_generator_try_lock", {
    p_region_id: regionId,
  });

  if (error) {
    throw new Error(`Unable to acquire regional generator lock: ${error.message}`);
  }

  return readBooleanRpcResult(data);
}

async function unlockRegionalGenerator(
  db: DbClientLike,
  regionId: string,
): Promise<boolean> {
  const { data, error } = await db.rpc("regional_generator_unlock", {
    p_region_id: regionId,
  });

  if (error) {
    throw new Error(`Unable to release regional generator lock: ${error.message}`);
  }

  return readBooleanRpcResult(data);
}

function createEmptyResult(regionId: string): GeneratorRunResult {
  return {
    regionId,
    eligibleUserCount: 0,
    clustersFormed: 0,
    clusterMembersDispatched: 0,
    soloInvitationsDispatched: 0,
    groupInvitationsDispatched: 0,
    skippedQuietHours: 0,
    skippedActivityUnresolvable: 0,
    skippedTimeWindowUnresolvable: 0,
    errors: [],
    durationMs: 0,
  };
}

function normalizeGroupSizePreference(value: unknown): GroupSizePreference {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_GROUP_SIZE_PREFERENCE;
  }

  const record = value as Record<string, unknown>;
  const min = normalizeInteger(record.min);
  const max = normalizeInteger(record.max);

  if (min == null || max == null || min < 2 || max > 10 || min > max) {
    return DEFAULT_GROUP_SIZE_PREFERENCE;
  }

  return { min, max };
}

function normalizeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null;
  }

  return value;
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  return value;
}

function buildLinkupCreateKey(
  regionId: string,
  memberIds: string[],
  activityKey: string,
  proposedTimeWindow: string,
): string {
  return `regional-generator:${regionId}:${[...memberIds].sort().join(",")}:${activityKey}:${proposedTimeWindow}`;
}

function computeQuietHoursRetryDelaySeconds(
  now: Date,
  timeZone: string,
): number {
  const parts = getZonedDateParts(now, timeZone);
  const jitterMinutes = randomIntInclusive(0, 30);
  const nextMorning = makeDateInTimeZone({
    year: parts.year,
    month: parts.month,
    day: parts.day + 1,
    hour: 8,
    minute: jitterMinutes,
    second: 0,
    timeZone,
  });

  const delayMs = Math.max(0, nextMorning.getTime() - now.getTime());
  return Math.ceil(delayMs / 1000);
}

function getZonedDateParts(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? "0"),
    month: Number(parts.find((part) => part.type === "month")?.value ?? "0"),
    day: Number(parts.find((part) => part.type === "day")?.value ?? "0"),
  };
}

function makeDateInTimeZone(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  timeZone: string;
}): Date {
  const utcGuess = new Date(Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour,
    input.minute,
    input.second,
  ));
  const initialOffsetMs = readTimeZoneOffsetMs(utcGuess, input.timeZone);
  const adjusted = new Date(utcGuess.getTime() - initialOffsetMs);
  const adjustedOffsetMs = readTimeZoneOffsetMs(adjusted, input.timeZone);
  return new Date(utcGuess.getTime() - adjustedOffsetMs);
}

function readTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  });
  const offsetToken = formatter.formatToParts(date)
    .find((part) => part.type === "timeZoneName")
    ?.value;

  if (!offsetToken || offsetToken === "GMT") {
    return 0;
  }

  const match = offsetToken.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) {
    throw new Error(`Unsupported time zone offset token: ${offsetToken}`);
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  return sign * ((hours * 60) + minutes) * 60 * 1000;
}

function resolveColdStartTargetUrl(): string {
  return new URL(COLD_START_ROUTE_PATH, resolveAppBaseUrl()).toString();
}

function resolveQStashPublishEndpoint(targetUrl: string): string {
  const qstashBaseUrl = (readEnv("QSTASH_URL") ?? "https://qstash.upstash.io").replace(/\/$/, "");
  return `${qstashBaseUrl}/v2/publish/${targetUrl}`;
}

function resolveAppBaseUrl(): string {
  const explicit = readEnv("APP_BASE_URL");
  if (explicit) {
    return normalizeAbsoluteHttpUrl(explicit, "APP_BASE_URL");
  }

  const vercelUrl = readEnv("VERCEL_URL");
  if (vercelUrl) {
    return normalizeAbsoluteHttpUrl(`https://${vercelUrl}`, "VERCEL_URL");
  }

  throw new Error("Missing required env var: APP_BASE_URL or VERCEL_URL");
}

function normalizeAbsoluteHttpUrl(raw: string, envName: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${envName} must be a valid absolute URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${envName} must use http or https.`);
  }

  if (parsed.search.length > 0) {
    throw new Error(`${envName} must not include query params.`);
  }

  return parsed.origin;
}

function readEnv(name: string): string | undefined {
  const denoRuntime = (globalThis as unknown as {
    Deno?: { env?: { get?: (key: string) => string | undefined } };
  }).Deno;
  const denoValue = denoRuntime?.env?.get?.(name);
  if (typeof denoValue === "string" && denoValue.trim()) {
    return denoValue.trim();
  }

  const nodeRuntime = (globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  const nodeValue = nodeRuntime?.env?.[name];
  if (typeof nodeValue === "string" && nodeValue.trim()) {
    return nodeValue.trim();
  }

  return undefined;
}

function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function randomIntInclusive(min: number, max: number): number {
  const span = max - min + 1;
  const randomFraction = typeof crypto?.getRandomValues === "function"
    ? crypto.getRandomValues(new Uint32Array(1))[0]! / 0x1_0000_0000
    : Math.random();

  return min + Math.floor(randomFraction * span);
}

function readBooleanRpcResult(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (typeof first === "boolean") {
      return first;
    }
    if (first && typeof first === "object") {
      const row = first as Record<string, unknown>;
      const booleans = Object.values(row).filter((entry): entry is boolean => typeof entry === "boolean");
      if (booleans.length > 0) {
        return booleans[0];
      }
    }
  }

  throw new Error("Regional generator RPC returned a non-boolean result.");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const __private__ = {
  buildLinkupCreateKey,
  computeQuietHoursRetryDelaySeconds,
  normalizeGroupSizePreference,
  readBooleanRpcResult,
};
