import { describe, expect, it } from "vitest";

import {
  detectSafetyContent,
  normalizeSafetyMessage,
} from "../../packages/core/src/safety/keyword-detector.ts";

describe("safety keyword detector", () => {
  it("normalizes case, punctuation, and whitespace", () => {
    const normalized = normalizeSafetyMessage("  I... WANT!!!   to   DIE??  ");

    expect(normalized).toBe("i want to die");
  });

  it("classifies crisis severity deterministically", () => {
    const result = detectSafetyContent("I want to die");

    expect(result.matched).toBe(true);
    expect(result.severity).toBe("crisis");
    expect(result.matched_term).toBe("i want to die");
    expect(result.keyword_version).toBe("safety_keywords_v1");
  });

  it("classifies high severity before medium and low", () => {
    const result = detectSafetyContent("You are an idiot and I will hurt you");

    expect(result.matched).toBe(true);
    expect(result.severity).toBe("high");
    expect(result.matched_term).toBe("i will hurt you");
  });

  it("does not trigger on safe text", () => {
    const result = detectSafetyContent("Can we reschedule for tomorrow evening?");

    expect(result.matched).toBe(false);
    expect(result.severity).toBeNull();
    expect(result.matched_term).toBeNull();
  });

  it("avoids brittle substring matches", () => {
    const result = detectSafetyContent("The classic movie was great.");

    expect(result.matched).toBe(false);
  });
});
