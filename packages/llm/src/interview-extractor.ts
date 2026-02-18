import {
  INTERVIEW_EXTRACTION_PROMPT_VERSION,
  INTERVIEW_EXTRACTION_SYSTEM_PROMPT,
} from "./prompts/interview-extraction-system-prompt.ts";
import {
  parseInterviewExtractOutput,
  type InterviewExtractOutput,
  type InterviewExtractedSignals,
} from "./schemas/interview-extract-output.schema.ts";
import {
  getDefaultLlmProvider,
  LlmProviderError,
  type LlmProvider,
} from "./provider.ts";

export type InterviewExtractInput = {
  userId: string;
  inboundMessageSid: string;
  stepId: string;
  questionTarget: string;
  questionText: string;
  userAnswerText: string;
  recentConversationTurns: Array<{ role: "user" | "assistant"; text: string }>;
  currentProfile: {
    fingerprint: Record<string, unknown>;
    activityPatterns: Array<Record<string, unknown>>;
    boundaries: Record<string, unknown>;
    preferences: Record<string, unknown>;
  };
  correlationId?: string;
};

export type InterviewExtractorFailureCode =
  | "provider_transient"
  | "provider_non_transient"
  | "timeout"
  | "invalid_json"
  | "schema_invalid"
  | "step_mismatch";

export class InterviewExtractorError extends Error {
  readonly code: InterviewExtractorFailureCode;
  readonly shouldFallback: true;
  readonly transient: boolean;
  readonly correlationId: string;
  readonly promptVersion: string;

