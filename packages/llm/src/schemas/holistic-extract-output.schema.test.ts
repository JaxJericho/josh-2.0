import { describe, expect, it } from "vitest";
import type { HolisticExtractOutput } from "../../../db/src/types";
import { parseHolisticExtractOutput } from "./holistic-extract-output.schema";

describe("holistic extract output schema", () => {
  it("accepts a minimal valid holistic extract output", () => {
    const minimal = {
      coordinationDimensionUpdates: {},
      coordinationSignalUpdates: {},
      coverageSummary: {
        dimensions: {
          social_energy: { covered: false, confidence: 0 },
          social_pace: { covered: false, confidence: 0 },
          conversation_depth: { covered: false, confidence: 0 },
          adventure_orientation: { covered: false, confidence: 0 },
          group_dynamic: { covered: false, confidence: 0 },
          values_proximity: { covered: false, confidence: 0 },
        },
        signals: {
          scheduling_availability: { covered: false, confidence: 0 },
          notice_preference: { covered: false, confidence: 0 },
          coordination_style: { covered: false, confidence: 0 },
        },
      },
      needsFollowUp: false,
    } satisfies HolisticExtractOutput;

    const parsed = parseHolisticExtractOutput(minimal);
    expect(parsed.needsFollowUp).toBe(false);
    expect(parsed.coverageSummary.dimensions.social_energy.covered).toBe(false);
  });
});
