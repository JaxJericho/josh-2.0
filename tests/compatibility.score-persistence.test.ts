import { describe, expect, it } from "vitest";
import {
  COMPATIBILITY_SCORE_TABLE,
  computeAndUpsertScore,
} from "../packages/core/src/compatibility/compatibility-score-writer";
import { COMPATIBILITY_SIGNAL_TABLE } from "../packages/core/src/compatibility/compatibility-signal-writer";

describe("compatibility score persistence", () => {
  it("upserts idempotently for the same pair/hash/version key", async () => {
    const { supabase, tables } = createMockSupabase();

    const first = await computeAndUpsertScore({
      supabase,
      user_a_id: USER_2,
      user_b_id: USER_1,
    });

    const second = await computeAndUpsertScore({
      supabase,
      user_a_id: USER_1,
      user_b_id: USER_2,
    });

    expect(second.score).toBe(first.score);
    expect(tables[COMPATIBILITY_SCORE_TABLE]).toHaveLength(1);

    const stored = tables[COMPATIBILITY_SCORE_TABLE][0];
    expect(stored.user_a_id).toBe(USER_1);
    expect(stored.user_b_id).toBe(USER_2);
    expect(stored.a_hash).toBe("hash-user-1");
    expect(stored.b_hash).toBe("hash-user-2");
    expect(stored.score_version).toBe(first.version);
  });

  it("fails fast when compatibility signals are missing", async () => {
    const { supabase, tables } = createMockSupabase();
    tables[COMPATIBILITY_SIGNAL_TABLE] = tables[COMPATIBILITY_SIGNAL_TABLE].filter(
      (row) => row.user_id !== USER_2,
    );

    await expect(() =>
      computeAndUpsertScore({
        supabase,
        user_a_id: USER_1,
        user_b_id: USER_2,
      })
    ).rejects.toThrow(`Compatibility signals not found for user '${USER_2}'.`);
  });
});

const USER_1 = "00000000-0000-0000-0000-000000000001";
const USER_2 = "00000000-0000-0000-0000-000000000002";

function createMockSupabase() {
  const tables: Record<string, any[]> = {
    users: [
      {
        id: USER_1,
        state: "active",
        deleted_at: null,
      },
      {
        id: USER_2,
        state: "active",
        deleted_at: null,
      },
    ],
    profiles: [
      {
        id: "pro-1",
        user_id: USER_1,
        state: "complete_mvp",
        is_complete_mvp: true,
      },
      {
        id: "pro-2",
        user_id: USER_2,
        state: "complete_mvp",
        is_complete_mvp: true,
      },
    ],
    entitlements: [
      {
        user_id: USER_1,
        can_receive_intro: true,
      },
      {
        user_id: USER_2,
        can_receive_intro: true,
      },
    ],
    profile_entitlements: [
      {
        profile_id: "pro-1",
        can_initiate: true,
        can_participate: true,
        can_exchange_contact: false,
        region_override: false,
        waitlist_override: false,
        safety_override: false,
        reason: null,
      },
      {
        profile_id: "pro-2",
        can_initiate: true,
        can_participate: true,
        can_exchange_contact: false,
        region_override: false,
        waitlist_override: false,
        safety_override: false,
        reason: null,
      },
    ],
    safety_holds: [],
    [COMPATIBILITY_SIGNAL_TABLE]: [
      {
        user_id: USER_1,
        interest_vector: [0.7, 0.4, 0.3, 0.5, 0, 0, 0.2, 0.6, 0.4],
        trait_vector: [0.8, 1, 0, 0, 1, 0, 1, 0, 0.6],
        intent_vector: [0.4, 0.7, 0.2, 0.1, 0.9, 1, 0, 0],
        availability_vector: [1, 0, 1, 0, 1, 0, 0],
        metadata: {},
        content_hash: "hash-user-1",
      },
      {
        user_id: USER_2,
        interest_vector: [0.5, 0.6, 0.1, 0.4, 0, 0, 0.2, 0.8, 0.3],
        trait_vector: [0.6, 1, 0, 0, 0, 1, 0, 1, 0.6],
        intent_vector: [0.5, 0.6, 0.2, 0.2, 0.7, 1, 0, 0],
        availability_vector: [1, 0, 0, 1, 0, 0, 1],
        metadata: {},
        content_hash: "hash-user-2",
      },
    ],
    [COMPATIBILITY_SCORE_TABLE]: [],
  };

  const supabase = {
    from(table: string) {
      return {
        select(..._args: unknown[]) {
          const filters: Array<[string, unknown]> = [];
          const query = {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return query;
            },
            async maybeSingle() {
              const rows = tables[table] ?? [];
              const matches = rows.filter((row) =>
                filters.every(([column, value]) => row[column] === value)
              );

              if (matches.length > 1) {
                return {
                  data: null,
                  error: { message: "Expected at most one row." },
                };
              }

              return {
                data: matches[0] ?? null,
                error: null,
              };
            },
          };
          return query;
        },
        async upsert(row: Record<string, unknown>, options: { onConflict?: string } = {}) {
          const rows = tables[table] ?? [];
          const onConflictColumns = (options.onConflict ?? "")
            .split(",")
            .map((column) => column.trim())
            .filter(Boolean);

          let existingIndex = -1;
          if (onConflictColumns.length > 0) {
            existingIndex = rows.findIndex((candidate) =>
              onConflictColumns.every((column) => candidate[column] === row[column])
            );
          }

          if (existingIndex >= 0) {
            rows[existingIndex] = {
              ...rows[existingIndex],
              ...row,
            };
          } else {
            rows.push({
              ...row,
            });
          }

          tables[table] = rows;

          return {
            data: null,
            error: null,
          };
        },
      };
    },
  };

  return {
    supabase,
    tables,
  };
}
