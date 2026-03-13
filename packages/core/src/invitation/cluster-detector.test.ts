import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createServiceRoleDbClientMock, scorePairMock } = vi.hoisted(() => ({
  createServiceRoleDbClientMock: vi.fn(),
  scorePairMock: vi.fn(),
}));

vi.mock("../../../db/src/client-node.mjs", () => ({
  createServiceRoleDbClient: createServiceRoleDbClientMock,
}));

vi.mock("../compatibility/scorer", () => ({
  scorePair: scorePairMock,
}));

import { detectClusters, type EligibleUser } from "./cluster-detector";

type CacheRow = {
  user_a_id: string;
  user_b_id: string;
  profile_hash_a: string;
  profile_hash_b: string;
  score: number;
  computed_at: string;
};

type Row = Record<string, unknown>;

function buildDbClient(initialRows: CacheRow[] = []) {
  const rows = new Map(
    initialRows.map((row) => [`${row.user_a_id}:${row.user_b_id}`, { ...row }]),
  );
  const calls = {
    selects: [] as Array<{ userAId: string; userBId: string }>,
    upserts: [] as Array<{ row: CacheRow; options: unknown }>,
  };

  function createBuilder() {
    const filters: Partial<Record<keyof CacheRow, string>> = {};

    return {
      select() {
        return this;
      },
      eq(column: keyof CacheRow, value: string) {
        filters[column] = value;
        return this;
      },
      maybeSingle: vi.fn(async () => {
        const userAId = filters.user_a_id ?? "";
        const userBId = filters.user_b_id ?? "";
        calls.selects.push({ userAId, userBId });

        return {
          data: rows.get(`${userAId}:${userBId}`) ?? null,
          error: null,
        };
      }),
      upsert: vi.fn(async (row: CacheRow, options?: unknown) => {
        rows.set(`${row.user_a_id}:${row.user_b_id}`, { ...row });
        calls.upserts.push({ row: { ...row }, options });
        return { data: null, error: null };
      }),
    };
  }

  return {
    db: {
      from(table: string) {
        if (table !== "compatibility_score_cache") {
          throw new Error(`Unexpected table '${table}'.`);
        }
        return createBuilder();
      },
    },
    calls,
    rows,
  };
}

function buildUser(
  userId: string,
  overrides: Partial<EligibleUser["profile"]> = {},
): EligibleUser {
  return {
    userId,
    groupSizePreference: { min: 2, max: 10 },
    profile: {
      content_hash: userId,
      coordination_dimensions: {
        social_energy: { value: 0.5, confidence: 0.7 },
      },
      activity_patterns: [
        {
          activity_key: "coffee_walk",
          motive_weights: {
            connection: 0.8,
            comfort: 0.6,
          },
        },
      ],
      scheduling_availability: {
        weekends: ["morning", "afternoon"],
      },
      boundaries: {
        no_thanks: [],
      },
      interest_signatures: [],
      ...overrides,
    },
  };
}

function setPairScores(scoreMap: Record<string, number>) {
  scorePairMock.mockImplementation((left: Row, right: Row) => {
    const leftId = String(left.content_hash);
    const rightId = String(right.content_hash);
    const key = buildPairKey(leftId, rightId);
    const score = scoreMap[key];

    if (typeof score !== "number") {
      throw new Error(`Missing mock score for ${key}.`);
    }

    return {
      score,
      breakdown: {
        social_energy: 0,
        social_pace: 0,
        conversation_depth: 0,
        adventure_orientation: 0,
        group_dynamic: 0,
        values_proximity: 0,
        coverage: 1,
        total: score,
      },
      a_hash: leftId,
      b_hash: rightId,
      version: "test",
    };
  });
}

function buildPairKey(leftUserId: string, rightUserId: string): string {
  return leftUserId.localeCompare(rightUserId) <= 0
    ? `${leftUserId}:${rightUserId}`
    : `${rightUserId}:${leftUserId}`;
}

function buildCompleteScoreMap(users: EligibleUser[], defaultScore: number): Record<string, number> {
  const scores: Record<string, number> = {};

  for (let leftIndex = 0; leftIndex < users.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < users.length; rightIndex += 1) {
      scores[buildPairKey(users[leftIndex].userId, users[rightIndex].userId)] = defaultScore;
    }
  }

  return scores;
}

