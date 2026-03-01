import type { HolisticExtractInput, HolisticExtractOutput } from "../../db/src/types";
import {
  HOLISTIC_EXTRACTION_PROMPT_VERSION,
  HOLISTIC_EXTRACTION_SYSTEM_PROMPT,
} from "./prompts/holistic-extraction-system-prompt.ts";
import { parseHolisticExtractOutput } from "./schemas/holistic-extract-output.schema.ts";
import {
  getDefaultLlmProvider,
  LlmProviderError,
  type LlmProvider,
} from "./provider.ts";
import { validateModelOutput } from "./output-validator.ts";
import { logEvent as emitStructuredEvent } from "../../core/src/observability/logger.ts";
import {
  elapsedMetricMs,
  emitMetricBestEffort,
  nowMetricMs,
} from "../../core/src/observability/metrics.ts";
import { estimateLlmCostUsd } from "../../core/src/observability/llm-pricing.ts";
import {
  captureSentryException,
  setSentryContext,
} from "../../core/src/observability/sentry.ts";

export type HolisticExtractorFailureCode =
  | "provider_transient"
  | "provider_non_transient"
  | "timeout"
  | "invalid_json"
  | "schema_invalid"
  | "guardrail_violation";

export class HolisticExtractorError extends Error {
  readonly code: HolisticExtractorFailureCode;
  readonly shouldFallback: true;
  readonly transient: boolean;
  readonly correlationId: string;
  readonly promptVersion: string;

  constructor(
    message: string,
    options: {
      code: HolisticExtractorFailureCode;
      correlationId: string;
      promptVersion: string;
      transient: boolean;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "HolisticExtractorError";
    this.code = options.code;
    this.shouldFallback = true;
    this.transient = options.transient;
    this.correlationId = options.correlationId;
    this.promptVersion = options.promptVersion;
    if (options.cause !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).cause = options.cause;
    }
  }
}

type HolisticExtractorLogger = {
  info(event: string, data: Record<string, unknown>): void;
  warn(event: string, data: Record<string, unknown>): void;
};

type CreateExtractorOptions = {
  provider?: LlmProvider;
  timeoutMs?: number;
  retryCount?: number;
  logger?: HolisticExtractorLogger;
  createCorrelationId?: () => string;
};

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_COUNT = 1;

function createDefaultLogger(): HolisticExtractorLogger {
  return {
    info(event, data) {
      emitStructuredEvent({
        level: "info",
        event,
        correlation_id: typeof data.correlation_id === "string" ? data.correlation_id : null,
        payload: data,
      });
    },
    warn(event, data) {
      emitStructuredEvent({
        level: "warn",
        event,
        correlation_id: typeof data.correlation_id === "string" ? data.correlation_id : null,
        payload: data,
      });
    },
  };
}

function normalizeErrorShape(error: unknown): { message: string } {
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: "unknown_error" };
}

function createCorrelationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `corr_${Date.now().toString(36)}`;
}

function buildHolisticExtractionUserPrompt(input: HolisticExtractInput): string {
  const recentTurns = input.conversationHistory
    .map((turn, index) => `${index + 1}. ${turn.role}: ${turn.text}`)
    .join("\n");

  return [
    `PromptVersion: ${HOLISTIC_EXTRACTION_PROMPT_VERSION}`,
    `SessionId: ${input.sessionId}`,
    "ConversationHistory:",
    recentTurns || "(none)",
    "CurrentProfileJSON:",
    JSON.stringify(input.currentProfile),
  ].join("\n");
}

function parseJsonPayload(raw: string): unknown {
  return JSON.parse(raw);
}

function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

