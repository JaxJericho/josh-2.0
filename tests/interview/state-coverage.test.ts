import { describe, expect, it } from "vitest";
import {
  buildInterviewTransitionPlan,
  type InterviewSessionSnapshot,
} from "../../packages/core/src/interview/state";
import type { ProfileRowForInterview } from "../../packages/core/src/profile/profile-writer";

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

function createProfile(overrides: Partial<ProfileRowForInterview> = {}): ProfileRowForInterview {
  return {
    id: "pro_coverage_1",
    user_id: "usr_coverage_1",
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
    state_changed_at: "2026-02-18T00:00:00.000Z",
    ...overrides,
  };
}

function createSession(currentStepId: string): InterviewSessionSnapshot {
  return {
    mode: "interviewing",
    state_token: `interview:${currentStepId}`,
    current_step_id: currentStepId,
    last_inbound_message_sid: null,
  };
}

describe("interview state progression with signal coverage", () => {
  it("buildInterviewTransitionPlan chooses the next question from uncovered coverage targets", () => {
    const profile = createProfile({
      preferences: {
        group_size_pref: "2-3",
        interview_progress: {
          version: 1,
          status: "in_progress",
          step_index: 8,
          current_step_id: "values_01",
          completed_step_ids: [
            "activity_01",
            "activity_02",
            "motive_01",
            "motive_02",
            "style_01",
            "style_02",
            "pace_01",
            "group_01",
          ],
          answers: {},
          updated_at: "2026-02-18T00:00:00.000Z",
        },
      },
      fingerprint: createFingerprint([
        "connection_depth",
        "novelty_seeking",
        "social_energy",
        "conversation_style",
        "social_pace",
        "structure_preference",
        "group_vs_1on1_preference",
      ]),
      activity_patterns: [
        { activity_key: "coffee", confidence: 0.65, source: "interview" },
        { activity_key: "walk", confidence: 0.65, source: "interview" },
        { activity_key: "museum", confidence: 0.65, source: "interview" },
      ],
      active_intent: { activity_key: "coffee" },
    });

    const transition = buildInterviewTransitionPlan({
      inbound_message_sid: "SM_COVERAGE_0001",
      inbound_message_text: "A",
      now_iso: "2026-02-18T00:00:00.000Z",
      session: createSession("values_01"),
      profile,
    });

    expect(transition.action).toBe("advance");
    expect(transition.current_step_id).toBe("values_01");
    expect(transition.next_step_id).toBe("boundaries_01");
  });

  it("completion is triggered only when mvp coverage thresholds are met", () => {
    const profile = createProfile({
      preferences: {
        group_size_pref: "2-3",
        interview_progress: {
          version: 1,
          status: "in_progress",
          step_index: 10,
          current_step_id: "constraints_01",
          completed_step_ids: [
            "activity_01",
            "activity_02",
            "motive_01",
            "motive_02",
            "style_01",
            "style_02",
            "pace_01",
            "group_01",
            "values_01",
            "boundaries_01",
          ],
          answers: {
            boundaries_01: {
              no_thanks: [],
              skipped: true,
            },
          },
          updated_at: "2026-02-18T00:00:00.000Z",
        },
      },
      boundaries: {
        no_thanks: [],
        skipped: true,
      },
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
      active_intent: { activity_key: "coffee" },
    });

    const transition = buildInterviewTransitionPlan({
      inbound_message_sid: "SM_COVERAGE_0002",
      inbound_message_text: "C",
      now_iso: "2026-02-18T00:00:00.000Z",
      session: createSession("constraints_01"),
      profile,
    });

    expect(transition.action).toBe("complete");
    expect(transition.next_step_id).toBeNull();
    expect(transition.next_session.mode).toBe("idle");
    expect(transition.profile_patch?.is_complete_mvp).toBe(true);
  });
});
