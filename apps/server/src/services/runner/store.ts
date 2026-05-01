import type {
  CaseEvaluation,
  DatasetFilter,
  ExtractionResult,
  PromptStrategy,
  RunStatus,
  RunSummary,
} from "@test-evals/shared";

export interface CreateRunRecordInput {
  id: string;
  strategy: PromptStrategy;
  model: string;
  promptHash: string;
  totalCases: number;
  datasetFilter?: DatasetFilter;
}

export interface ExtractionCacheKey {
  strategy: PromptStrategy;
  model: string;
  transcriptId: string;
  promptHash: string;
}

export interface RunnerStore {
  createRun(input: CreateRunRecordInput): Promise<RunSummary>;
  updateRun(summary: RunSummary): Promise<void>;
  getRun(runId: string): Promise<RunSummary | null>;
  listRuns(): Promise<RunSummary[]>;
  getRunDatasetFilter(runId: string): Promise<DatasetFilter | undefined>;
  setRunStatus(runId: string, status: RunStatus, error?: string): Promise<void>;
  findCachedExtraction(key: ExtractionCacheKey): Promise<(ExtractionResult & { id: string }) | null>;
  getExtraction(id: string): Promise<(ExtractionResult & { id: string }) | null>;
  saveExtraction(result: ExtractionResult): Promise<string>;
  saveEvaluation(evaluation: CaseEvaluation): Promise<string>;
  listEvaluations(runId: string): Promise<CaseEvaluation[]>;
  getEvaluation(runId: string, caseId: string): Promise<CaseEvaluation | null>;
}
