import type {
  ClinicalExtraction,
  ExtractionResult,
  LLMAttemptTrace,
  PromptStrategy,
  SchemaValidationIssue,
} from "@test-evals/shared";

import { DEFAULT_MODEL, EXTRACTION_TOOL_NAME, MAX_EXTRACTION_ATTEMPTS } from "./constants";
import { providerForModel, type LlmMessagesClient, type LlmProvider } from "./client";
import { hashPrompt } from "./hash";
import { estimateCostUsd } from "./pricing";
import { type ExtractionSchema, loadExtractionSchema, validateExtraction } from "./schema";
import { getPromptStrategy } from "./strategies";
import { addTokenUsage, emptyTokenUsage, mapAnthropicUsage, mapOpenAiUsage } from "./usage";

export interface ExtractClinicalTranscriptInput {
  caseId: string;
  transcriptId: string;
  transcript: string;
  strategy: PromptStrategy;
  model?: string;
  runId?: string;
  client: LlmMessagesClient;
  schema?: ExtractionSchema;
}

interface ToolUseBlock {
  type: string;
  name?: string;
  input?: unknown;
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildRequest(params: {
  model: string;
  provider: LlmProvider;
  system: string;
  user: string;
  schema: ExtractionSchema;
}): unknown {
  if (params.provider === "groq") {
    return {
      model: params.model,
      max_tokens: 1400,
      temperature: 0,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: EXTRACTION_TOOL_NAME,
            description: "Extract a structured clinical encounter from the provided transcript.",
            parameters: params.schema,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: EXTRACTION_TOOL_NAME } },
    };
  }

  return {
    model: params.model,
    max_tokens: 1400,
    temperature: 0,
    system: [
      {
        type: "text",
        text: params.system,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: params.user }],
      },
    ],
    tools: [
      {
        name: EXTRACTION_TOOL_NAME,
        description: "Extract a structured clinical encounter from the provided transcript.",
        input_schema: params.schema,
      },
    ],
    tool_choice: { type: "tool", name: EXTRACTION_TOOL_NAME },
  };
}

function extractToolInput(response: unknown): unknown {
  const choices = (response as { choices?: unknown }).choices;
  if (Array.isArray(choices)) {
    const message = (choices[0] as { message?: { tool_calls?: unknown } } | undefined)?.message;
    const toolCalls = message?.tool_calls;
    if (Array.isArray(toolCalls)) {
      const toolCall = toolCalls.find((block) => {
        const candidate = block as { type?: string; function?: { name?: string } };
        return candidate.type === "function" && candidate.function?.name === EXTRACTION_TOOL_NAME;
      }) as { function?: { arguments?: unknown } } | undefined;
      const args = toolCall?.function?.arguments;
      if (typeof args === "string") {
        try {
          return JSON.parse(args) as unknown;
        } catch {
          return null;
        }
      }
      return args ?? null;
    }
  }

  const content = (response as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return null;
  }

  const toolUse = content.find((block): block is ToolUseBlock => {
    const candidate = block as Partial<ToolUseBlock>;
    return candidate.type === "tool_use" && candidate.name === EXTRACTION_TOOL_NAME;
  });

  return toolUse?.input ?? null;
}

export function buildPromptHash(input: {
  strategy: PromptStrategy;
  stableParts: unknown;
  schema: ExtractionSchema;
}): string {
  return hashPrompt({
    strategy: input.strategy,
    stableParts: input.stableParts,
    schema: input.schema,
    toolName: EXTRACTION_TOOL_NAME,
  });
}

export async function extractClinicalTranscript(
  input: ExtractClinicalTranscriptInput,
): Promise<ExtractionResult> {
  const model = input.model ?? DEFAULT_MODEL;
  const provider = input.client.provider ?? providerForModel(model);
  const schema = input.schema ?? loadExtractionSchema();
  const strategyBuilder = getPromptStrategy(input.strategy);
  let totalUsage = emptyTokenUsage();
  let validationErrors: SchemaValidationIssue[] = [];
  let priorExtraction: unknown = null;
  let finalExtraction: ClinicalExtraction | null = null;
  let finalSchemaValid = false;
  const attempts: LLMAttemptTrace[] = [];
  const startedAtMs = Date.now();
  let promptHash = "";

  for (let attempt = 1; attempt <= MAX_EXTRACTION_ATTEMPTS; attempt += 1) {
    const prompt = strategyBuilder({
      transcript: input.transcript,
      validationErrors: attempt === 1 ? undefined : validationErrors,
      priorExtraction,
    });
    promptHash = buildPromptHash({
      strategy: input.strategy,
      stableParts: prompt.stableParts,
      schema,
    });

    const request = buildRequest({
      model,
      provider,
      system: prompt.system,
      user: prompt.user,
      schema,
    });

    const attemptStartedAt = Date.now();
    const traceBase = {
      attempt,
      startedAt: new Date(attemptStartedAt).toISOString(),
      model,
      strategy: input.strategy,
      promptHash,
      request,
    };

    try {
      const response = await input.client.create(request);
      const rawExtraction = extractToolInput(response);
      priorExtraction = rawExtraction;
      const validation = validateExtraction(rawExtraction, schema);
      const tokenUsage =
        provider === "anthropic"
          ? mapAnthropicUsage((response as { usage?: unknown }).usage)
          : mapOpenAiUsage((response as { usage?: unknown }).usage);
      totalUsage = addTokenUsage(totalUsage, tokenUsage);

      attempts.push({
        ...traceBase,
        completedAt: nowIso(),
        response,
        extracted: validation.extraction,
        schemaValid: validation.schemaValid,
        validationErrors: validation.validationErrors,
        tokenUsage,
        cacheReadVerified: tokenUsage.cacheReadInputTokens > 0,
        latencyMs: Date.now() - attemptStartedAt,
      });

      finalExtraction = validation.extraction;
      finalSchemaValid = validation.schemaValid;
      validationErrors = validation.validationErrors;

      if (validation.schemaValid) {
        break;
      }
    } catch (error) {
      const candidate = error as { status?: number; message?: string };
      if (candidate.status === 429 || candidate.message?.toLowerCase().includes("rate limit") === true) {
        throw error;
      }

      const tokenUsage = emptyTokenUsage();
      attempts.push({
        ...traceBase,
        completedAt: nowIso(),
        response: null,
        extracted: null,
        schemaValid: false,
        validationErrors,
        tokenUsage,
        cacheReadVerified: false,
        latencyMs: Date.now() - attemptStartedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      validationErrors = [
        {
          path: "/",
          message: error instanceof Error ? error.message : "LLM request failed.",
          keyword: "request_error",
        },
      ];
      break;
    }
  }

  if (!finalSchemaValid && validationErrors.length === 0) {
    validationErrors = [
      {
        path: "/",
        message: `Model did not call ${EXTRACTION_TOOL_NAME} with a valid input.`,
        keyword: "tool_use",
      },
    ];
  }

  return {
    caseId: input.caseId,
    transcriptId: input.transcriptId,
    runId: input.runId,
    strategy: input.strategy,
    model,
    promptHash,
    extraction: finalExtraction,
    schemaValid: finalSchemaValid,
    validationErrors,
    attempts,
    tokenUsage: totalUsage,
    latencyMs: Date.now() - startedAtMs,
    costUsd: estimateCostUsd(model, totalUsage),
    cached: false,
    createdAt: nowIso(),
  };
}
