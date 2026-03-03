import { describe, expect, it } from "vitest";
import { scorePair, type CompatibilitySignalSnapshot } from "../packages/core/src/compatibility/scorer";
import type { CoordinationDimensionKey } from "../packages/db/src/types/index";

describe("compatibility scorer", () => {
  it("is deterministic for identical inputs", () => {
    const left = sampleSignal(
      {
        social_energy: [0.58, 0.8],
        social_pace: [0.61, 0.81],
        conversation_depth: [0.66, 0.79],
        adventure_orientation: [0.72, 0.82],
        group_dynamic: [0.42, 0.75],
        values_proximity: [0.69, 0.77],
      },
      "hash-left",
    );
    const right = sampleSignal(
      {
        social_energy: [0.55, 0.85],
        social_pace: [0.59, 0.79],
        conversation_depth: [0.6, 0.83],
        adventure_orientation: [0.74, 0.86],
        group_dynamic: [0.47, 0.8],
        values_proximity: [0.66, 0.82],
      },
      "hash-right",
    );

    const first = scorePair(left, right);
    const second = scorePair(left, right);

    expect(second).toEqual(first);
  });

  it("is symmetric for score and breakdown totals", () => {
    const left = sampleSignal(
      {
        social_energy: [0.58, 0.8],
        social_pace: [0.61, 0.81],
        conversation_depth: [0.66, 0.79],
        adventure_orientation: [0.72, 0.82],
        group_dynamic: [0.42, 0.75],
        values_proximity: [0.69, 0.77],
      },
      "hash-left",
    );
    const right = sampleSignal(
      {
        social_energy: [0.55, 0.85],
        social_pace: [0.59, 0.79],
        conversation_depth: [0.6, 0.83],
        adventure_orientation: [0.74, 0.86],
        group_dynamic: [0.47, 0.8],
        values_proximity: [0.66, 0.82],
      },
      "hash-right",
    );

    const forward = scorePair(left, right);
    const reverse = scorePair(right, left);

    expect(reverse.score).toBe(forward.score);
    expect(reverse.breakdown).toEqual(forward.breakdown);
    expect(reverse.a_hash).toBe("hash-right");
    expect(reverse.b_hash).toBe("hash-left");
  });

  it("scores aligned dimension pairs above mismatched dimension pairs", () => {
    const left = sampleSignal({
      social_energy: [0.6, 0.9],
      social_pace: [0.55, 0.88],
      conversation_depth: [0.82, 0.92],
      adventure_orientation: [0.65, 0.86],
      group_dynamic: [0.48, 0.84],
      values_proximity: [0.77, 0.95],
    });

    const aligned = sampleSignal({
      social_energy: [0.62, 0.89],
      social_pace: [0.53, 0.87],
      conversation_depth: [0.8, 0.9],
      adventure_orientation: [0.66, 0.88],
      group_dynamic: [0.5, 0.84],
      values_proximity: [0.74, 0.91],
    });

    const mismatched = sampleSignal({
      social_energy: [0.62, 0.89],
      social_pace: [0.53, 0.87],
      conversation_depth: [0.14, 0.9],
      adventure_orientation: [0.66, 0.88],
      group_dynamic: [0.5, 0.84],
      values_proximity: [0.74, 0.91],
    });

    const alignedResult = scorePair(left, aligned);
    const mismatchedResult = scorePair(left, mismatched);

    expect(alignedResult.score).toBeGreaterThan(mismatchedResult.score);
    expect(alignedResult.breakdown.conversation_depth).toBeGreaterThan(
      mismatchedResult.breakdown.conversation_depth,
    );
  });

  it("scores incomplete 3-of-6 profiles below complete profiles when values are otherwise similar", () => {
    const left = sampleSignal({
      social_energy: [0.58, 0.9],
      social_pace: [0.56, 0.88],
      conversation_depth: [0.71, 0.93],
      adventure_orientation: [0.63, 0.86],
      group_dynamic: [0.45, 0.82],
      values_proximity: [0.79, 0.95],
    });

    const complete = sampleSignal({
      social_energy: [0.6, 0.89],
      social_pace: [0.57, 0.87],
      conversation_depth: [0.69, 0.91],
      adventure_orientation: [0.65, 0.85],
      group_dynamic: [0.47, 0.81],
      values_proximity: [0.77, 0.93],
    });

    const incomplete = sampleSignal({
      social_energy: [0.6, 0.89],
      social_pace: [0.57, 0.87],
      conversation_depth: [0.69, 0.91],
    });

    const completeResult = scorePair(left, complete);
    const incompleteResult = scorePair(left, incomplete);

    expect(completeResult.score).toBeGreaterThan(incompleteResult.score);
    expect(incompleteResult.breakdown.coverage).toBeLessThan(completeResult.breakdown.coverage);
  });

  it("keeps weighted breakdown internally consistent and in range", () => {
    const result = scorePair(
      sampleSignal({
        social_energy: [0.58, 0.8],
        social_pace: [0.61, 0.81],
        conversation_depth: [0.66, 0.79],
        adventure_orientation: [0.72, 0.82],
        group_dynamic: [0.42, 0.75],
        values_proximity: [0.69, 0.77],
      }),
      sampleSignal({
        social_energy: [0.55, 0.85],
        social_pace: [0.59, 0.79],
        conversation_depth: [0.6, 0.83],
        adventure_orientation: [0.74, 0.86],
        group_dynamic: [0.47, 0.8],
        values_proximity: [0.66, 0.82],
      }),
    );

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);

    const reconstructed = round(
      result.breakdown.social_energy +
        result.breakdown.social_pace +
        result.breakdown.conversation_depth +
        result.breakdown.adventure_orientation +
        result.breakdown.group_dynamic +
        result.breakdown.values_proximity,
    );

    expect(result.breakdown.total).toBeCloseTo(reconstructed, 6);
    expect(result.score).toBe(result.breakdown.total);
  });
});

function sampleSignal(
  dimensions: Partial<Record<CoordinationDimensionKey, readonly [number, number]>>,
  contentHash = "hash",
): CompatibilitySignalSnapshot {
  const coordinationDimensions: Record<string, unknown> = {};
  for (const [key, tuple] of Object.entries(dimensions) as Array<
    [CoordinationDimensionKey, readonly [number, number] | undefined]
  >) {
    if (!tuple) {
      continue;
    }
    const [value, confidence] = tuple;
    coordinationDimensions[key] = { value, confidence };
  }

  return {
    coordination_dimensions: coordinationDimensions,
    content_hash: contentHash,
    metadata: {},
  };
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
