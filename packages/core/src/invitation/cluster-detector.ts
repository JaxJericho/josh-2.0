import { createHash } from "node:crypto";
import { createServiceRoleDbClient } from "../../../db/src/client-node.mjs";
import type {
  CoordinationDimensionKey,
  DbClient,
  DbInsert,
  DbRow,
  GroupSizePreference,
  InterestSignatures,
} from "../../../db/src/types";
import { scorePair, type CompatibilitySignalSnapshot } from "../compatibility/scorer";
import { CLUSTER_MIN_PAIRWISE_SCORE, MAX_CLUSTER_SIZE } from "./constants";

const SCORE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ADJUSTED_INTEREST_WEIGHT = 0.10;
const ROUND_DIGITS = 3;

const COORDINATION_DIMENSION_KEYS: readonly CoordinationDimensionKey[] = [
  "social_energy",
  "social_pace",
  "conversation_depth",
  "adventure_orientation",
  "group_dynamic",
  "values_proximity",
];

const PROPOSED_TIME_WINDOW_ORDER = [
  "weekend_morning",
  "weekend_afternoon",
  "weekend_evening",
  "weekday_morning",
  "weekday_afternoon",
  "weekday_evening",
] as const;

type ProposedTimeWindow = (typeof PROPOSED_TIME_WINDOW_ORDER)[number];
type DbClientLike = Pick<DbClient, "from">;
type ScoreCacheRow = Pick<
  DbRow<"compatibility_score_cache">,
  "user_a_id" | "user_b_id" | "profile_hash_a" | "profile_hash_b" | "score" | "computed_at"
>;

type EligibleProfile = CompatibilitySignalSnapshot & {
  activity_patterns?: unknown;
  scheduling_availability?: unknown;
  boundaries?: unknown;
  interest_signatures?: unknown;
};

type ParsedDimension = {
  value: number;
  confidence: number;
};

type ParsedDimensions = Partial<Record<CoordinationDimensionKey, ParsedDimension>>;

type ActivityPattern = {
  activityKey: string;
  motiveWeights: Record<string, number>;
};

type PairEvaluation = {
  key: string;
  userAId: string;
  userBId: string;
  score: number;
  interestOverlapScore: number;
};

type CandidateExtension = {
  userId: string;
  meanScore: number;
  minScore: number;
};

export type EligibleUser = {
  userId: string;
  profile: EligibleProfile;
  groupSizePreference: GroupSizePreference;
};

export type Cluster = {
  members: string[];
  pairScores: Record<string, number>;
  clusterScore: number;
  adjustedClusterScore: number;
  interestOverlapScore: number;
  activityKey: string | null;
  proposedTimeWindow: string | null;
  activityUnresolvable: boolean;
  timeWindowUnresolvable: boolean;
};

export async function detectClusters(
  eligibleUsers: EligibleUser[],
): Promise<Cluster[]> {
  if (eligibleUsers.length < 2) {
    return [];
  }

  const db = createServiceRoleDbClient();
  const usersById = new Map(eligibleUsers.map((user) => [user.userId, user]));
  const pairEvaluations = await evaluateAllPairs(eligibleUsers, db);
  const sortedPairs = Array.from(pairEvaluations.values()).sort(comparePairEvaluations);
  const clusteredUserIds = new Set<string>();
  const clusters: Cluster[] = [];

  for (const pair of sortedPairs) {
    if (clusteredUserIds.has(pair.userAId) || clusteredUserIds.has(pair.userBId)) {
      continue;
    }

    if (pair.score < CLUSTER_MIN_PAIRWISE_SCORE) {
      continue;
    }

    const memberIds = [pair.userAId, pair.userBId];
    while (memberIds.length < MAX_CLUSTER_SIZE) {
      const candidate = findNextClusterMember(
        eligibleUsers,
        memberIds,
        clusteredUserIds,
        pairEvaluations,
      );
      if (!candidate) {
        break;
      }

      memberIds.push(candidate.userId);
    }

    const clusterUsers = memberIds.map((userId) => {
      const user = usersById.get(userId);
      if (!user) {
        throw new Error(`Eligible user '${userId}' was not found while building a cluster.`);
      }
      return user;
    });

    for (const userId of memberIds) {
      clusteredUserIds.add(userId);
    }

    clusters.push(buildCluster(clusterUsers, pairEvaluations));
  }

  return clusters.sort(compareClusters);
}

