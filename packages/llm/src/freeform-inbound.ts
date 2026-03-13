import {
  FREEFORM_INBOUND_CLASSIFIER_PROMPT_VERSION,
  FREEFORM_INBOUND_CLASSIFIER_SYSTEM_PROMPT,
} from "./prompts/freeform-inbound-classifier-system-prompt.ts";
import {
  FREEFORM_PREFERENCE_EXTRACTION_PROMPT_VERSION,
  FREEFORM_PREFERENCE_EXTRACTION_SYSTEM_PROMPT,
} from "./prompts/freeform-preference-extraction-system-prompt.ts";
import {
  getDefaultLlmProvider,
  LlmProviderError,
  type LlmProvider,
} from "./provider.ts";
import { validateModelOutput } from "./output-validator.ts";

export type FreeformInboundCategory =
  | "AVAILABILITY_SIGNAL"
  | "POST_EVENT_SIGNAL"
  | "PREFERENCE_UPDATE"
  | "GENERAL_FREEFORM";

export type FreeformInboundClassification = {
  category: FreeformInboundCategory;
  summary: string;
};

export type FreeformPreferenceExtraction = {
  summary: string;
  preferences_patch: Record<string, unknown>;
  boundaries_patch: Record<string, unknown>;
  notice_preference?: string | null;
  coordination_style?: string | null;
};

type FreeformPromptInput = {
  messageText: string;
  correlationId: string;
};

type FreeformPreferencePromptInput = FreeformPromptInput & {
  currentPreferences: unknown;
  currentBoundaries: unknown;
  currentNoticePreference: string | null;
  currentCoordinationStyle: string | null;
};

type CreateHelperOptions = {
  provider?: LlmProvider;
  timeoutMs?: number;
  retryCount?: number;
};

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_COUNT = 1;
const VALID_FREEFORM_CATEGORIES = new Set<FreeformInboundCategory>([
  "AVAILABILITY_SIGNAL",
  "POST_EVENT_SIGNAL",
  "PREFERENCE_UPDATE",
  "GENERAL_FREEFORM",
]);

function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

function sanitizeSummary(value: string, fallback: string): string {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function buildFreeformClassifierUserPrompt(input: FreeformPromptInput): string {
  return [
    `PromptVersion: ${FREEFORM_INBOUND_CLASSIFIER_PROMPT_VERSION}`,
    `CorrelationId: ${input.correlationId}`,
    "InboundMessage:",
    input.messageText.trim(),
  ].join("\n");
}

function buildFreeformPreferenceUserPrompt(input: FreeformPreferencePromptInput): string {
  return [
    `PromptVersion: ${FREEFORM_PREFERENCE_EXTRACTION_PROMPT_VERSION}`,
    `CorrelationId: ${input.correlationId}`,
    "CurrentPreferencesJSON:",
    JSON.stringify(input.currentPreferences ?? {}),
    "CurrentBoundariesJSON:",
    JSON.stringify(input.currentBoundaries ?? {}),
    `CurrentNoticePreference: ${input.currentNoticePreference ?? "null"}`,
    `CurrentCoordinationStyle: ${input.currentCoordinationStyle ?? "null"}`,
    "InboundMessage:",
    input.messageText.trim(),
  ].join("\n");
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function parseJsonPayload(raw: string): unknown {
  return JSON.parse(raw);
}

function isTransientError(error: unknown): boolean {
  const isAbort = error instanceof DOMException && error.name === "AbortError";
  return isAbort || (error instanceof LlmProviderError && error.transient);
}

async function callStructuredPrompt<T>(params: {
  provider: LlmProvider;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs: number;
  retryCount: number;
  parse: (value: unknown) => T;
}): Promise<T | null> {
  const attempts = params.retryCount + 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const timeout = withTimeoutSignal(params.timeoutMs);
    try {
      const response = await params.provider.generateText({
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
        timeoutMs: params.timeoutMs,
        signal: timeout.signal,
      });
      const validation = validateModelOutput({
        rawText: response.text,
        requireJson: true,
      });
      if (!validation.ok) {
        return null;
      }

      return params.parse(parseJsonPayload(validation.sanitizedText));
    } catch (error) {
      if (attempt < attempts && isTransientError(error)) {
        continue;
      }
      return null;
    } finally {
      timeout.clear();
    }
  }

  return null;
}

function parseClassificationResult(value: unknown, messageText: string): FreeformInboundClassification {
  const payload = asObject(value);
  const category = payload.category;
  const summary = typeof payload.summary === "string"
    ? sanitizeSummary(payload.summary, messageText.trim() || "User sent a freeform message.")
    : (messageText.trim() || "User sent a freeform message.");

  if (!VALID_FREEFORM_CATEGORIES.has(category as FreeformInboundCategory)) {
    return {
      category: "GENERAL_FREEFORM",
      summary,
    };
  }

  return {
    category: category as FreeformInboundCategory,
    summary,
  };
}

function parsePreferenceExtractionResult(value: unknown, messageText: string): FreeformPreferenceExtraction {
  const payload = asObject(value);
  const summary = typeof payload.summary === "string"
    ? sanitizeSummary(payload.summary, messageText.trim() || "User shared a preference update.")
    : (messageText.trim() || "User shared a preference update.");
  const result: FreeformPreferenceExtraction = {
    summary,
    preferences_patch: asObject(payload.preferences_patch),
    boundaries_patch: asObject(payload.boundaries_patch),
  };

  if (typeof payload.notice_preference === "string" || payload.notice_preference === null) {
    result.notice_preference = payload.notice_preference as string | null;
  }
  if (typeof payload.coordination_style === "string" || payload.coordination_style === null) {
    result.coordination_style = payload.coordination_style as string | null;
  }

  return result;
}

export function createFreeformInboundClassifier(options: CreateHelperOptions = {}) {
  const provider = options.provider ?? getDefaultLlmProvider();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryCount = options.retryCount ?? DEFAULT_RETRY_COUNT;

  return async function classifyFreeformInbound(
    input: FreeformPromptInput,
  ): Promise<FreeformInboundClassification> {
    const fallbackSummary = input.messageText.trim() || "User sent a freeform message.";
    const parsed = await callStructuredPrompt({
      provider,
      systemPrompt: FREEFORM_INBOUND_CLASSIFIER_SYSTEM_PROMPT,
      userPrompt: buildFreeformClassifierUserPrompt(input),
      timeoutMs,
      retryCount,
      parse: (value) => parseClassificationResult(value, fallbackSummary),
    });

    return parsed ?? {
      category: "GENERAL_FREEFORM",
      summary: fallbackSummary,
    };
  };
}

export function createFreeformPreferenceExtractor(options: CreateHelperOptions = {}) {
  const provider = options.provider ?? getDefaultLlmProvider();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryCount = options.retryCount ?? DEFAULT_RETRY_COUNT;

  return async function extractFreeformPreferenceUpdate(
    input: FreeformPreferencePromptInput,
  ): Promise<FreeformPreferenceExtraction | null> {
    return callStructuredPrompt({
      provider,
      systemPrompt: FREEFORM_PREFERENCE_EXTRACTION_SYSTEM_PROMPT,
      userPrompt: buildFreeformPreferenceUserPrompt(input),
      timeoutMs,
      retryCount,
      parse: (value) => parsePreferenceExtractionResult(value, input.messageText),
    });
  };
}

export const classifyFreeformInbound = createFreeformInboundClassifier();
export const extractFreeformPreferenceUpdate = createFreeformPreferenceExtractor();
