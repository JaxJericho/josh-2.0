import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createServiceRoleDbClientMock } = vi.hoisted(() => ({
  createServiceRoleDbClientMock: vi.fn(),
}));

vi.mock("../../../db/src/client-node.mjs", () => ({
  createServiceRoleDbClient: createServiceRoleDbClientMock,
}));

import { selectSoloInvitation } from "./solo-invitation-selector";

type Row = Record<string, unknown>;

type QueryFixtures = {
  users?: Row[];
  profiles?: Row[];
  invitations?: Row[];
  activity_catalog?: Row[];
};

type OrderSpec = {
  column: string;
  ascending: boolean;
};

function buildDbClient(fixtures: QueryFixtures) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];

  function execute(table: string, state: {
    filters: Array<(row: Row) => boolean>;
    order: OrderSpec | null;
    limit: number | null;
  }) {
    let rows = [...(fixtures[table as keyof QueryFixtures] ?? [])];
    rows = rows.filter((row) => state.filters.every((predicate) => predicate(row)));

    if (state.order) {
      const { column, ascending } = state.order;
      rows.sort((left, right) => {
        const leftValue = left[column];
        const rightValue = right[column];

        const normalizedLeft = leftValue == null ? "" : String(leftValue);
        const normalizedRight = rightValue == null ? "" : String(rightValue);
        const comparison = normalizedLeft.localeCompare(normalizedRight);

        return ascending ? comparison : -comparison;
      });
    }

    if (state.limit != null) {
      rows = rows.slice(0, state.limit);
    }

    return {
      data: rows,
      error: null,
    };
  }

  function createBuilder(table: string) {
    const state = {
      filters: [] as Array<(row: Row) => boolean>,
      order: null as OrderSpec | null,
      limit: null as number | null,
    };

    const builder = {
      select(selection: string) {
        calls.push({ table, method: "select", args: [selection] });
        return builder;
      },
      eq(column: string, value: unknown) {
        calls.push({ table, method: "eq", args: [column, value] });
        state.filters.push((row) => row[column] === value);
        return builder;
      },
      gte(column: string, value: unknown) {
        calls.push({ table, method: "gte", args: [column, value] });
        state.filters.push((row) => {
          const rowValue = row[column];
          if (typeof rowValue !== "string" || typeof value !== "string") {
            return false;
          }
          return rowValue >= value;
        });
        return builder;
      },
      in(column: string, values: unknown[]) {
        calls.push({ table, method: "in", args: [column, values] });
        state.filters.push((row) => values.includes(row[column]));
        return builder;
      },
      order(column: string, options?: { ascending?: boolean }) {
        calls.push({ table, method: "order", args: [column, options] });
        state.order = {
          column,
          ascending: options?.ascending ?? true,
        };
        return builder;
      },
      limit(value: number) {
        calls.push({ table, method: "limit", args: [value] });
        state.limit = value;
        return builder;
      },
      maybeSingle: vi.fn(async () => {
        const result = execute(table, state);
        return {
          data: result.data[0] ?? null,
          error: null,
        };
      }),
      then(onFulfilled: (value: { data: Row[]; error: null }) => unknown) {
        return Promise.resolve(onFulfilled(execute(table, state)));
      },
    };

    return builder;
  }

  return {
    db: {
      from(table: string) {
        calls.push({ table, method: "from", args: [] });
        return createBuilder(table);
      },
    },
    calls,
  };
}

function buildUser(overrides: Partial<Row> = {}): Row {
  return {
    id: "usr_123",
    region_id: "reg_123",
    ...overrides,
  };
}

function buildProfile(overrides: Partial<Row> = {}): Row {
  return {
    user_id: "usr_123",
    coordination_dimensions: null,
    activity_patterns: [],
    scheduling_availability: {
      weekends: ["morning", "afternoon"],
    },
    notice_preference: "24_hours",
    boundaries: {
      no_thanks: [],
    },
    interest_signatures: null,
    relational_context: null,
    ...overrides,
  };
}

function buildActivity(overrides: Partial<Row> = {}): Row {
  return {
    activity_key: "coffee_walk",
    category: "comfort",
    motive_weights: {
      connection: 0.4,
      comfort: 0.8,
    },
    preferred_windows: ["morning"],
    tags: ["coffee", "low-key"],
    regional_availability: "anywhere",
    ...overrides,
  };
}

function buildInvitation(overrides: Partial<Row> = {}): Row {
  return {
    user_id: "usr_123",
    activity_key: "coffee_walk",
    state: "pending",
    created_at: "2026-03-03T12:00:00.000Z",
    responded_at: null,
    ...overrides,
  };
}

