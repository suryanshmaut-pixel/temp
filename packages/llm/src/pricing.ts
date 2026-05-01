import type { TokenUsage } from "@test-evals/shared";

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
}

const DEFAULT_PRICING: ModelPricing = {
  inputPerMillion: 1,
  outputPerMillion: 5,
  cacheWritePerMillion: 1.25,
  cacheReadPerMillion: 0.1,
};

const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-haiku-4-5-20251001": DEFAULT_PRICING,
  "llama-3.1-8b-instant": {
    inputPerMillion: 0.05,
    outputPerMillion: 0.08,
    cacheWritePerMillion: 0,
    cacheReadPerMillion: 0,
  },
};

export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  const uncachedInputTokens = Math.max(0, usage.inputTokens - usage.cacheReadInputTokens);

  return (
    (uncachedInputTokens / 1_000_000) * pricing.inputPerMillion +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMillion +
    (usage.cacheWriteInputTokens / 1_000_000) * pricing.cacheWritePerMillion +
    (usage.cacheReadInputTokens / 1_000_000) * pricing.cacheReadPerMillion
  );
}