async function evaluateAllPairs(
  eligibleUsers: EligibleUser[],
  db: DbClientLike,
): Promise<Map<string, PairEvaluation>> {
  const pairEvaluations = new Map<string, PairEvaluation>();

  for (let leftIndex = 0; leftIndex < eligibleUsers.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < eligibleUsers.length; rightIndex += 1) {
      const evaluation = await evaluatePair(
        eligibleUsers[leftIndex],
        eligibleUsers[rightIndex],
        db,
      );
      pairEvaluations.set(evaluation.key, evaluation);
    }
  }

  return pairEvaluations;
}

async function evaluatePair(
  leftUser: EligibleUser,
  rightUser: EligibleUser,
  db: DbClientLike,
): Promise<PairEvaluation> {
  const [userA, userB] = orderUsers(leftUser, rightUser);
  const currentHashA = resolveProfileHash(userA.profile);
  const currentHashB = resolveProfileHash(userB.profile);
  const cached = await fetchCachedScore(db, userA.userId, userB.userId);

  let score = 0;
  if (isFreshCachedScore(cached, currentHashA, currentHashB)) {
    score = readCachedScore(cached.score);
  } else {
    const scoredPair = scorePair(userA.profile, userB.profile);
    score = scoredPair.score;

    await writeCachedScore(db, {
      user_a_id: userA.userId,
      user_b_id: userB.userId,
      profile_hash_a: scoredPair.a_hash,
      profile_hash_b: scoredPair.b_hash,
      score: scoredPair.score,
      computed_at: new Date().toISOString(),
    });
  }

  return {
    key: buildPairKey(userA.userId, userB.userId),
    userAId: userA.userId,
    userBId: userB.userId,
    score,
    interestOverlapScore: computeInterestOverlap(
      userA.profile.interest_signatures,
      userB.profile.interest_signatures,
    ),
  };
}

async function fetchCachedScore(
  db: DbClientLike,
  userAId: string,
  userBId: string,
): Promise<ScoreCacheRow | null> {
  const { data, error } = await db
    .from("compatibility_score_cache")
    .select("user_a_id,user_b_id,profile_hash_a,profile_hash_b,score,computed_at")
    .eq("user_a_id", userAId)
    .eq("user_b_id", userBId)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to read compatibility score cache.");
  }

  if (!data) {
    return null;
  }

  return {
    user_a_id: String(data.user_a_id),
    user_b_id: String(data.user_b_id),
    profile_hash_a: String(data.profile_hash_a),
    profile_hash_b: String(data.profile_hash_b),
    score: data.score,
    computed_at: String(data.computed_at),
  };
}

async function writeCachedScore(
  db: DbClientLike,
  row: DbInsert<"compatibility_score_cache">,
): Promise<void> {
  const { error } = await db
    .from("compatibility_score_cache")
    .upsert(row, { onConflict: "user_a_id,user_b_id" });

  if (error) {
    throw new Error("Unable to update compatibility score cache.");
  }
}

function isFreshCachedScore(
  cached: ScoreCacheRow | null,
  currentHashA: string,
  currentHashB: string,
): cached is ScoreCacheRow {
  if (!cached) {
    return false;
  }

  if (
    cached.profile_hash_a !== currentHashA ||
    cached.profile_hash_b !== currentHashB
  ) {
    return false;
  }

  const computedAtMs = new Date(cached.computed_at).getTime();
  if (!Number.isFinite(computedAtMs)) {
    return false;
  }

  return computedAtMs > Date.now() - SCORE_CACHE_TTL_MS;
}

function readCachedScore(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new Error("Compatibility score cache contained a non-numeric score.");
}

function findNextClusterMember(
  eligibleUsers: EligibleUser[],
  memberIds: string[],
  clusteredUserIds: Set<string>,
  pairEvaluations: Map<string, PairEvaluation>,
): CandidateExtension | null {
  const memberIdSet = new Set(memberIds);
  const rankedCandidates = eligibleUsers
    .filter((user) => !clusteredUserIds.has(user.userId) && !memberIdSet.has(user.userId))
    .map((user) => {
      const scores = memberIds.map((memberId) =>
        getPairEvaluation(pairEvaluations, user.userId, memberId).score
      );

      return {
        userId: user.userId,
        meanScore: mean(scores),
        minScore: Math.min(...scores),
      };
    })
    .sort(compareCandidateExtensions);

  return rankedCandidates.find((candidate) =>
    candidate.minScore >= CLUSTER_MIN_PAIRWISE_SCORE
  ) ?? null;
}