  constructor(
    message: string,
    options: {
      code: InterviewExtractorFailureCode;
      correlationId: string;
      promptVersion: string;
      transient: boolean;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "InterviewExtractorError";
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

type InterviewExtractorLogger = {
  info(event: string, data: Record<string, unknown>): void;
  warn(event: string, data: Record<string, unknown>): void;
};

type CreateExtractorOptions = {
  provider?: LlmProvider;
  timeoutMs?: number;
  retryCount?: number;
  logger?: InterviewExtractorLogger;
  createCorrelationId?: () => string;
};

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_COUNT = 1;

function createDefaultLogger(): InterviewExtractorLogger {
  return {
    info(event, data) {
      console.info(event, data);
    },
    warn(event, data) {
      console.warn(event, data);
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

function buildInterviewExtractionUserPrompt(input: InterviewExtractInput): string {
  const recentTurns = input.recentConversationTurns
    .slice(-8)
    .map((turn, index) => `${index + 1}. ${turn.role}: ${turn.text}`)
    .join("\n");

  return [
    `PromptVersion: ${INTERVIEW_EXTRACTION_PROMPT_VERSION}`,
    `UserId: ${input.userId}`,
    `InboundMessageSid: ${input.inboundMessageSid}`,
    `CurrentStepId: ${input.stepId}`,
    `CurrentQuestionTarget: ${input.questionTarget}`,
    `CurrentQuestionText: ${input.questionText}`,
    `UserAnswerText: ${input.userAnswerText}`,
    "RecentConversationTurns:",
    recentTurns || "(none)",
    "CurrentProfileJSON:",
    JSON.stringify(input.currentProfile),
  ].join("\n");
}

function parseJsonPayload(raw: string): unknown {
  const trimmed = raw.trim();
  const withoutFence = trimmed.startsWith("```")
    ? trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
    : trimmed;

  return JSON.parse(withoutFence);
}

function hasStrongMotiveWeight(output: InterviewExtractOutput): boolean {
  const entries = output.extracted.activityPatternsAdd ?? [];
  for (const entry of entries) {
    for (const weight of Object.values(entry.motive_weights)) {
      if (weight >= 0.55) {
        return true;
      }
    }
  }
  return false;
}

function enforceNeedsFollowUpRule(output: InterviewExtractOutput): InterviewExtractOutput {
  if (!output.notes?.needsFollowUp) {
    return output;
  }

  const followUpQuestion = output.notes.followUpQuestion?.toLowerCase() ?? "";
  const mismatchSignal = /\b(mismatch|conflict|incompatible|risk)\b/.test(followUpQuestion);
  const motiveFlat = !hasStrongMotiveWeight(output);
  if (motiveFlat || mismatchSignal) {
    return output;
  }

  return {
    ...output,
    notes: {
      ...output.notes,
      needsFollowUp: false,
    },
  };
}

function mergeExtractedSignals(extracted: InterviewExtractedSignals): InterviewExtractedSignals {
  return {
    fingerprintPatches: extracted.fingerprintPatches?.map((entry) => ({ ...entry })),
    activityPatternsAdd: extracted.activityPatternsAdd?.map((entry) => ({
      ...entry,
      motive_weights: { ...entry.motive_weights },
      constraints: entry.constraints ? { ...entry.constraints } : undefined,
      preferred_windows: entry.preferred_windows ? [...entry.preferred_windows] : undefined,
    })),
    boundariesPatch: extracted.boundariesPatch ? { ...extracted.boundariesPatch } : undefined,
    preferencesPatch: extracted.preferencesPatch ? { ...extracted.preferencesPatch } : undefined,
  };
}

function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

export function createInterviewSignalExtractor(options: CreateExtractorOptions = {}) {
  const provider = options.provider ?? getDefaultLlmProvider();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryCount = options.retryCount ?? DEFAULT_RETRY_COUNT;
  const logger = options.logger ?? createDefaultLogger();
  const correlationFactory = options.createCorrelationId ?? createCorrelationId;

  return async function extractInterviewSignals(input: InterviewExtractInput): Promise<InterviewExtractOutput> {
    const correlationId = input.correlationId ?? correlationFactory();
    const attempts = retryCount + 1;
    const userPrompt = buildInterviewExtractionUserPrompt(input);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      logger.info("interview_extractor.call", {
        correlation_id: correlationId,
        prompt_version: INTERVIEW_EXTRACTION_PROMPT_VERSION,
        attempt,
      });

      const timeout = withTimeoutSignal(timeoutMs);
      try {
        const providerResponse = await provider.generateText({
          systemPrompt: INTERVIEW_EXTRACTION_SYSTEM_PROMPT,
          userPrompt,
          timeoutMs,
          signal: timeout.signal,
        });
        const parsedJson = parseJsonPayload(providerResponse.text);
        const parsedOutput = enforceNeedsFollowUpRule(parseInterviewExtractOutput(parsedJson));

        if (parsedOutput.stepId !== input.stepId) {
          throw new InterviewExtractorError(
            `Extractor returned stepId '${parsedOutput.stepId}' instead of '${input.stepId}'.`,
            {
              code: "step_mismatch",
              correlationId,
              promptVersion: INTERVIEW_EXTRACTION_PROMPT_VERSION,
              transient: false,
            },
          );
        }

        return {
          ...parsedOutput,
          extracted: mergeExtractedSignals(parsedOutput.extracted),
          notes: parsedOutput.notes ? { ...parsedOutput.notes } : undefined,
        } satisfies InterviewExtractOutput;
      } catch (error) {
        lastError = error;

        const isAbort = error instanceof DOMException && error.name === "AbortError";
        const normalized = normalizeErrorShape(error);
        const providerTransient = error instanceof LlmProviderError && error.transient;
        const transient = isAbort || providerTransient;
        const code: InterviewExtractorFailureCode = error instanceof InterviewExtractorError
          ? error.code
          : isAbort
          ? "timeout"
          : error instanceof LlmProviderError
          ? (error.transient ? "provider_transient" : "provider_non_transient")
          : error instanceof SyntaxError
          ? "invalid_json"
          : "schema_invalid";

        logger.warn("interview_extractor.failure", {
          correlation_id: correlationId,
          prompt_version: INTERVIEW_EXTRACTION_PROMPT_VERSION,
          attempt,
          error_code: code,
          transient,
        });

        if (attempt < attempts && transient) {
          continue;
        }

        throw new InterviewExtractorError(
          `Interview extraction failed: ${normalized.message}`,
          {
            code,
            correlationId,
            promptVersion: INTERVIEW_EXTRACTION_PROMPT_VERSION,
            transient,
            cause: error,
          },
        );
      } finally {
        timeout.clear();
      }
    }

    throw new InterviewExtractorError(
      "Interview extraction failed after retry.",
      {
        code: "provider_transient",
        correlationId,
        promptVersion: INTERVIEW_EXTRACTION_PROMPT_VERSION,
        transient: true,
        cause: lastError,
      },
    );
  };
}

export const extractInterviewSignals = createInterviewSignalExtractor();
