import { afterEach, describe, expect, test } from "bun:test";

import { createGroqMessagesClient } from "./client";
import { EXTRACTION_TOOL_NAME } from "./constants";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createGroqMessagesClient", () => {
  test("turns Groq failed_generation tool-call errors into retryable tool responses", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "tool call validation failed",
            type: "invalid_request_error",
            code: "tool_use_failed",
            failed_generation: `<function=${EXTRACTION_TOOL_NAME}> {"diagnoses":[{"description":"IBS flare","icd10":null}]} </function>`,
          },
        }),
        { status: 400 },
      );

    const client = await createGroqMessagesClient("test-key");
    const response = (await client.create({ model: "llama-3.1-8b-instant" })) as {
      choices: Array<{ message: { tool_calls: Array<{ function: { name: string; arguments: string } }> } }>;
    };

    const toolCall = response.choices[0]?.message.tool_calls[0];
    expect(toolCall?.function.name).toBe(EXTRACTION_TOOL_NAME);
    expect(JSON.parse(toolCall?.function.arguments ?? "{}")).toEqual({
      diagnoses: [{ description: "IBS flare", icd10: null }],
    });
  });
});
