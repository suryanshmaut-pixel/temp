import type { PromptBuilder } from "./types";
import { BASE_SYSTEM_PROMPT, retryInstructions, transcriptUserPrompt } from "./shared";

export const zeroShotStrategy: PromptBuilder = (input) => {
  const system = [
    BASE_SYSTEM_PROMPT,
    "Prefer short clinical summaries over copying whole dialogue turns.",
  ].join("\n");

  return {
    strategy: "zero_shot",
    system,
    user: `${transcriptUserPrompt(input.transcript)}${retryInstructions(input.validationErrors, input.priorExtraction)}`,
    stableParts: { system },
  };
};
