import { describe, expect, it } from "vitest";
import {
  COMPATIBILITY_SCORE_TABLE,
  computeAndUpsertScore,
} from "../packages/core/src/compatibility/compatibility-score-writer";

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
    expect(stored.a_hash).toBe(first.a_hash);
    expect(stored.b_hash).toBe(first.b_hash);
    expect(stored.score_version).toBe(first.version);
  });

  it("keeps incomplete profiles in scoring with deterministic attenuation", async () => {
    const { supabase, tables } = createMockSupabase();

    const complete = await computeAndUpsertScore({
      supabase,
      user_a_id: USER_1,
      user_b_id: USER_2,
    });

    tables.profiles = tables.profiles.map((profile) =>
      profile.user_id === USER_2
        ? {
            ...profile,
            coordination_dimensions: partialCoordinationDimensions(),
          }
        : profile,
    );

    const incomplete = await computeAndUpsertScore({
      supabase,
      user_a_id: USER_1,
      user_b_id: USER_2,
    });

    expect(incomplete.score).toBeGreaterThanOrEqual(0);
    expect(incomplete.score).toBeLessThan(complete.score);
  });

  it("excludes complete_invited profiles even when is_complete_mvp is true", async () => {
    const { supabase, tables } = createMockSupabase();
    tables.profiles = tables.profiles.map((profile) =>
      profile.user_id === USER_2
        ? {
            ...profile,
            state: "complete_invited",
            is_complete_mvp: true,
          }
        : profile,
    );

    await expect(() =>
      computeAndUpsertScore({
        supabase,
        user_a_id: USER_1,
        user_b_id: USER_2,
      }),
    ).rejects.toThrow(`Profile not found for user '${USER_2}'.`);
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
        coordination_dimensions: fullCoordinationDimensions(0.02),
      },
      {
        id: "pro-2",
        user_id: USER_2,
        state: "complete_mvp",
        is_complete_mvp: true,
        coordination_dimensions: fullCoordinationDimensions(-0.02),
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
    [COMPATIBILITY_SCORE_TABLE]: [],
  };

  const supabase = {
    from(table: string) {
      return {
        select(..._args: unknown[]) {
          const filters: Array<{ column: string; value: unknown; op: "eq" | "neq" }> = [];
          const query = {
            eq(column: string, value: unknown) {
              filters.push({ column, value, op: "eq" });
              return query;
            },
            neq(column: string, value: unknown) {
              filters.push({ column, value, op: "neq" });
              return query;
            },
            async maybeSingle() {
              const rows = tables[table] ?? [];
              const matches = rows.filter((row) =>
                filters.every((filter) =>
                  filter.op === "eq"
                    ? row[filter.column] === filter.value
                    : row[filter.column] !== filter.value,
                ),
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

function fullCoordinationDimensions(offset: number): Record<string, unknown> {
  return {
    social_energy: { value: 0.62 + offset, confidence: 0.9 },
    social_pace: { value: 0.58 + offset, confidence: 0.88 },
    conversation_depth: { value: 0.7 + offset, confidence: 0.91 },
    adventure_orientation: { value: 0.66 + offset, confidence: 0.86 },
    group_dynamic: { value: 0.44 + offset, confidence: 0.8 },
    values_proximity: { value: 0.76 + offset, confidence: 0.92 },
  };
}

function partialCoordinationDimensions(): Record<string, unknown> {
  return {
    social_energy: { value: 0.6, confidence: 0.9 },
    social_pace: { value: 0.57, confidence: 0.87 },
    conversation_depth: { value: 0.69, confidence: 0.91 },
  };
}
