import { describe, expect, it } from "vitest";
import {
  HolisticExtractorError,
  createHolisticSignalExtractor,
} from "../../packages/llm/src/holistic-extractor";
import { LlmProviderError, type LlmProvider } from "../../packages/llm/src/provider";
import {
  clearInMemoryMetrics,
  getInMemoryMetrics,
} from "../../packages/core/src/observability/metrics";

function createInput() {
  return {
    sessionId: "ses_llm_1",
    conversationHistory: [
      { role: "assistant" as const, text: "What kind of plans energize you?" },
      { role: "user" as const, text: "I love hiking and trying adventurous things outdoors." },
      { role: "assistant" as const, text: "Do you prefer fast-paced plans?" },
      { role: "user" as const, text: "Yes, I like momentum and active weekends." },
      { role: "assistant" as const, text: "How much notice do you want?" },
      { role: "user" as const, text: "A day ahead is ideal." },
    ],
    currentProfile: {},
  };
}

function validOutputJson() {
  return JSON.stringify({
    coordinationDimensionUpdates: {
      social_energy: { value: 0.62, confidence: 0.73 },
      social_pace: { value: 0.74, confidence: 0.71 },
      conversation_depth: { value: 0.58, confidence: 0.67 },
      adventure_orientation: { value: 0.81, confidence: 0.79 },
      group_dynamic: { value: 0.46, confidence: 0.64 },
      values_proximity: { value: 0.69, confidence: 0.68 },
    },
    coordinationSignalUpdates: {
      scheduling_availability: {
        preferred_windows: ["weekends_only"],
      },
      notice_preference: "24_hours",
      coordination_style: "direct",
    },
    coverageSummary: {
      dimensions: {
        social_energy: { covered: true, confidence: 0.73 },
        social_pace: { covered: true, confidence: 0.71 },
        conversation_depth: { covered: true, confidence: 0.67 },
        adventure_orientation: { covered: true, confidence: 0.79 },
        group_dynamic: { covered: true, confidence: 0.64 },
        values_proximity: { covered: true, confidence: 0.68 },
      },
      signals: {
        scheduling_availability: { covered: true, confidence: 0.63 },
        notice_preference: { covered: true, confidence: 0.71 },
        coordination_style: { covered: true, confidence: 0.66 },
      },
    },
    needsFollowUp: false,
  });
}

