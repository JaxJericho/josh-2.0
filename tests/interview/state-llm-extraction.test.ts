import { describe, expect, it } from "vitest";
import { buildInterviewTransitionPlan } from "../../packages/core/src/interview/state";
import type { ProfileRowForInterview } from "../../packages/core/src/profile/profile-writer";
import { createInterviewSignalExtractor } from "../../packages/llm/src/interview-extractor";
import { LlmProviderError, type LlmProvider } from "../../packages/llm/src/provider";

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

describe("interview state llm extraction wiring", () => {
  it("valid LLM extraction path applies extracted patches", async () => {
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
      },
      profile: createProfile(),
      llm_extractor: async () => {
        callCount += 1;
        return {
          stepId: "motive_01",
          extracted: {
            fingerprintPatches: [
              { key: "adventure_comfort", range_value: 0.78, confidence: 0.66 },
              { key: "novelty_seeking", range_value: 0.72, confidence: 0.64 },
            ],
            activityPatternsAdd: [
              {
                activity_key: "skydiving",
                motive_weights: { adventure: 0.82, growth: 0.62 },
                confidence: 0.7,
              },
            ],
          },
          notes: {
            needsFollowUp: false,
          },
        };
      },
    });

    expect(callCount).toBe(1);
    expect(transition.action).toBe("advance");
    expect(transition.profile_event_payload?.extraction_source).toBe("llm");

    const adventureNode = (transition.profile_patch?.fingerprint as Record<string, unknown>)
      .adventure_comfort as Record<string, unknown>;
    const noveltyNode = (transition.profile_patch?.fingerprint as Record<string, unknown>)
      .novelty_seeking as Record<string, unknown>;

    expect((adventureNode.value as number) >= 0.75).toBe(true);
    expect((noveltyNode.value as number) >= 0.7).toBe(true);
    expect((adventureNode.confidence as number) >= 0.6).toBe(true);
    expect((noveltyNode.confidence as number) >= 0.6).toBe(true);
  });

  it("invalid JSON extractor output falls back to deterministic parser", async () => {
    const provider: LlmProvider = {
      async generateText() {
        return { provider: "anthropic", model: "test", text: "not-json" };
      },
    };
    const llmExtractor = createInterviewSignalExtractor({
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
            stepId: "activity_01",
            extracted: {
              fingerprintPatches: [
                { key: "adventure_comfort", range_value: 2, confidence: 0.5 },
              ],
            },
          }),
        };
      },
    };

    const llmExtractor = createInterviewSignalExtractor({
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
    const llmExtractor = createInterviewSignalExtractor({
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
          text: JSON.stringify({
            stepId: "activity_01",
            extracted: {
              activityPatternsAdd: [
                {
                  activity_key: "coffee",
                  motive_weights: { comfort: 0.7 },
                  confidence: 0.7,
                },
              ],
            },
          }),
        };
      },
    };

    const llmExtractor = createInterviewSignalExtractor({
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
