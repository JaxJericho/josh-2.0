import { describe, expect, it, vi } from "vitest";

import {
  handleInterviewAnswerAbbreviated,
  type AbbreviatedInterviewProfile,
  type AbbreviatedInterviewSession,
} from "./handle-interview-answer-abbreviated.ts";
import { buildInvitedAbbreviatedWrapMessage } from "../../../core/src/invitations/abbreviated-welcome-messages.ts";
import type { HolisticExtractOutput } from "../../../db/src/types/index.ts";

const NOW_ISO = "2026-03-02T16:00:00.000Z";

describe("handleInterviewAnswerAbbreviated", () => {
  it("completes invited onboarding at 3 dimensions and 1 signal thresholds", async () => {
    const result = await handleInterviewAnswerAbbreviated(
      {
        message: "Weeknights are easiest and I like direct planning.",
        inboundMessageSid: "SM_COMPLETE_1",
        inviterName: "Alex",
        nowIso: NOW_ISO,
        session: buildSession(),
        profile: buildProfile(),
      },
      {
        extractSignals: vi.fn().mockResolvedValue(
          buildExtractionOutput({
            coordinationDimensionUpdates: {
              social_energy: { value: 0.62, confidence: 0.7 },
              social_pace: { value: 0.58, confidence: 0.61 },
              conversation_depth: { value: 0.64, confidence: 0.66 },
            },
            coordinationSignalUpdates: {
              notice_preference: "24_hours",
            },
            coverageSummary: {
              dimensions: {
                social_energy: { covered: true, confidence: 0.7 },
                social_pace: { covered: true, confidence: 0.61 },
                conversation_depth: { covered: true, confidence: 0.66 },
                adventure_orientation: { covered: false, confidence: 0.2 },
                group_dynamic: { covered: false, confidence: 0.2 },
                values_proximity: { covered: false, confidence: 0.2 },
              },
              signals: {
                scheduling_availability: { covered: false, confidence: 0.2 },
                notice_preference: { covered: true, confidence: 0.68 },
                coordination_style: { covered: false, confidence: 0.2 },
              },
            },
          }),
        ),
      },
    );

    expect(result.completed).toBe(true);
    expect(result.completedNow).toBe(true);
    expect(result.replyMessage).toBe(buildInvitedAbbreviatedWrapMessage("Alex"));
    expect(result.profilePatch?.state).toBe("complete_invited");
    expect(result.profilePatch?.is_complete_mvp).toBe(false);
    expect(result.sessionPatch).toEqual({
      mode: "idle",
      state_token: "idle",
      current_step_id: null,
      last_inbound_message_sid: "SM_COMPLETE_1",
    });
    expect(result.completionSnapshot).toEqual({
      dimensionsAboveThreshold: 3,
      signalsAboveThreshold: 1,
    });
  });

  it("merges updates without lowering existing confidence", async () => {
    const profile = buildProfile({
      coordination_dimensions: {
        social_energy: { value: 0.9, confidence: 0.92, source: "interview_llm" },
      },
      notice_preference: "24_hours",
      preferences: {
        coordination_signal_confidence: {
          scheduling_availability: 0.1,
          notice_preference: 0.85,
          coordination_style: 0.1,
        },
      },
    });

    const result = await handleInterviewAnswerAbbreviated(
      {
        message: "Maybe same-day notices work too.",
        inboundMessageSid: "SM_MERGE_1",
        inviterName: "Taylor",
        nowIso: NOW_ISO,
        session: buildSession(),
        profile,
      },
      {
        extractSignals: vi.fn().mockResolvedValue(
          buildExtractionOutput({
            coordinationDimensionUpdates: {
              social_energy: { value: 0.2, confidence: 0.2 },
            },
            coordinationSignalUpdates: {
              notice_preference: "same_day",
            },
            coverageSummary: {
              dimensions: {
                social_energy: { covered: true, confidence: 0.2 },
                social_pace: { covered: false, confidence: 0 },
                conversation_depth: { covered: false, confidence: 0 },
                adventure_orientation: { covered: false, confidence: 0 },
                group_dynamic: { covered: false, confidence: 0 },
                values_proximity: { covered: false, confidence: 0 },
              },
              signals: {
                scheduling_availability: { covered: false, confidence: 0 },
                notice_preference: { covered: true, confidence: 0.3 },
                coordination_style: { covered: false, confidence: 0 },
              },
            },
          }),
        ),
      },
    );

    const patchedDimensions = result.profilePatch?.coordination_dimensions as Record<string, unknown>;
    const socialEnergy = patchedDimensions.social_energy as { confidence: number; value: number };
    expect(socialEnergy.confidence).toBe(0.92);
    expect(socialEnergy.value).toBe(0.2);

    const patchedPreferences = result.profilePatch?.preferences as Record<string, unknown>;
    const signalConfidence = (patchedPreferences.coordination_signal_confidence as Record<string, number>);
    expect(signalConfidence.notice_preference).toBe(0.85);
    expect(result.profilePatch?.notice_preference).toBe("24_hours");
  });

  it("is replay-safe when the same inbound sid is seen again", async () => {
    const result = await handleInterviewAnswerAbbreviated(
      {
        message: "same message replay",
        inboundMessageSid: "SM_REPLAY_1",
        inviterName: "Riley",
        nowIso: NOW_ISO,
        session: buildSession({ last_inbound_message_sid: "SM_REPLAY_1" }),
        profile: buildProfile(),
      },
      {
        extractSignals: vi.fn(),
      },
    );

    expect(result.replayed).toBe(true);
    expect(result.replyMessage).toBeNull();
    expect(result.profilePatch).toBeNull();
    expect(result.sessionPatch).toBeNull();
  });
});

function buildSession(
  overrides: Partial<AbbreviatedInterviewSession> = {},
): AbbreviatedInterviewSession {
  return {
    id: "ses_123",
    mode: "interviewing_abbreviated",
    state_token: "interview_abbreviated:awaiting_reply",
    current_step_id: null,
    last_inbound_message_sid: null,
    ...overrides,
  };
}

function buildProfile(
  overrides: Partial<AbbreviatedInterviewProfile> = {},
): AbbreviatedInterviewProfile {
  return {
    id: "pro_123",
    user_id: "usr_123",
    state: "empty",
    is_complete_mvp: false,
    country_code: null,
    state_code: null,
    last_interview_step: null,
    preferences: {},
    fingerprint: {},
    activity_patterns: [],
    boundaries: {},
    active_intent: null,
    coordination_dimensions: {},
    scheduling_availability: null,
    notice_preference: null,
    coordination_style: null,
    completeness_percent: 0,
    completed_at: null,
    status_reason: "invited_interview_pending",
    state_changed_at: NOW_ISO,
    ...overrides,
  };
}

function buildExtractionOutput(
  overrides: Partial<HolisticExtractOutput>,
): HolisticExtractOutput {
  return {
    coordinationDimensionUpdates: {},
    coordinationSignalUpdates: {},
    coverageSummary: {
      dimensions: {
        social_energy: { covered: false, confidence: 0 },
        social_pace: { covered: false, confidence: 0 },
        conversation_depth: { covered: false, confidence: 0 },
        adventure_orientation: { covered: false, confidence: 0 },
        group_dynamic: { covered: false, confidence: 0 },
        values_proximity: { covered: false, confidence: 0 },
      },
      signals: {
        scheduling_availability: { covered: false, confidence: 0 },
        notice_preference: { covered: false, confidence: 0 },
        coordination_style: { covered: false, confidence: 0 },
      },
    },
    needsFollowUp: false,
    ...overrides,
  };
}
