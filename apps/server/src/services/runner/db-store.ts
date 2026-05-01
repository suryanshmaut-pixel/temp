import { db } from "@test-evals/db";
import { caseEvaluations, evalRuns, extractionResults } from "@test-evals/db/schema/index";
import type { CaseEvaluation, DatasetFilter, ExtractionResult, RunStatus, RunSummary } from "@test-evals/shared";
import { and, desc, eq } from "drizzle-orm";

import type { CreateRunRecordInput, ExtractionCacheKey, RunnerStore } from "./store";

function isoToDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function dateToIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function runRowToSummary(row: typeof evalRuns.$inferSelect): RunSummary {
  return {
    id: row.id,
    strategy: row.strategy,
    model: row.model,
    promptHash: row.promptHash,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    completedAt: dateToIso(row.completedAt),
    durationMs: row.durationMs,
    totalCases: row.totalCases,
    completedCases: row.completedCases,
    failedCases: row.failedCases,
    schemaFailureCount: row.schemaFailureCount,
    hallucinationCount: row.hallucinationCount,
    aggregateScore: row.aggregateScore,
    aggregateF1: row.aggregateF1,
    fieldAggregates: row.fieldAggregates,
    tokenUsage: row.tokenUsage,
    totalCostUsd: row.totalCostUsd,
    cacheReadVerified: row.cacheReadVerified,
    error: row.error ?? undefined,
  };
}

function extractionRowToResult(row: typeof extractionResults.$inferSelect): ExtractionResult & { id: string } {
  return {
    id: row.id,
    caseId: row.caseId,
    transcriptId: row.transcriptId,
    runId: row.runId ?? undefined,
    strategy: row.strategy,
    model: row.model,
    promptHash: row.promptHash,
    extraction: row.extraction,
    schemaValid: row.schemaValid,
    validationErrors: row.validationErrors,
    attempts: row.attempts,
    tokenUsage: row.tokenUsage,
    latencyMs: row.latencyMs,
    costUsd: row.costUsd,
    cached: row.cached,
    createdAt: row.createdAt.toISOString(),
  };
}

function evaluationRowToCase(row: typeof caseEvaluations.$inferSelect): CaseEvaluation {
  return {
    caseId: row.caseId,
    transcriptId: row.transcriptId,
    runId: row.runId,
    extractionResultId: row.extractionResultId ?? undefined,
    schemaValid: row.schemaValid,
    fieldScores: row.fieldScores,
    aggregateScore: row.aggregateScore,
    aggregateF1: row.aggregateF1,
    hallucinations: row.hallucinations,
    hallucinationCount: row.hallucinationCount,
    gold: row.gold,
    prediction: row.prediction,
    evaluatedAt: row.evaluatedAt.toISOString(),
  };
}

export class DbRunnerStore implements RunnerStore {
  async createRun(input: CreateRunRecordInput): Promise<RunSummary> {
    const startedAt = new Date();
    const rows = await db
      .insert(evalRuns)
      .values({
        id: input.id,
        strategy: input.strategy,
        model: input.model,
        promptHash: input.promptHash,
        status: "queued",
        startedAt,
        totalCases: input.totalCases,
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheWriteInputTokens: 0,
        },
        datasetFilter: input.datasetFilter,
      })
      .returning();

    const row = rows[0];
    if (row === undefined) {
      throw new Error("Failed to create run.");
    }

