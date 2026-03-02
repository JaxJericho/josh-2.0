import { describe, expect, it } from "vitest";

import {
  suggestSoloActivity,
  type SoloActivityRepository,
} from "./suggest-solo-activity";

describe("suggestSoloActivity", () => {
  it("returns an activity aligned to the user's regional availability", async () => {
    const repository: SoloActivityRepository = {
      fetchUserPreferences: async () => ({
        regional_availability: "urban_dense",
        motive_weights: {
          restorative: 1,
          comfort: 1,
        },
        preferred_windows: ["evening"],
      }),
      listSoloActivities: async () => [
        buildActivity({
          activity_key: "suburban_drive",
          short_description: "Take a scenic suburban drive.",
          regional_availability: "suburban",
          motive_weights: {
            restorative: 10,
            connection: 0,
            play: 0,
            exploration: 0,
            achievement: 0,
            stimulation: 0,
            belonging: 0,
            focus: 0,
            comfort: 10,
          },
          preferred_windows: ["evening"],
        }),
        buildActivity({
          activity_key: "city_walk",
          short_description: "Take a short neighborhood city walk.",
          regional_availability: "urban_dense",
          motive_weights: {
            restorative: 1,
            connection: 0,
            play: 0,
            exploration: 0,
            achievement: 0,
            stimulation: 0,
            belonging: 0,
            focus: 0,
            comfort: 1,
          },
          preferred_windows: ["evening"],
        }),
      ],
    };

    const selected = await suggestSoloActivity("usr_123", { repository });

    expect(selected.activity_key).toBe("city_walk");
    expect(selected.regional_availability).toBe("urban_dense");
  });
});

function buildActivity(
  overrides: Partial<{
    id: string;
    activity_key: string;
    display_name: string;
    category: string;
    short_description: string;
    regional_availability: "anywhere" | "suburban" | "urban_mid" | "urban_dense";
    motive_weights: {
      restorative: number;
      connection: number;
      play: number;
      exploration: number;
      achievement: number;
      stimulation: number;
      belonging: number;
      focus: number;
      comfort: number;
    };
    preferred_windows: Array<"morning" | "afternoon" | "evening" | "weekend">;
    group_size_fit: Array<"solo" | "small" | "medium" | "large">;
    tags: string[] | null;
    created_at: string;
  }> = {},
) {
  return {
    id: overrides.id ?? "act_1",
    activity_key: overrides.activity_key ?? "activity_key",
    display_name: overrides.display_name ?? "Activity",
    category: overrides.category ?? "general",
    short_description: overrides.short_description ?? "Do a simple solo activity.",
    regional_availability: overrides.regional_availability ?? "anywhere",
    motive_weights: overrides.motive_weights ?? {
      restorative: 0,
      connection: 0,
      play: 0,
      exploration: 0,
      achievement: 0,
      stimulation: 0,
      belonging: 0,
      focus: 0,
      comfort: 0,
    },
    constraints: {
      setting: "either" as const,
      noise_level: "moderate" as const,
      physical_demand: "low" as const,
      requires_booking: false,
      weather_dependent: false,
    },
    preferred_windows: overrides.preferred_windows ?? ["evening"],
    group_size_fit: overrides.group_size_fit ?? ["solo"],
    tags: overrides.tags ?? null,
    created_at: overrides.created_at ?? "2026-02-28T00:00:00.000Z",
  };
}
