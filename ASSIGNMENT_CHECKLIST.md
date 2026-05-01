# Assignment Checklist

Use this as the review rubric for every AI-generated diff. A change is not complete unless every relevant hard requirement remains satisfied.

## Hard Requirements

- [x] **Structured output enforcement**
  - [x] Extractor uses Anthropic tool use or another schema-enforcing structured output path.
  - [x] Raw free-form model text is not accepted as the source of truth.
  - [x] No bare `JSON.parse` of model prose without a schema-enforcing path.
  - [x] Returned extraction conforms to `data/schema.json`.
  - [x] Gold files and `data/schema.json` are not modified.

- [x] **Retry-with-error-feedback loop**
  - [x] Schema validation failures are sent back to the model for correction.
  - [x] Retry loop is capped at 3 attempts.
  - [x] Every attempt is logged with request, response, validation status, and errors.
  - [x] Schema-invalid outputs that still escape retries are tracked and reported.

- [ ] **Prompt caching verification**
  - [x] System prompt and few-shot examples use Anthropic prompt caching/cache-control.
  - [x] Run summary includes input, output, cache-read, and cache-write token counts.
  - [x] Dashboard exposes `cache_read_input_tokens`.
  - [ ] Repeated runs demonstrate cache reads increasing.

- [x] **Concurrency control**
  - [x] Runner limits concurrent cases to at most 5 in flight.
  - [x] Implementation uses a semaphore, token bucket, queue, or equivalent.
  - [x] Runner does not use naive `Promise.all` across all cases.
  - [x] Anthropic 429 handling uses backoff or rate-limit-aware retry.
  - [x] Groq `llama-3.1-8b-instant` handling respects documented RPM/TPM limits and 429 `retry-after`.
  - [x] `NOTES.md` documents the concurrency and 429 strategy.

- [x] **Resumable runs**
  - [x] `POST /api/v1/runs/:id/resume` continues an interrupted run.
  - [x] Completed cases are not re-run or double-charged after resume.
  - [x] Server crash/restart during a run is recoverable.
  - [x] Resumability behavior is covered by a test.

- [x] **Field-specific metrics**
  - [x] `chief_complaint` uses normalized fuzzy string scoring in `[0, 1]`.
  - [x] `vitals.*` use exact matching with numeric tolerance where appropriate, then average.
  - [x] `medications` use set-based precision, recall, and F1.
  - [x] Medication matching normalizes fuzzy `name`, `dose`, and `frequency`.
  - [x] `diagnoses` use set-based F1 by fuzzy `description`.
  - [x] Diagnosis scoring gives bonus credit for matching `icd10`.
  - [x] `plan` uses set-based F1 on fuzzy-matched plan items.
  - [x] `follow_up.interval_days` uses exact match.
  - [x] `follow_up.reason` uses fuzzy matching.
  - [x] No single exact-match-everything evaluator is used.

- [x] **Hallucination detection**
  - [x] Predictions are checked for textual support in the transcript.
  - [x] Grounding check uses substring matching and/or normalized fuzzy matching.
  - [x] Hallucinated fields are flagged per case.
  - [x] Hallucination counts are aggregated per run.
  - [x] Method is documented, even if simple.
    Current method: normalized substring, loose substring, numeric token support, token overlap with small clinical aliases, ICD-10 support through grounded diagnosis text, and fuzzy transcript-window matching.

- [x] **Compare view**
  - [x] User can pick two runs to compare.
  - [x] View shows per-field score deltas.
  - [x] View clearly identifies which strategy/model wins for each field.
  - [x] View surfaces real signal beyond two static columns of numbers.

- [x] **At least 8 tests**
  - [x] Test: schema-validation retry path.
  - [x] Test: fuzzy medication matching.
  - [x] Test: set-F1 correctness on a tiny synthetic case.
  - [x] Test: hallucination detector positive case.
  - [x] Test: hallucination detector negative case.
  - [x] Test: resumability.
  - [x] Test: idempotency.
  - [x] Test: rate-limit backoff with mocked SDK.
  - [x] Test: prompt-hash stability.
  - [x] Total test count is at least 8, with the required behaviors covered.
    Evaluator tests currently have 10 passing tests, LLM client/extractor tests have 11 passing tests, and runner tests have 9 passing tests.