describe("detectClusters", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-13T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("forms greedy pair-first clusters with deterministic scores", async () => {
    const users = [
      buildUser("00000000-0000-0000-0000-000000000001"),
      buildUser("00000000-0000-0000-0000-000000000002"),
      buildUser("00000000-0000-0000-0000-000000000003"),
      buildUser("00000000-0000-0000-0000-000000000004", {
        activity_patterns: [{ activity_key: "museum_visit", motive_weights: { exploration: 0.8 } }],
      }),
      buildUser("00000000-0000-0000-0000-000000000005", {
        activity_patterns: [{ activity_key: "museum_visit", motive_weights: { exploration: 0.7 } }],
      }),
    ];
    const scoreMap = buildCompleteScoreMap(users, 0.4);
    scoreMap[buildPairKey(users[0].userId, users[1].userId)] = 0.8;
    scoreMap[buildPairKey(users[0].userId, users[2].userId)] = 0.7;
    scoreMap[buildPairKey(users[1].userId, users[2].userId)] = 0.72;
    scoreMap[buildPairKey(users[3].userId, users[4].userId)] = 0.67;
    setPairScores(scoreMap);

    const dbClient = buildDbClient();
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    const clusters = await detectClusters(users);

    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toMatchObject({
      members: [users[0].userId, users[1].userId, users[2].userId],
      activityKey: "coffee_walk",
      proposedTimeWindow: "weekend_morning",
      activityUnresolvable: false,
      timeWindowUnresolvable: false,
    });
    expect(clusters[1]).toMatchObject({
      members: [users[3].userId, users[4].userId],
      activityKey: "museum_visit",
      proposedTimeWindow: "weekend_morning",
      activityUnresolvable: false,
      timeWindowUnresolvable: false,
    });
  });

  it("does not add a candidate when any pair score to the cluster is below the floor", async () => {
    const users = [
      buildUser("00000000-0000-0000-0000-000000000011"),
      buildUser("00000000-0000-0000-0000-000000000012"),
      buildUser("00000000-0000-0000-0000-000000000013"),
      buildUser("00000000-0000-0000-0000-000000000014"),
    ];
    const scoreMap = buildCompleteScoreMap(users, 0.4);
    scoreMap[buildPairKey(users[0].userId, users[1].userId)] = 0.8;
    scoreMap[buildPairKey(users[0].userId, users[2].userId)] = 0.7;
    scoreMap[buildPairKey(users[1].userId, users[2].userId)] = 0.72;
    scoreMap[buildPairKey(users[0].userId, users[3].userId)] = 0.8;
    scoreMap[buildPairKey(users[1].userId, users[3].userId)] = 0.6;
    scoreMap[buildPairKey(users[2].userId, users[3].userId)] = 0.8;
    setPairScores(scoreMap);

    const dbClient = buildDbClient();
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    const clusters = await detectClusters(users);

    expect(clusters[0]?.members).toEqual([
      users[0].userId,
      users[1].userId,
      users[2].userId,
    ]);
    expect(clusters.flatMap((cluster) => cluster.members)).not.toContain(users[3].userId);
  });

  it("caps the cluster at MAX_CLUSTER_SIZE", async () => {
    const users = Array.from({ length: 11 }, (_, index) =>
      buildUser(`00000000-0000-0000-0000-0000000001${String(index).padStart(2, "0")}`)
    );
    setPairScores(buildCompleteScoreMap(users, 0.8));

    const dbClient = buildDbClient();
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    const clusters = await detectClusters(users);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.members).toHaveLength(10);
    expect(clusters[0]?.members).not.toContain(users[10].userId);
  });

  it("marks a cluster as activity unresolvable when every candidate is blocked", async () => {
    const users = [
      buildUser("00000000-0000-0000-0000-000000000021", {
        activity_patterns: [{ activity_key: "coffee_walk", motive_weights: { connection: 0.9 } }],
        boundaries: { no_thanks: ["museum_visit"] },
      }),
      buildUser("00000000-0000-0000-0000-000000000022", {
        activity_patterns: [{ activity_key: "museum_visit", motive_weights: { exploration: 0.8 } }],
        boundaries: { no_thanks: ["coffee_walk"] },
      }),
    ];
    setPairScores({
      [buildPairKey(users[0].userId, users[1].userId)]: 0.8,
    });

    const dbClient = buildDbClient();
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    const [cluster] = await detectClusters(users);

    expect(cluster).toMatchObject({
      activityKey: null,
      activityUnresolvable: true,
      proposedTimeWindow: "weekend_morning",
      timeWindowUnresolvable: false,
    });
  });

  it("marks a cluster as time-window unresolvable when there is no availability overlap", async () => {
    const users = [
      buildUser("00000000-0000-0000-0000-000000000031", {
        scheduling_availability: { weekdays: ["evening"] },
      }),
      buildUser("00000000-0000-0000-0000-000000000032", {
        scheduling_availability: { weekends: ["morning"] },
      }),
    ];
    setPairScores({
      [buildPairKey(users[0].userId, users[1].userId)]: 0.8,
    });

    const dbClient = buildDbClient();
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    const [cluster] = await detectClusters(users);

    expect(cluster).toMatchObject({
      activityKey: "coffee_walk",
      activityUnresolvable: false,
      proposedTimeWindow: null,
      timeWindowUnresolvable: true,
    });
  });

  it("uses a fresh cache hit without calling the scorer", async () => {
    const users = [
      buildUser("00000000-0000-0000-0000-000000000041"),
      buildUser("00000000-0000-0000-0000-000000000042"),
    ];
    const pairKey = buildPairKey(users[0].userId, users[1].userId);
    const dbClient = buildDbClient([
      {
        user_a_id: users[0].userId,
        user_b_id: users[1].userId,
        profile_hash_a: users[0].userId,
        profile_hash_b: users[1].userId,
        score: 0.81,
        computed_at: "2026-03-13T11:00:00.000Z",
      },
    ]);
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    const [cluster] = await detectClusters(users);

    expect(scorePairMock).not.toHaveBeenCalled();
    expect(dbClient.calls.upserts).toHaveLength(0);
    expect(dbClient.calls.selects).toContainEqual({
      userAId: users[0].userId,
      userBId: users[1].userId,
    });
    expect(cluster.pairScores[pairKey]).toBe(0.81);
  });

  it("recomputes and updates the cache when the entry is stale", async () => {
    const users = [
      buildUser("00000000-0000-0000-0000-000000000051"),
      buildUser("00000000-0000-0000-0000-000000000052"),
    ];
    setPairScores({
      [buildPairKey(users[0].userId, users[1].userId)]: 0.77,
    });
    const dbClient = buildDbClient([
      {
        user_a_id: users[0].userId,
        user_b_id: users[1].userId,
        profile_hash_a: users[0].userId,
        profile_hash_b: users[1].userId,
        score: 0.4,
        computed_at: "2026-03-11T10:00:00.000Z",
      },
    ]);
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    const [cluster] = await detectClusters(users);

    expect(scorePairMock).toHaveBeenCalledTimes(1);
    expect(dbClient.calls.upserts).toHaveLength(1);
    expect(dbClient.calls.upserts[0]?.row).toMatchObject({
      user_a_id: users[0].userId,
      user_b_id: users[1].userId,
      score: 0.77,
    });
    expect(cluster.clusterScore).toBe(0.77);
  });

  it("computes positive interest overlap for shared domain tokens", async () => {
    const users = [
      buildUser("00000000-0000-0000-0000-000000000061", {
        interest_signatures: [
          { domain: "urban infrastructure", intensity: 0.8, confidence: 0.7 },
        ],
      }),
      buildUser("00000000-0000-0000-0000-000000000062", {
        interest_signatures: [
          { domain: "urban farming", intensity: 0.6, confidence: 0.7 },
        ],
      }),
    ];
    setPairScores({
      [buildPairKey(users[0].userId, users[1].userId)]: 0.8,
    });

    const dbClient = buildDbClient();
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    const [cluster] = await detectClusters(users);

    expect(cluster.interestOverlapScore).toBeGreaterThan(0);
    expect(cluster.adjustedClusterScore).toBeGreaterThan(cluster.clusterScore);
  });

  it("ranks otherwise-equal clusters by adjusted score from interest overlap", async () => {
    const users = [
      buildUser("00000000-0000-0000-0000-000000000071", {
        interest_signatures: [{ domain: "coffee tasting", intensity: 0.8, confidence: 0.7 }],
      }),
      buildUser("00000000-0000-0000-0000-000000000072", {
        interest_signatures: [{ domain: "coffee roasting", intensity: 0.7, confidence: 0.7 }],
      }),
      buildUser("00000000-0000-0000-0000-000000000073", {
        interest_signatures: [{ domain: "quiet reading", intensity: 0.7, confidence: 0.7 }],
      }),
      buildUser("00000000-0000-0000-0000-000000000074", {
        interest_signatures: [{ domain: "night cycling", intensity: 0.7, confidence: 0.7 }],
      }),
    ];
    const scoreMap = buildCompleteScoreMap(users, 0.4);
    scoreMap[buildPairKey(users[0].userId, users[1].userId)] = 0.8;
    scoreMap[buildPairKey(users[2].userId, users[3].userId)] = 0.8;
    setPairScores(scoreMap);

    const dbClient = buildDbClient();
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    const clusters = await detectClusters(users);

    expect(clusters[0]?.members).toEqual([users[0].userId, users[1].userId]);
    expect(clusters[0]?.adjustedClusterScore).toBeGreaterThan(
      clusters[1]?.adjustedClusterScore ?? 0,
    );
  });
});
