import { describe, expect, it } from "vitest";
import {
  COMPATIBILITY_SIGNAL_TABLE,
  recomputeProfileSignals,
} from "../packages/core/src/compatibility/compatibility-signal-writer";

describe("compatibility signal recompute idempotency", () => {
  it("recompute replaces existing normalized row and remains identical on rerun", async () => {
    const { supabase, tables } = createMockSupabase();

    const first = await recomputeProfileSignals({
      supabase,
      user_id: "usr_123",
    });

    const second = await recomputeProfileSignals({
      supabase,
      user_id: "usr_123",
    });

    expect(first.content_hash).toBe(second.content_hash);
    expect(first.normalized).toEqual(second.normalized);

    const storedRows = tables[COMPATIBILITY_SIGNAL_TABLE];
    expect(storedRows).toHaveLength(1);

    const stored = storedRows[0];
    expect(stored.user_id).toBe("usr_123");
    expect(stored.content_hash).toBe(first.content_hash);

    const { data: queried } = await supabase
      .from(COMPATIBILITY_SIGNAL_TABLE)
      .select("*")
      .eq("user_id", "usr_123")
      .maybeSingle();

    expect(queried).not.toBeNull();
    expect(queried?.interest_vector).toEqual(first.normalized.interest_vector);
    expect(queried?.trait_vector).toEqual(first.normalized.trait_vector);
    expect(queried?.intent_vector).toEqual(first.normalized.intent_vector);
    expect(queried?.availability_vector).toEqual(first.normalized.availability_vector);
  });
});

function createMockSupabase() {
  const tables: Record<string, any[]> = {
    profiles: [
      {
        id: "pro_123",
        user_id: "usr_123",
        state: "complete_mvp",
        is_complete_mvp: true,
        fingerprint: {
          social_pace: { value: "medium", confidence: 0.8, source: "interview" },
          interaction_style: { value: "thoughtful", confidence: 0.72, source: "interview" },
          conversation_style: { value: ["ideas", "plans"], confidence: 0.7, source: "interview" },
        },
        activity_patterns: [
          { activity_key: "coffee", confidence: 0.7, source: "interview" },
          { activity_key: "museum", confidence: 0.6, source: "interview" },
        ],
        boundaries: {
          no_thanks: ["late nights"],
        },
        preferences: {
          group_size_pref: "4-6",
          values_alignment_importance: "somewhat",
          time_preferences: ["weekends_only"],
        },
        active_intent: {
          activity_key: "coffee",
          motive_weights: {
            connection: 0.8,
            fun: 0.3,
            restorative: 0.5,
            adventure: 0.2,
            comfort: 0.4,
          },
        },
        completed_at: "2026-02-16T12:00:00.000Z",
        updated_at: "2026-02-16T12:00:00.000Z",
      },
    ],
    [COMPATIBILITY_SIGNAL_TABLE]: [],
  };

  const supabase = {
    from(table: string) {
      return {
        select(..._args: unknown[]) {
          return {
            eq(column: string, value: unknown) {
              return {
                async maybeSingle() {
                  const row = tables[table].find((entry) => entry[column] === value) ?? null;
                  return {
                    data: row,
                    error: null,
                  };
                },
              };
            },
          };
        },
        delete() {
          return {
            async eq(column: string, value: unknown) {
              tables[table] = tables[table].filter((entry) => entry[column] !== value);
              return {
                error: null,
              };
            },
          };
        },
        async upsert(row: Record<string, unknown>) {
          const existingIndex = tables[table].findIndex((entry) => entry.user_id === row.user_id);
          if (existingIndex >= 0) {
            tables[table][existingIndex] = {
              ...tables[table][existingIndex],
              ...row,
            };
          } else {
            tables[table].push({
              ...row,
            });
          }
          return {
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
