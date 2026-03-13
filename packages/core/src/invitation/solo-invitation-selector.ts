import { createServiceRoleDbClient } from "../../../db/src/client-node.mjs";
import type { DbClient, DbRow, InterestSignatures, RelationalContext } from "../../../db/src/types";

const RECENT_INVITATION_WINDOW_DAYS = 14;
const DIVERSITY_BONUS = 0.10;
const NOVELTY_BONUS = 0.05;
const INTEREST_ALIGNMENT_MULTIPLIER = 0.15;
const INTEREST_ALIGNMENT_CAP = 0.20;
const RELATIONAL_CONTEXT_BONUS = 0.10;

const DEPTH_RELATIONAL_KEYWORDS = [
  "depth",
  "challenged",
  "invisible",
  "meaningful",
] as const;
const DEPTH_RELATIONAL_CATEGORIES = new Set(["connection", "exploration"]);
const EASE_RELATIONAL_KEYWORDS = [
  "ease",
  "familiar",
  "low-key",
  "comfortable",
] as const;
const EASE_RELATIONAL_CATEGORIES = new Set(["comfort", "restorative"]);

const PROPOSED_TIME_WINDOW_ORDER = [
  "weekend_morning",
  "weekend_afternoon",
  "weekend_evening",
  "weekday_morning",
  "weekday_afternoon",
  "weekday_evening",
] as const;

type DbClientLike = Pick<DbClient, "from">;
type ProposedTimeWindow = (typeof PROPOSED_TIME_WINDOW_ORDER)[number];

type UserRegionRow = Pick<DbRow<"users">, "region_id">;
type ProfileSignalsRow = Pick<
  DbRow<"profiles">,
  | "coordination_dimensions"
  | "activity_patterns"
  | "scheduling_availability"
  | "notice_preference"
  | "boundaries"
  | "interest_signatures"
  | "relational_context"
>;
type ActivityCatalogRow = Pick<
  DbRow<"activity_catalog">,
  "activity_key" | "category" | "motive_weights" | "preferred_windows" | "tags"
>;
type InvitationRecencyRow = Pick<DbRow<"invitations">, "activity_key" | "created_at">;
type AcceptedInvitationRow = Pick<DbRow<"invitations">, "activity_key" | "responded_at">;
type ActivityCategoryRow = Pick<DbRow<"activity_catalog">, "activity_key" | "category">;

export type SoloInvitationCandidate = {
  activityKey: string;
  proposedTimeWindow: string;
  locationHint: string | null;
  selectionScore: number;
  explainability: {
    motiveScore: number;
    diversityBonus: number;
    noveltyBonus: number;
    interestAlignmentBonus: number;
    relationalContextBonus: number;
  };
};

type ScoredActivityCandidate = SoloInvitationCandidate & {
  motiveScore: number;
};

export async function selectSoloInvitation(
  userId: string,
): Promise<SoloInvitationCandidate | null> {
  const db = createServiceRoleDbClient();
  const user = await fetchUserRegion(db, userId);
  if (!user.region_id) {
    return null;
  }

  const profile = await fetchProfileSignals(db, userId);
  const userAvailabilityBuckets = normalizeUserAvailability(profile.scheduling_availability);
  if (userAvailabilityBuckets.size === 0) {
    return null;
  }

  const [activities, recentInvitations, acceptedInvitations] = await Promise.all([
    fetchAnywhereActivities(db),
    fetchRecentInvitations(db, userId),
    fetchAcceptedInvitations(db, userId),
  ]);

  const recentInvitationKeys = new Set(
    recentInvitations.map((invitation) => invitation.activity_key),
  );
  const acceptedCategories = await fetchAcceptedActivityCategories(
    db,
    acceptedInvitations.map((invitation) => invitation.activity_key),
  );

  const blockedActivityKeys = extractNoThanks(profile.boundaries);
  const userMotiveWeights = deriveUserMotiveWeights(profile.activity_patterns);
  const historicalActivityKeys = extractHistoricalActivityKeys(profile.activity_patterns);
  const interestSignatures = toInterestSignatures(profile.interest_signatures);
  const relationalContext = toRelationalContext(profile.relational_context);

  const scoredCandidates: ScoredActivityCandidate[] = [];

  for (const activity of activities) {
    if (blockedActivityKeys.has(activity.activity_key)) {
      continue;
    }

    if (recentInvitationKeys.has(activity.activity_key)) {
      continue;
    }

    const activityAvailabilityBuckets = normalizeActivityWindows(activity.preferred_windows);
    const proposedTimeWindow = selectProposedTimeWindow(
      userAvailabilityBuckets,
      activityAvailabilityBuckets,
    );
    if (!proposedTimeWindow) {
      continue;
    }

    const motiveScore = computeMotiveScore(activity.motive_weights, userMotiveWeights);
    const diversityBonus = acceptedCategories.has(activity.category) ? 0 : DIVERSITY_BONUS;
    const noveltyBonus = historicalActivityKeys.has(activity.activity_key) ? 0 : NOVELTY_BONUS;
    const interestAlignmentBonus = computeInterestAlignmentBonus(
      interestSignatures,
      activity.tags,
    );
    const relationalContextBonus = computeRelationalContextBonus(
      relationalContext,
      activity.category,
    );
    const selectionScore =
      motiveScore +
      diversityBonus +
      noveltyBonus +
      interestAlignmentBonus +
      relationalContextBonus;

    scoredCandidates.push({
      activityKey: activity.activity_key,
      proposedTimeWindow,
      locationHint: null,
      selectionScore,
      explainability: {
        motiveScore,
        diversityBonus,
        noveltyBonus,
        interestAlignmentBonus,
        relationalContextBonus,
      },
      motiveScore,
    });
  }

  if (scoredCandidates.length === 0) {
    return null;
  }

  scoredCandidates.sort(compareScoredCandidates);
  const bestCandidate = scoredCandidates[0];

  return {
    activityKey: bestCandidate.activityKey,
    proposedTimeWindow: bestCandidate.proposedTimeWindow,
    locationHint: bestCandidate.locationHint,
    selectionScore: bestCandidate.selectionScore,
    explainability: bestCandidate.explainability,
  };
}

