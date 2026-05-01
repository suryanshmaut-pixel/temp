import {
  DEFAULT_MODEL,
  createAnthropicMessagesClient,
  createGroqMessagesClient,
  extractClinicalTranscript,
  providerForModel,
  type LlmMessagesClient,
} from "@test-evals/llm";
import type { ExtractionResult, PromptStrategy } from "@test-evals/shared";

export interface ExtractCaseInput {
  caseId: string;
  transcriptId: string;
  runId?: string;
  transcript: string;
  strategy: PromptStrategy;
  model?: string;
  client?: LlmMessagesClient;
}

function getAnthropicApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("ANTHROPIC_API_KEY is required to run extraction.");
  }

  return apiKey;
}

function getGroqApiKey(): string {
  const apiKey = process.env.GROQ_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("GROQ_API_KEY is required to run Groq extraction.");
  }

  return apiKey;
}

export async function extractCase(input: ExtractCaseInput): Promise<ExtractionResult> {
  const model = input.model ?? DEFAULT_MODEL;
  const client =
    input.client ??
    (providerForModel(model) === "anthropic"
      ? await createAnthropicMessagesClient(getAnthropicApiKey())
      : await createGroqMessagesClient(getGroqApiKey()));

  return extractClinicalTranscript({
    caseId: input.caseId,
    transcriptId: input.transcriptId,
    runId: input.runId,
    transcript: input.transcript,
    strategy: input.strategy,
    model,
    client,
  });
}
