import { describe, expect, it } from "vitest";
import { buildInterviewTransitionPlan } from "../../packages/core/src/interview/state";
import type { ProfileRowForInterview } from "../../packages/core/src/profile/profile-writer";
import { createHolisticSignalExtractor } from "../../packages/llm/src/holistic-extractor";
import { LlmProviderError, type LlmProvider } from "../../packages/llm/src/provider";
import type { HolisticExtractOutput } from "../../packages/db/src/types";

function createProfile(overrides: Partial<ProfileRowForInterview> = {}): ProfileRowForInterview {
  return {
    id: "pro_llm_1",
    user_id: "usr_llm_1",
    country_code: null,
    state_code: null,
    state: "partial",
    is_complete_mvp: false,
    last_interview_step: "activity_02",
    preferences: {
      interview_progress: {
        version: 1,
        status: "in_progress",
        step_index: 3,
        current_step_id: "motive_01",
        completed_step_ids: ["activity_01", "activity_02"],
        answers: {
          activity_01: { activity_keys: ["coffee", "walk", "museum"] },
          activity_02: { activity_key: "coffee" },
        },
        updated_at: "2026-02-18T12:00:00.000Z",
      },
    },
    fingerprint: {},
    activity_patterns: [
      { activity_key: "coffee", confidence: 0.65, source: "interview" },
      { activity_key: "walk", confidence: 0.65, source: "interview" },
      { activity_key: "museum", confidence: 0.65, source: "interview" },
    ],
    boundaries: {},
    active_intent: {
      activity_key: "coffee",
    },
    completeness_percent: 0,
    completed_at: null,
    status_reason: "interview_in_progress",
    state_changed_at: "2026-02-18T12:00:00.000Z",
    ...overrides,
  };
}

function validHolisticOutput(overrides: Partial<HolisticExtractOutput> = {}): HolisticExtractOutput {
  return {
    coordinationDimensionUpdates: {
      social_energy: { value: 0.55, confidence: 0.62 },
      social_pace: { value: 0.58, confidence: 0.64 },
      conversation_depth: { value: 0.63, confidence: 0.66 },
      adventure_orientation: { value: 0.78, confidence: 0.67 },
      group_dynamic: { value: 0.46, confidence: 0.61 },
      values_proximity: { value: 0.71, confidence: 0.68 },
    },
    coordinationSignalUpdates: {
      scheduling_availability: { windows: ["weekends_only"] },
      notice_preference: "24_hours",
      coordination_style: "direct",
    },
    coverageSummary: {
      dimensions: {
        social_energy: { covered: true, confidence: 0.62 },
        social_pace: { covered: true, confidence: 0.64 },
        conversation_depth: { covered: true, confidence: 0.66 },
        adventure_orientation: { covered: true, confidence: 0.67 },
        group_dynamic: { covered: true, confidence: 0.61 },
        values_proximity: { covered: true, confidence: 0.68 },
      },
      signals: {
        scheduling_availability: { covered: true, confidence: 0.61 },
        notice_preference: { covered: true, confidence: 0.65 },
        coordination_style: { covered: true, confidence: 0.63 },
      },
    },
    needsFollowUp: false,
    ...overrides,
  };
}