async function fetchUserRegion(
  db: DbClientLike,
  userId: string,
): Promise<UserRegionRow> {
  const { data, error } = await db
    .from("users")
    .select("region_id")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to resolve user region for solo invitation selection.");
  }

  if (!data) {
    throw new Error(`User '${userId}' not found for solo invitation selection.`);
  }

  return {
    region_id: typeof data.region_id === "string" ? data.region_id : null,
  };
}

async function fetchProfileSignals(
  db: DbClientLike,
  userId: string,
): Promise<ProfileSignalsRow> {
  const { data, error } = await db
    .from("profiles")
    .select(
      "coordination_dimensions,activity_patterns,scheduling_availability,notice_preference,boundaries,interest_signatures,relational_context",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to resolve profile signals for solo invitation selection.");
  }

  if (!data) {
    throw new Error(`Profile for user '${userId}' not found for solo invitation selection.`);
  }

  return {
    coordination_dimensions: data.coordination_dimensions,
    activity_patterns: data.activity_patterns,
    scheduling_availability: data.scheduling_availability,
    notice_preference:
      typeof data.notice_preference === "string" ? data.notice_preference : null,
    boundaries: data.boundaries,
    interest_signatures: data.interest_signatures,
    relational_context: data.relational_context,
  };
}

async function fetchAnywhereActivities(
  db: DbClientLike,
): Promise<ActivityCatalogRow[]> {
  const { data, error } = await db
    .from("activity_catalog")
    .select("activity_key,category,motive_weights,preferred_windows,tags")
    .eq("regional_availability", "anywhere");

  if (error) {
    throw new Error("Unable to resolve activity catalog for solo invitation selection.");
  }

  return (data ?? []).map((row) => ({
    activity_key: typeof row.activity_key === "string" ? row.activity_key : "",
    category: typeof row.category === "string" ? row.category : "",
    motive_weights: row.motive_weights,
    preferred_windows: Array.isArray(row.preferred_windows)
      ? row.preferred_windows.filter((value): value is string => typeof value === "string")
      : [],
    tags: Array.isArray(row.tags)
      ? row.tags.filter((value): value is string => typeof value === "string")
      : null,
  }));
}

