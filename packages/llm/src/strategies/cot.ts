import type { PromptBuilder } from "./types";
import { BASE_SYSTEM_PROMPT, retryInstructions, transcriptUserPrompt } from "./shared";

export const cotStrategy: PromptBuilder = (input) => {
  const system = [
    BASE_SYSTEM_PROMPT,
    "Before calling the tool, silently identify evidence for each schema field.",
    "Do not include reasoning in the tool output; only provide the final structured object.",
  ].join("\n");

  return {
    strategy: "cot",
    system,
    user: `${transcriptUserPrompt(input.transcript)}${retryInstructions(input.validationErrors, input.priorExtraction)}`,
    stableParts: { system },
  };
};