describe("interview state llm extraction wiring", () => {
  it("valid holistic extraction path applies 6-dimension updates", async () => {
    let callCount = 0;
    const transition = await buildInterviewTransitionPlan({
      inbound_message_sid: "SM_LLM_WIRE_0001",
      inbound_message_text: "I love skydiving and white water rafting",
      now_iso: "2026-02-18T12:00:00.000Z",
      session: {
        mode: "interviewing",
        state_token: "interview:motive_01",
        current_step_id: "motive_01",
        last_inbound_message_sid: null,
        dropout_nudge_sent_at: null,
      },
      profile: createProfile(),
      llm_extractor: async () => {
        callCount += 1;
        return validHolisticOutput();
      },
    });

    expect(callCount).toBe(1);
    expect(transition.action).toBe("advance");
    expect(transition.profile_event_payload?.extraction_source).toBe("llm");

    const patch = transition.profile_patch as Record<string, unknown>;
    const coordinationDimensions = patch.coordination_dimensions as Record<string, unknown>;
    const adventureNode = coordinationDimensions.adventure_orientation as Record<string, unknown>;
    expect((adventureNode.value as number) >= 0.75).toBe(true);
    expect((adventureNode.confidence as number) >= 0.66).toBe(true);
    expect(patch.notice_preference).toBe("24_hours");
    expect(patch.coordination_style).toBe("direct");
  });

  it("invalid JSON extractor output falls back to deterministic parser", async () => {
    const provider: LlmProvider = {
      async generateText() {
        return { provider: "anthropic", model: "test", text: "not-json" };
      },
    };
    const llmExtractor = createHolisticSignalExtractor({
      provider,
      logger: { info() {}, warn() {} },
    });

    const transition = await buildInterviewTransitionPlan({
      inbound_message_sid: "SM_LLM_WIRE_0002",
      inbound_message_text: "coffee, walk, museum",
      now_iso: "2026-02-18T12:00:00.000Z",
      session: {
        mode: "interviewing",
        state_token: "interview:activity_01",
        current_step_id: "activity_01",
        last_inbound_message_sid: null,
        dropout_nudge_sent_at: null,
      },
      profile: createProfile({
        preferences: {},
        activity_patterns: [],
        active_intent: null,
        last_interview_step: null,
      }),
      llm_extractor: llmExtractor,
    });

    expect(transition.action).toBe("advance");
    expect(transition.profile_event_payload?.extraction_source).toBe("deterministic");
    expect(transition.profile_event_payload?.extraction_fallback_reason).toBe("invalid_json");
  });

  it("schema-invalid extractor output falls back to deterministic parser", async () => {
    const provider: LlmProvider = {
      async generateText() {
        return {
          provider: "anthropic",
          model: "test",
          text: JSON.stringify({
            coordinationDimensionUpdates: {
              legacy_factor_key: { value: 0.5, confidence: 0.7 },
            },
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
          }),
        };
      },
    };

    const llmExtractor = createHolisticSignalExtractor({
      provider,
      logger: { info() {}, warn() {} },
    });

    const transition = await buildInterviewTransitionPlan({
      inbound_message_sid: "SM_LLM_WIRE_0003",
      inbound_message_text: "coffee, walk, museum",
      now_iso: "2026-02-18T12:00:00.000Z",
      session: {
        mode: "interviewing",
        state_token: "interview:activity_01",
        current_step_id: "activity_01",
        last_inbound_message_sid: null,
        dropout_nudge_sent_at: null,
      },
      profile: createProfile({
        preferences: {},
        activity_patterns: [],
        active_intent: null,
        last_interview_step: null,
      }),
      llm_extractor: llmExtractor,
    });

    expect(transition.action).toBe("advance");
    expect(transition.profile_event_payload?.extraction_source).toBe("deterministic");
    expect(transition.profile_event_payload?.extraction_fallback_reason).toBe("schema_invalid");
  });

  it("timeout retries once then falls back to deterministic parser", async () => {
    let callCount = 0;
    const provider: LlmProvider = {
      async generateText() {
        callCount += 1;
        throw new DOMException("timeout", "AbortError");
      },
    };
    const llmExtractor = createHolisticSignalExtractor({
      provider,
      logger: { info() {}, warn() {} },
    });

    const transition = await buildInterviewTransitionPlan({
      inbound_message_sid: "SM_LLM_WIRE_0004",
      inbound_message_text: "coffee, walk, museum",
      now_iso: "2026-02-18T12:00:00.000Z",
      session: {
        mode: "interviewing",
        state_token: "interview:activity_01",
        current_step_id: "activity_01",
        last_inbound_message_sid: null,
        dropout_nudge_sent_at: null,
      },
      profile: createProfile({
        preferences: {},
        activity_patterns: [],
        active_intent: null,
        last_interview_step: null,
      }),
      llm_extractor: llmExtractor,
    });

    expect(callCount).toBe(2);
    expect(transition.action).toBe("advance");
    expect(transition.profile_event_payload?.extraction_source).toBe("deterministic");
    expect(transition.profile_event_payload?.extraction_fallback_reason).toBe("timeout");
  });

  it("retries transient provider failure once and succeeds without fallback", async () => {
    let callCount = 0;
    const provider: LlmProvider = {
      async generateText() {
        callCount += 1;
        if (callCount === 1) {
          throw new LlmProviderError("temporary", { transient: true, status: 503 });
        }

        return {
          provider: "anthropic",
          model: "test",
          text: JSON.stringify(validHolisticOutput()),
        };
      },
    };

    const llmExtractor = createHolisticSignalExtractor({
      provider,
      logger: { info() {}, warn() {} },
    });

    const transition = await buildInterviewTransitionPlan({
      inbound_message_sid: "SM_LLM_WIRE_0005",
      inbound_message_text: "coffee please",
      now_iso: "2026-02-18T12:00:00.000Z",
      session: {
        mode: "interviewing",
        state_token: "interview:activity_01",
        current_step_id: "activity_01",
        last_inbound_message_sid: null,
        dropout_nudge_sent_at: null,
      },
      profile: createProfile({
        preferences: {},
        activity_patterns: [],
        active_intent: null,
        last_interview_step: null,
      }),
      llm_extractor: llmExtractor,
    });

    expect(callCount).toBe(2);
    expect(transition.action).toBe("advance");
    expect(transition.profile_event_payload?.extraction_source).toBe("llm");
    expect(transition.profile_event_payload?.extraction_fallback_reason).toBeNull();
  });

  it("rate limiting guard blocks duplicate extractor call per inbound message", async () => {
    let callCount = 0;
    const guard = new Set<string>(["usr_llm_1:SM_LLM_WIRE_0006"]);

    const transition = await buildInterviewTransitionPlan({
      inbound_message_sid: "SM_LLM_WIRE_0006",
      inbound_message_text: "coffee, walk, museum",
      now_iso: "2026-02-18T12:00:00.000Z",
      session: {
        mode: "interviewing",
        state_token: "interview:activity_01",
        current_step_id: "activity_01",
        last_inbound_message_sid: null,
        dropout_nudge_sent_at: null,
      },
      profile: createProfile({
        preferences: {},
        activity_patterns: [],
        active_intent: null,
        last_interview_step: null,
      }),
      llm_request_guard: guard,
      llm_extractor: async () => {
        callCount += 1;
        throw new Error("should_not_run");
      },
    });

    expect(callCount).toBe(0);
    expect(transition.action).toBe("advance");
    expect(transition.profile_event_payload?.extraction_source).toBe("deterministic");
    expect(transition.profile_event_payload?.extraction_fallback_reason).toBe("rate_limited");
  });
});
