import { describe, expect, it } from "vitest";
import type { ProfileRowForInterview } from "../profile/profile-writer";
import { resolveCurrentInterviewStep } from "./state";

const BASE_PROFILE: ProfileRowForInterview = {
  id: "profile-1",
  user_id: "user-1",
  country_code: null,
  state_code: null,
  state: "partial",
  is_complete_mvp: false,
  last_interview_step: null,
  preferences: {},
  fingerprint: {},
  activity_patterns: [],
  boundaries: {},
  active_intent: null,
  completeness_percent: 0,
  completed_at: null,
  status_reason: null,
  state_changed_at: "2026-01-01T00:00:00.000Z",
};

describe("resolveCurrentInterviewStep", () => {
  it("throws when interview engine receives an onboarding state token", () => {
    expect(() =>
      resolveCurrentInterviewStep({
        session: {
          mode: "interviewing",
          state_token: "onboarding:awaiting_opening_response",
          current_step_id: null,
          last_inbound_message_sid: null,
          dropout_nudge_sent_at: null,
        },
        profile: BASE_PROFILE,
      })
    ).toThrow("must be routed to onboarding engine");
  });

  it("resolves interview tokens as normal", () => {
    const stepId = resolveCurrentInterviewStep({
      session: {
        mode: "interviewing",
        state_token: "interview:activity_01",
        current_step_id: null,
        last_inbound_message_sid: null,
        dropout_nudge_sent_at: null,
      },
      profile: BASE_PROFILE,
    });

    expect(stepId).toBe("activity_01");
  });
});
