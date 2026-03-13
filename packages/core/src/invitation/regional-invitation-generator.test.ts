import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  checkInvitationEligibilityMock,
  createServiceRoleDbClientMock,
  detectClustersMock,
  dispatchInvitationMock,
  logEventMock,
  selectSoloInvitationMock,
} = vi.hoisted(() => ({
  checkInvitationEligibilityMock: vi.fn(),
  createServiceRoleDbClientMock: vi.fn(),
  detectClustersMock: vi.fn(),
  dispatchInvitationMock: vi.fn(),
  logEventMock: vi.fn(),
  selectSoloInvitationMock: vi.fn(),
}));

vi.mock("../../../db/src/client-node.mjs", () => ({
  createServiceRoleDbClient: createServiceRoleDbClientMock,
}));

vi.mock("./frequency-guard.ts", () => ({
  checkInvitationEligibility: checkInvitationEligibilityMock,
}));

vi.mock("./cluster-detector.ts", () => ({
  detectClusters: detectClustersMock,
}));

vi.mock("./dispatch-invitation.ts", () => ({
  dispatchInvitation: dispatchInvitationMock,
}));

vi.mock("./solo-invitation-selector.ts", () => ({
  selectSoloInvitation: selectSoloInvitationMock,
}));

vi.mock("../observability/logger.ts", () => ({
  logEvent: logEventMock,
}));

import { runRegionalGenerator } from "./regional-invitation-generator";

type UserRow = {
  id: string;
  region_id: string;
  state: string;
};

type ProfileRow = {
  user_id: string;
  state: string;
  coordination_dimensions: unknown;
  activity_patterns: unknown;
  scheduling_availability: unknown;
  boundaries: unknown;
  interest_signatures: unknown;
  relational_context: unknown;
  group_size_preference: unknown;
};

type SubscriptionRow = {
  user_id: string;
  status: string;
};