function buildCluster(
  members: EligibleUser[],
  pairEvaluations: Map<string, PairEvaluation>,
): Cluster {
  const pairScores: Record<string, number> = {};
  const pairScoreValues: number[] = [];
  const pairInterestValues: number[] = [];

  for (let leftIndex = 0; leftIndex < members.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < members.length; rightIndex += 1) {
      const pair = getPairEvaluation(
        pairEvaluations,
        members[leftIndex].userId,
        members[rightIndex].userId,
      );
      pairScores[pair.key] = pair.score;
      pairScoreValues.push(pair.score);
      pairInterestValues.push(pair.interestOverlapScore);
    }
  }

  const clusterScore = round(mean(pairScoreValues));
  const interestOverlapScore = round(mean(pairInterestValues));
  const adjustedClusterScore = round(
    clusterScore + (interestOverlapScore * ADJUSTED_INTEREST_WEIGHT)
  );
  const activityKey = selectClusterActivity(members);
  const proposedTimeWindow = selectClusterTimeWindow(members);

  return {
    members: members.map((member) => member.userId),
    pairScores,
    clusterScore,
    adjustedClusterScore,
    interestOverlapScore,
    activityKey,
    proposedTimeWindow,
    activityUnresolvable: activityKey == null,
    timeWindowUnresolvable: proposedTimeWindow == null,
  };
}

function selectClusterActivity(members: EligibleUser[]): string | null {
  const blockedActivities = members.map((member) => extractNoThanks(member.profile.boundaries));
  const aggregatedActivityWeights = collectClusterActivities(members);
  const memberMotiveWeights = members.map((member) =>
    deriveUserMotiveWeights(member.profile.activity_patterns)
  );

  const rankedActivities = Array.from(aggregatedActivityWeights.entries())
    .filter(([activityKey]) => blockedActivities.every((blocked) => !blocked.has(activityKey)))
    .map(([activityKey, motiveWeights]) => ({
      activityKey,
      score: mean(
        memberMotiveWeights.map((userMotiveWeights) =>
          computeMotiveScore(motiveWeights, userMotiveWeights)
        ),
      ),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.activityKey.localeCompare(right.activityKey);
    });

  return rankedActivities[0]?.activityKey ?? null;
}

function collectClusterActivities(
  members: EligibleUser[],
): Map<string, Record<string, number>> {
  const activities = new Map<string, Record<string, number>>();

  for (const member of members) {
    for (const pattern of toActivityPatterns(member.profile.activity_patterns)) {
      const existingWeights = activities.get(pattern.activityKey) ?? {};
      const nextWeights = { ...existingWeights };

      for (const [motive, value] of Object.entries(pattern.motiveWeights)) {
        nextWeights[motive] = Math.max(nextWeights[motive] ?? 0, value);
      }

      activities.set(pattern.activityKey, nextWeights);
    }
  }

  return activities;
}

function selectClusterTimeWindow(members: EligibleUser[]): ProposedTimeWindow | null {
  let overlappingWindows: Set<ProposedTimeWindow> | null = null;

  for (const member of members) {
    const availability = normalizeUserAvailability(member.profile.scheduling_availability);
    if (overlappingWindows == null) {
      overlappingWindows = availability;
      continue;
    }

    overlappingWindows = intersectSets(overlappingWindows, availability);
  }

  if (!overlappingWindows || overlappingWindows.size === 0) {
    return null;
  }

  for (const window of PROPOSED_TIME_WINDOW_ORDER) {
    if (overlappingWindows.has(window)) {
      return window;
    }
  }

  return null;
}

function computeInterestOverlap(
  leftRaw: unknown,
  rightRaw: unknown,
): number {
  const leftSignatures = toInterestSignatures(leftRaw);
  const rightSignatures = toInterestSignatures(rightRaw);
  const leftTokens = new Set(leftSignatures.flatMap((signature) => tokenize(signature.domain)));
  const rightTokens = new Set(rightSignatures.flatMap((signature) => tokenize(signature.domain)));

  let sharedTokenCount = 0;
  for (const token of Array.from(leftTokens)) {
    if (rightTokens.has(token)) {
      sharedTokenCount += 1;
    }
  }

  return round(
    sharedTokenCount /
      Math.max(leftSignatures.length, rightSignatures.length, 1),
  );
}

function comparePairEvaluations(left: PairEvaluation, right: PairEvaluation): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (right.interestOverlapScore !== left.interestOverlapScore) {
    return right.interestOverlapScore - left.interestOverlapScore;
  }

  return left.key.localeCompare(right.key);
}

function compareCandidateExtensions(
  left: CandidateExtension,
  right: CandidateExtension,
): number {
  if (right.meanScore !== left.meanScore) {
    return right.meanScore - left.meanScore;
  }

  if (right.minScore !== left.minScore) {
    return right.minScore - left.minScore;
  }

  return left.userId.localeCompare(right.userId);
}