- [x] **No API key in browser**
  - [x] `ANTHROPIC_API_KEY` is loaded only by the server environment.
  - [x] `GROQ_API_KEY` is loaded only by the server environment.
  - [x] Browser code does not import server-only env modules.
  - [x] Web app talks only to Hono API routes.
  - [x] Only Hono/server code calls Anthropic or Groq.
  - [x] No API key is exposed through client bundles, DTOs, logs, or dashboard traces.

## Extractor

- [x] `packages/llm` exists or is extended with an Anthropic SDK wrapper.
- [x] `apps/server/src/services/extract.service.ts` orchestrates extraction.
- [x] Extractor accepts transcript plus prompt strategy.
- [x] Supported strategies include `zero_shot`, `few_shot`, and `cot`.
- [x] Strategies are swappable modules.
- [x] Adding a fourth strategy should be a small, localized change.
- [x] Model defaults or examples use Haiku 4.5: `claude-haiku-4-5-20251001`.
- [x] Optional dashboard/CLI model selection supports Groq `llama-3.1-8b-instant` without changing the default Haiku path.
- [x] Attempts, validation results, token usage, cache stats, and errors are persisted or retrievable for dashboard traces.

## Evaluator

- [x] `apps/server/src/services/evaluate.service.ts` computes per-case scores.
- [x] Evaluator processes each `(transcript, prediction, gold)` triple.
- [x] Per-case scores are stored.
- [x] Per-field aggregate scores are stored.
- [x] Schema-failure count is stored.
- [x] Hallucination count is stored.
- [x] Total input tokens are stored.
- [x] Total output tokens are stored.
- [x] Total cache-read tokens are stored.
- [x] Total cache-write tokens are stored.
- [x] Wall time is stored.
- [x] Total cost in USD is stored.

## Runner And API

- [x] `POST /api/v1/runs` starts a run with `{ strategy, model, dataset_filter? }`.
- [x] SSE streams progress to the dashboard as cases complete.
- [x] Idempotency: same `{ strategy, model, transcript_id }` returns cached result unless `force=true`.
- [x] Idempotent cache hit does not call the LLM.
- [x] Schema-invalid extraction attempts are not reused as cache hits.
- [x] Run statuses are persisted accurately.
- [x] Dataset filter behavior is deterministic and documented or obvious.

## Dashboard

- [x] Dashboard implementation is complete for the assignment-required views.
- [x] Dashboard start-run form uses a model dropdown rather than a free-form model field.
- [x] Runs list shows every run.
- [x] Runs list includes strategy, model, aggregate F1, cost, duration, and status.
- [x] Run detail shows all cases in the selected run with per-case scores.
- [x] Case detail shows transcript.
- [x] Transcript highlights grounded prediction values.
- [x] Case detail shows gold JSON and predicted JSON side by side.
- [x] Case detail includes field-level diff.
- [x] Case detail includes full LLM trace.
- [x] LLM trace includes every retry attempt.
- [x] LLM trace includes each request and response.
- [x] LLM trace includes cache stats.

## Reproducibility

- [x] CLI command runs a full eval without the dashboard:

  ```bash
  bun run eval -- --strategy=cot --model=claude-haiku-4-5-20251001
  ```

- [x] CLI prints a summary table to stdout.
- [x] Demo CLI can run all 50 cases without LLM/API key or DB:

  ```bash
  bun run apps/server/src/cli/eval.ts --strategy=zero_shot --demo=true --force=true --memory=true
  ```

- [x] Every run pins prompt content with a content hash.
- [x] Changing any prompt character produces a new hash.
- [ ] Clean clone flow works: `bun install && bun run eval -- --strategy=zero_shot`.

## Notes And Submission

- [x] `NOTES.md` includes a results table for all three strategies.
- [x] `NOTES.md` describes what was surprising.
- [x] `NOTES.md` explains which strategy wins on which fields and why.
- [x] `NOTES.md` documents what would be built next.
- [x] `NOTES.md` documents what was cut.
- [x] Submission includes output from one full 3-strategy CLI run in `results/` or pasted in `NOTES.md`.
- [x] Working tree excludes `node_modules` from submission.

## Constraints

- [x] Synthetic data only.
- [x] No real medical data in code, fixtures, tests, prompts, logs, or notes.
- [ ] Full 50-case Haiku run across all three strategies should cost under $1.
- [x] Any added transcript cases remain synthetic.
- [x] Existing gold files remain untouched.
- [x] Existing schema remains untouched.
