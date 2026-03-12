import { describe, expect, it } from "vitest";
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
    const classification = classifyIntent(
      "STOP",
      buildSession({
        has_user_record: false,
        has_pending_contact_invitation: true,
      }),
    );

    expect(classification).toEqual({
      intent: "CONTACT_INVITE_RESPONSE",
      confidence: 1,
    });
  });

  it("classifies awaiting_invite_reply as INVITE_RESPONSE without LLM", () => {
    const classification = classifyIntent(
      "yes",
      buildSession({ mode: "awaiting_invite_reply" }),
    );

    expect(classification).toEqual({
      intent: "INVITE_RESPONSE",
      confidence: 1,
    });
  });

  it("classifies awaiting_invitation_response as INVITATION_RESPONSE without LLM", () => {
    const classification = classifyIntent(
      "I'm in",
      buildSession({ mode: "awaiting_invitation_response" }),
    );

    expect(classification).toEqual({
      intent: "INVITATION_RESPONSE",
      confidence: 1,
    });
  });

  it("classifies interviewing mode as INTERVIEW_ANSWER without LLM", () => {
    const classification = classifyIntent(
      "I like low-key coffee shops",
      buildSession({ mode: "interviewing" }),
    );

    expect(classification).toEqual({
      intent: "INTERVIEW_ANSWER",
      confidence: 1,
    });
  });

  it("classifies interviewing_abbreviated mode as INTERVIEW_ANSWER_ABBREVIATED without LLM", () => {
    const classification = classifyIntent(
      "Weeknights are best for me",
      buildSession({ mode: "interviewing_abbreviated" }),
    );

    expect(classification).toEqual({
      intent: "INTERVIEW_ANSWER_ABBREVIATED",
      confidence: 1,
    });
  });

  it("classifies post_activity_checkin mode as POST_ACTIVITY_CHECKIN without LLM", () => {
    const classification = classifyIntent(
      "yes",
      buildSession({ mode: "post_activity_checkin" }),
    );

    expect(classification).toEqual({
      intent: "POST_ACTIVITY_CHECKIN",
      confidence: 1,
    });
  });

  it("classifies HELP as HELP", () => {
    const classification = classifyIntent(" HELP ", buildSession());

    expect(classification).toEqual({
      intent: "HELP",
      confidence: 1,
    });
  });

  it("falls back to UNKNOWN for idle non-special messages", () => {
    const classification = classifyIntent("Let's make a plan", buildSession());

    expect(classification).toEqual({
      intent: "UNKNOWN",
      confidence: 0.35,
    });
  });

  it("always returns confidence in the [0, 1] range", () => {
    const classifications = [
      classifyIntent("HELP", buildSession()),
      classifyIntent("yes", buildSession({ mode: "awaiting_invite_reply" })),
      classifyIntent("I'm in", buildSession({ mode: "awaiting_invitation_response" })),
      classifyIntent("Let's make a plan", buildSession()),
    ];

    for (const classification of classifications) {
      expect(classification.confidence).toBeGreaterThanOrEqual(0);
      expect(classification.confidence).toBeLessThanOrEqual(1);
    }
  });
});
