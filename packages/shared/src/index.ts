export type PromptStrategy = "zero_shot" | "few_shot" | "cot";

export type RunStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

export interface ClinicalVitals {
  bp: string | null;
  hr: number | null;
  temp_f: number | null;
  spo2: number | null;
}

export interface ClinicalMedication {
  name: string;
  dose: string | null;
  frequency: string | null;
  route: string | null;
}

export interface ClinicalDiagnosis {
  description: string;
  icd10?: string;
}

export interface ClinicalFollowUp {
  interval_days: number | null;
  reason: string | null;
}

export interface ClinicalExtraction {
  chief_complaint: string;
  vitals: ClinicalVitals;
  medications: ClinicalMedication[];
  diagnoses: ClinicalDiagnosis[];
  plan: string[];
  follow_up: ClinicalFollowUp;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
}

export interface SchemaValidationIssue {
  path: string;
  message: string;
  keyword?: string;
}

export interface LLMAttemptTrace {
  attempt: number;
  startedAt: string;
  completedAt: string;
  model: string;
  strategy: PromptStrategy;
  promptHash: string;
  request: unknown;
  response: unknown;
  extracted: ClinicalExtraction | null;
  schemaValid: boolean;
  validationErrors: SchemaValidationIssue[];
  tokenUsage: TokenUsage;
  cacheReadVerified: boolean;
  latencyMs: number;
  error?: string;
}

export interface ExtractionResult {
  caseId: string;
  transcriptId: string;
  runId?: string;
  strategy: PromptStrategy;
  model: string;
  promptHash: string;
  extraction: ClinicalExtraction | null;
  schemaValid: boolean;
  validationErrors: SchemaValidationIssue[];
  attempts: LLMAttemptTrace[];
  tokenUsage: TokenUsage;
  latencyMs: number;
  costUsd: number;
  cached: boolean;
  createdAt: string;
}

export type EvaluatedField =
  | "chief_complaint"
  | "vitals"
  | "vitals.bp"
  | "vitals.hr"
  | "vitals.temp_f"
  | "vitals.spo2"
  | "medications"
  | "diagnoses"
  | "plan"
  | "follow_up"
  | "follow_up.interval_days"
  | "follow_up.reason";

export interface PrecisionRecallF1 {
  precision: number;
  recall: number;
  f1: number;
}

export interface FieldEvaluation {
  field: EvaluatedField;
  score: number;
  metric: "exact" | "numeric_tolerance" | "fuzzy" | "set_f1" | "composite";
  precision?: number;
  recall?: number;
  f1?: number;
  details?: string;
}

export interface HallucinationFinding {
  field: EvaluatedField;
  value: string;
  supported: false;
  evidence?: string;
  reason: string;
}

export interface CaseEvaluation {
  caseId: string;
  transcriptId: string;
  runId: string;
  extractionResultId?: string;
  schemaValid: boolean;
  fieldScores: FieldEvaluation[];
  aggregateScore: number;
  aggregateF1: number;
  hallucinations: HallucinationFinding[];
  hallucinationCount: number;
  gold: ClinicalExtraction;
  prediction: ClinicalExtraction | null;
  evaluatedAt: string;
}

export interface DatasetFilter {
  caseIds?: string[];
  limit?: number;
  offset?: number;
}

export interface StartRunRequest {
  strategy: PromptStrategy;
  model?: string;
  dataset_filter?: DatasetFilter;
  force?: boolean;
}

export interface RunSummary {
  id: string;
  strategy: PromptStrategy;
  model: string;
  promptHash: string;
  status: RunStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  totalCases: number;
  completedCases: number;
  failedCases: number;
  schemaFailureCount: number;
  hallucinationCount: number;
  aggregateScore: number | null;
  aggregateF1: number | null;
  fieldAggregates: FieldEvaluation[];
  tokenUsage: TokenUsage;
  totalCostUsd: number;
  cacheReadVerified: boolean;
  error?: string;
}

export interface RunProgressEvent {
  runId: string;
  status: RunStatus;
  completedCases: number;
  totalCases: number;
  latestCase?: CaseEvaluation;
  summary?: RunSummary;
}

export interface CompareFieldDelta {
  field: EvaluatedField | "overall";
  leftScore: number | null;
  rightScore: number | null;
  delta: number | null;
  winner: "left" | "right" | "tie" | "insufficient_data";
}

export interface CompareRunResponse {
  leftRun: RunSummary;
  rightRun: RunSummary;
  fields: CompareFieldDelta[];
  overall: CompareFieldDelta;
  winner: "left" | "right" | "tie" | "insufficient_data";
}

export interface CaseDetailResponse {
  evaluation: CaseEvaluation;
  transcript: string;
  extraction: (ExtractionResult & { id: string }) | null;
}
