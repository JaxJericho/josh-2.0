import { describe, expect, it } from "vitest";
import { scorePair, type CompatibilitySignalSnapshot } from "../packages/core/src/compatibility/scorer";

describe("compatibility scorer", () => {
  it("is deterministic for identical inputs", () => {
    const left = sampleSignal("hash-left");
    const right = sampleSignal("hash-right");

    const first = scorePair(left, right);
    const second = scorePair(left, right);

    expect(second).toEqual(first);
  });

  it("is symmetric for score and breakdown totals", () => {
    const left = sampleSignal("hash-left");
    const right = sampleSignal("hash-right");

    const forward = scorePair(left, right);
    const reverse = scorePair(right, left);

    expect(reverse.score).toBe(forward.score);
    expect(reverse.breakdown).toEqual(forward.breakdown);
    expect(reverse.a_hash).toBe("hash-right");
    expect(reverse.b_hash).toBe("hash-left");
  });

  it("keeps weighted breakdown internally consistent and in range", () => {
    const result = scorePair(sampleSignal("hash-left"), sampleSignal("hash-right"));

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.breakdown.penalties).toBeGreaterThanOrEqual(0);

    const reconstructed = round(
      result.breakdown.interests +
        result.breakdown.traits +
        result.breakdown.intent +
        result.breakdown.availability -
        result.breakdown.penalties,
    );

    expect(result.breakdown.total).toBeCloseTo(reconstructed, 6);
    expect(result.score).toBe(result.breakdown.total);
  });
});

function sampleSignal(contentHash: string): CompatibilitySignalSnapshot {
  return {
    interest_vector: [0.8, 0.5, 0.3, 0, 0.1, 0, 0.7, 0.2, 0],
    trait_vector: [0.5, 1, 0, 0, 1, 0, 1, 0, 0.6],
    intent_vector: [0.9, 0.4, 0.3, 0, 0.8, 0, 1, 0],
    availability_vector: [1, 0, 1, 0, 1, 0, 1],
    content_hash: contentHash,
    metadata: {
      normalizer_version: "v1",
    },
  };
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
