import {
  DEFAULT_MODEL,
  buildPromptHash,
  getPromptStrategy,
  loadExtractionSchema,
  providerForModel,
  type LlmMessagesClient,
} from "@test-evals/llm";
import type {
  CaseDetailResponse,
  CaseEvaluation,
  CompareFieldDelta,
  CompareRunResponse,
  EvaluatedField,
  ExtractionResult,
  RunProgressEvent,
  RunSummary,
  StartRunRequest,
  TokenUsage,
} from "@test-evals/shared";

import { addTokenUsage, emptyTokenUsage } from "@test-evals/llm";
import { aggregateFieldScores } from "./evaluate.service";
import { loadDataset, type DatasetCase } from "./dataset.service";
import { evaluateCase } from "./evaluate.service";
import { extractCase } from "./extract.service";
import { runEventBus, type RunEventBus } from "./runner/events";
import type { RunnerStore } from "./runner/store";

const MAX_CONCURRENCY = 5;
const MAX_RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY_MS = 250;
const PROVIDER_MIN_INTERVAL_MS = {
  anthropic: 250,
  groq: 2100,
} as const;
const PROVIDER_TOKENS_PER_MINUTE = {
  groq: 6000,
} as const;
const COMPARE_EPSILON = 0.005;
const COMPARE_FIELDS: EvaluatedField[] = [
  "chief_complaint",
  "vitals",
  "vitals.bp",
  "vitals.hr",
  "vitals.temp_f",
  "vitals.spo2",
  "medications",
  "diagnoses",
  "plan",
  "follow_up",
  "follow_up.interval_days",
  "follow_up.reason",
];

export interface RunnerServiceOptions {
  store?: RunnerStore;
  eventBus?: RunEventBus;
  client?: LlmMessagesClient;
  extractor?: (input: {
    caseId: string;
    transcriptId: string;
    runId: string;
    transcript: string;
    strategy: StartRunRequest["strategy"];
    model: string;
    client?: LlmMessagesClient;
  }) => Promise<ExtractionResult>;
  sleep?: (ms: number) => Promise<void>;
  concurrency?: number;
}

export class RateLimitError extends Error {
  retryAfterMs?: number;

  constructor(message = "Rate limited by model provider.", retryAfterMs?: number) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

function isRateLimitError(error: unknown): boolean {
  const candidate = error as { status?: number; name?: string; message?: string };
  return (
    candidate.status === 429 ||
    candidate.name === "RateLimitError" ||
    candidate.message?.toLowerCase().includes("rate limit") === true ||
    candidate.message?.includes("429") === true
  );
}

function delayWithJitter(attempt: number): number {
  const exponential = RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt;
  return exponential + Math.floor(Math.random() * 50);
}

class ModelRateLimiter {
  private nextAvailableAt = new Map<string, number>();
  private tokenReservations = new Map<string, Array<{ reservedAt: number; tokens: number }>>();
  private queue = Promise.resolve();