async function fetchRecentInvitations(
  db: DbClientLike,
  userId: string,
): Promise<InvitationRecencyRow[]> {
  const cutoffIso = new Date(
    Date.now() - RECENT_INVITATION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await db
    .from("invitations")
    .select("activity_key,created_at")
    .eq("user_id", userId)
    .gte("created_at", cutoffIso);

  if (error) {
    throw new Error("Unable to resolve recent invitations for solo invitation selection.");
  }

  return (data ?? []).map((row) => ({
    activity_key: typeof row.activity_key === "string" ? row.activity_key : "",
    created_at: typeof row.created_at === "string" ? row.created_at : "",
  }));
}

async function fetchAcceptedInvitations(
  db: DbClientLike,
  userId: string,
): Promise<AcceptedInvitationRow[]> {
  const { data, error } = await db
    .from("invitations")
    .select("activity_key,responded_at")
    .eq("user_id", userId)
    .eq("state", "accepted")
    .order("responded_at", { ascending: false })
    .limit(3);

  if (error) {
    throw new Error("Unable to resolve accepted invitations for solo invitation selection.");
  }

  return (data ?? []).map((row) => ({
    activity_key: typeof row.activity_key === "string" ? row.activity_key : "",
    responded_at: typeof row.responded_at === "string" ? row.responded_at : null,
  }));
}

async function fetchAcceptedActivityCategories(
  db: DbClientLike,
  activityKeys: string[],
): Promise<Set<string>> {
  const validKeys = activityKeys.filter((key) => key.length > 0);
  if (validKeys.length === 0) {
    return new Set();
  }

  const { data, error } = await db
    .from("activity_catalog")
    .select("activity_key,category")
    .in("activity_key", validKeys);

  if (error) {
    throw new Error("Unable to resolve accepted activity categories for solo invitation selection.");
  }

  return new Set(
    (data ?? [])
      .map((row): ActivityCategoryRow => ({
        activity_key: typeof row.activity_key === "string" ? row.activity_key : "",
        category: typeof row.category === "string" ? row.category : "",
      }))
      .map((row) => row.category)
      .filter((category) => category.length > 0),
  );
}

function extractNoThanks(boundaries: unknown): Set<string> {
  const boundaryObject = asRecord(boundaries);
  const rawNoThanks = boundaryObject.no_thanks;
  if (!Array.isArray(rawNoThanks)) {
    return new Set();
  }

  return new Set(
    rawNoThanks.filter((value): value is string => typeof value === "string"),
  );
}

function deriveUserMotiveWeights(activityPatterns: unknown): Record<string, number> {
  const patterns = asRecordArray(activityPatterns);
  const userMotiveWeights: Record<string, number> = {};

  for (const pattern of patterns) {
    const rawMotiveWeights = asRecord(pattern.motive_weights);
    for (const [motive, value] of Object.entries(rawMotiveWeights)) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        continue;
      }

      userMotiveWeights[motive] = Math.max(userMotiveWeights[motive] ?? 0, value);
    }
  }

  return userMotiveWeights;
}

function extractHistoricalActivityKeys(activityPatterns: unknown): Set<string> {
  const patterns = asRecordArray(activityPatterns);
  return new Set(
    patterns
      .map((pattern) => pattern.activity_key)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
}

function computeMotiveScore(
  activityMotiveWeights: unknown,
  userMotiveWeights: Record<string, number>,
): number {
  const activityWeights = asRecord(activityMotiveWeights);
  let score = 0;

  for (const [motive, value] of Object.entries(activityWeights)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }

    score += Math.min(value, userMotiveWeights[motive] ?? 0);
  }

  return score;
}

function computeInterestAlignmentBonus(
  interestSignatures: InterestSignatures,
  tags: string[] | null,
): number {
  if (interestSignatures.length === 0 || !tags || tags.length === 0) {
    return 0;
  }

  const tagTokens = new Set(tags.flatMap((tag) => tokenize(tag)));
  let bonus = 0;

  for (const signature of interestSignatures) {
    const domainTokens = tokenize(signature.domain);
    if (domainTokens.some((token) => tagTokens.has(token))) {
      bonus += INTEREST_ALIGNMENT_MULTIPLIER * signature.intensity;
    }
  }

  return Math.min(INTEREST_ALIGNMENT_CAP, bonus);
}

function computeRelationalContextBonus(
  relationalContext: RelationalContext | null,
  category: string,
): number {
  const connectionMotivation = relationalContext?.connection_motivation;
  if (!connectionMotivation) {
    return 0;
  }

  const normalizedMotivation = connectionMotivation.toLowerCase();
  if (
    DEPTH_RELATIONAL_KEYWORDS.some((keyword) => normalizedMotivation.includes(keyword)) &&
    DEPTH_RELATIONAL_CATEGORIES.has(category)
  ) {
    return RELATIONAL_CONTEXT_BONUS;
  }

  if (
    EASE_RELATIONAL_KEYWORDS.some((keyword) => normalizedMotivation.includes(keyword)) &&
    EASE_RELATIONAL_CATEGORIES.has(category)
  ) {
    return RELATIONAL_CONTEXT_BONUS;
  }

  return 0;
}

function selectProposedTimeWindow(
  userBuckets: Set<ProposedTimeWindow>,
  activityBuckets: Set<ProposedTimeWindow>,
): ProposedTimeWindow | null {
  for (const bucket of PROPOSED_TIME_WINDOW_ORDER) {
    if (userBuckets.has(bucket) && activityBuckets.has(bucket)) {
      return bucket;
    }
  }

  return null;
}

