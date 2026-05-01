import { EXTRACTION_TOOL_NAME } from "./constants";

export type LlmProvider = "anthropic" | "groq";

export interface LlmMessagesClient {
  provider?: LlmProvider;
  create(request: unknown): Promise<unknown>;
}

export type AnthropicMessagesClient = LlmMessagesClient;

export function providerForModel(model: string): LlmProvider {
  return model.startsWith("claude-") ? "anthropic" : "groq";
}

export async function createAnthropicMessagesClient(apiKey: string): Promise<LlmMessagesClient> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  return {
    provider: "anthropic",
    create: (request: unknown) => client.messages.create(request as never),
  };
}

function extractJsonObjectString(text: string): string | null {
  const taggedStart = text.indexOf(`<function=${EXTRACTION_TOOL_NAME}>`);
  const searchStart = taggedStart >= 0 ? taggedStart : 0;
  const start = text.indexOf("{", searchStart);
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function groqFailedGenerationToResponse(body: string): unknown | null {
  try {
    const parsed = JSON.parse(body) as { error?: { failed_generation?: unknown } };
    const failedGeneration = parsed.error?.failed_generation;
    if (typeof failedGeneration !== "string") {
      return null;
    }

    const argumentsJson = extractJsonObjectString(failedGeneration);
    if (argumentsJson === null) {
      return null;
    }

    return {
      choices: [
        {
          message: {
            tool_calls: [
              {
                type: "function",
                function: {
                  name: EXTRACTION_TOOL_NAME,
                  arguments: argumentsJson,
                },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
      },
      groq_error: parsed.error,
    };
  } catch {
    return null;
  }
}

export async function createGroqMessagesClient(apiKey: string): Promise<LlmMessagesClient> {
  return {
    provider: "groq",
    async create(request: unknown): Promise<unknown> {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const body = await response.text();
        const failedGenerationResponse = response.status === 429 ? null : groqFailedGenerationToResponse(body);
        if (failedGenerationResponse !== null) {
          return failedGenerationResponse;
        }

        const retryAfter = response.headers.get("retry-after");
        const error = new Error(body || `Groq request failed with ${response.status}`) as Error & {
          status?: number;
          retryAfterMs?: number;
        };
        error.status = response.status;
        if (retryAfter !== null) {
          const retryAfterSeconds = Number(retryAfter);
          if (Number.isFinite(retryAfterSeconds)) {
            error.retryAfterMs = Math.max(0, retryAfterSeconds * 1000);
          }
        }
        throw error;
      }

      return response.json();
    },
  };
}
