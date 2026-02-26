export type LlmProviderRequest = {
  systemPrompt: string;
  userPrompt: string;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type LlmProviderResponse = {
  text: string;
  model: string;
  provider: "anthropic";
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
};

export interface LlmProvider {
  generateText(request: LlmProviderRequest): Promise<LlmProviderResponse>;
}

export class LlmProviderError extends Error {
  readonly transient: boolean;
  readonly status: number | null;

  constructor(message: string, options: { transient: boolean; status?: number | null }) {
    super(message);
    this.name = "LlmProviderError";
    this.transient = options.transient;
    this.status = options.status ?? null;
  }
}

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";
const ANTHROPIC_DEFAULT_MODEL = "claude-3-5-haiku-latest";

function readEnv(name: string): string | null {
  try {
    // @ts-ignore Deno global is not available in Node typings.
    if (typeof Deno !== "undefined" && typeof Deno.env?.get === "function") {
      // @ts-ignore Deno global is not available in Node typings.
      return Deno.env.get(name) ?? null;
    }
  } catch {
    // Ignore and continue with process.env fallback.
  }

  if (typeof process !== "undefined" && process?.env) {
    const value = process.env[name];
    return typeof value === "string" ? value : null;
  }

  return null;
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function extractAnthropicText(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LlmProviderError("Anthropic response must be an object.", {
      transient: false,
    });
  }

  const response = value as Record<string, unknown>;
  const content = response.content;
  if (!Array.isArray(content)) {
    throw new LlmProviderError("Anthropic response is missing content array.", {
      transient: false,
    });
  }

  const textChunk = content.find((entry) =>
    entry &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    (entry as Record<string, unknown>).type === "text"
  ) as Record<string, unknown> | undefined;

  const text = textChunk?.text;
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new LlmProviderError("Anthropic response does not include text content.", {
      transient: false,
    });
  }

  return text;
}

function extractAnthropicUsage(value: unknown): { input_tokens: number; output_tokens: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { input_tokens: 0, output_tokens: 0 };
  }

  const usage = (value as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return { input_tokens: 0, output_tokens: 0 };
  }

  const usageRecord = usage as Record<string, unknown>;
  const inputTokens = Number(usageRecord.input_tokens ?? 0);
  const outputTokens = Number(usageRecord.output_tokens ?? 0);

  return {
    input_tokens: Number.isFinite(inputTokens) && inputTokens > 0
      ? Math.floor(inputTokens)
      : 0,
    output_tokens: Number.isFinite(outputTokens) && outputTokens > 0
      ? Math.floor(outputTokens)
      : 0,
  };
}

export function createAnthropicProvider(params?: {
  apiKey?: string | null;
  model?: string;
  fetchImpl?: typeof fetch;
}): LlmProvider {
  const apiKey = params?.apiKey ?? readEnv("ANTHROPIC_API_KEY");
  const model = params?.model ?? ANTHROPIC_DEFAULT_MODEL;
  const fetchImpl = params?.fetchImpl ?? fetch;

  return {
    async generateText(request: LlmProviderRequest): Promise<LlmProviderResponse> {
      if (!apiKey) {
        throw new LlmProviderError("ANTHROPIC_API_KEY is not configured.", {
          transient: false,
        });
      }

      let response: Response;
      try {
        response = await fetchImpl(ANTHROPIC_ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_API_VERSION,
          },
          body: JSON.stringify({
            model,
            max_tokens: 800,
            temperature: 0,
            system: request.systemPrompt,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: request.userPrompt,
                  },
                ],
              },
            ],
          }),
          signal: request.signal,
        });
      } catch (error) {
        const isAbort = error instanceof DOMException && error.name === "AbortError";
        throw new LlmProviderError(
          isAbort ? "LLM provider call timed out." : "LLM provider network failure.",
          { transient: true },
        );
      }

      const rawText = await response.text();
      if (!response.ok) {
        throw new LlmProviderError("LLM provider returned non-OK status.", {
          transient: isTransientStatus(response.status),
          status: response.status,
        });
      }

      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(rawText);
      } catch {
        throw new LlmProviderError("LLM provider returned non-JSON payload.", {
          transient: false,
          status: response.status,
        });
      }

      const extractedText = extractAnthropicText(parsedBody);
      const usage = extractAnthropicUsage(parsedBody);

      return {
        text: extractedText,
        model,
        provider: "anthropic",
        usage,
      };
    },
  };
}

let cachedProvider: LlmProvider | null = null;

export function getDefaultLlmProvider(): LlmProvider {
  if (!cachedProvider) {
    cachedProvider = createAnthropicProvider();
  }
  return cachedProvider;
}

export function __resetDefaultLlmProviderForTests(): void {
  cachedProvider = null;
}
