import { describe, expect, it, vi } from "vitest";
import { classifyIntent } from "./intent-classifier";
import type { ConversationSession } from "./intent-types";

const BASE_SESSION: ConversationSession = {
  mode: "idle",
  has_user_record: true,
  has_pending_contact_invitation: false,
};

function buildSession(
  overrides: Partial<ConversationSession> = {},
): ConversationSession {
  return {
    ...BASE_SESSION,
    ...overrides,
  };
}

describe("classifyIntent", () => {
  it("classifies unknown-number pending invitations before any other path", () => {
    const disambiguator = vi.fn((): "OPEN_INTENT" => "OPEN_INTENT");

    const classification = classifyIntent(
      "STOP",
      buildSession({
        has_user_record: false,
        has_pending_contact_invitation: true,
      }),
      { resolveAmbiguousIntent: disambiguator },
    );

    expect(classification).toEqual({
      intent: "CONTACT_INVITE_RESPONSE",
      confidence: 1,
    });
    expect(disambiguator).not.toHaveBeenCalled();
  });

  it("classifies awaiting_social_choice as PLAN_SOCIAL_CHOICE without LLM", () => {
    const disambiguator = vi.fn((): "OPEN_INTENT" => "OPEN_INTENT");

    const classification = classifyIntent(
      "I will take option B",
      buildSession({ mode: "awaiting_social_choice" }),
      { resolveAmbiguousIntent: disambiguator },
    );

    expect(classification).toEqual({
      intent: "PLAN_SOCIAL_CHOICE",
      confidence: 1,
    });
    expect(disambiguator).not.toHaveBeenCalled();
  });

  it("classifies interviewing mode as INTERVIEW_ANSWER without LLM", () => {
    const disambiguator = vi.fn((): "OPEN_INTENT" => "OPEN_INTENT");

    const classification = classifyIntent(
      "I like low-key coffee shops",
      buildSession({ mode: "interviewing" }),
      { resolveAmbiguousIntent: disambiguator },
    );

    expect(classification).toEqual({
      intent: "INTERVIEW_ANSWER",
      confidence: 1,
    });
    expect(disambiguator).not.toHaveBeenCalled();
  });

  it("classifies STOP and HELP as SYSTEM_COMMAND from any mode", () => {
    const stopClassification = classifyIntent(
      " stop ",
      buildSession({ mode: "interviewing" }),
    );
    const helpClassification = classifyIntent(
      "HELP",
      buildSession({ mode: "awaiting_social_choice" }),
    );

    expect(stopClassification).toEqual({
      intent: "SYSTEM_COMMAND",
      confidence: 1,
    });
    expect(helpClassification).toEqual({
      intent: "SYSTEM_COMMAND",
      confidence: 1,
    });
  });

  it("uses disambiguator only for ambiguous OPEN_INTENT vs NAMED_PLAN_REQUEST", () => {
    const disambiguator = vi.fn(
      (): "NAMED_PLAN_REQUEST" => "NAMED_PLAN_REQUEST",
    );

    const classification = classifyIntent(
      "Let's make a plan",
      buildSession(),
      { resolveAmbiguousIntent: disambiguator },
    );

    expect(classification).toEqual({
      intent: "NAMED_PLAN_REQUEST",
      confidence: 0.7,
    });
    expect(disambiguator).toHaveBeenCalledTimes(1);
    expect(disambiguator).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Let's make a plan",
        normalizedMessage: "let's make a plan",
      }),
    );
  });

  it("does not call disambiguator for clear OPEN_INTENT and NAMED_PLAN_REQUEST", () => {
    const disambiguator = vi.fn((): "OPEN_INTENT" => "OPEN_INTENT");

    const openIntent = classifyIntent(
      "I want to do something this weekend",
      buildSession(),
      { resolveAmbiguousIntent: disambiguator },
    );
    const namedIntent = classifyIntent(
      "I want to go hiking with Sarah",
      buildSession(),
      { resolveAmbiguousIntent: disambiguator },
    );

    expect(openIntent.intent).toBe("OPEN_INTENT");
    expect(namedIntent.intent).toBe("NAMED_PLAN_REQUEST");
    expect(disambiguator).not.toHaveBeenCalled();
  });

  it("always returns confidence in the [0, 1] range", () => {
    const classifications = [
      classifyIntent("HELP", buildSession()),
      classifyIntent(
        "I want to do something this weekend",
        buildSession(),
      ),
      classifyIntent(
        "I want to go hiking with Sarah",
        buildSession(),
      ),
      classifyIntent("Let's make a plan", buildSession()),
    ];

    for (const classification of classifications) {
      expect(classification.confidence).toBeGreaterThanOrEqual(0);
      expect(classification.confidence).toBeLessThanOrEqual(1);
    }
  });
});
