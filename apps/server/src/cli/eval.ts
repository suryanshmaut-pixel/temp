import { DEFAULT_MODEL } from "@test-evals/llm";
import type { ClinicalExtraction, ExtractionResult, PromptStrategy, StartRunRequest } from "@test-evals/shared";
import { existsSync, readFileSync } from "node:fs";

import { RunnerService } from "../services/runner.service";
import { MemoryRunnerStore } from "../services/runner/memory-store";

function loadServerEnv(): void {
  const envPath = "apps/server/.env";
  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/gu, "");
    process.env[key] ??= value;
  }
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return Bun.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function parseStrategy(value: string | undefined): PromptStrategy {
  if (value === "zero_shot" || value === "few_shot" || value === "cot") {
    return value;
  }

  return "zero_shot";
}

const strategy = parseStrategy(argValue("strategy"));
const model = argValue("model") ?? DEFAULT_MODEL;
const limit = argValue("limit");
const force = argValue("force") === "true";
const demo = argValue("demo") === "true";
const memory = argValue("memory") === "true";

const request: StartRunRequest = {
  strategy,
  model,
  force,
  dataset_filter: limit === undefined ? undefined : { limit: Number(limit) },
};

function demoExtraction(input: {
  caseId: string;
  transcriptId: string;
  runId: string;
  strategy: PromptStrategy;
  model: string;
}): ExtractionResult {
  const gold = JSON.parse(readFileSync(`data/gold/${input.caseId}.json`, "utf8")) as ClinicalExtraction;

  return {
    caseId: input.caseId,
    transcriptId: input.transcriptId,
    runId: input.runId,
    strategy: input.strategy,
    model: input.model,
    promptHash: "demo",
    extraction: gold,
    schemaValid: true,
    validationErrors: [],
    attempts: [
      {
        attempt: 1,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        model: input.model,
        strategy: input.strategy,
        promptHash: "demo",
        request: { demo: true },
        response: { demo: true },
        extracted: gold,
        schemaValid: true,
        validationErrors: [],
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheWriteInputTokens: 0,
        },
        cacheReadVerified: false,
        latencyMs: 0,
      },
    ],
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
    },
    latencyMs: 0,
    costUsd: 0,
    cached: false,
    createdAt: new Date().toISOString(),
  };
}

if (!memory) {
  loadServerEnv();
}

const store = memory ? new MemoryRunnerStore() : new (await import("../services/runner/db-store")).DbRunnerStore();

const runner = new RunnerService({
  store,
  extractor: demo ? async (input) => demoExtraction(input) : undefined,
});
const summary = await runner.runSync(request);

console.table([
  {
    runId: summary.id,
    strategy: summary.strategy,
    model: summary.model,
    status: summary.status,
    cases: `${summary.completedCases}/${summary.totalCases}`,
    aggregateScore: summary.aggregateScore?.toFixed(3) ?? "n/a",
    aggregateF1: summary.aggregateF1?.toFixed(3) ?? "n/a",
    schemaFailures: summary.schemaFailureCount,
    hallucinations: summary.hallucinationCount,
    costUsd: summary.totalCostUsd.toFixed(4),
  },
]);