function normalizeUserAvailability(
  schedulingAvailability: unknown,
): Set<ProposedTimeWindow> {
  const buckets = new Set<ProposedTimeWindow>();

  if (Array.isArray(schedulingAvailability)) {
    addGenericAvailabilityValues(schedulingAvailability, buckets);
    return buckets;
  }

  const availabilityObject = asRecord(schedulingAvailability);
  addScopedAvailabilityValues(availabilityObject.weekdays, "weekday", buckets);
  addScopedAvailabilityValues(availabilityObject.weekends, "weekend", buckets);
  addGenericAvailabilityValues(availabilityObject.windows, buckets);
  addGenericAvailabilityValues(availabilityObject.preferred_windows, buckets);

  return buckets;
}

function normalizeActivityWindows(
  preferredWindows: string[],
): Set<ProposedTimeWindow> {
  const buckets = new Set<ProposedTimeWindow>();

  for (const window of preferredWindows) {
    switch (normalizeWindowToken(window)) {
      case "morning":
        buckets.add("weekday_morning");
        buckets.add("weekend_morning");
        break;
      case "afternoon":
        buckets.add("weekday_afternoon");
        buckets.add("weekend_afternoon");
        break;
      case "evening":
        buckets.add("weekday_evening");
        buckets.add("weekend_evening");
        break;
      case "weekend":
      case "weekends_only":
        buckets.add("weekend_morning");
        buckets.add("weekend_afternoon");
        buckets.add("weekend_evening");
        break;
    }
  }

  return buckets;
}

function addScopedAvailabilityValues(
  rawValues: unknown,
  scope: "weekday" | "weekend",
  buckets: Set<ProposedTimeWindow>,
): void {
  if (!Array.isArray(rawValues)) {
    return;
  }

  for (const rawValue of rawValues) {
    if (typeof rawValue !== "string") {
      continue;
    }

    switch (normalizeWindowToken(rawValue)) {
      case "morning":
        buckets.add(`${scope}_morning`);
        break;
      case "afternoon":
        buckets.add(`${scope}_afternoon`);
        break;
      case "evening":
        buckets.add(`${scope}_evening`);
        break;
      case "weekend":
      case "weekends_only":
        if (scope === "weekend") {
          buckets.add("weekend_morning");
          buckets.add("weekend_afternoon");
          buckets.add("weekend_evening");
        }
        break;
    }
  }
}

function addGenericAvailabilityValues(
  rawValues: unknown,
  buckets: Set<ProposedTimeWindow>,
): void {
  if (!Array.isArray(rawValues)) {
    return;
  }

  for (const rawValue of rawValues) {
    if (typeof rawValue !== "string") {
      continue;
    }

    switch (normalizeWindowToken(rawValue)) {
      case "morning":
        buckets.add("weekday_morning");
        buckets.add("weekend_morning");
        break;
      case "afternoon":
        buckets.add("weekday_afternoon");
        buckets.add("weekend_afternoon");
        break;
      case "evening":
        buckets.add("weekday_evening");
        buckets.add("weekend_evening");
        break;
      case "weekend":
      case "weekends_only":
        buckets.add("weekend_morning");
        buckets.add("weekend_afternoon");
        buckets.add("weekend_evening");
        break;
    }
  }
}

function normalizeWindowToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[\s-]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function toInterestSignatures(value: unknown): InterestSignatures {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asRecord(entry))
    .filter((entry) =>
      typeof entry.domain === "string" &&
      typeof entry.intensity === "number" &&
      Number.isFinite(entry.intensity)
    )
    .map((entry) => ({
      domain: entry.domain as string,
      intensity: entry.intensity as number,
      confidence:
        typeof entry.confidence === "number" && Number.isFinite(entry.confidence)
          ? entry.confidence
          : 0,
    }));
}

function toRelationalContext(value: unknown): RelationalContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const relationalContext = value as Record<string, unknown>;
  return {
    life_stage_signal:
      typeof relationalContext.life_stage_signal === "string"
        ? relationalContext.life_stage_signal
        : null,
    connection_motivation:
      typeof relationalContext.connection_motivation === "string"
        ? relationalContext.connection_motivation
        : null,
    social_history_hint:
      typeof relationalContext.social_history_hint === "string"
        ? relationalContext.social_history_hint
        : null,
  };
}

function compareScoredCandidates(
  left: ScoredActivityCandidate,
  right: ScoredActivityCandidate,
): number {
  if (right.selectionScore !== left.selectionScore) {
    return right.selectionScore - left.selectionScore;
  }

  if (right.motiveScore !== left.motiveScore) {
    return right.motiveScore - left.motiveScore;
  }

  return left.activityKey.localeCompare(right.activityKey);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is Record<string, unknown> =>
      !!entry && typeof entry === "object" && !Array.isArray(entry),
  );
}
