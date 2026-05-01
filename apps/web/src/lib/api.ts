"use client";

import type {
  CaseDetailResponse,
  CaseEvaluation,
  CompareRunResponse,
  RunProgressEvent,
  RunSummary,
  StartRunRequest,
} from "@test-evals/shared";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8787";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export function listRuns(): Promise<RunSummary[]> {
  return apiFetch<RunSummary[]>("/api/v1/runs");
}

export function getRun(runId: string): Promise<RunSummary> {
  return apiFetch<RunSummary>(`/api/v1/runs/${runId}`);
}

export function listRunCases(runId: string): Promise<CaseEvaluation[]> {
  return apiFetch<CaseEvaluation[]>(`/api/v1/runs/${runId}/cases`);
}

export function getCaseDetail(runId: string, caseId: string): Promise<CaseDetailResponse> {
  return apiFetch<CaseDetailResponse>(`/api/v1/runs/${runId}/cases/${caseId}`);
}

export function compareRuns(leftRunId: string, rightRunId: string): Promise<CompareRunResponse> {
  const params = new URLSearchParams({ left: leftRunId, right: rightRunId });
  return apiFetch<CompareRunResponse>(`/api/v1/runs/compare?${params.toString()}`);
}

export function startRun(request: StartRunRequest): Promise<RunSummary> {
  return apiFetch<RunSummary>("/api/v1/runs", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function resumeRun(runId: string): Promise<RunSummary> {
  return apiFetch<RunSummary>(`/api/v1/runs/${runId}/resume`, {
    method: "POST",
  });
}

export function subscribeToRun(
  runId: string,
  onEvent: (event: RunProgressEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  const source = new EventSource(`${API_BASE_URL}/api/v1/runs/${runId}/events`);
  source.onmessage = (message) => {
    onEvent(JSON.parse(message.data) as RunProgressEvent);
  };
  source.onerror = (error) => {
    onError?.(error);
  };
  return () => source.close();
}
