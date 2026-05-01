import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClinicalExtraction, ExtractionResult, PromptStrategy, TokenUsage } from "@test-evals/shared";

import { DEFAULT_MODEL } from "@test-evals/llm";
import { loadDataset } from "../dataset.service";
import { RateLimitError, RunnerService } from "../runner.service";
import { RunEventBus } from "../runner/events";
import { MemoryRunnerStore } from "../runner/memory-store";

const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
};

function goldFor(caseId: string): ClinicalExtraction {
  const datasetCase = loadDataset({ caseIds: [caseId] })[0];
  if (datasetCase === undefined) {
    throw new Error(`Missing dataset case ${caseId}.`);
  }
  return datasetCase.gold;
}

function extractionFor(input: {
  caseId: string;
  transcriptId: string;
  runId: string;
  strategy: PromptStrategy;
  model: string;
}): ExtractionResult {
  return {
    caseId: input.caseId,
    transcriptId: input.transcriptId,
    runId: input.runId,
    strategy: input.strategy,
    model: input.model,
    promptHash: "runner-overwrites-this",
    extraction: goldFor(input.caseId),
    schemaValid: true,
    validationErrors: [],
    attempts: [],
    tokenUsage: {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadInputTokens: 2,
      cacheWriteInputTokens: 1,
    },
    latencyMs: 1,
    costUsd: 0.0001,
    cached: false,
    createdAt: new Date().toISOString(),
  };
}

