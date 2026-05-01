"use client";

import {
  Activity,
  CheckCircle2,
  GitCompareArrows,
  Play,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import type {
  CaseDetailResponse,
  CaseEvaluation,
  ClinicalExtraction,
  CompareRunResponse,
  EvaluatedField,
  PromptStrategy,
  RunSummary,
  StartRunRequest,
} from "@test-evals/shared";

import {
  compareRuns,
  getCaseDetail,
  listRunCases,
  listRuns,
  resumeRun,
  startRun,
  subscribeToRun,
} from "@/lib/api";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MODEL_OPTIONS = [
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  { value: "llama-3.1-8b-instant", label: "Groq Llama 3.1 8B Instant" },
];
const FIELD_ORDER: EvaluatedField[] = [
  "chief_complaint",
  "vitals",
  "medications",
  "diagnoses",
  "plan",
  "follow_up",
];

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : `${Math.round(value * 1000) / 10}%`;
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatDuration(value: number | null): string {
  if (value === null) {
    return "-";
  }
  if (value < 1000) {
    return `${value} ms`;
  }
  const seconds = Math.round(value / 100) / 10;
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function shortHash(value: string): string {
  return value.slice(0, 10);
}

function statusTone(status: RunSummary["status"]): string {
  if (status === "completed") {
    return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
  }
  if (status === "failed" || status === "canceled") {
    return "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200";
  }
  return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200";
}

function fieldScore(caseEvaluation: CaseEvaluation, field: EvaluatedField): number | null {
  const match = caseEvaluation.fieldScores.find((item) => item.field === field);
  return match?.f1 ?? match?.score ?? null;
}

function extractHighlightValues(prediction: ClinicalExtraction | null): string[] {
  if (prediction === null) {
    return [];
  }

  const values = [
    prediction.chief_complaint,
    prediction.vitals.bp,
    prediction.vitals.hr?.toString(),
    prediction.vitals.temp_f?.toString(),
    prediction.vitals.spo2?.toString(),
    ...prediction.medications.flatMap((item) => [item.name, item.dose, item.frequency, item.route]),
    ...prediction.diagnoses.flatMap((item) => [item.description, item.icd10]),
    ...prediction.plan,
    prediction.follow_up.interval_days?.toString(),
    prediction.follow_up.reason,
  ];

  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.length > 1)))
    .sort((left, right) => right.length - left.length)
    .slice(0, 60);
}

