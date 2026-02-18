import { describe, expect, it } from "vitest";
import {
  FINGERPRINT_FACTOR_KEYS,
  getSignalCoverageStatus,
  selectNextQuestion,
} from "../../packages/core/src/interview/signal-coverage";

function createProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    country_code: null,
    state_code: null,
    last_interview_step: null,
    fingerprint: {},
    activity_patterns: [],
    boundaries: {},
    preferences: {},
    active_intent: null,
    ...overrides,
  };
}

function createFingerprint(keys: string[]): Record<string, unknown> {
  return keys.reduce((accumulator, key) => {
    accumulator[key] = {
      value: 0.7,
      confidence: 0.7,
      source: "interview",
    };
    return accumulator;
  }, {} as Record<string, unknown>);
}

describe("signal coverage", () => {
  it("empty profile marks all required targets uncovered and is not mvp complete", () => {
    const status = getSignalCoverageStatus(createProfile());

    expect(status.mvpComplete).toBe(false);
    expect(status.covered).toHaveLength(0);
    expect(status.uncovered).toEqual(expect.arrayContaining([...FINGERPRINT_FACTOR_KEYS]));
    expect(status.uncovered).toEqual(
      expect.arrayContaining([
        "activity_patterns",
        "group_size_pref",
        "time_preferences",
        "boundaries_asked",
      ]),
    );
    expect(status.nextSignalTarget).toBe("activity_patterns");
  });

  it("partial profile computes covered and uncovered deterministically", () => {
    const status = getSignalCoverageStatus(createProfile({
      fingerprint: createFingerprint([
        "connection_depth",
        "social_energy",
        "conversation_style",
        "social_pace",
      ]),
      activity_patterns: [
        { activity_key: "coffee", confidence: 0.7, source: "interview" },
        { activity_key: "walk", confidence: 0.65, source: "interview" },
      ],
      boundaries: { skipped: true, no_thanks: [] },
      preferences: {
        group_size_pref: "2-3",
      },
    }));

    expect(status.mvpComplete).toBe(false);
    expect(status.covered).toEqual(
      expect.arrayContaining([
        "connection_depth",
        "social_energy",
        "conversation_style",
        "social_pace",
        "group_size_pref",
        "boundaries_asked",
      ]),
    );
    expect(status.uncovered).toEqual(expect.arrayContaining(["activity_patterns", "time_preferences"]));
    expect(status.nextSignalTarget).toBe("activity_patterns");
  });

  it("complete profile meets mvp thresholds", () => {
    const status = getSignalCoverageStatus(createProfile({
      fingerprint: createFingerprint([
        "connection_depth",
        "social_energy",
        "social_pace",
        "novelty_seeking",
        "structure_preference",
        "humor_style",
        "conversation_style",
        "values_alignment_importance",
      ]),
      activity_patterns: [
        { activity_key: "coffee", confidence: 0.65, source: "interview" },
        { activity_key: "walk", confidence: 0.65, source: "interview" },
        { activity_key: "museum", confidence: 0.65, source: "interview" },
      ],
      boundaries: { skipped: true, no_thanks: [] },
      preferences: {
        group_size_pref: "2-3",
        time_preferences: ["evenings"],
      },
    }));

    expect(status.mvpComplete).toBe(true);
    expect(status.nextSignalTarget).toBeNull();
  });
});

describe("adaptive next question selection", () => {
  it("skips already-covered targets and returns a stable question id", () => {
    const selection = selectNextQuestion(
      createProfile({
        fingerprint: createFingerprint([
          "connection_depth",
          "novelty_seeking",
        ]),
        activity_patterns: [
          { activity_key: "coffee", confidence: 0.65, source: "interview" },
          { activity_key: "walk", confidence: 0.65, source: "interview" },
          { activity_key: "museum", confidence: 0.65, source: "interview" },
        ],
        active_intent: { activity_key: "coffee" },
      }),
      [],
    );

    expect(selection).not.toBeNull();
    expect(selection?.signalTarget).toBe("social_energy");
    expect(selection?.questionId).toBe("style_01");
  });

  it("skips inferable targets when conversation history strongly indicates them", () => {
    const selection = selectNextQuestion(
      createProfile({
        fingerprint: createFingerprint([
          "connection_depth",
          "novelty_seeking",
          "social_energy",
          "conversation_style",
          "social_pace",
        ]),
        activity_patterns: [
          { activity_key: "coffee", confidence: 0.65, source: "interview" },
          { activity_key: "walk", confidence: 0.65, source: "interview" },
          { activity_key: "museum", confidence: 0.65, source: "interview" },
        ],
        active_intent: { activity_key: "coffee" },
      }),
      ["Small group works best for me."],
    );

    expect(selection).not.toBeNull();
    expect(selection?.signalTarget).toBe("values_alignment_importance");
    expect(selection?.questionId).toBe("values_01");
  });
});