function compareClusters(left: Cluster, right: Cluster): number {
  if (right.adjustedClusterScore !== left.adjustedClusterScore) {
    return right.adjustedClusterScore - left.adjustedClusterScore;
  }

  if (right.clusterScore !== left.clusterScore) {
    return right.clusterScore - left.clusterScore;
  }

  return left.members.join(":").localeCompare(right.members.join(":"));
}

function orderUsers(
  left: EligibleUser,
  right: EligibleUser,
): [EligibleUser, EligibleUser] {
  if (left.userId.localeCompare(right.userId) <= 0) {
    return [left, right];
  }

  return [right, left];
}

function buildPairKey(leftUserId: string, rightUserId: string): string {
  return leftUserId.localeCompare(rightUserId) <= 0
    ? `${leftUserId}:${rightUserId}`
    : `${rightUserId}:${leftUserId}`;
}

function getPairEvaluation(
  pairEvaluations: Map<string, PairEvaluation>,
  leftUserId: string,
  rightUserId: string,
): PairEvaluation {
  const key = buildPairKey(leftUserId, rightUserId);
  const evaluation = pairEvaluations.get(key);
  if (!evaluation) {
    throw new Error(`Missing pair evaluation for '${key}'.`);
  }
  return evaluation;
}

function resolveProfileHash(profile: EligibleProfile): string {
  if (typeof profile.content_hash === "string" && profile.content_hash.length > 0) {
    return profile.content_hash;
  }

  return createHash("sha256")
    .update(stableStringify(parseDimensions(profile.coordination_dimensions)))
    .digest("hex");
}

function parseDimensions(raw: unknown): ParsedDimensions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const record = raw as Record<string, unknown>;
  const parsed: ParsedDimensions = {};

  for (const key of COORDINATION_DIMENSION_KEYS) {
    const nodeRaw = record[key];
    if (!nodeRaw || typeof nodeRaw !== "object" || Array.isArray(nodeRaw)) {
      continue;
    }

    const node = nodeRaw as Record<string, unknown>;
    const value = toUnitInterval(node.value);
    const confidence = toUnitInterval(node.confidence);
    if (value == null || confidence == null) {
      continue;
    }

    parsed[key] = { value, confidence };
  }

  return parsed;
}

function toUnitInterval(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return round(Math.min(1, Math.max(0, value)));
}

function stableStringify(value: unknown): string {
  if (value === null) {
    return "null";
  }

  const valueType = typeof value;
  if (valueType === "number" || valueType === "boolean") {
    return JSON.stringify(value);
  }

  if (valueType === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (valueType === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(",");
    return `{${entries}}`;
  }

  return JSON.stringify(null);
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
  const userMotiveWeights: Record<string, number> = {};

  for (const pattern of toActivityPatterns(activityPatterns)) {
    for (const [motive, value] of Object.entries(pattern.motiveWeights)) {
      userMotiveWeights[motive] = Math.max(userMotiveWeights[motive] ?? 0, value);
    }
  }

  return userMotiveWeights;
}

function computeMotiveScore(
  activityMotiveWeights: Record<string, number>,
  userMotiveWeights: Record<string, number>,
): number {
  let score = 0;

  for (const [motive, value] of Object.entries(activityMotiveWeights)) {
    score += Math.min(value, userMotiveWeights[motive] ?? 0);
  }

  return score;
}

function toActivityPatterns(value: unknown): ActivityPattern[] {
  return asRecordArray(value)
    .map((entry) => ({
      activityKey:
        typeof entry.activity_key === "string" ? entry.activity_key : "",
      motiveWeights: asNumericRecord(entry.motive_weights),
    }))
    .filter((pattern) => pattern.activityKey.length > 0);
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

function intersectSets<T>(left: Set<T>, right: Set<T>): Set<T> {
  const intersection = new Set<T>();

  for (const value of Array.from(left)) {
    if (right.has(value)) {
      intersection.add(value);
    }
  }

  return intersection;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value: number): number {
  const multiplier = 10 ** ROUND_DIGITS;
  return Math.round(value * multiplier) / multiplier;
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

function asNumericRecord(value: unknown): Record<string, number> {
  const numericRecord: Record<string, number> = {};

  for (const [key, entryValue] of Object.entries(asRecord(value))) {
    if (typeof entryValue === "number" && Number.isFinite(entryValue)) {
      numericRecord[key] = entryValue;
    }
  }

  return numericRecord;
}