  async wait(model: string, estimatedInputTokens: number, sleep: (ms: number) => Promise<void>): Promise<void> {
    const provider = providerForModel(model);
    const minIntervalMs = PROVIDER_MIN_INTERVAL_MS[provider];

    this.queue = this.queue.then(async () => {
      let now = Date.now();
      const tokenLimit = provider === "groq" ? PROVIDER_TOKENS_PER_MINUTE.groq : undefined;
      if (tokenLimit !== undefined) {
        const reservations = this.tokenReservations.get(model) ?? [];
        const boundedEstimate = Math.min(tokenLimit, Math.max(1, estimatedInputTokens));

        while (true) {
          now = Date.now();
          const active = reservations.filter((item) => now - item.reservedAt < 60_000);
          const reservedTokens = active.reduce((total, item) => total + item.tokens, 0);
          if (reservedTokens + boundedEstimate <= tokenLimit || active.length === 0) {
            active.push({ reservedAt: now, tokens: boundedEstimate });
            this.tokenReservations.set(model, active);
            break;
          }

          await sleep(Math.max(1, 60_000 - (now - active[0].reservedAt)));
        }
      }

      now = Date.now();
      const nextAt = this.nextAvailableAt.get(model) ?? now;
      const delayMs = Math.max(0, nextAt - now);
      this.nextAvailableAt.set(model, Math.max(now, nextAt) + minIntervalMs);
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    });

    return this.queue;
  }
}

function estimateInputTokensForRateLimit(input: Parameters<NonNullable<RunnerServiceOptions["extractor"]>>[0]): number {
  return Math.ceil(input.transcript.length / 4) + 1800;
}

function promptHashForStrategy(strategy: StartRunRequest["strategy"]): string {
  const schema = loadExtractionSchema();
  const prompt = getPromptStrategy(strategy)({ transcript: "" });
  return buildPromptHash({ strategy, stableParts: prompt.stableParts, schema });
}

function scoreForField(run: RunSummary, field: EvaluatedField): number | null {
  const aggregate = run.fieldAggregates.find((item) => item.field === field);
  if (aggregate === undefined) {
    return null;
  }
  return aggregate.f1 ?? aggregate.score;
}

function compareScores(
  field: EvaluatedField | "overall",
  leftScore: number | null,
  rightScore: number | null,
): CompareFieldDelta {
  if (leftScore === null || rightScore === null) {
    return { field, leftScore, rightScore, delta: null, winner: "insufficient_data" };
  }

  const delta = rightScore - leftScore;
  const winner = Math.abs(delta) <= COMPARE_EPSILON ? "tie" : delta > 0 ? "right" : "left";
  return { field, leftScore, rightScore, delta, winner };
}

function summarizeRun(
  base: RunSummary,
  evaluations: CaseEvaluation[],
  extractions: ExtractionResult[],
  initialTokenUsage: TokenUsage = emptyTokenUsage(),
  initialCostUsd = 0,
  initialCacheReadVerified = false,
): RunSummary {
  const tokenUsage = extractions.reduce<TokenUsage>(
    (total, extraction) => addTokenUsage(total, extraction.tokenUsage),
    initialTokenUsage,
  );
  const completedAt = base.status === "completed" || base.status === "failed" ? new Date().toISOString() : null;
  const startedAtMs = new Date(base.startedAt).getTime();
  const durationMs = completedAt === null ? null : new Date(completedAt).getTime() - startedAtMs;

  return {
    ...base,
    completedAt,
    durationMs,
    completedCases: evaluations.length,
    failedCases: evaluations.filter((evaluation) => !evaluation.schemaValid).length,
    schemaFailureCount: evaluations.filter((evaluation) => !evaluation.schemaValid).length,
    hallucinationCount: evaluations.reduce((total, evaluation) => total + evaluation.hallucinationCount, 0),
    aggregateScore:
      evaluations.length === 0
        ? null
        : evaluations.reduce((total, evaluation) => total + evaluation.aggregateScore, 0) / evaluations.length,
    aggregateF1:
      evaluations.length === 0
        ? null
        : evaluations.reduce((total, evaluation) => total + evaluation.aggregateF1, 0) / evaluations.length,
    fieldAggregates: aggregateFieldScores(evaluations),
    tokenUsage,
    totalCostUsd: initialCostUsd + extractions.reduce((total, extraction) => total + extraction.costUsd, 0),
    cacheReadVerified:
      initialCacheReadVerified ||
      extractions.some(
        (extraction) =>
          extraction.tokenUsage.cacheReadInputTokens > 0 ||
          extraction.attempts.some((attempt) => attempt.cacheReadVerified),
      ),
  };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      if (item !== undefined) {
        await worker(item);
      }
    }
  });

  await Promise.all(workers);
}

export class RunnerService {
  private readonly store: RunnerStore;
  private readonly eventBus: RunEventBus;
  private readonly client?: LlmMessagesClient;
  private readonly extractor: NonNullable<RunnerServiceOptions["extractor"]>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly concurrency: number;
  private readonly rateLimiter = new ModelRateLimiter();