function buildDbClient(input?: {
  lockAcquired?: boolean;
  unlockAcquired?: boolean;
  users?: UserRow[];
  profiles?: ProfileRow[];
  subscriptions?: SubscriptionRow[];
  existingLinkups?: Record<string, { id: string }>;
}) {
  const state = {
    lockAcquired: input?.lockAcquired ?? true,
    unlockAcquired: input?.unlockAcquired ?? true,
    users: [...(input?.users ?? [])],
    profiles: [...(input?.profiles ?? [])],
    subscriptions: [...(input?.subscriptions ?? [])],
    existingLinkups: new Map(Object.entries(input?.existingLinkups ?? {})),
  };

  const calls = {
    usersEq: [] as Array<{ column: string; value: unknown }>,
    profilesIn: [] as Array<{ column: string; values: unknown[] }>,
    profilesNeq: [] as Array<{ column: string; value: unknown }>,
    subscriptionsIn: [] as Array<{ column: string; values: unknown[] }>,
    subscriptionsEq: [] as Array<{ column: string; value: unknown }>,
    linkupSelectKeys: [] as string[],
    linkupInserts: [] as Record<string, unknown>[],
    rpc: [] as Array<{ name: string; payload: Record<string, unknown> }>,
  };

  function createAwaitableQuery<T extends Record<string, unknown>>(config: {
    rows: T[];
    onEq?: (column: string, value: unknown) => void;
    onIn?: (column: string, values: unknown[]) => void;
    onNeq?: (column: string, value: unknown) => void;
  }) {
    const eqFilters: Array<{ column: string; value: unknown }> = [];
    const inFilters: Array<{ column: string; values: unknown[] }> = [];
    const neqFilters: Array<{ column: string; value: unknown }> = [];

    const query = {
      select() {
        return query;
      },
      eq(column: string, value: unknown) {
        eqFilters.push({ column, value });
        config.onEq?.(column, value);
        return query;
      },
      in(column: string, values: unknown[]) {
        inFilters.push({ column, values });
        config.onIn?.(column, values);
        return query;
      },
      neq(column: string, value: unknown) {
        neqFilters.push({ column, value });
        config.onNeq?.(column, value);
        return query;
      },
      then(onFulfilled?: (value: { data: T[]; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
        const filteredRows = config.rows.filter((row) => {
          for (const filter of eqFilters) {
            if (row[filter.column] !== filter.value) {
              return false;
            }
          }

          for (const filter of inFilters) {
            if (!filter.values.includes(row[filter.column])) {
              return false;
            }
          }

          for (const filter of neqFilters) {
            if (row[filter.column] === filter.value) {
              return false;
            }
          }

          return true;
        });

        return Promise.resolve({ data: filteredRows, error: null }).then(onFulfilled, onRejected);
      },
    };

    return query;
  }

  const db = {
    from(table: string) {
      if (table === "users") {
        return createAwaitableQuery({
          rows: state.users,
          onEq: (column, value) => calls.usersEq.push({ column, value }),
        });
      }

      if (table === "profiles") {
        return createAwaitableQuery({
          rows: state.profiles,
          onIn: (column, values) => calls.profilesIn.push({ column, values }),
          onNeq: (column, value) => calls.profilesNeq.push({ column, value }),
        });
      }

      if (table === "subscriptions") {
        return createAwaitableQuery({
          rows: state.subscriptions,
          onIn: (column, values) => calls.subscriptionsIn.push({ column, values }),
          onEq: (column, value) => calls.subscriptionsEq.push({ column, value }),
        });
      }

      if (table === "linkups") {
        return {
          select() {
            return {
              eq(column: string, value: unknown) {
                if (column !== "linkup_create_key") {
                  throw new Error(`Unexpected linkup filter '${column}'.`);
                }
                calls.linkupSelectKeys.push(String(value));
                return {
                  maybeSingle: vi.fn(async () => ({
                    data: state.existingLinkups.get(String(value)) ?? null,
                    error: null,
                  })),
                };
              },
            };
          },
          insert(row: Record<string, unknown>) {
            calls.linkupInserts.push(row);
            const createKey = String(row.linkup_create_key);
            const id = `linkup-${calls.linkupInserts.length}`;
            state.existingLinkups.set(createKey, { id });
            return {
              select() {
                return {
                  maybeSingle: vi.fn(async () => ({
                    data: { id },
                    error: null,
                  })),
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table '${table}'.`);
    },
    async rpc(name: string, payload: Record<string, unknown>) {
      calls.rpc.push({ name, payload });

      if (name === "regional_generator_try_lock") {
        return {
          data: state.lockAcquired,
          error: null,
        };
      }

      if (name === "regional_generator_unlock") {
        return {
          data: state.unlockAcquired,
          error: null,
        };
      }

      throw new Error(`Unexpected rpc '${name}'.`);
    },
  };

  return { db, calls };
}

function buildUser(id: string, regionId: string): UserRow {
  return {
    id,
    region_id: regionId,
    state: "active",
  };
}

function buildProfile(userId: string, overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    user_id: userId,
    state: "complete_mvp",
    coordination_dimensions: {
      social_energy: { value: 0.5, confidence: 0.8 },
    },
    activity_patterns: [
      {
        activity_key: "coffee_walk",
        motive_weights: { connection: 0.8 },
      },
    ],
    scheduling_availability: {
      weekends: ["morning"],
    },
    boundaries: {
      no_thanks: [],
    },
    interest_signatures: [],
    relational_context: {
      connection_motivation: "meet new people",
    },
    group_size_preference: { min: 2, max: 5 },
    ...overrides,
  };
}

function buildSubscription(userId: string): SubscriptionRow {
  return {
    user_id: userId,
    status: "active",
  };
}

describe("runRegionalGenerator", () => {
  const regionId = "00000000-0000-0000-0000-000000000101";
  const userA = "00000000-0000-0000-0000-000000000201";
  const userB = "00000000-0000-0000-0000-000000000202";
  const userC = "00000000-0000-0000-0000-000000000203";
  const userD = "00000000-0000-0000-0000-000000000204";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-13T12:00:00.000Z"));
    vi.stubEnv("APP_BASE_URL", "https://example.test");
    vi.stubEnv("QSTASH_TOKEN", "qstash-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: vi.fn().mockResolvedValue(""),
    }));
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "99999999-9999-9999-9999-999999999999"),
      getRandomValues: vi.fn((input: Uint32Array) => {
        input[0] = 0;
        return input;
      }),
    });

    checkInvitationEligibilityMock.mockResolvedValue({ eligible: true });
    detectClustersMock.mockResolvedValue([]);
    selectSoloInvitationMock.mockResolvedValue(null);
    dispatchInvitationMock.mockResolvedValue({
      dispatched: true,
      invitationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("creates one system linkup for a resolvable cluster and falls back to one solo invite", async () => {
    const dbClient = buildDbClient({
      users: [
        buildUser(userA, regionId),
        buildUser(userB, regionId),
        buildUser(userC, regionId),
        buildUser(userD, regionId),
      ],
      profiles: [
        buildProfile(userA),
        buildProfile(userB),
        buildProfile(userC),
        buildProfile(userD),
      ],
      subscriptions: [
        buildSubscription(userA),
        buildSubscription(userB),
        buildSubscription(userC),
        buildSubscription(userD),
      ],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);
    detectClustersMock.mockResolvedValue([
      {
        members: [userA, userB, userC],
        pairScores: {},
        clusterScore: 0.8,
        adjustedClusterScore: 0.82,
        interestOverlapScore: 0.2,
        activityKey: "coffee_walk",
        proposedTimeWindow: "weekend_morning",
        activityUnresolvable: false,
        timeWindowUnresolvable: false,
      },
    ]);
    selectSoloInvitationMock.mockImplementation(async (userId: string) => {
      if (userId === userD) {
        return {
          activityKey: "museum_visit",
          proposedTimeWindow: "weekend_afternoon",
          locationHint: null,
        };
      }
      return null;
    });

    const result = await runRegionalGenerator(regionId);

    expect(result).toMatchObject({
      regionId,
      eligibleUserCount: 4,
      clustersFormed: 1,
      groupInvitationsDispatched: 1,
      clusterMembersDispatched: 3,
      soloInvitationsDispatched: 1,
      skippedQuietHours: 0,
      skippedActivityUnresolvable: 0,
      skippedTimeWindowUnresolvable: 0,
      errors: [],
    });
    expect(dbClient.calls.linkupInserts[0]).toMatchObject({
      system_created: true,
      initiator_user_id: null,
      state: "broadcasting",
      region_id: regionId,
      activity_key: "coffee_walk",
      proposed_time_window: "weekend_morning",
      min_size: 2,
      max_size: 10,
      correlation_id: "99999999-9999-9999-9999-999999999999",
      linkup_create_key:
        `regional-generator:${regionId}:${[userA, userB, userC].join(",")}:coffee_walk:weekend_morning`,
    });
    expect(selectSoloInvitationMock).toHaveBeenCalledWith(userD);
    expect(dbClient.calls.rpc.map((entry) => entry.name)).toEqual([
      "regional_generator_try_lock",
      "regional_generator_unlock",
    ]);
    expect(logEventMock).toHaveBeenCalledWith(expect.objectContaining({
      event: "generator_run.complete",
      correlation_id: "99999999-9999-9999-9999-999999999999",
    }));
  });

  it("applies the complete_invited hard filter on the profile query", async () => {
    const dbClient = buildDbClient({
      users: [buildUser(userA, regionId)],
      profiles: [buildProfile(userA)],
      subscriptions: [buildSubscription(userA)],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await runRegionalGenerator(regionId);

    expect(dbClient.calls.profilesNeq).toContainEqual({
      column: "state",
      value: "complete_invited",
    });
  });

  it("returns an empty result and logs when the regional lock is unavailable", async () => {
    const dbClient = buildDbClient({
      lockAcquired: false,
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    const result = await runRegionalGenerator(regionId);

    expect(result).toMatchObject({
      regionId,
      eligibleUserCount: 0,
      clustersFormed: 0,
      groupInvitationsDispatched: 0,
      clusterMembersDispatched: 0,
      soloInvitationsDispatched: 0,
      skippedQuietHours: 0,
      skippedActivityUnresolvable: 0,
      skippedTimeWindowUnresolvable: 0,
      errors: [],
    });
    expect(logEventMock).toHaveBeenCalledWith({
      event: "generator_run.lock_unavailable",
      correlation_id: "99999999-9999-9999-9999-999999999999",
      payload: {
        regionId,
      },
    });
    expect(dbClient.calls.rpc.map((entry) => entry.name)).toEqual([
      "regional_generator_try_lock",
    ]);
    expect(detectClustersMock).not.toHaveBeenCalled();
  });

  it("releases the lock from finally and continues after an individual dispatch error", async () => {
    const dbClient = buildDbClient({
      users: [
        buildUser(userA, regionId),
        buildUser(userB, regionId),
        buildUser(userC, regionId),
      ],
      profiles: [
        buildProfile(userA),
        buildProfile(userB),
        buildProfile(userC),
      ],
      subscriptions: [
        buildSubscription(userA),
        buildSubscription(userB),
        buildSubscription(userC),
      ],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);
    detectClustersMock.mockResolvedValue([
      {
        members: [userA, userB, userC],
        pairScores: {},
        clusterScore: 0.8,
        adjustedClusterScore: 0.82,
        interestOverlapScore: 0.2,
        activityKey: "coffee_walk",
        proposedTimeWindow: "weekend_morning",
        activityUnresolvable: false,
        timeWindowUnresolvable: false,
      },
    ]);
    dispatchInvitationMock.mockImplementation(async ({ userId }: { userId: string }) => {
      if (userId === userB) {
        throw new Error("simulated dispatch failure");
      }

      return {
        dispatched: true,
        invitationId: `invitation-${userId}`,
      };
    });

    const result = await runRegionalGenerator(regionId);

    expect(result.clusterMembersDispatched).toBe(2);
    expect(result.errors).toContain(
      `cluster member ${userB}: simulated dispatch failure`,
    );
    expect(dbClient.calls.rpc.map((entry) => entry.name)).toEqual([
      "regional_generator_try_lock",
      "regional_generator_unlock",
    ]);
  });

  it("requeues quiet-hours skips through the existing cold-start route", async () => {
    const dbClient = buildDbClient({
      users: [buildUser(userD, regionId)],
      profiles: [buildProfile(userD)],
      subscriptions: [buildSubscription(userD)],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);
    selectSoloInvitationMock.mockResolvedValue({
      activityKey: "museum_visit",
      proposedTimeWindow: "weekend_afternoon",
      locationHint: null,
    });
    dispatchInvitationMock.mockResolvedValue({
      dispatched: false,
      reason: "quiet_hours",
    });

    const result = await runRegionalGenerator(regionId);

    expect(result.skippedQuietHours).toBe(1);
    expect(result.soloInvitationsDispatched).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(
      "https://qstash.upstash.io/v2/publish/https://example.test/api/invitations/cold-start",
    );
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ userId: userD }));
    expect((init?.headers as Record<string, string>)["Upstash-Delay"]).toMatch(/^\d+s$/);
  });

  it("falls back to solo invitations when cluster activity or time window is unresolvable", async () => {
    const dbClient = buildDbClient({
      users: [
        buildUser(userA, regionId),
        buildUser(userB, regionId),
        buildUser(userC, regionId),
        buildUser(userD, regionId),
      ],
      profiles: [
        buildProfile(userA),
        buildProfile(userB),
        buildProfile(userC),
        buildProfile(userD),
      ],
      subscriptions: [
        buildSubscription(userA),
        buildSubscription(userB),
        buildSubscription(userC),
        buildSubscription(userD),
      ],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);
    detectClustersMock.mockResolvedValue([
      {
        members: [userA, userB],
        pairScores: {},
        clusterScore: 0.8,
        adjustedClusterScore: 0.82,
        interestOverlapScore: 0.2,
        activityKey: null,
        proposedTimeWindow: null,
        activityUnresolvable: true,
        timeWindowUnresolvable: false,
      },
      {
        members: [userC, userD],
        pairScores: {},
        clusterScore: 0.8,
        adjustedClusterScore: 0.82,
        interestOverlapScore: 0.2,
        activityKey: "coffee_walk",
        proposedTimeWindow: null,
        activityUnresolvable: false,
        timeWindowUnresolvable: true,
      },
    ]);
    selectSoloInvitationMock.mockResolvedValue({
      activityKey: "museum_visit",
      proposedTimeWindow: "weekend_afternoon",
      locationHint: null,
    });

    const result = await runRegionalGenerator(regionId);

    expect(result.groupInvitationsDispatched).toBe(0);
    expect(result.soloInvitationsDispatched).toBe(4);
    expect(result.skippedActivityUnresolvable).toBe(2);
    expect(result.skippedTimeWindowUnresolvable).toBe(2);
    expect(dbClient.calls.linkupInserts).toHaveLength(0);
  });
});
