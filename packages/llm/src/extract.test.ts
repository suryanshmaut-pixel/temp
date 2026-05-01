import { describe, expect, test } from "bun:test";
import type { ClinicalExtraction } from "@test-evals/shared";

import type { LlmMessagesClient } from "./client";
import { DEFAULT_MODEL, EXTRACTION_TOOL_NAME, MAX_EXTRACTION_ATTEMPTS } from "./constants";
import { buildPromptHash, extractClinicalTranscript } from "./extract";
import { loadExtractionSchema, validateExtraction } from "./schema";

const validExtraction: ClinicalExtraction = {
  chief_complaint: "sore throat and congestion",
  vitals: { bp: "122/78", hr: 88, temp_f: 100.4, spo2: 98 },
  medications: [{ name: "ibuprofen", dose: "400 mg", frequency: "every 6 hours as needed", route: "PO" }],
  diagnoses: [{ description: "viral upper respiratory infection", icd10: "J06.9" }],
  plan: ["supportive care", "ibuprofen as needed"],
  follow_up: { interval_days: null, reason: "if symptoms worsen" },
};

function toolResponse(input: unknown, usage: Record<string, number> = {}) {
  return {
    content: [
      {
        type: "tool_use",
        id: "toolu_001",
        name: EXTRACTION_TOOL_NAME,
        input,
      },
    ],
    usage: {
      input_tokens: usage.input_tokens ?? 10,
      output_tokens: usage.output_tokens ?? 20,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    },
  };
}

function textResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: 3, output_tokens: 4 },
  };
}

function groqToolResponse(input: unknown, usage: Record<string, number> = {}) {
  return {
    choices: [
      {
        message: {
          tool_calls: [
            {
              type: "function",
              function: {
                name: EXTRACTION_TOOL_NAME,
                arguments: JSON.stringify(input),
              },
            },
          ],
        },
      },
    ],
    usage: {
      prompt_tokens: usage.prompt_tokens ?? 11,
      completion_tokens: usage.completion_tokens ?? 21,
    },
  };
}

function createMockClient(responses: unknown[], provider: LlmMessagesClient["provider"] = "anthropic"): LlmMessagesClient & { requests: unknown[] } {
  const requests: unknown[] = [];

  return {
    provider,
    requests,
    async create(request: unknown) {
      requests.push(request);
      const response = responses.shift();
      if (response === undefined) {
        throw new Error("No mock response available.");
      }
      return response;
    },
  };
}

function requestText(request: unknown): string {
  return JSON.stringify(request);
}

describe("validateExtraction", () => {
  test("accepts a schema-conformant extraction", () => {
    const result = validateExtraction(validExtraction);

    expect(result.schemaValid).toBe(true);
    expect(result.validationErrors).toEqual([]);
    expect(result.extraction).toEqual(validExtraction);
  });

  test("returns schema issues for invalid extraction objects", () => {
    const result = validateExtraction({ ...validExtraction, follow_up: undefined });

    expect(result.schemaValid).toBe(false);
    expect(result.extraction).toBeNull();
    expect(result.validationErrors.some((issue) => issue.keyword === "required")).toBe(true);
  });
});