describe("selectSoloInvitation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-13T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("returns null when user.region_id is null", async () => {
    const dbClient = buildDbClient({
      users: [buildUser({ region_id: null })],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(selectSoloInvitation("usr_123")).resolves.toBeNull();
  });

  it("returns null when scheduling availability is null", async () => {
    const dbClient = buildDbClient({
      users: [buildUser()],
      profiles: [buildProfile({ scheduling_availability: null })],
      activity_catalog: [buildActivity()],
      invitations: [],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(selectSoloInvitation("usr_123")).resolves.toBeNull();
  });

  it("filters activity_catalog to anywhere rows only", async () => {
    const dbClient = buildDbClient({
      users: [buildUser()],
      profiles: [buildProfile()],
      activity_catalog: [buildActivity()],
      invitations: [],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await selectSoloInvitation("usr_123");

    expect(dbClient.calls).toContainEqual({
      table: "activity_catalog",
      method: "eq",
      args: ["regional_availability", "anywhere"],
    });
  });

  it("never selects an activity listed in no_thanks", async () => {
    const dbClient = buildDbClient({
      users: [buildUser()],
      profiles: [
        buildProfile({
          boundaries: {
            no_thanks: ["coffee_walk"],
          },
        }),
      ],
      activity_catalog: [
        buildActivity({ activity_key: "coffee_walk" }),
        buildActivity({
          activity_key: "museum_visit",
          category: "exploration",
          preferred_windows: ["afternoon"],
          tags: ["art", "museum"],
        }),
      ],
      invitations: [],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(selectSoloInvitation("usr_123")).resolves.toMatchObject({
      activityKey: "museum_visit",
    });
  });

  it("uses created_at for the 14-day recency exclusion window", async () => {
    const dbClient = buildDbClient({
      users: [buildUser()],
      profiles: [buildProfile()],
      activity_catalog: [
        buildActivity({ activity_key: "coffee_walk" }),
        buildActivity({
          activity_key: "museum_visit",
          category: "exploration",
          preferred_windows: ["afternoon"],
        }),
      ],
      invitations: [
        buildInvitation({
          activity_key: "coffee_walk",
          created_at: "2026-03-10T12:00:00.000Z",
        }),
        buildInvitation({
          activity_key: "museum_visit",
          created_at: "2026-02-21T12:00:00.000Z",
        }),
      ],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(selectSoloInvitation("usr_123")).resolves.toMatchObject({
      activityKey: "museum_visit",
    });
  });

  it("returns canonical proposedTimeWindow buckets that overlap availability", async () => {
    const dbClient = buildDbClient({
      users: [buildUser()],
      profiles: [
        buildProfile({
          scheduling_availability: {
            weekdays: ["evening"],
            weekends: ["morning"],
          },
        }),
      ],
      activity_catalog: [
        buildActivity({
          activity_key: "board_games",
          preferred_windows: ["evening"],
        }),
      ],
      invitations: [],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(selectSoloInvitation("usr_123")).resolves.toMatchObject({
      proposedTimeWindow: "weekday_evening",
    });
  });

  it("returns null when all activities are filtered out", async () => {
    const dbClient = buildDbClient({
      users: [buildUser()],
      profiles: [
        buildProfile({
          boundaries: {
            no_thanks: ["coffee_walk", "museum_visit"],
          },
        }),
      ],
      activity_catalog: [
        buildActivity({ activity_key: "coffee_walk" }),
        buildActivity({
          activity_key: "museum_visit",
          category: "exploration",
        }),
      ],
      invitations: [],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(selectSoloInvitation("usr_123")).resolves.toBeNull();
  });

  it("applies zero interest bonus when interest_signatures is null", async () => {
    const dbClient = buildDbClient({
      users: [buildUser()],
      profiles: [buildProfile({ interest_signatures: null })],
      activity_catalog: [buildActivity()],
      invitations: [],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(selectSoloInvitation("usr_123")).resolves.toMatchObject({
      explainability: {
        interestAlignmentBonus: 0,
      },
    });
  });

  it("applies interest bonus from activity tags and caps it at 0.20", async () => {
    const dbClient = buildDbClient({
      users: [buildUser()],
      profiles: [
        buildProfile({
          interest_signatures: [
            {
              domain: "coffee craft",
              intensity: 0.9,
              confidence: 0.7,
            },
            {
              domain: "quiet reading",
              intensity: 0.8,
              confidence: 0.6,
            },
          ],
        }),
      ],
      activity_catalog: [
        buildActivity({
          tags: ["coffee", "reading", "quiet"],
        }),
      ],
      invitations: [],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    const result = await selectSoloInvitation("usr_123");
    expect(result?.explainability.interestAlignmentBonus).toBeCloseTo(0.2);
  });

  it("applies zero relational bonus when relational_context is null", async () => {
    const dbClient = buildDbClient({
      users: [buildUser()],
      profiles: [buildProfile({ relational_context: null })],
      activity_catalog: [buildActivity()],
      invitations: [],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(selectSoloInvitation("usr_123")).resolves.toMatchObject({
      explainability: {
        relationalContextBonus: 0,
      },
    });
  });

  it("applies the depth relational bonus for connection and exploration categories", async () => {
    const dbClient = buildDbClient({
      users: [buildUser()],
      profiles: [
        buildProfile({
          relational_context: {
            life_stage_signal: null,
            connection_motivation: "looking for something meaningful with more depth",
            social_history_hint: null,
          },
        }),
      ],
      activity_catalog: [
        buildActivity({
          activity_key: "deep_dinner",
          category: "connection",
        }),
      ],
      invitations: [],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(selectSoloInvitation("usr_123")).resolves.toMatchObject({
      explainability: {
        relationalContextBonus: 0.1,
      },
    });
  });

  it("applies the ease relational bonus for comfort and restorative categories", async () => {
    const dbClient = buildDbClient({
      users: [buildUser()],
      profiles: [
        buildProfile({
          relational_context: {
            life_stage_signal: null,
            connection_motivation: "want something familiar and comfortable",
            social_history_hint: null,
          },
        }),
      ],
      activity_catalog: [
        buildActivity({
          activity_key: "tea_break",
          category: "restorative",
        }),
      ],
      invitations: [],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(selectSoloInvitation("usr_123")).resolves.toMatchObject({
      explainability: {
        relationalContextBonus: 0.1,
      },
    });
  });

  it("applies novelty bonus only when the activity is absent from activity_patterns", async () => {
    const dbClient = buildDbClient({
      users: [buildUser()],
      profiles: [
        buildProfile({
          activity_patterns: [
            {
              activity_key: "coffee_walk",
            },
          ],
        }),
      ],
      activity_catalog: [
        buildActivity({ activity_key: "coffee_walk" }),
        buildActivity({
          activity_key: "museum_visit",
          category: "exploration",
          preferred_windows: ["afternoon"],
        }),
      ],
      invitations: [],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    const result = await selectSoloInvitation("usr_123");
    expect(result?.activityKey).toBe("museum_visit");
    expect(result?.explainability.noveltyBonus).toBe(0.05);
  });

  it("uses the categories of the last three accepted invitations for diversity scoring", async () => {
    const dbClient = buildDbClient({
      users: [buildUser()],
      profiles: [buildProfile()],
      activity_catalog: [
        buildActivity({
          activity_key: "coffee_walk",
          category: "comfort",
        }),
        buildActivity({
          activity_key: "museum_visit",
          category: "exploration",
          preferred_windows: ["afternoon"],
        }),
        buildActivity({
          activity_key: "accepted_one",
          category: "comfort",
        }),
        buildActivity({
          activity_key: "accepted_two",
          category: "connection",
        }),
        buildActivity({
          activity_key: "accepted_three",
          category: "restorative",
        }),
      ],
      invitations: [
        buildInvitation({
          activity_key: "accepted_one",
          state: "accepted",
          responded_at: "2026-03-12T12:00:00.000Z",
        }),
        buildInvitation({
          activity_key: "accepted_two",
          state: "accepted",
          responded_at: "2026-03-11T12:00:00.000Z",
        }),
        buildInvitation({
          activity_key: "accepted_three",
          state: "accepted",
          responded_at: "2026-03-10T12:00:00.000Z",
        }),
      ],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    const result = await selectSoloInvitation("usr_123");
    expect(result?.activityKey).toBe("museum_visit");
    expect(result?.explainability.diversityBonus).toBe(0.1);
  });

  it("selects the higher motive score when all bonuses are equal", async () => {
    const dbClient = buildDbClient({
      users: [buildUser()],
      profiles: [
        buildProfile({
          activity_patterns: [
            {
              activity_key: "history",
              motive_weights: {
                comfort: 0.9,
                connection: 0.7,
              },
            },
          ],
        }),
      ],
      activity_catalog: [
        buildActivity({
          activity_key: "lower_score",
          motive_weights: {
            comfort: 0.2,
            connection: 0.3,
          },
        }),
        buildActivity({
          activity_key: "higher_score",
          motive_weights: {
            comfort: 0.7,
            connection: 0.6,
          },
        }),
      ],
      invitations: [],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(selectSoloInvitation("usr_123")).resolves.toMatchObject({
      activityKey: "higher_score",
    });
  });

  it("still returns a deterministic candidate when all remaining scores are zero", async () => {
    const dbClient = buildDbClient({
      users: [buildUser()],
      profiles: [buildProfile()],
      activity_catalog: [
        buildActivity({
          activity_key: "zebra_walk",
          category: "comfort",
          motive_weights: {},
          tags: null,
        }),
        buildActivity({
          activity_key: "alpha_walk",
          category: "comfort",
          motive_weights: {},
          tags: null,
        }),
      ],
      invitations: [
        buildInvitation({
          activity_key: "accepted_one",
          state: "accepted",
          responded_at: "2026-03-12T12:00:00.000Z",
        }),
      ],
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    const result = await selectSoloInvitation("usr_123");
    expect(result?.activityKey).toBe("alpha_walk");
    expect(result?.selectionScore).toBeCloseTo(0.15);
  });
});
