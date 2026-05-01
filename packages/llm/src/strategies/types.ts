import type { PromptStrategy, SchemaValidationIssue } from "@test-evals/shared";

export interface PromptBuildInput {
  transcript: string;
  validationErrors?: SchemaValidationIssue[];
  priorExtraction?: unknown;
}

export interface PromptDefinition {
  strategy: PromptStrategy;
  system: string;
  user: string;
  stableParts: unknown;
}

export type PromptBuilder = (input: PromptBuildInput) => PromptDefinition;