describe("extractClinicalTranscript", () => {
  test("extracts only the Anthropic tool input", async () => {
    const client = createMockClient([toolResponse(validExtraction)]);

    const result = await extractClinicalTranscript({
      caseId: "case_001",
      transcriptId: "case_001",
      transcript: "Patient has sore throat and congestion.",
      strategy: "zero_shot",
      client,
    });

    expect(result.schemaValid).toBe(true);
    expect(result.extraction).toEqual(validExtraction);
    expect(result.attempts).toHaveLength(1);
    expect(requestText(client.requests[0]).includes(EXTRACTION_TOOL_NAME)).toBe(true);
  });

  test("does not accept raw JSON-looking assistant prose as extraction", async () => {
    const client = createMockClient([
      textResponse(JSON.stringify(validExtraction)),
      textResponse(JSON.stringify(validExtraction)),
      textResponse(JSON.stringify(validExtraction)),
    ]);

    const result = await extractClinicalTranscript({
      caseId: "case_001",
      transcriptId: "case_001",
      transcript: "Patient has sore throat and congestion.",
      strategy: "zero_shot",
      client,
    });

    expect(result.schemaValid).toBe(false);
    expect(result.extraction).toBeNull();
    expect(result.attempts).toHaveLength(MAX_EXTRACTION_ATTEMPTS);
  });

  test("retries with validation feedback and then succeeds", async () => {
    const invalidExtraction = { ...validExtraction, follow_up: undefined };
    const client = createMockClient([toolResponse(invalidExtraction), toolResponse(validExtraction)]);

    const result = await extractClinicalTranscript({
      caseId: "case_001",
      transcriptId: "case_001",
      transcript: "Patient has sore throat and congestion.",
      strategy: "few_shot",
      client,
    });

    expect(result.schemaValid).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(requestText(client.requests[1]).includes("Validation errors")).toBe(true);
    expect(requestText(client.requests[1]).includes("follow_up")).toBe(true);
  });

  test("caps validation retries at three attempts", async () => {
    const invalidExtraction = { ...validExtraction, follow_up: undefined };
    const client = createMockClient([
      toolResponse(invalidExtraction),
      toolResponse(invalidExtraction),
      toolResponse(invalidExtraction),
    ]);

    const result = await extractClinicalTranscript({
      caseId: "case_001",
      transcriptId: "case_001",
      transcript: "Patient has sore throat and congestion.",
      strategy: "cot",
      client,
    });

    expect(result.schemaValid).toBe(false);
    expect(result.validationErrors.length).toBeGreaterThan(0);
    expect(result.attempts).toHaveLength(3);
  });

  test("maps token usage and cache read verification", async () => {
    const client = createMockClient([
      toolResponse(validExtraction, {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 25,
        cache_creation_input_tokens: 10,
      }),
    ]);

    const result = await extractClinicalTranscript({
      caseId: "case_001",
      transcriptId: "case_001",
      transcript: "Patient has sore throat and congestion.",
      strategy: "zero_shot",
      model: DEFAULT_MODEL,
      client,
    });

    expect(result.tokenUsage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 25,
      cacheWriteInputTokens: 10,
    });
    expect(result.attempts[0]?.cacheReadVerified).toBe(true);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  test("supports Groq function tool calls and OpenAI-compatible usage", async () => {
    const client = createMockClient([groqToolResponse(validExtraction)], "groq");

    const result = await extractClinicalTranscript({
      caseId: "case_001",
      transcriptId: "case_001",
      transcript: "Patient has sore throat and congestion.",
      strategy: "zero_shot",
      model: "llama-3.1-8b-instant",
      client,
    });

    expect(result.schemaValid).toBe(true);
    expect(result.extraction).toEqual(validExtraction);
    expect(requestText(client.requests[0]).includes('"tool_choice"')).toBe(true);
    expect(result.tokenUsage).toEqual({
      inputTokens: 11,
      outputTokens: 21,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
    });
  });
});

describe("buildPromptHash", () => {
  test("is stable for equivalent prompt inputs", () => {
    const schema = loadExtractionSchema();
    const first = buildPromptHash({ strategy: "zero_shot", stableParts: { system: "same" }, schema });
    const second = buildPromptHash({ strategy: "zero_shot", stableParts: { system: "same" }, schema });

    expect(first).toBe(second);
  });

  test("changes when prompt content changes", () => {
    const schema = loadExtractionSchema();
    const first = buildPromptHash({ strategy: "zero_shot", stableParts: { system: "same" }, schema });
    const second = buildPromptHash({ strategy: "zero_shot", stableParts: { system: "changed" }, schema });

    expect(first).not.toBe(second);
  });
});
