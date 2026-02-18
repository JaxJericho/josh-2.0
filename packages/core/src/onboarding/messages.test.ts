import { describe, expect, it } from "vitest";
import {
  ONBOARDING_EXPLANATION,
  ONBOARDING_LATER,
  ONBOARDING_MESSAGE_1,
  ONBOARDING_MESSAGE_2,
  ONBOARDING_MESSAGE_3,
  ONBOARDING_MESSAGE_4,
  ONBOARDING_MESSAGES_VERSION,
  ONBOARDING_OPENING,
  renderOnboardingOpening,
} from "./messages";

describe("onboarding messages constants", () => {
  it("exports a non-empty version identifier", () => {
    expect(ONBOARDING_MESSAGES_VERSION).toBeDefined();
    expect(ONBOARDING_MESSAGES_VERSION.trim().length).toBeGreaterThan(0);
    expect(ONBOARDING_OPENING).toBeDefined();
    expect(ONBOARDING_EXPLANATION).toBeDefined();
    expect(ONBOARDING_MESSAGE_1).toBeDefined();
    expect(ONBOARDING_MESSAGE_2).toBeDefined();
    expect(ONBOARDING_MESSAGE_3).toBeDefined();
    expect(ONBOARDING_MESSAGE_4).toBeDefined();
    expect(ONBOARDING_LATER).toBeDefined();
  });

  it("matches approved onboarding copy exactly", () => {
    expect({
      ONBOARDING_MESSAGES_VERSION,
      ONBOARDING_OPENING,
      ONBOARDING_EXPLANATION,
      ONBOARDING_MESSAGE_1,
      ONBOARDING_MESSAGE_2,
      ONBOARDING_MESSAGE_3,
      ONBOARDING_MESSAGE_4,
      ONBOARDING_LATER,
    }).toMatchSnapshot();
  });

  it("renders the opening with a first name replacement", () => {
    expect(renderOnboardingOpening("Alex")).toBe(
      `Call me JOSH. Nice to meet you, Alex. You're off the waitlist — time to find your people.

Quick heads up: a profile photo is required before I can lock in your first LinkUp. You can add it anytime through your dashboard — now or later both work. Just know it needs to be there before any plan gets confirmed. Sound good?`,
    );
  });

  it("throws when firstName is empty", () => {
    expect(() => renderOnboardingOpening("")).toThrowError("firstName must be non-empty.");
  });
});