async function waitForRun(store: MemoryRunnerStore, runId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const run = await store.getRun(runId);
    if (run?.status === "completed" || run?.status === "failed") {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for run.");
}

describe("loadDataset", () => {
  test("pairs transcript and gold files deterministically with filters", () => {
    const cases = loadDataset({ caseIds: ["case_002", "case_001"], limit: 1 });

    expect(cases).toHaveLength(1);
    expect(cases[0]?.caseId).toBe("case_001");
    expect(cases[0]?.transcript).toContain("sore throat");
    expect(cases[0]?.gold.chief_complaint).toContain("sore throat");
  });

  test("loads the repo-level dataset when the server package is the working directory", () => {
    const originalCwd = process.cwd();
    const testDir = fileURLToPath(new URL(".", import.meta.url));
    const serverDir = join(testDir, "..", "..", "..");

    try {
      process.chdir(serverDir);
      const cases = loadDataset({ caseIds: ["case_001"] });

      expect(cases).toHaveLength(1);
      expect(cases[0]?.caseId).toBe("case_001");
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe("RunnerService", () => {
  test("runs one case through extraction, evaluation, and aggregation", async () => {
    const store = new MemoryRunnerStore();
    const runner = new RunnerService({
      store,
      eventBus: new RunEventBus(),
      extractor: async (input) => extractionFor(input),
      concurrency: 1,
    });

    const summary = await runner.runSync({
      strategy: "zero_shot",
      model: DEFAULT_MODEL,
      dataset_filter: { caseIds: ["case_001"] },
    });

    const cases = await runner.listCases(summary.id);
    expect(summary.status).toBe("completed");
    expect(summary.completedCases).toBe(1);
    expect(summary.aggregateScore).toBe(1);
    expect(summary.aggregateF1).toBe(1);
    expect(summary.hallucinationCount).toBe(0);
    expect(summary.tokenUsage.inputTokens).toBe(10);
    expect(summary.cacheReadVerified).toBe(true);
    expect(cases[0]?.aggregateScore).toBe(1);
  });

  test("uses cached extraction on repeated prompt/model/transcript without force", async () => {
    const store = new MemoryRunnerStore();
    let calls = 0;
    const runner = new RunnerService({
      store,
      eventBus: new RunEventBus(),
      extractor: async (input) => {
        calls += 1;
        return extractionFor(input);
      },
      concurrency: 1,
    });

    await runner.runSync({
      strategy: "zero_shot",
      model: DEFAULT_MODEL,
      dataset_filter: { caseIds: ["case_001"] },
    });
    const second = await runner.runSync({
      strategy: "zero_shot",
      model: DEFAULT_MODEL,
      dataset_filter: { caseIds: ["case_001"] },
    });

    expect(calls).toBe(1);
    expect(second.completedCases).toBe(1);
    expect((await runner.listCases(second.id))[0]?.aggregateScore).toBe(1);
  });

  test("does not reuse cached schema-invalid extractions", async () => {
    const store = new MemoryRunnerStore();
    let calls = 0;
    const runner = new RunnerService({
      store,
      eventBus: new RunEventBus(),
      extractor: async (input) => {
        calls += 1;
        if (calls === 1) {
          return {
            ...extractionFor(input),
            extraction: null,
            schemaValid: false,
            validationErrors: [{ path: "/diagnoses/0/icd10", message: "expected string, but got null" }],
            tokenUsage: ZERO_USAGE,
          };
        }
        return extractionFor(input);
      },
      concurrency: 1,
    });

    await runner.runSync({
      strategy: "zero_shot",
      model: DEFAULT_MODEL,
      dataset_filter: { caseIds: ["case_001"] },
    });
    const second = await runner.runSync({
      strategy: "zero_shot",
      model: DEFAULT_MODEL,
      dataset_filter: { caseIds: ["case_001"] },
    });

    expect(calls).toBe(2);
    expect(second.schemaFailureCount).toBe(0);
    expect((await runner.listCases(second.id))[0]?.prediction).not.toBeNull();
  });

  test("resumes a failed run without reprocessing completed cases", async () => {
    const store = new MemoryRunnerStore();
    const seen: string[] = [];
    let failOnce = true;
    const runner = new RunnerService({
      store,
      eventBus: new RunEventBus(),
      extractor: async (input) => {
        seen.push(input.caseId);
        if (input.caseId === "case_002" && failOnce) {
          failOnce = false;
          throw new Error("simulated crash");
        }
        return extractionFor(input);
      },
      concurrency: 1,
    });

    const failed = await runner.runSync({
      strategy: "zero_shot",
      dataset_filter: { caseIds: ["case_001", "case_002"] },
      force: true,
    });
    expect(failed.status).toBe("failed");
    expect(failed.completedCases).toBe(1);

    await runner.resumeRun(failed.id);
    const completed = await waitForRun(store, failed.id);

    expect(completed.status).toBe("completed");
    expect(completed.completedCases).toBe(2);
    expect(seen.filter((caseId) => caseId === "case_001")).toHaveLength(1);
    expect(seen.filter((caseId) => caseId === "case_002")).toHaveLength(2);
  });

  test("limits concurrent case extraction", async () => {
    const store = new MemoryRunnerStore();
    let active = 0;
    let maxActive = 0;
    const runner = new RunnerService({
      store,
      eventBus: new RunEventBus(),
      concurrency: 2,
      extractor: async (input) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return extractionFor(input);
      },
    });

    await runner.runSync({
      strategy: "zero_shot",
      dataset_filter: { limit: 5 },
      force: true,
    });

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  test("backs off and retries rate-limit errors", async () => {
    const store = new MemoryRunnerStore();
    const sleeps: number[] = [];
    let calls = 0;
    const runner = new RunnerService({
      store,
      eventBus: new RunEventBus(),
      concurrency: 1,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      extractor: async (input) => {
        calls += 1;
        if (calls === 1) {
          throw new RateLimitError();
        }
        return extractionFor(input);
      },
    });

    const summary = await runner.runSync({
      strategy: "zero_shot",
      dataset_filter: { caseIds: ["case_001"] },
      force: true,
    });

    expect(summary.status).toBe("completed");
    expect(calls).toBe(2);
    expect(sleeps.length).toBeGreaterThanOrEqual(1);
  });

  test("aggregates schema failures from invalid extractions", async () => {
    const store = new MemoryRunnerStore();
    const runner = new RunnerService({
      store,
      eventBus: new RunEventBus(),
      concurrency: 1,
      extractor: async (input) => ({
        ...extractionFor(input),
        extraction: null,
        schemaValid: false,
        validationErrors: [{ path: "/", message: "invalid", keyword: "required" }],
        tokenUsage: ZERO_USAGE,
      }),
    });

    const summary = await runner.runSync({
      strategy: "zero_shot",
      dataset_filter: { caseIds: ["case_001"] },
      force: true,
    });

    expect(summary.schemaFailureCount).toBe(1);
    expect(summary.failedCases).toBe(1);
    expect(summary.aggregateScore).toBe(0);
  });
});
