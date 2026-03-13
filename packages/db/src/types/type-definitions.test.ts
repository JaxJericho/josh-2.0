import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  ActivityCatalogEntry,
  ContactInvitation,
  CoordinationDimensionKey,
  CoordinationDimensions,
  CoordinationSignals,
  DimensionCoverageSummary,
  GroupSizePreference,
  HolisticExtractInput,
  HolisticExtractOutput,
  InterestSignature,
  RelationalContext,
  Invitation,
  Linkup,
  Profile,
  User,
} from "../index";
import {
  GroupSizePreferenceSchema,
  InterestSignatureSchema,
  InvitationSchema,
  LinkupSchema,
  ProfileSchema,
  RelationalContextSchema,
  UserSchema,
} from "../index";

describe("3.0 db type definitions", () => {
  it("imports and instantiates all new type contracts", () => {
    const invitation: ContactInvitation = {
      id: "inv_123",
      inviter_user_id: "user_123",
      invitee_phone_hash: "hash_123",
      status: "pending",
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

    const invitationRecord: Invitation = {
      id: "7aa85f3b-a6f5-4e94-8080-7b9c8fdc8d7d",
      user_id: "fbff2aa8-b86f-40d7-9ea5-8115ebf8342a",
      invitation_type: "solo",
      linkup_id: null,
      activity_key: "coffee_walk",
      proposed_time_window: "weekend_morning",
      offered_at: "2026-03-12T00:00:00.000Z",
      location_hint: "Capitol Hill",
      group_size_preference_snapshot: {
        min: 2,
        max: 6,
      },
      state: "pending",
      expires_at: "2026-03-14T00:00:00.000Z",
      responded_at: null,
      response_message_sid: null,
      idempotency_key: "invitation:user_123:coffee_walk:2026-W11",
      correlation_id: null,
      created_at: "2026-03-12T00:00:00.000Z",
      updated_at: "2026-03-12T00:00:00.000Z",
    };

    const linkupRecord: Linkup = {
      acceptance_window_ends_at: null,
      activity_key: "coffee_walk",
      brief: {
        activity_key: "coffee_walk",
        time_window: "weekend_morning",
      },
      broadcast_started_at: null,
      canceled_reason: null,
      correlation_id: null,
      created_at: "2026-03-12T00:00:00.000Z",
      event_time: null,
      id: "e0ecfce7-3602-4dfa-84dd-6ef6d72265cb",
      initiator_user_id: null,
      linkup_create_key: "linkup:create:region_123:2026-W11",
      lock_version: 0,
      locked_at: null,
      max_size: 6,
      max_waves: 3,
      min_size: 2,
      proposed_time_window: "weekend_morning",
      region_id: "70f8f4d7-6af5-40ec-b548-c0f7aee0efe9",
      scheduled_at: null,
      state: "draft",
      status: "draft",
      system_created: false,
      updated_at: "2026-03-12T00:00:00.000Z",
      venue: null,
      wave_sizes: [6, 6, 8],
      waves_sent: 0,
    };

    const userRecord: User = {
      age_consent: true,
      birthday: "1994-03-12",
      created_at: "2026-03-12T00:00:00.000Z",
      deleted_at: null,
      email: "alex@example.com",
      first_name: "Alex",
      id: "c7af95e7-2370-4f99-b4b2-458b4cfe6958",
      invitation_backoff_count: 0,
      invitation_count_this_week: 0,
      invitation_week_start: null,
      last_invited_at: null,
      last_name: "Rivera",
      phone_e164: "+14155550123",
      phone_hash: "phone_hash_123",
      privacy_consent: true,
      region_id: "70f8f4d7-6af5-40ec-b548-c0f7aee0efe9",
      registration_source: "organic",
      sms_consent: true,
      state: "active",
      suspended_at: null,
      terms_consent: true,
      updated_at: "2026-03-12T00:00:00.000Z",
    };

    const profileRecord: Profile = {
      active_intent: null,
      activity_patterns: {
        habits: ["coffee_walks"],
      },
      boundaries: {
        pace: "low_key",
      },
      completed_at: null,
      completeness_percent: 72,
      coordination_dimensions: {
        group_dynamic: {
          value: 0.3,
          confidence: 0.6,
        },
      },
      coordination_style: "direct",
      country_code: "US",
      created_at: "2026-03-12T00:00:00.000Z",
      group_size_preference: {
        min: 2,
        max: 6,
      },
      id: "f62ab199-88c6-4f8e-b1d9-b9fd7038c1f8",
      interest_signatures: [
        {
          domain: "urban infrastructure",
          intensity: 0.8,
          confidence: 0.6,
        },
      ],
      is_complete_mvp: true,
      last_interview_step: "group_01",
      notice_preference: "24_hours",
      personality_substrate: null,
      preferences: {
        group_size_pref: "4-6",
      },
      relational_context: {
        life_stage_signal: "new to city",
        connection_motivation: "rebuilding social circle",
        social_history_hint: null,
      },
      relational_style: null,
      scheduling_availability: {
        weekends: ["morning"],
      },
      stale_at: null,
      state: "complete_mvp",
      state_changed_at: "2026-03-12T00:00:00.000Z",
      state_code: "CA",
      status_reason: null,
      updated_at: "2026-03-12T00:00:00.000Z",
      user_id: "c7af95e7-2370-4f99-b4b2-458b4cfe6958",
      values_orientation: null,
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
    expect(InvitationSchema.parse(invitationRecord).state).toBe("pending");
    expect(LinkupSchema.parse(linkupRecord).system_created).toBe(false);
    expect(ProfileSchema.parse(profileRecord).group_size_preference).toEqual({
      min: 2,
      max: 6,
    });
    expect(UserSchema.parse(userRecord).invitation_count_this_week).toBe(0);
    expect(activityCatalogEntry.activity_key).toBe("coffee_walk");
    expect(coverageSummary.dimensions.social_energy.covered).toBe(true);
    expect(holisticInput.sessionId).toBe("session_123");
    expect(holisticOutput.needsFollowUp).toBe(false);
    expect(ProfileSchema.parse(profileRecord).interest_signatures?.[0]?.domain).toBe("urban infrastructure");
    expect(ProfileSchema.parse(profileRecord).relational_context?.connection_motivation).toBe("rebuilding social circle");
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

  it("validates group size preference bounds", () => {
    expect(() => GroupSizePreferenceSchema.parse({ min: 1, max: 6 })).toThrow();
    expect(() => GroupSizePreferenceSchema.parse({ min: 3, max: 11 })).toThrow();
    expect(() => GroupSizePreferenceSchema.parse({ min: 5, max: 3 })).toThrow();

    const validPreference: GroupSizePreference = { min: 2, max: 6 };

    expect(GroupSizePreferenceSchema.parse(validPreference)).toEqual(validPreference);
  });

  it("validates depth signal shapes", () => {
    const validInterestSignature: InterestSignature = {
      domain: "hiking",
      intensity: 0.8,
      confidence: 0.6,
    };
    const validRelationalContext: RelationalContext = {
      life_stage_signal: null,
      connection_motivation: null,
      social_history_hint: null,
    };

    expect(() =>
      InterestSignatureSchema.parse({ domain: "", intensity: 0.5, confidence: 0.5 })
    ).toThrow();
    expect(() =>
      InterestSignatureSchema.parse({ domain: "hiking", intensity: 1.2, confidence: 0.5 })
    ).toThrow();
    expect(InterestSignatureSchema.parse(validInterestSignature)).toEqual(validInterestSignature);
    expect(RelationalContextSchema.parse(validRelationalContext)).toEqual(validRelationalContext);
  });
});
