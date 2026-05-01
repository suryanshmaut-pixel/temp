import type { SchemaValidationIssue } from "@test-evals/shared";

export const BASE_SYSTEM_PROMPT = [
  "You extract structured clinical data from one synthetic doctor-patient transcript.",
  "Return only facts supported by the transcript.",
  "Use null for missing vitals, medication dose/frequency/route, and follow-up interval or reason.",
  "For diagnosis icd10, omit the property when unknown; do not set icd10 to null.",
  "Keep plan items concise, one discrete action per item.",
  "Use ICD-10 only when the transcript clearly states a code or the diagnosis is unambiguous.",
  "You must call the extraction tool with an object that conforms exactly to the provided schema.",
].join("\n");

export function transcriptUserPrompt(transcript: string): string {
  return [
    "Extract the structured clinical encounter from this transcript.",
    "",
    "<transcript>",
    transcript,
    "</transcript>",
  ].join("\n");
}

export function retryInstructions(
  validationErrors: SchemaValidationIssue[] | undefined,
  priorExtraction: unknown,
): string {
  if (validationErrors === undefined || validationErrors.length === 0) {
    return "";
  }

  const formattedErrors = validationErrors
    .map((error) => `- ${error.path}: ${error.message}${error.keyword ? ` (${error.keyword})` : ""}`)
    .join("\n");

  return [
    "",
    "The prior tool input did not pass JSON Schema validation. Call the same tool again with a corrected object.",
    "Validation errors:",
    formattedErrors,
    "Prior extracted object:",
    JSON.stringify(priorExtraction, null, 2),
  ].join("\n");
}