async function buildPromptFingerprint(input: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    return `len_${input.length}`;
  }

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function createHolisticSignalExtractor(options: CreateExtractorOptions = {}) {
  const provider = options.provider ?? getDefaultLlmProvider();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryCount = options.retryCount ?? DEFAULT_RETRY_COUNT;
  const logger = options.logger ?? createDefaultLogger();
  const correlationFactory = options.createCorrelationId ?? createCorrelationId;

  return async function extractCoordinationSignals(
    input: HolisticExtractInput,
  ): Promise<HolisticExtractOutput> {
    const correlationId = correlationFactory();
    const attempts = retryCount + 1;
    const userPrompt = buildHolisticExtractionUserPrompt(input);
    const promptHash = await buildPromptFingerprint(userPrompt);
    setSentryContext({
      category: "llm_extraction",
      correlation_id: correlationId,
      user_id: null,
      tags: {
        prompt_hash: promptHash,
        session_id: input.sessionId,
      },
    });
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      logger.info("holistic_extractor.call", {
        correlation_id: correlationId,
        prompt_version: HOLISTIC_EXTRACTION_PROMPT_VERSION,
        attempt,
      });

      const timeout = withTimeoutSignal(timeoutMs);
      const llmCallStartedAt = nowMetricMs();
      let llmCallOutcome: "success" | "error" = "success";
      let llmProvider = "anthropic";
      let llmModel = "unknown";
      try {
        const providerResponse = await provider.generateText({
          systemPrompt: HOLISTIC_EXTRACTION_SYSTEM_PROMPT,
          userPrompt,
          timeoutMs,
          signal: timeout.signal,
        });
        llmProvider = providerResponse.provider;
        llmModel = providerResponse.model;

        const inputTokens = providerResponse.usage?.input_tokens ?? 0;
        const outputTokens = providerResponse.usage?.output_tokens ?? 0;
        const costEstimate = estimateLlmCostUsd({
          model: providerResponse.model,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        });

        emitMetricBestEffort({
          metric: "llm.token.input",
          value: costEstimate.input_tokens,
          correlation_id: correlationId,
          tags: {
            component: "holistic_extractor",
            provider: providerResponse.provider,
            model: providerResponse.model,
          },
        });
        emitMetricBestEffort({
          metric: "llm.token.output",
          value: costEstimate.output_tokens,
          correlation_id: correlationId,
          tags: {
            component: "holistic_extractor",
            provider: providerResponse.provider,
            model: providerResponse.model,
          },
        });
        emitMetricBestEffort({
          metric: "llm.cost.estimated_usd",
          value: costEstimate.estimated_cost_usd,
          correlation_id: correlationId,
          tags: {
            component: "holistic_extractor",
            provider: providerResponse.provider,
            model: costEstimate.pricing_model,
            pricing_version: costEstimate.pricing_version,
          },
        });

        const validation = validateModelOutput({
          rawText: providerResponse.text,
          requireJson: true,
        });
        if (!validation.ok) {
          logger.warn("holistic_extractor.output_rejected", {
            correlation_id: correlationId,
            prompt_version: HOLISTIC_EXTRACTION_PROMPT_VERSION,
            attempt,
            violation_codes: validation.violations.map((entry) => entry.code),
          });

          const hasWrapperOrJsonViolation = validation.violations.some((entry) =>
            entry.code === "invalid_json" || entry.code === "output_wrapper_detected"
          );

          throw new HolisticExtractorError(
            "Model output rejected by output validator.",
            {
              code: hasWrapperOrJsonViolation ? "invalid_json" : "guardrail_violation",
              correlationId,
              promptVersion: HOLISTIC_EXTRACTION_PROMPT_VERSION,
              transient: false,
            },
          );
        }

        const parsedJson = parseJsonPayload(validation.sanitizedText);
        return parseHolisticExtractOutput(parsedJson);
      } catch (error) {
        lastError = error;
        llmCallOutcome = "error";

        const isAbort = error instanceof DOMException && error.name === "AbortError";
        const normalized = normalizeErrorShape(error);
        const providerTransient = error instanceof LlmProviderError && error.transient;
        const transient = isAbort || providerTransient;
        const code: HolisticExtractorFailureCode = error instanceof HolisticExtractorError
          ? error.code
          : isAbort
          ? "timeout"
          : error instanceof LlmProviderError
          ? (error.transient ? "provider_transient" : "provider_non_transient")
          : error instanceof SyntaxError
          ? "invalid_json"
          : "schema_invalid";

        logger.warn("holistic_extractor.failure", {
          correlation_id: correlationId,
          prompt_version: HOLISTIC_EXTRACTION_PROMPT_VERSION,
          attempt,
          error_code: code,
          transient,
        });

        if (code === "invalid_json") {
          captureSentryException(error, {
            level: "error",
            event: "llm.intent.invalid_json",
            context: {
              category: "llm_extraction",
              correlation_id: correlationId,
              user_id: null,
              tags: {
                prompt_hash: promptHash,
                session_id: input.sessionId,
                attempt,
              },
            },
            payload: {
              prompt_version: HOLISTIC_EXTRACTION_PROMPT_VERSION,
              prompt_hash: promptHash,
              error_code: code,
              transient,
            },
          });
        }

        if (attempt < attempts && transient) {
          continue;
        }

        throw new HolisticExtractorError(
          `Holistic extraction failed: ${normalized.message}`,
          {
            code,
            correlationId,
            promptVersion: HOLISTIC_EXTRACTION_PROMPT_VERSION,
            transient,
            cause: error,
          },
        );
      } finally {
        timeout.clear();
        emitMetricBestEffort({
          metric: "llm.request.count",
          value: 1,
          correlation_id: correlationId,
          tags: {
            component: "holistic_extractor",
            provider: llmProvider,
            model: llmModel,
            attempt,
            outcome: llmCallOutcome,
          },
        });
        emitMetricBestEffort({
          metric: "system.request.latency",
          value: elapsedMetricMs(llmCallStartedAt),
          correlation_id: correlationId,
          tags: {
            component: "llm_call",
            operation: "holistic_extractor",
            outcome: llmCallOutcome,
          },
        });
      }
    }

    throw new HolisticExtractorError(
      "Holistic extraction failed after retry.",
      {
        code: "provider_transient",
        correlationId,
        promptVersion: HOLISTIC_EXTRACTION_PROMPT_VERSION,
        transient: true,
        cause: lastError,
      },
    );
  };
}

export const extractCoordinationSignals = createHolisticSignalExtractor();