function HighlightedTranscript({ transcript, prediction }: { transcript: string; prediction: ClinicalExtraction | null }) {
  const values = extractHighlightValues(prediction);
  const ranges: Array<{ start: number; end: number }> = [];
  const lowerTranscript = transcript.toLowerCase();

  for (const value of values) {
    const needle = value.toLowerCase();
    let index = lowerTranscript.indexOf(needle);
    while (index >= 0) {
      const end = index + needle.length;
      if (!ranges.some((range) => index < range.end && end > range.start)) {
        ranges.push({ start: index, end });
      }
      index = lowerTranscript.indexOf(needle, end);
    }
  }

  ranges.sort((left, right) => left.start - right.start);
  if (ranges.length === 0) {
    return <pre className="whitespace-pre-wrap text-sm leading-6">{transcript}</pre>;
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      parts.push(transcript.slice(cursor, range.start));
    }
    parts.push(
      <mark key={`${range.start}-${index}`} className="rounded bg-yellow-200 px-0.5 text-slate-950">
        {transcript.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });
  parts.push(transcript.slice(cursor));

  return <pre className="whitespace-pre-wrap text-sm leading-6">{parts}</pre>;
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[30rem] overflow-auto rounded-md border bg-slate-950 p-3 text-xs text-slate-50">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub !== undefined ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function StartRunPanel({ onStarted }: { onStarted: (run: RunSummary) => void }) {
  const [strategy, setStrategy] = useState<PromptStrategy>("zero_shot");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [limit, setLimit] = useState("");
  const [force, setForce] = useState(false);
  const [starting, setStarting] = useState(false);

  async function submit() {
    setStarting(true);
    try {
      const request: StartRunRequest = {
        strategy,
        model,
        force,
        dataset_filter: limit === "" ? undefined : { limit: Number(limit) },
      };
      onStarted(await startRun(request));
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="rounded-md border p-4">
      <div className="mb-3 flex items-center gap-2">
        <Play className="h-4 w-4" />
        <h2 className="font-semibold">Start Run</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2 md:items-end xl:grid-cols-[12rem_minmax(18rem,1fr)_8rem_max-content_max-content]">
        <label className="grid gap-1 text-sm">
          Strategy
          <select className="rounded-md border bg-background px-3 py-2" value={strategy} onChange={(event) => setStrategy(event.target.value as PromptStrategy)}>
            <option value="zero_shot">zero_shot</option>
            <option value="few_shot">few_shot</option>
            <option value="cot">cot</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Model
          <select className="rounded-md border bg-background px-3 py-2" value={model} onChange={(event) => setModel(event.target.value)}>
            {MODEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Limit
          <input className="min-w-0 rounded-md border bg-background px-3 py-2" inputMode="numeric" value={limit} onChange={(event) => setLimit(event.target.value.replace(/\D/gu, ""))} placeholder="50" />
        </label>
        <label className="flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md border px-3 py-2 text-sm">
          <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
          Force
        </label>
        <button className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60" disabled={starting} onClick={submit}>
          <Play className="h-4 w-4" />
          {starting ? "Starting" : "Start"}
        </button>
      </div>
    </section>
  );
}

function RunsTable({
  runs,
  selectedRunId,
  onSelect,
  onResume,
  onComparePick,
}: {
  runs: RunSummary[];
  selectedRunId: string | null;
  onSelect: (run: RunSummary) => void;
  onResume: (run: RunSummary) => void;
  onComparePick: (side: "left" | "right", run: RunSummary) => void;
}) {
  return (
    <section className="rounded-md border">
      <div className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2 font-semibold">
          <Activity className="h-4 w-4" />
          Runs
        </div>
        <div className="text-sm text-muted-foreground">{runs.length} total</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[72rem] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Strategy</th>
              <th className="px-3 py-2">Model</th>
              <th className="px-3 py-2">F1</th>
              <th className="px-3 py-2">Cost</th>
              <th className="px-3 py-2">Duration</th>
              <th className="px-3 py-2">Cases</th>
              <th className="px-3 py-2">Failures</th>
              <th className="px-3 py-2">Halluc.</th>
              <th className="px-3 py-2">Cache Read</th>
              <th className="px-3 py-2">Prompt</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className={run.id === selectedRunId ? "bg-primary/10" : "border-t"}>
                <td className="px-3 py-2">
                  <span className={`rounded-full border px-2 py-1 text-xs ${statusTone(run.status)}`}>{run.status}</span>
                </td>
                <td className="px-3 py-2 font-medium">{run.strategy}</td>
                <td className="px-3 py-2 text-xs">{run.model}</td>
                <td className="px-3 py-2">{formatPercent(run.aggregateF1)}</td>
                <td className="px-3 py-2">{formatCurrency(run.totalCostUsd)}</td>
                <td className="px-3 py-2">{formatDuration(run.durationMs)}</td>
                <td className="px-3 py-2">{run.completedCases}/{run.totalCases}</td>
                <td className="px-3 py-2">{run.schemaFailureCount}</td>
                <td className="px-3 py-2">{run.hallucinationCount}</td>
                <td className="px-3 py-2">{run.tokenUsage.cacheReadInputTokens.toLocaleString()}</td>
                <td className="px-3 py-2 font-mono text-xs">{shortHash(run.promptHash)}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <button className="rounded-md border px-2 py-1" onClick={() => onSelect(run)}>View</button>
                    <button className="rounded-md border px-2 py-1" onClick={() => onComparePick("left", run)}>Left</button>
                    <button className="rounded-md border px-2 py-1" onClick={() => onComparePick("right", run)}>Right</button>
                    {run.status !== "completed" ? (
                      <button className="inline-flex items-center gap-1 rounded-md border px-2 py-1" onClick={() => onResume(run)}>
                        <RotateCcw className="h-3 w-3" />
                        Resume
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RunDetail({
  run,
  cases,
  selectedCaseId,
  onCaseSelect,
}: {
  run: RunSummary;
  cases: CaseEvaluation[];
  selectedCaseId: string | null;
  onCaseSelect: (caseEvaluation: CaseEvaluation) => void;
}) {
  return (
    <section className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Aggregate F1" value={formatPercent(run.aggregateF1)} sub={`${run.completedCases}/${run.totalCases} cases`} />
        <MetricCard label="Cost" value={formatCurrency(run.totalCostUsd)} sub={`${run.tokenUsage.inputTokens.toLocaleString()} input tokens`} />
        <MetricCard label="Cache Read" value={run.tokenUsage.cacheReadInputTokens.toLocaleString()} sub={run.cacheReadVerified ? "verified" : "not yet verified"} />
        <MetricCard label="Quality Flags" value={`${run.schemaFailureCount} / ${run.hallucinationCount}`} sub="schema failures / hallucinations" />
      </div>
      <div className="rounded-md border">
        <div className="border-b p-4">
          <h2 className="font-semibold">Run Detail</h2>
          <p className="text-sm text-muted-foreground">
            {run.strategy} · {run.model} · prompt {shortHash(run.promptHash)}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Case</th>
                <th className="px-3 py-2">Score</th>
                <th className="px-3 py-2">F1</th>
                {FIELD_ORDER.map((field) => (
                  <th key={field} className="px-3 py-2">{field}</th>
                ))}
                <th className="px-3 py-2">Schema</th>
                <th className="px-3 py-2">Halluc.</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((item) => (
                <tr key={item.caseId} className={item.caseId === selectedCaseId ? "bg-primary/10" : "border-t"}>
                  <td className="px-3 py-2">
                    <button className="font-mono text-primary underline-offset-2 hover:underline" onClick={() => onCaseSelect(item)}>
                      {item.caseId}
                    </button>
                  </td>
                  <td className="px-3 py-2">{formatPercent(item.aggregateScore)}</td>
                  <td className="px-3 py-2">{formatPercent(item.aggregateF1)}</td>
                  {FIELD_ORDER.map((field) => (
                    <td key={field} className="px-3 py-2">{formatPercent(fieldScore(item, field))}</td>
                  ))}
                  <td className="px-3 py-2">{item.schemaValid ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />}</td>
                  <td className="px-3 py-2">{item.hallucinationCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function CaseDetail({ detail }: { detail: CaseDetailResponse }) {
  const { evaluation, extraction, transcript } = detail;

  return (
    <section className="grid gap-4 rounded-md border p-4">
      <div>
        <h2 className="font-semibold">Case {evaluation.caseId}</h2>
        <p className="text-sm text-muted-foreground">
          Aggregate F1 {formatPercent(evaluation.aggregateF1)} · {evaluation.hallucinationCount} hallucination flags · {extraction?.attempts.length ?? 0} LLM attempts
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border p-3">
          <h3 className="mb-2 font-medium">Transcript</h3>
          <HighlightedTranscript transcript={transcript} prediction={evaluation.prediction} />
        </div>
        <div className="grid gap-4">
          <div>
            <h3 className="mb-2 font-medium">Hallucination Flags</h3>
            {evaluation.hallucinations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hallucinations detected.</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {evaluation.hallucinations.map((item, index) => (
                  <li key={`${item.field}-${index}`} className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-950">
                    <span className="font-medium">{item.field}</span>: {item.value} · {item.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 font-medium">Field Diff</h3>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Field</th>
                    <th className="px-3 py-2">Metric</th>
                    <th className="px-3 py-2">Score</th>
                    <th className="px-3 py-2">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluation.fieldScores.map((field) => (
                    <tr key={field.field} className="border-t">
                      <td className="px-3 py-2">{field.field}</td>
                      <td className="px-3 py-2">{field.metric}</td>
                      <td className="px-3 py-2">{formatPercent(field.f1 ?? field.score)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{field.details ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 font-medium">Gold JSON</h3>
          <JsonBlock value={evaluation.gold} />
        </div>
        <div>
          <h3 className="mb-2 font-medium">Predicted JSON</h3>
          <JsonBlock value={evaluation.prediction} />
        </div>
      </div>
      <div>
        <h3 className="mb-2 font-medium">LLM Trace</h3>
        {extraction === null ? (
          <p className="text-sm text-muted-foreground">No extraction trace was linked to this evaluation.</p>
        ) : (
          <div className="grid gap-3">
            {extraction.attempts.map((attempt) => (
              <details key={attempt.attempt} className="rounded-md border p-3">
                <summary className="cursor-pointer font-medium">
                  Attempt {attempt.attempt} · {attempt.schemaValid ? "schema valid" : "schema invalid"} · {attempt.latencyMs} ms · cache read {attempt.tokenUsage.cacheReadInputTokens}
                </summary>
                {attempt.validationErrors.length > 0 ? (
                  <ul className="my-3 grid gap-1 text-sm text-red-700">
                    {attempt.validationErrors.map((error, index) => (
                      <li key={`${error.path}-${index}`}>{error.path}: {error.message}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div>
                    <h4 className="mb-1 text-sm font-medium">Request</h4>
                    <JsonBlock value={attempt.request} />
                  </div>
                  <div>
                    <h4 className="mb-1 text-sm font-medium">Response</h4>
                    <JsonBlock value={attempt.response} />
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function CompareView({ runs, leftId, rightId, onPick }: { runs: RunSummary[]; leftId: string | null; rightId: string | null; onPick: (side: "left" | "right", id: string) => void }) {
  const [comparison, setComparison] = useState<CompareRunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (leftId === null || rightId === null || leftId === rightId) {
      setComparison(null);
      return;
    }

    let canceled = false;
    compareRuns(leftId, rightId)
      .then((data) => {
        if (!canceled) {
          setComparison(data);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!canceled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      });

    return () => {
      canceled = true;
    };
  }, [leftId, rightId]);

  const sortedSignals = useMemo(() => {
    return [...(comparison?.fields ?? [])]
      .filter((field) => field.delta !== null)
      .sort((left, right) => Math.abs(right.delta ?? 0) - Math.abs(left.delta ?? 0))
      .slice(0, 5);
  }, [comparison]);

  return (
    <section className="grid gap-4 rounded-md border p-4">
      <div className="flex items-center gap-2">
        <GitCompareArrows className="h-4 w-4" />
        <h2 className="font-semibold">Compare Runs</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {(["left", "right"] as const).map((side) => (
          <label key={side} className="grid gap-1 text-sm">
            {side === "left" ? "Left run" : "Right run"}
            <select className="rounded-md border bg-background px-3 py-2" value={side === "left" ? leftId ?? "" : rightId ?? ""} onChange={(event) => onPick(side, event.target.value)}>
              <option value="">Select a run</option>
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.strategy} · {formatPercent(run.aggregateF1)} · {shortHash(run.promptHash)} · {run.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {error !== null ? <p className="text-sm text-red-600">{error}</p> : null}
      {comparison !== null ? (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <MetricCard label="Overall Winner" value={comparison.winner} sub={`Delta ${formatPercent(comparison.overall.delta)}`} />
            <MetricCard label="Left F1" value={formatPercent(comparison.leftRun.aggregateF1)} sub={comparison.leftRun.strategy} />
            <MetricCard label="Right F1" value={formatPercent(comparison.rightRun.aggregateF1)} sub={comparison.rightRun.strategy} />
            <MetricCard label="Cost Delta" value={formatCurrency(comparison.rightRun.totalCostUsd - comparison.leftRun.totalCostUsd)} sub="right minus left" />
          </div>
          <div className="rounded-md border p-3">
            <h3 className="mb-2 font-medium">Largest Signals</h3>
            <div className="grid gap-2">
              {sortedSignals.map((field) => (
                <div key={field.field} className="grid gap-2 md:grid-cols-[12rem_1fr_5rem] md:items-center">
                  <span className="text-sm">{field.field}</span>
                  <div className="h-2 rounded bg-muted">
                    <div
                      className={`h-2 rounded ${field.winner === "right" ? "bg-emerald-500" : field.winner === "left" ? "bg-red-500" : "bg-slate-400"}`}
                      style={{ width: `${Math.min(100, Math.abs(field.delta ?? 0) * 100)}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium">{formatPercent(field.delta)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[42rem] text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Field</th>
                  <th className="px-3 py-2">Left</th>
                  <th className="px-3 py-2">Right</th>
                  <th className="px-3 py-2">Delta</th>
                  <th className="px-3 py-2">Winner</th>
                </tr>
              </thead>
              <tbody>
                {comparison.fields.map((field) => (
                  <tr key={field.field} className="border-t">
                    <td className="px-3 py-2">{field.field}</td>
                    <td className="px-3 py-2">{formatPercent(field.leftScore)}</td>
                    <td className="px-3 py-2">{formatPercent(field.rightScore)}</td>
                    <td className="px-3 py-2">{formatPercent(field.delta)}</td>
                    <td className="px-3 py-2 font-medium">{field.winner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Pick two completed runs to see per-field deltas and winners.</p>
      )}
    </section>
  );
}

export default function EvalDashboard() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRun, setSelectedRun] = useState<RunSummary | null>(null);
  const [cases, setCases] = useState<CaseEvaluation[]>([]);
  const [selectedCase, setSelectedCase] = useState<CaseDetailResponse | null>(null);
  const [leftCompareId, setLeftCompareId] = useState<string | null>(null);
  const [rightCompareId, setRightCompareId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refreshRuns() {
    const data = await listRuns();
    setRuns(data);
    if (selectedRun !== null) {
      setSelectedRun(data.find((run) => run.id === selectedRun.id) ?? selectedRun);
    }
  }

  useEffect(() => {
    refreshRuns()
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selectedRun === null) {
      setCases([]);
      return;
    }
    listRunCases(selectedRun.id)
      .then(setCases)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));

    if (selectedRun.status === "running" || selectedRun.status === "queued") {
      return subscribeToRun(selectedRun.id, (event) => {
        if (event.summary !== undefined) {
          setSelectedRun(event.summary);
          setRuns((current) => current.map((run) => (run.id === event.summary?.id ? event.summary : run)));
        }
        if (event.latestCase !== undefined) {
          const latestCase = event.latestCase;
          setCases((current) => {
            const rest = current.filter((item) => item.caseId !== latestCase.caseId);
            return [...rest, latestCase].sort((left, right) => left.caseId.localeCompare(right.caseId));
          });
        }
      });
    }
  }, [selectedRun?.id, selectedRun?.status]);

  async function selectRun(run: RunSummary) {
    setSelectedRun(run);
    setSelectedCase(null);
    setCases(await listRunCases(run.id));
  }

  async function selectCase(caseEvaluation: CaseEvaluation) {
    setSelectedCase(await getCaseDetail(caseEvaluation.runId, caseEvaluation.caseId));
  }

  async function handleResume(run: RunSummary) {
    const resumed = await resumeRun(run.id);
    setSelectedRun(resumed);
    await refreshRuns();
  }

  function pickCompare(side: "left" | "right", run: RunSummary) {
    if (side === "left") {
      setLeftCompareId(run.id);
    } else {
      setRightCompareId(run.id);
    }
  }

  return (
    <main className="min-h-0 overflow-auto p-4">
      <div className="mx-auto grid max-w-7xl gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">HEALOSBENCH Dashboard</h1>
            <p className="text-sm text-muted-foreground">Prompt evals for structured clinical extraction.</p>
          </div>
          <button className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm" onClick={() => refreshRuns()}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {error !== null ? (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>
        ) : null}

        <StartRunPanel
          onStarted={(run) => {
            setRuns((current) => [run, ...current]);
            setSelectedRun(run);
            setSelectedCase(null);
          }}
        />

        {loading ? (
          <div className="rounded-md border p-6 text-sm text-muted-foreground">Loading runs...</div>
        ) : runs.length === 0 ? (
          <div className="rounded-md border p-6 text-sm text-muted-foreground">No eval runs yet. Start a small run to warm up the dashboard.</div>
        ) : (
          <RunsTable
            runs={runs}
            selectedRunId={selectedRun?.id ?? null}
            onSelect={selectRun}
            onResume={handleResume}
            onComparePick={pickCompare}
          />
        )}

        <CompareView
          runs={runs}
          leftId={leftCompareId}
          rightId={rightCompareId}
          onPick={(side, id) => {
            if (side === "left") {
              setLeftCompareId(id || null);
            } else {
              setRightCompareId(id || null);
            }
          }}
        />

        {selectedRun !== null ? (
          <RunDetail run={selectedRun} cases={cases} selectedCaseId={selectedCase?.evaluation.caseId ?? null} onCaseSelect={selectCase} />
        ) : null}

        {selectedCase !== null ? <CaseDetail detail={selectedCase} /> : null}

        <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4" />
          Dashboard data comes from Hono only. Model provider credentials stay server-side.
        </div>
      </div>
    </main>
  );
}
