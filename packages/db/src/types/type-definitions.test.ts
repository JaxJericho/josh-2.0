import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  ActivityCatalogEntry,
  ContactCircleEntry,
  ContactInvitation,
  CoordinationDimensionKey,
  CoordinationDimensions,
  CoordinationSignals,
  DimensionCoverageSummary,
  HolisticExtractInput,
  HolisticExtractOutput,
  PlanBrief,
} from "../index";

describe("3.0 db type definitions", () => {
  it("imports and instantiates all new type contracts", () => {
    const invitation: ContactInvitation = {
      id: "inv_123",
      inviter_user_id: "user_123",
      invitee_phone_hash: "hash_123",
      plan_brief_id: "brief_123",
      status: "pending",
      created_at: "2026-02-28T00:00:00.000Z",
      updated_at: "2026-02-28T00:00:00.000Z",
    };

    const planBrief: PlanBrief = {
      id: "brief_123",
      creator_user_id: "user_123",
      activity_key: "coffee_walk",
      proposed_time_window: "next_weekend",
      notes: "Prefer late morning.",
      status: "draft",
      created_at: "2026-02-28T00:00:00.000Z",
      updated_at: "2026-02-28T00:00:00.000Z",
    };

    const contactCircleEntry: ContactCircleEntry = {
      id: "circle_123",
      user_id: "user_123",
      contact_name: "Taylor",
      contact_phone_hash: "hash_456",
      contact_phone_e164: "+15555550123",
      created_at: "2026-02-28T00:00:00.000Z",
      updated_at: "2026-02-28T00:00:00.000Z",
    };

    const activityCatalogEntry: ActivityCatalogEntry = {
      id: "activity_123",
      activity_key: "coffee_walk",
      display_name: "Coffee walk",
      category: "ambient_low_key",
      short_description: "Low-stakes walk with coffee and conversation.",
      regional_availability: "anywhere",
      motive_weights: {
        restorative: 0.3,
        connection: 0.7,
        play: 0.2,
        exploration: 0.2,
        achievement: 0.1,
        stimulation: 0.2,
        belonging: 0.6,
        focus: 0.3,
        comfort: 0.8,
      },
      constraints: {
        setting: "either",
        noise_level: "quiet",
        physical_demand: "low",
        requires_booking: false,
        weather_dependent: false,
      },
      preferred_windows: ["morning", "afternoon"],
      group_size_fit: ["solo", "small"],
      tags: ["low-bar", "outdoor"],
      created_at: "2026-02-28T00:00:00.000Z",
    };

    const dimensions: CoordinationDimensions = {
      social_energy: { value: 0.6, confidence: 0.7 },
      social_pace: { value: 0.4, confidence: 0.8 },
      conversation_depth: { value: 0.5, confidence: 0.9 },
      adventure_orientation: { value: 0.7, confidence: 0.8 },
      group_dynamic: { value: 0.3, confidence: 0.6 },
      values_proximity: { value: 0.9, confidence: 0.95 },
    };

    const signals: CoordinationSignals = {
      scheduling_availability: {
        weekdays: ["evening"],
        weekends: ["morning", "afternoon"],
      },
      notice_preference: "24_hours",
      coordination_style: "direct",
    };

    const coverageSummary: DimensionCoverageSummary = {
      dimensions: {
        social_energy: { covered: true, confidence: 0.9 },
        social_pace: { covered: true, confidence: 0.8 },
        conversation_depth: { covered: true, confidence: 0.85 },
        adventure_orientation: { covered: true, confidence: 0.8 },
        group_dynamic: { covered: true, confidence: 0.75 },
        values_proximity: { covered: true, confidence: 0.9 },
      },
      signals: {
        scheduling_availability: { covered: true, confidence: 0.7 },
        notice_preference: { covered: true, confidence: 0.8 },
        coordination_style: { covered: true, confidence: 0.85 },
      },
    };

    const holisticInput: HolisticExtractInput = {
      conversationHistory: [{ role: "user", text: "I like low-key plans." }],
      currentProfile: {
        social_energy: dimensions.social_energy,
      },
      sessionId: "session_123",
    };

    const holisticOutput: HolisticExtractOutput = {
      coordinationDimensionUpdates: {
        social_pace: dimensions.social_pace,
      },
      coordinationSignalUpdates: {
        notice_preference: signals.notice_preference,
      },
      coverageSummary,
      needsFollowUp: false,
    };

    expect(invitation.status).toBe("pending");
    expect(planBrief.status).toBe("draft");
    expect(contactCircleEntry.contact_name).toBe("Taylor");
    expect(activityCatalogEntry.activity_key).toBe("coffee_walk");
    expect(coverageSummary.dimensions.social_energy.covered).toBe(true);
    expect(holisticInput.sessionId).toBe("session_123");
    expect(holisticOutput.needsFollowUp).toBe(false);
  });

  it("enforces exact dimension keys and rejects stepId on holistic extraction input", () => {
    expectTypeOf<keyof CoordinationDimensions>().toEqualTypeOf<CoordinationDimensionKey>();

    const invalidInput: HolisticExtractInput = {
      conversationHistory: [],
      currentProfile: {},
      sessionId: "session_123",
      // @ts-expect-error HolisticExtractInput intentionally excludes stepId.
      stepId: "profile_goals",
    };

    expect(invalidInput).toBeDefined();
  });
});
