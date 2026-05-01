import type { CaseEvaluation, DatasetFilter, ExtractionResult, RunStatus, RunSummary } from "@test-evals/shared";

import type { CreateRunRecordInput, ExtractionCacheKey, RunnerStore } from "./store";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryRunnerStore implements RunnerStore {
  readonly runs = new Map<string, RunSummary>();
  readonly datasetFilters = new Map<string, DatasetFilter | undefined>();
  readonly extractions = new Map<string, ExtractionResult & { id: string }>();
  readonly evaluations = new Map<string, CaseEvaluation & { id: string }>();

  async createRun(input: CreateRunRecordInput): Promise<RunSummary> {
    const startedAt = new Date().toISOString();
    const summary: RunSummary = {
      id: input.id,
      strategy: input.strategy,
      model: input.model,
      promptHash: input.promptHash,
      status: "queued",
      startedAt,
      completedAt: null,
      durationMs: null,
      totalCases: input.totalCases,
      completedCases: 0,
      failedCases: 0,
      schemaFailureCount: 0,
      hallucinationCount: 0,
      aggregateScore: null,
      aggregateF1: null,
      fieldAggregates: [],
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
      totalCostUsd: 0,
      cacheReadVerified: false,
    };

    this.runs.set(input.id, clone(summary));
    this.datasetFilters.set(input.id, input.datasetFilter);
    return summary;
  }

  async updateRun(summary: RunSummary): Promise<void> {
    this.runs.set(summary.id, clone(summary));
  }

  async getRun(runId: string): Promise<RunSummary | null> {
    const run = this.runs.get(runId);
    return run === undefined ? null : clone(run);
  }

  async listRuns(): Promise<RunSummary[]> {
    return Array.from(this.runs.values()).map(clone);
  }

  async getRunDatasetFilter(runId: string): Promise<DatasetFilter | undefined> {
    return this.datasetFilters.get(runId);
  }

  async setRunStatus(runId: string, status: RunStatus, error?: string): Promise<void> {
    const run = this.runs.get(runId);
    if (run !== undefined) {
      this.runs.set(runId, { ...run, status, error });
    }
  }

  async findCachedExtraction(key: ExtractionCacheKey): Promise<(ExtractionResult & { id: string }) | null> {
    const match = Array.from(this.extractions.values()).find(
      (item) =>
        item.strategy === key.strategy &&
        item.model === key.model &&
        item.transcriptId === key.transcriptId &&
        item.promptHash === key.promptHash,
    );

    return match === undefined ? null : clone(match);
  }

  async getExtraction(id: string): Promise<(ExtractionResult & { id: string }) | null> {
    const extraction = this.extractions.get(id);
    return extraction === undefined ? null : clone(extraction);
  }

  async saveExtraction(result: ExtractionResult): Promise<string> {
    const id = crypto.randomUUID();
    this.extractions.set(id, { ...clone(result), id });
    return id;
  }

  async saveEvaluation(evaluation: CaseEvaluation): Promise<string> {
    const id = crypto.randomUUID();
    this.evaluations.set(id, { ...clone(evaluation), id });
    return id;
  }

  async listEvaluations(runId: string): Promise<CaseEvaluation[]> {
    return Array.from(this.evaluations.values())
      .filter((item) => item.runId === runId)
      .map(({ id: _id, ...evaluation }) => clone(evaluation));
  }

  async getEvaluation(runId: string, caseId: string): Promise<CaseEvaluation | null> {
    const match = Array.from(this.evaluations.values()).find(
      (item) => item.runId === runId && item.caseId === caseId,
    );
    if (match === undefined) {
      return null;
    }
    const { id: _id, ...evaluation } = match;
    return clone(evaluation);
  }
}
