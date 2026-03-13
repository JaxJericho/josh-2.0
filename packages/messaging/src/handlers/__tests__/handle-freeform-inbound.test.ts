import { describe, expect, it, vi } from "vitest";

import {
  FREEFORM_AVAILABILITY_REPLY,
  FREEFORM_GENERAL_REPLY,
  FREEFORM_PREFERENCE_UPDATE_REPLY,
  handleFreeformInbound,
} from "../handle-freeform-inbound";
import type { ProfileRowForFreeformPreferenceUpdate } from "../../../../core/src/profile/profile-writer";

const NOW_ISO = "2026-03-12T18:00:00.000Z";

describe("handleFreeformInbound", () => {
  it("returns availability signal outcome with idle reply", async () => {
    const result = await handleFreeformInbound(
      {
        messageText: "I'm free Saturday.",
        correlationId: "corr_123",
        nowIso: NOW_ISO,
        profile: buildProfile(),
      },
      {
        classifyInbound: vi.fn().mockResolvedValue({
          category: "AVAILABILITY_SIGNAL",
          summary: "User is free Saturday.",
        }),
      },
    );

    expect(result).toEqual({
      kind: "availability_signal",
      summary: "User is free Saturday.",
      replyMessage: FREEFORM_AVAILABILITY_REPLY,
      nextMode: "idle",
      nextStateToken: "idle",
    });
  });

  it("returns post-event signal outcome without doing router-side lookup work", async () => {
    const result = await handleFreeformInbound(
      {
        messageText: "That coffee place was perfect.",
        correlationId: "corr_123",
        nowIso: NOW_ISO,
        profile: buildProfile(),
      },
      {
        classifyInbound: vi.fn().mockResolvedValue({
          category: "POST_EVENT_SIGNAL",
          summary: "User praised a recent coffee outing.",
        }),
      },
    );

    expect(result).toEqual({
      kind: "post_event_signal",
      summary: "User praised a recent coffee outing.",
    });
  });

  it("builds a profile patch and profile event for preference updates", async () => {
    const result = await handleFreeformInbound(
      {
        messageText: "Stop sending me hiking stuff. Early mornings are best.",
        correlationId: "corr_123",
        nowIso: NOW_ISO,
        profile: buildProfile(),
      },
      {
        classifyInbound: vi.fn().mockResolvedValue({
          category: "PREFERENCE_UPDATE",
          summary: "User opted out of hiking and prefers early mornings.",
        }),
        extractPreferenceUpdate: vi.fn().mockResolvedValue({
          summary: "User opted out of hiking and prefers early mornings.",
          preferences_patch: {
            time_preferences: ["early_morning"],
          },
          boundaries_patch: {
            no_thanks: ["hiking"],
          },
        }),
      },
    );

    expect(result.kind).toBe("preference_update");
    if (result.kind !== "preference_update") {
      throw new Error("Expected preference_update result.");
    }
    expect(result.replyMessage).toBe(FREEFORM_PREFERENCE_UPDATE_REPLY);
    expect(result.profilePatch?.preferences).toMatchObject({
      time_preferences: ["early_morning"],
    });
    expect(result.profilePatch?.boundaries).toMatchObject({
      no_thanks: ["hiking"],
    });
    expect(result.profileEvent).toEqual({
      eventType: "freeform_preference_updated",
      payload: {
        summary: "User opted out of hiking and prefers early mornings.",
        preferences_patch: {
          time_preferences: ["early_morning"],
        },
        boundaries_patch: {
          no_thanks: ["hiking"],
        },
      },
    });
  });

  it("returns acknowledgment without a profile write when preference extraction fails", async () => {
    const result = await handleFreeformInbound(
      {
        messageText: "Not into group things right now.",
        correlationId: "corr_123",
        nowIso: NOW_ISO,
        profile: buildProfile(),
      },
      {
        classifyInbound: vi.fn().mockResolvedValue({
          category: "PREFERENCE_UPDATE",
          summary: "User prefers smaller or no groups right now.",
        }),
        extractPreferenceUpdate: vi.fn().mockRejectedValue(new Error("timeout")),
      },
    );

    expect(result).toEqual({
      kind: "preference_update",
      summary: "User prefers smaller or no groups right now.",
      replyMessage: FREEFORM_PREFERENCE_UPDATE_REPLY,
      nextMode: "idle",
      nextStateToken: "idle",
      profilePatch: null,
      profileEvent: null,
    });
  });

  it("falls back to general freeform when classification throws", async () => {
    const result = await handleFreeformInbound(
      {
        messageText: "hello there",
        correlationId: "corr_123",
        nowIso: NOW_ISO,
        profile: buildProfile(),
      },
      {
        classifyInbound: vi.fn().mockRejectedValue(new Error("AbortError")),
      },
    );

    expect(result).toEqual({
      kind: "general_freeform",
      summary: "hello there",
      replyMessage: FREEFORM_GENERAL_REPLY,
      nextMode: "idle",
      nextStateToken: "idle",
    });
  });
});

function buildProfile(
  overrides: Partial<ProfileRowForFreeformPreferenceUpdate> = {},
): ProfileRowForFreeformPreferenceUpdate {
  return {
    id: "pro_123",
    user_id: "usr_123",
    state: "complete_mvp",
    is_complete_mvp: true,
    country_code: "US",
    state_code: "CA",
    last_interview_step: "group_01",
    preferences: {},
    coordination_dimensions: {},
    activity_patterns: [],
    boundaries: {},
    active_intent: null,
    scheduling_availability: null,
    notice_preference: null,
    coordination_style: null,
    completeness_percent: 100,
    completed_at: NOW_ISO,
    status_reason: "interview_complete_mvp",
    state_changed_at: NOW_ISO,
    ...overrides,
  };
}
