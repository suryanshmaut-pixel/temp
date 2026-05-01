import type { PromptBuilder } from "./types";
import { BASE_SYSTEM_PROMPT, retryInstructions, transcriptUserPrompt } from "./shared";

const FEW_SHOT_EXAMPLES = [
  {
    transcript:
      "Doctor: Your blood pressure is 130/84 and oxygen is 99%. This looks like seasonal allergies. Try cetirizine 10 mg by mouth daily and come back if symptoms worsen.",
    extraction: {
      chief_complaint: "seasonal allergy symptoms",
      vitals: { bp: "130/84", hr: null, temp_f: null, spo2: 99 },
      medications: [{ name: "cetirizine", dose: "10 mg", frequency: "daily", route: "PO" }],
      diagnoses: [{ description: "seasonal allergic rhinitis" }],
      plan: ["start cetirizine 10 mg daily", "return if symptoms worsen"],
      follow_up: { interval_days: null, reason: "if symptoms worsen" },
    },
  },
  {
    transcript:
      "Doctor: Rapid strep is negative. This is most likely a viral sore throat. Use fluids and acetaminophen as needed. No scheduled follow-up is needed.",
    extraction: {
      chief_complaint: "sore throat",
      vitals: { bp: null, hr: null, temp_f: null, spo2: null },
      medications: [{ name: "acetaminophen", dose: null, frequency: "as needed", route: null }],
      diagnoses: [{ description: "viral pharyngitis" }],
      plan: ["supportive care with fluids", "acetaminophen as needed"],
      follow_up: { interval_days: null, reason: null },
    },
  },
];

export const fewShotStrategy: PromptBuilder = (input) => {
  const system = [
    BASE_SYSTEM_PROMPT,
    "Follow these synthetic examples for granularity and null handling:",
    JSON.stringify(FEW_SHOT_EXAMPLES, null, 2),
  ].join("\n");

  return {
    strategy: "few_shot",
    system,
    user: `${transcriptUserPrompt(input.transcript)}${retryInstructions(input.validationErrors, input.priorExtraction)}`,
    stableParts: { system, examples: FEW_SHOT_EXAMPLES },
  };
};
