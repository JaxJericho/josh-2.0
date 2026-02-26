export type LlmPricing = {
  input_nano_usd_per_token: number;
  output_nano_usd_per_token: number;
};

export type LlmCostEstimate = {
  pricing_version: string;
  pricing_model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  total_nano_usd: number;
  estimated_cost_usd: number;
};

export const LLM_PRICING_VERSION = "2026-02-26.v1";

export const LLM_PRICING_BY_MODEL: Readonly<Record<string, LlmPricing>> = Object.freeze({
  "claude-3-5-haiku-latest": {
    input_nano_usd_per_token: 800,
    output_nano_usd_per_token: 4_000,
  },
  "claude-3-5-sonnet-latest": {
    input_nano_usd_per_token: 3_000,
    output_nano_usd_per_token: 15_000,
  },
});

const FALLBACK_MODEL = "claude-3-5-haiku-latest";
const NANO_USD_PER_USD = 1_000_000_000;

export function estimateLlmCostUsd(input: {
  model: string;
  input_tokens: number;
  output_tokens: number;
}): LlmCostEstimate {
  const pricingModel = resolvePricingModel(input.model);
  const pricing = LLM_PRICING_BY_MODEL[pricingModel];
  if (!pricing) {
    throw new Error(`Missing pricing configuration for model '${pricingModel}'.`);
  }

  const inputTokens = normalizeTokenCount(input.input_tokens);
  const outputTokens = normalizeTokenCount(input.output_tokens);
  const totalNanoUsd = (inputTokens * pricing.input_nano_usd_per_token) +
    (outputTokens * pricing.output_nano_usd_per_token);
  const estimatedCostUsd = Number((totalNanoUsd / NANO_USD_PER_USD).toFixed(9));

  return {
    pricing_version: LLM_PRICING_VERSION,
    pricing_model: pricingModel,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    total_nano_usd: totalNanoUsd,
    estimated_cost_usd: estimatedCostUsd,
  };
}

export function resolvePricingModel(model: string): string {
  const normalized = model.trim();
  if (!normalized) {
    return FALLBACK_MODEL;
  }

  if (LLM_PRICING_BY_MODEL[normalized]) {
    return normalized;
  }

  if (normalized.startsWith("claude-3-5-haiku")) {
    return "claude-3-5-haiku-latest";
  }
  if (normalized.startsWith("claude-3-5-sonnet")) {
    return "claude-3-5-sonnet-latest";
  }

  return FALLBACK_MODEL;
}

function normalizeTokenCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  return Math.floor(value);
}
