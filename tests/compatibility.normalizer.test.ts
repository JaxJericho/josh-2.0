import { describe, expect, it } from "vitest";
import {
  normalizeProfileSignals,
  type StructuredProfileForCompatibility,
} from "../packages/core/src/compatibility/normalizer";

describe("compatibility signal normalizer", () => {
  it("produces deterministic vectors for the same profile input", () => {
    const profile = sampleProfile();
    const before = JSON.stringify(profile);

    const first = normalizeProfileSignals(profile);
    const second = normalizeProfileSignals(profile);

    expect(second).toEqual(first);
    expect(JSON.stringify(profile)).toBe(before);
    expect(first.interest_vector).toEqual([0.8, 0.5, 0, 0, 0, 0, 0, 0, 0]);
    expect(first.trait_vector).toEqual([0.82, 0.8, 0.74, 0.35, 0.4, 0.88]);
    expect(first.intent_vector).toEqual([0.7, 0.2, 0.6, 0, 0, 1, 0, 0]);
    expect(first.availability_vector).toEqual([1, 0, 1, 0, 1, 0, 1]);
    expect(first.metadata.ignored_activity_keys).toEqual(["pickleball"]);
    expect(first.metadata.coordination_dimensions.social_pace).toEqual({
      value: 0.8,
      confidence: 0.8,
    });
    expect(first.metadata.trait_vector_source).toEqual([0.82, 0.8, 0.74, 0.35, 0.4, 0.88]);
  });

  it("fails fast on implicit coercion attempts", () => {
    const profile = sampleProfile();
    profile.activity_patterns = [
      {
        activity_key: "coffee",
        confidence: "0.8",
      },
    ];

    expect(() => normalizeProfileSignals(profile)).toThrow(
      "profile.activity_patterns[0].confidence must be a finite number.",
    );
  });

  it("returns null defaults when coordination dimensions are missing", () => {
    const profile = sampleProfile();
    profile.coordination_dimensions = null;

    const normalized = normalizeProfileSignals(profile);

    expect(normalized.trait_vector).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(normalized.metadata.trait_vector_source).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(normalized.metadata.coordination_dimensions).toEqual({
      social_energy: { value: null, confidence: null },
      social_pace: { value: null, confidence: null },
      conversation_depth: { value: null, confidence: null },
      adventure_orientation: { value: null, confidence: null },
      group_dynamic: { value: null, confidence: null },
      values_proximity: { value: null, confidence: null },
    });
  });
});

function sampleProfile(): StructuredProfileForCompatibility {
  return {
    profile_id: "pro_123",
    user_id: "usr_123",
    state: "complete_mvp",
    is_complete_mvp: true,
    coordination_dimensions: {
      social_energy: { value: 0.82, confidence: 0.7, source: "interview" },
      social_pace: { value: 0.8, confidence: 0.8, source: "interview" },
      conversation_depth: { value: 0.74, confidence: 0.66, source: "interview" },
      adventure_orientation: { value: 0.35, confidence: 0.69, source: "interview" },
      group_dynamic: { value: 0.4, confidence: 0.6, source: "interview" },
      values_proximity: { value: 0.88, confidence: 0.72, source: "interview" },
    },
    activity_patterns: [
      { activity_key: "coffee", confidence: 0.8, source: "interview" },
      { activity_key: "walk", confidence: 0.5, source: "interview" },
      { activity_key: "pickleball", confidence: 0.4, source: "interview" },
    ],
    boundaries: {
      no_thanks: ["bars", "super loud places"],
    },
    preferences: {
      group_size_pref: "2-3",
      values_alignment_importance: "very",
      time_preferences: ["mornings", "evenings"],
    },
    active_intent: {
      activity_key: "coffee",
      motive_weights: {
        connection: 0.7,
        fun: 0.2,
        restorative: 0.6,
      },
    },
    completed_at: "2026-02-16T12:00:00.000Z",
    updated_at: "2026-02-16T12:00:00.000Z",
  };
}
