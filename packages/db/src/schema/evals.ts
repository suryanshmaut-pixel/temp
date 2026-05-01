import type {
  CaseEvaluation,
  DatasetFilter,
  ExtractionResult,
  FieldEvaluation,
  PromptStrategy,
  RunStatus,
  TokenUsage,
} from "@test-evals/shared";
import { relations } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const evalRuns = pgTable(
  "eval_runs",
  {
    id: text("id").primaryKey(),
    strategy: text("strategy").$type<PromptStrategy>().notNull(),
    model: text("model").notNull(),
    promptHash: text("prompt_hash").notNull(),
    status: text("status").$type<RunStatus>().notNull(),
    startedAt: timestamp("started_at").notNull(),
    completedAt: timestamp("completed_at"),
    durationMs: integer("duration_ms"),
    totalCases: integer("total_cases").notNull(),
    completedCases: integer("completed_cases").default(0).notNull(),
    failedCases: integer("failed_cases").default(0).notNull(),
    schemaFailureCount: integer("schema_failure_count").default(0).notNull(),
    hallucinationCount: integer("hallucination_count").default(0).notNull(),
    aggregateScore: doublePrecision("aggregate_score"),
    aggregateF1: doublePrecision("aggregate_f1"),
    fieldAggregates: jsonb("field_aggregates").$type<FieldEvaluation[]>().default([]).notNull(),
    tokenUsage: jsonb("token_usage").$type<TokenUsage>().notNull(),
    totalCostUsd: doublePrecision("total_cost_usd").default(0).notNull(),
    cacheReadVerified: boolean("cache_read_verified").default(false).notNull(),
    datasetFilter: jsonb("dataset_filter").$type<DatasetFilter>(),
    error: text("error"),
  },
  (table) => [
    index("eval_runs_status_idx").on(table.status),
    index("eval_runs_started_at_idx").on(table.startedAt),
  ],
);

export const extractionResults = pgTable(
  "extraction_results",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    transcriptId: text("transcript_id").notNull(),
    runId: text("run_id").references(() => evalRuns.id, { onDelete: "set null" }),
    strategy: text("strategy").$type<PromptStrategy>().notNull(),
    model: text("model").notNull(),
    promptHash: text("prompt_hash").notNull(),
    extraction: jsonb("extraction").$type<ExtractionResult["extraction"]>(),
    schemaValid: boolean("schema_valid").notNull(),
    validationErrors: jsonb("validation_errors").$type<ExtractionResult["validationErrors"]>().default([]).notNull(),
    attempts: jsonb("attempts").$type<ExtractionResult["attempts"]>().default([]).notNull(),
    tokenUsage: jsonb("token_usage").$type<TokenUsage>().notNull(),
    latencyMs: integer("latency_ms").notNull(),
    costUsd: doublePrecision("cost_usd").notNull(),
    cached: boolean("cached").default(false).notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("extraction_results_run_id_idx").on(table.runId),
    index("extraction_results_cache_key_idx").on(
      table.strategy,
      table.model,
      table.transcriptId,
      table.promptHash,
    ),
  ],
);

export const caseEvaluations = pgTable(
  "case_evaluations",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    transcriptId: text("transcript_id").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => evalRuns.id, { onDelete: "cascade" }),
    extractionResultId: text("extraction_result_id").references(() => extractionResults.id, {
      onDelete: "set null",
    }),
    schemaValid: boolean("schema_valid").notNull(),
    fieldScores: jsonb("field_scores").$type<CaseEvaluation["fieldScores"]>().default([]).notNull(),
    aggregateScore: doublePrecision("aggregate_score").notNull(),
    aggregateF1: doublePrecision("aggregate_f1").notNull(),
    hallucinations: jsonb("hallucinations").$type<CaseEvaluation["hallucinations"]>().default([]).notNull(),
    hallucinationCount: integer("hallucination_count").notNull(),
    gold: jsonb("gold").$type<CaseEvaluation["gold"]>().notNull(),
    prediction: jsonb("prediction").$type<CaseEvaluation["prediction"]>(),
    evaluatedAt: timestamp("evaluated_at").notNull(),
  },
  (table) => [
    index("case_evaluations_run_id_idx").on(table.runId),
    uniqueIndex("case_evaluations_run_case_idx").on(table.runId, table.caseId),
  ],
);

export const evalRunRelations = relations(evalRuns, ({ many }) => ({
  extractionResults: many(extractionResults),
  caseEvaluations: many(caseEvaluations),
}));

export const extractionResultRelations = relations(extractionResults, ({ one, many }) => ({
  run: one(evalRuns, {
    fields: [extractionResults.runId],
    references: [evalRuns.id],
  }),
  caseEvaluations: many(caseEvaluations),
}));

export const caseEvaluationRelations = relations(caseEvaluations, ({ one }) => ({
  run: one(evalRuns, {
    fields: [caseEvaluations.runId],
    references: [evalRuns.id],
  }),
  extractionResult: one(extractionResults, {
    fields: [caseEvaluations.extractionResultId],
    references: [extractionResults.id],
  }),
}));