  constructor(options: RunnerServiceOptions = {}) {
    if (options.store === undefined) {
      throw new Error("RunnerService requires a RunnerStore.");
    }

    this.store = options.store;
    this.eventBus = options.eventBus ?? runEventBus;
    this.client = options.client;
    this.extractor = options.extractor ?? extractCase;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, options.concurrency ?? MAX_CONCURRENCY));
  }

  async startRun(request: StartRunRequest): Promise<RunSummary> {
    const model = request.model ?? DEFAULT_MODEL;
    const cases = loadDataset(request.dataset_filter);
    const run = await this.store.createRun({
      id: crypto.randomUUID(),
      strategy: request.strategy,
      model,
      promptHash: promptHashForStrategy(request.strategy),
      totalCases: cases.length,
      datasetFilter: request.dataset_filter,
    });

    void this.executeRun(run.id, cases, request.force === true);
    return { ...run, status: "running" };
  }

  async resumeRun(runId: string): Promise<RunSummary> {
    const run = await this.requireRun(runId);
    const filter = await this.store.getRunDatasetFilter(runId);
    const completed = new Set((await this.store.listEvaluations(runId)).map((evaluation) => evaluation.caseId));
    const cases = loadDataset(filter).filter((item) => !completed.has(item.caseId));
    await this.store.setRunStatus(runId, "running");

    void this.executeRun(runId, cases, false);
    return { ...run, status: "running" };
  }

  async runSync(request: StartRunRequest): Promise<RunSummary> {
    const model = request.model ?? DEFAULT_MODEL;
    const cases = loadDataset(request.dataset_filter);
    const run = await this.store.createRun({
      id: crypto.randomUUID(),
      strategy: request.strategy,
      model,
      promptHash: promptHashForStrategy(request.strategy),
      totalCases: cases.length,
      datasetFilter: request.dataset_filter,
    });
    return this.executeRun(run.id, cases, request.force === true);
  }

  async getRun(runId: string): Promise<RunSummary | null> {
    return this.store.getRun(runId);
  }

  async listRuns(): Promise<RunSummary[]> {
    return this.store.listRuns();
  }

  async listCases(runId: string): Promise<CaseEvaluation[]> {
    return this.store.listEvaluations(runId);
  }

  async getCaseDetail(runId: string, caseId: string): Promise<CaseDetailResponse | null> {
    const evaluation = await this.store.getEvaluation(runId, caseId);
    if (evaluation === null) {
      return null;
    }

    const datasetCase = loadDataset({ caseIds: [caseId] })[0];
    const extraction =
      evaluation.extractionResultId === undefined
        ? null
        : await this.store.getExtraction(evaluation.extractionResultId);

    return {
      evaluation,
      transcript: datasetCase?.transcript ?? "",
      extraction,
    };
  }

  async compareRuns(leftRunId: string, rightRunId: string): Promise<CompareRunResponse | null> {
    const [leftRun, rightRun] = await Promise.all([this.store.getRun(leftRunId), this.store.getRun(rightRunId)]);
    if (leftRun === null || rightRun === null) {
      return null;
    }

    const fields = COMPARE_FIELDS.map((field) =>
      compareScores(field, scoreForField(leftRun, field), scoreForField(rightRun, field)),
    );
    const overall = compareScores("overall", leftRun.aggregateF1, rightRun.aggregateF1);

    return {
      leftRun,
      rightRun,
      fields,
      overall,
      winner: overall.winner,
    };
  }

  subscribe(runId: string, listener: (event: RunProgressEvent) => void): () => void {
    return this.eventBus.subscribe(runId, listener);
  }

  private async requireRun(runId: string): Promise<RunSummary> {
    const run = await this.store.getRun(runId);
    if (run === null) {
      throw new Error(`Run ${runId} was not found.`);
    }
    return run;
  }

  private async extractWithBackoff(input: Parameters<NonNullable<RunnerServiceOptions["extractor"]>>[0]) {
    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
      try {
        await this.rateLimiter.wait(input.model, estimateInputTokensForRateLimit(input), this.sleep);
        return await this.extractor(input);
      } catch (error) {
        if (!isRateLimitError(error) || attempt === MAX_RATE_LIMIT_RETRIES) {
          throw error;
        }

        const retryAfterMs = (error as { retryAfterMs?: number }).retryAfterMs;
        await this.sleep(retryAfterMs ?? delayWithJitter(attempt));
      }
    }

    throw new RateLimitError("Exceeded rate-limit retry attempts.");
  }

  private async processCase(
    run: RunSummary,
    item: DatasetCase,
    force: boolean,
  ): Promise<{ evaluation: CaseEvaluation; extraction: ExtractionResult }> {
    const cachedResult =
      force === true
        ? null
        : await this.store.findCachedExtraction({
            strategy: run.strategy,
            model: run.model,
            transcriptId: item.transcriptId,
            promptHash: run.promptHash,
          });
    const cached = cachedResult?.schemaValid === true ? cachedResult : null;

    const rawExtraction =
      cached === null
        ? await this.extractWithBackoff({
            caseId: item.caseId,
            transcriptId: item.transcriptId,
            runId: run.id,
            transcript: item.transcript,
            strategy: run.strategy,
            model: run.model,
            client: this.client,
          })
        : { ...cached, runId: run.id, cached: true };
    const extraction = { ...rawExtraction, promptHash: run.promptHash };

    const extractionResultId = cached?.id ?? (await this.store.saveExtraction(extraction));
    const evaluation = evaluateCase({
      caseId: item.caseId,
      transcriptId: item.transcriptId,
      runId: run.id,
      extractionResultId,
      transcript: item.transcript,
      gold: item.gold,
      prediction: extraction.extraction,
      schemaValid: extraction.schemaValid,
    });
    await this.store.saveEvaluation(evaluation);

    return { evaluation, extraction };
  }

  private async executeRun(runId: string, cases: DatasetCase[], force: boolean): Promise<RunSummary> {
    const baseRun = await this.requireRun(runId);
    let summary: RunSummary = { ...baseRun, status: "running", completedAt: null, durationMs: null, error: undefined };
    await this.store.updateRun(summary);

    const existingEvaluations = await this.store.listEvaluations(runId);
    const evaluations = [...existingEvaluations];
    const extractions: ExtractionResult[] = [];
    const initialTokenUsage = baseRun.tokenUsage;
    const initialCostUsd = baseRun.totalCostUsd;
    const initialCacheReadVerified = baseRun.cacheReadVerified;

    try {
      await runWithConcurrency(cases, this.concurrency, async (item) => {
        const result = await this.processCase(summary, item, force);
        evaluations.push(result.evaluation);
        extractions.push(result.extraction);
        summary = summarizeRun(
          summary,
          evaluations,
          extractions,
          initialTokenUsage,
          initialCostUsd,
          initialCacheReadVerified,
        );
        await this.store.updateRun(summary);
        this.eventBus.publish({
          runId,
          status: summary.status,
          completedCases: summary.completedCases,
          totalCases: summary.totalCases,
          latestCase: result.evaluation,
          summary,
        });
      });

      summary = summarizeRun(
        { ...summary, status: "completed" },
        evaluations,
        extractions,
        initialTokenUsage,
        initialCostUsd,
        initialCacheReadVerified,
      );
      await this.store.updateRun(summary);
      this.eventBus.publish({
        runId,
        status: summary.status,
        completedCases: summary.completedCases,
        totalCases: summary.totalCases,
        summary,
      });
      return summary;
    } catch (error) {
      summary = summarizeRun(
        {
          ...summary,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        },
        evaluations,
        extractions,
        initialTokenUsage,
        initialCostUsd,
        initialCacheReadVerified,
      );
      await this.store.updateRun(summary);
      this.eventBus.publish({
        runId,
        status: summary.status,
        completedCases: summary.completedCases,
        totalCases: summary.totalCases,
        summary,
      });
      return summary;
    }
  }
}
