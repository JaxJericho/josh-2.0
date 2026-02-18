import { describe, expect, it } from "vitest";
import { validateModelOutput } from "../../packages/llm/src/output-validator";

describe("output validator", () => {
  it("accepts plain JSON output when JSON is required", () => {
    const result = validateModelOutput({
      rawText: JSON.stringify({
        stepId: "motive_01",
        extracted: {},
      }),
      requireJson: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected validator to pass");
    }
    expect(result.sanitizedText).toContain("\"stepId\":\"motive_01\"");
  });

  it("rejects prose wrappers even when wrapped JSON is parseable", () => {
    const result = validateModelOutput({
      rawText: `Sure. Here's the JSON:\n{"stepId":"motive_01","extracted":{}}`,
      requireJson: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validator to fail");
    }
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "output_wrapper_detected" }),
      ]),
    );
  });

  it("rejects prohibited guarantee language in user-facing fields", () => {
    const result = validateModelOutput({
      rawText: JSON.stringify({
        stepId: "motive_01",
        extracted: {},
        notes: {
          followUpQuestion: "I guarantee this will work. Which one fits best?",
        },
      }),
      requireJson: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validator to fail");
    }
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "no_guarantees" }),
      ]),
    );
  });
});
