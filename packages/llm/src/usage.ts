import type { TokenUsage } from "@test-evals/shared";

import { EMPTY_TOKEN_USAGE } from "./constants";

export function addTokenUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadInputTokens: left.cacheReadInputTokens + right.cacheReadInputTokens,
    cacheWriteInputTokens: left.cacheWriteInputTokens + right.cacheWriteInputTokens,
  };
}

export function emptyTokenUsage(): TokenUsage {
  return { ...EMPTY_TOKEN_USAGE };
}

export function mapAnthropicUsage(usage: unknown): TokenUsage {
  const record = usage as Record<string, number | undefined> | undefined;

  return {
    inputTokens: record?.input_tokens ?? 0,
    outputTokens: record?.output_tokens ?? 0,
    cacheReadInputTokens: record?.cache_read_input_tokens ?? 0,
    cacheWriteInputTokens: record?.cache_creation_input_tokens ?? 0,
  };
}

export function mapOpenAiUsage(usage: unknown): TokenUsage {
  const record = usage as Record<string, number | undefined> | undefined;

  return {
    inputTokens: record?.prompt_tokens ?? record?.input_tokens ?? 0,
    outputTokens: record?.completion_tokens ?? record?.output_tokens ?? 0,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
  };
}
