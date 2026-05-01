import type { PromptStrategy } from "@test-evals/shared";

import { cotStrategy } from "./cot";
import { fewShotStrategy } from "./few-shot";
import { zeroShotStrategy } from "./zero-shot";
import type { PromptBuilder } from "./types";

const STRATEGIES: Record<PromptStrategy, PromptBuilder> = {
  zero_shot: zeroShotStrategy,
  few_shot: fewShotStrategy,
  cot: cotStrategy,
};

export function getPromptStrategy(strategy: PromptStrategy): PromptBuilder {
  return STRATEGIES[strategy];
}

export type { PromptBuildInput, PromptBuilder, PromptDefinition } from "./types";