describe("holistic extractor", () => {
  it("returns validated extraction output for valid JSON", async () => {
    const provider: LlmProvider = {
      async generateText() {
        return {
          provider: "anthropic",
          model: "claude-test",
          text: validOutputJson(),
        };
      },
    };

    const extractor = createHolisticSignalExtractor({
      provider,
      logger: {
        info() {},
        warn() {},
      },
    });

    const output = await extractor(createInput());
    expect(output.coordinationDimensionUpdates.adventure_orientation?.value).toBe(0.81);
    expect(output.coverageSummary.signals.notice_preference.covered).toBe(true);
  });

  it("throws invalid_json when provider returns non-JSON text", async () => {
    const provider: LlmProvider = {
      async generateText() {
        return {
          provider: "anthropic",
          model: "claude-test",
          text: "not-json",
        };
      },
    };

    const extractor = createHolisticSignalExtractor({
      provider,
      logger: {
        info() {},
        warn() {},
      },
    });

    await expect(extractor(createInput())).rejects.toMatchObject({
      name: "HolisticExtractorError",
      code: "invalid_json",
      shouldFallback: true,
    } satisfies Partial<HolisticExtractorError>);
  });

  it("throws schema_invalid when JSON does not match output schema", async () => {
    const provider: LlmProvider = {
      async generateText() {
        return {
          provider: "anthropic",
          model: "claude-test",
          text: JSON.stringify({
            coordinationDimensionUpdates: {
              social_energy: { value: 2, confidence: 0.7 },
            },
            coordinationSignalUpdates: {},
            coverageSummary: {
              dimensions: {
                social_energy: { covered: true, confidence: 0.9 },
                social_pace: { covered: true, confidence: 0.9 },
                conversation_depth: { covered: true, confidence: 0.9 },
                adventure_orientation: { covered: true, confidence: 0.9 },
                group_dynamic: { covered: true, confidence: 0.9 },
                values_proximity: { covered: true, confidence: 0.9 },
              },
              signals: {
                scheduling_availability: { covered: true, confidence: 0.9 },
                notice_preference: { covered: true, confidence: 0.9 },
                coordination_style: { covered: true, confidence: 0.9 },
              },
            },
            needsFollowUp: false,
          }),
        };
      },
    };

    const extractor = createHolisticSignalExtractor({
      provider,
      logger: {
        info() {},
        warn() {},
      },
    });

    await expect(extractor(createInput())).rejects.toMatchObject({
      name: "HolisticExtractorError",
      code: "schema_invalid",
      shouldFallback: true,
    } satisfies Partial<HolisticExtractorError>);
  });

  it("fails schema validation when response contains legacy factor keys", async () => {
    const provider: LlmProvider = {
      async generateText() {
        return {
          provider: "anthropic",
          model: "claude-test",
          text: JSON.stringify({
            coordinationDimensionUpdates: {
              legacy_factor_key: { value: 0.6, confidence: 0.8 },
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
            needsFollowUp: true,
          }),
        };
      },
    };

    const extractor = createHolisticSignalExtractor({
      provider,
      logger: {
        info() {},
        warn() {},
      },
    });

    await expect(extractor(createInput())).rejects.toMatchObject({
      name: "HolisticExtractorError",
      code: "schema_invalid",
      shouldFallback: true,
    } satisfies Partial<HolisticExtractorError>);
  });

  it("retries once on transient error and succeeds on second attempt", async () => {
    let callCount = 0;
    const provider: LlmProvider = {
      async generateText() {
        callCount += 1;
        if (callCount === 1) {
          throw new LlmProviderError("temporary", {
            transient: true,
            status: 503,
          });
        }

        return {
          provider: "anthropic",
          model: "claude-test",
          text: validOutputJson(),
        };
      },
    };

    const extractor = createHolisticSignalExtractor({
      provider,
      logger: {
        info() {},
        warn() {},
      },
    });

    const output = await extractor(createInput());
    expect(output.coordinationDimensionUpdates.social_energy?.value).toBe(0.62);
    expect(callCount).toBe(2);
  });

  it("retries once on timeout then throws fallback error", async () => {
    let callCount = 0;
    const provider: LlmProvider = {
      async generateText() {
        callCount += 1;
        throw new DOMException("timeout", "AbortError");
      },
    };

    const extractor = createHolisticSignalExtractor({
      provider,
      logger: {
        info() {},
        warn() {},
      },
    });

    await expect(extractor(createInput())).rejects.toMatchObject({
      name: "HolisticExtractorError",
      code: "timeout",
      shouldFallback: true,
    } satisfies Partial<HolisticExtractorError>);
    expect(callCount).toBe(2);
  });

  it("emits LLM token and cost metrics from provider usage", async () => {
    clearInMemoryMetrics();
    const provider: LlmProvider = {
      async generateText() {
        return {
          provider: "anthropic",
          model: "claude-3-5-haiku-latest",
          text: validOutputJson(),
          usage: {
            input_tokens: 1200,
            output_tokens: 300,
          },
        };
      },
    };

    const extractor = createHolisticSignalExtractor({
      provider,
      logger: {
        info() {},
        warn() {},
      },
      createCorrelationId: () => "corr-llm-metrics-1",
    });

    const output = await extractor(createInput());
    expect(output.coordinationSignalUpdates.notice_preference).toBe("24_hours");

    const emitted = getInMemoryMetrics();
    const inputMetric = emitted.find((entry) => entry.metric === "llm.token.input");
    const outputMetric = emitted.find((entry) => entry.metric === "llm.token.output");
    const costMetric = emitted.find((entry) => entry.metric === "llm.cost.estimated_usd");
    const requestMetric = emitted.find((entry) => entry.metric === "llm.request.count");
    const latencyMetric = emitted.find((entry) =>
      entry.metric === "system.request.latency" &&
      entry.tags.component === "llm_call"
    );

    expect(inputMetric?.value).toBe(1200);
    expect(outputMetric?.value).toBe(300);
    expect(costMetric?.value).toBe(0.00216);
    expect(requestMetric?.value).toBe(1);
    expect(requestMetric?.tags.outcome).toBe("success");
    expect(latencyMetric?.value).toBeGreaterThanOrEqual(0);
    expect(costMetric?.correlation_id).toBe("corr-llm-metrics-1");
  });
});
