import { describe, expect, it } from "vitest";
import {
  InterviewExtractorError,
  createInterviewSignalExtractor,
} from "../../packages/llm/src/interview-extractor";
import { LlmProviderError, type LlmProvider } from "../../packages/llm/src/provider";
import {
  clearInMemoryMetrics,
  getInMemoryMetrics,
} from "../../packages/core/src/observability/metrics";

function createInput() {
  return {
    userId: "usr_llm_1",
    inboundMessageSid: "SM_LLM_0001",
    stepId: "motive_01",
    questionTarget: "connection_depth",
    questionText: "What do you want that to feel like?",
    userAnswerText: "I love skydiving and white water rafting",
    recentConversationTurns: [
      { role: "assistant" as const, text: "What are you into?" },
      { role: "user" as const, text: "I love skydiving and white water rafting" },
    ],
    currentProfile: {
      fingerprint: {},
      activityPatterns: [],
      boundaries: {},
      preferences: {},
    },
    correlationId: "corr-test-1",
  };
}

describe("interview extractor", () => {
  it("returns validated extraction output for valid JSON", async () => {
    const provider: LlmProvider = {
      async generateText() {
        return {
          provider: "anthropic",
          model: "claude-test",
          text: JSON.stringify({
            stepId: "motive_01",
            extracted: {
              fingerprintPatches: [
                { key: "adventure_comfort", range_value: 0.8, confidence: 0.66 },
                { key: "novelty_seeking", range_value: 0.74, confidence: 0.63 },
              ],
            },
          }),
        };
      },
    };

    const extractor = createInterviewSignalExtractor({
      provider,
      logger: {
        info() {},
        warn() {},
      },
    });

    const output = await extractor(createInput());
    expect(output.stepId).toBe("motive_01");
    expect(output.extracted.fingerprintPatches?.[0]?.key).toBe("adventure_comfort");
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

    const extractor = createInterviewSignalExtractor({
      provider,
      logger: {
        info() {},
        warn() {},
      },
    });

    await expect(extractor(createInput())).rejects.toMatchObject({
      name: "InterviewExtractorError",
      code: "invalid_json",
      shouldFallback: true,
    });
  });

  it("throws invalid_json when provider wraps JSON with prose", async () => {
    const provider: LlmProvider = {
      async generateText() {
        return {
          provider: "anthropic",
          model: "claude-test",
          text: `Sure. Here's the JSON:\n{"stepId":"motive_01","extracted":{}}`,
        };
      },
    };

    const extractor = createInterviewSignalExtractor({
      provider,
      logger: {
        info() {},
        warn() {},
      },
    });

    await expect(extractor(createInput())).rejects.toMatchObject({
      name: "InterviewExtractorError",
      code: "invalid_json",
      shouldFallback: true,
    });
  });

  it("throws schema_invalid when JSON does not match output schema", async () => {
    const provider: LlmProvider = {
      async generateText() {
        return {
          provider: "anthropic",
          model: "claude-test",
          text: JSON.stringify({
            stepId: "motive_01",
            extracted: {
              fingerprintPatches: [{ key: "adventure_comfort", range_value: 2, confidence: 0.7 }],
            },
          }),
        };
      },
    };

    const extractor = createInterviewSignalExtractor({
      provider,
      logger: {
        info() {},
        warn() {},
      },
    });

    await expect(extractor(createInput())).rejects.toMatchObject({
      name: "InterviewExtractorError",
      code: "schema_invalid",
      shouldFallback: true,
    });
  });

  it("throws guardrail_violation when output contains prohibited language", async () => {
    const provider: LlmProvider = {
      async generateText() {
        return {
          provider: "anthropic",
          model: "claude-test",
          text: JSON.stringify({
            stepId: "motive_01",
            extracted: {},
            notes: {
              followUpQuestion: "I guarantee this will work. Which one feels closer?",
            },
          }),
        };
      },
    };

    const extractor = createInterviewSignalExtractor({
      provider,
      logger: {
        info() {},
        warn() {},
      },
    });

    await expect(extractor(createInput())).rejects.toMatchObject({
      name: "InterviewExtractorError",
      code: "guardrail_violation",
      shouldFallback: true,
    });
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
          text: JSON.stringify({
            stepId: "motive_01",
            extracted: {},
          }),
        };
      },
    };

    const extractor = createInterviewSignalExtractor({
      provider,
      logger: {
        info() {},
        warn() {},
      },
    });

    const output = await extractor(createInput());
    expect(output.stepId).toBe("motive_01");
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

    const extractor = createInterviewSignalExtractor({
      provider,
      logger: {
        info() {},
        warn() {},
      },
    });

    await expect(extractor(createInput())).rejects.toMatchObject({
      name: "InterviewExtractorError",
      code: "timeout",
      shouldFallback: true,
    });
    expect(callCount).toBe(2);
  });

  it("emits LLM token and cost metrics from provider usage", async () => {
    clearInMemoryMetrics();
    const correlationId = "corr-llm-metrics-1";
    const provider: LlmProvider = {
      async generateText() {
        return {
          provider: "anthropic",
          model: "claude-3-5-haiku-latest",
          text: JSON.stringify({
            stepId: "motive_01",
            extracted: {},
          }),
          usage: {
            input_tokens: 1200,
            output_tokens: 300,
          },
        };
      },
    };

    const extractor = createInterviewSignalExtractor({
      provider,
      logger: {
        info() {},
        warn() {},
      },
    });

    const output = await extractor({
      ...createInput(),
      correlationId,
    });
    expect(output.stepId).toBe("motive_01");

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
    expect(costMetric?.correlation_id).toBe(correlationId);
  });
});