    return runRowToSummary(row);
  }

  async updateRun(summary: RunSummary): Promise<void> {
    await db
      .update(evalRuns)
      .set({
        status: summary.status,
        completedAt: isoToDate(summary.completedAt),
        durationMs: summary.durationMs,
        completedCases: summary.completedCases,
        failedCases: summary.failedCases,
        schemaFailureCount: summary.schemaFailureCount,
        hallucinationCount: summary.hallucinationCount,
        aggregateScore: summary.aggregateScore,
        aggregateF1: summary.aggregateF1,
        fieldAggregates: summary.fieldAggregates,
        tokenUsage: summary.tokenUsage,
        totalCostUsd: summary.totalCostUsd,
        cacheReadVerified: summary.cacheReadVerified,
        error: summary.error,
      })
      .where(eq(evalRuns.id, summary.id));
  }

  async getRun(runId: string): Promise<RunSummary | null> {
    const rows = await db.select().from(evalRuns).where(eq(evalRuns.id, runId)).limit(1);
    return rows[0] === undefined ? null : runRowToSummary(rows[0]);
  }

  async listRuns(): Promise<RunSummary[]> {
    const rows = await db.select().from(evalRuns).orderBy(desc(evalRuns.startedAt));
    return rows.map(runRowToSummary);
  }

  async getRunDatasetFilter(runId: string): Promise<DatasetFilter | undefined> {
    const rows = await db
      .select({ datasetFilter: evalRuns.datasetFilter })
      .from(evalRuns)
      .where(eq(evalRuns.id, runId))
      .limit(1);
    return rows[0]?.datasetFilter ?? undefined;
  }

  async setRunStatus(runId: string, status: RunStatus, error?: string): Promise<void> {
    await db.update(evalRuns).set({ status, error }).where(eq(evalRuns.id, runId));
  }

  async findCachedExtraction(key: ExtractionCacheKey): Promise<(ExtractionResult & { id: string }) | null> {
    const rows = await db
      .select()
      .from(extractionResults)
      .where(
        and(
          eq(extractionResults.strategy, key.strategy),
          eq(extractionResults.model, key.model),
          eq(extractionResults.transcriptId, key.transcriptId),
          eq(extractionResults.promptHash, key.promptHash),
        ),
      )
      .limit(1);
    return rows[0] === undefined ? null : extractionRowToResult(rows[0]);
  }

  async getExtraction(id: string): Promise<(ExtractionResult & { id: string }) | null> {
    const rows = await db.select().from(extractionResults).where(eq(extractionResults.id, id)).limit(1);
    return rows[0] === undefined ? null : extractionRowToResult(rows[0]);
  }

  async saveExtraction(result: ExtractionResult): Promise<string> {
    const id = crypto.randomUUID();
    await db.insert(extractionResults).values({
      id,
      caseId: result.caseId,
      transcriptId: result.transcriptId,
      runId: result.runId,
      strategy: result.strategy,
      model: result.model,
      promptHash: result.promptHash,
      extraction: result.extraction,
      schemaValid: result.schemaValid,
      validationErrors: result.validationErrors,
      attempts: result.attempts,
      tokenUsage: result.tokenUsage,
      latencyMs: result.latencyMs,
      costUsd: result.costUsd,
      cached: result.cached,
      createdAt: new Date(result.createdAt),
    });
    return id;
  }

  async saveEvaluation(evaluation: CaseEvaluation): Promise<string> {
    const id = crypto.randomUUID();
    await db.insert(caseEvaluations).values({
      id,
      caseId: evaluation.caseId,
      transcriptId: evaluation.transcriptId,
      runId: evaluation.runId,
      extractionResultId: evaluation.extractionResultId,
      schemaValid: evaluation.schemaValid,
      fieldScores: evaluation.fieldScores,
      aggregateScore: evaluation.aggregateScore,
      aggregateF1: evaluation.aggregateF1,
      hallucinations: evaluation.hallucinations,
      hallucinationCount: evaluation.hallucinationCount,
      gold: evaluation.gold,
      prediction: evaluation.prediction,
      evaluatedAt: new Date(evaluation.evaluatedAt),
    });
    return id;
  }

  async listEvaluations(runId: string): Promise<CaseEvaluation[]> {
    const rows = await db.select().from(caseEvaluations).where(eq(caseEvaluations.runId, runId));
    return rows.map(evaluationRowToCase);
  }

  async getEvaluation(runId: string, caseId: string): Promise<CaseEvaluation | null> {
    const rows = await db
      .select()
      .from(caseEvaluations)
      .where(and(eq(caseEvaluations.runId, runId), eq(caseEvaluations.caseId, caseId)))
      .limit(1);
    return rows[0] === undefined ? null : evaluationRowToCase(rows[0]);
  }
}
