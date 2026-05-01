# Overview

HEALOSBENCH is implemented as a repeatable structured-extraction eval harness for 50 synthetic clinical transcripts. The system has a schema-enforced extractor, three prompt strategies (`zero_shot`, `few_shot`, `cot`), field-specific scoring, hallucination detection, resumable/idempotent runs, SSE progress, a dashboard with run detail and comparison views, and a CLI path for reproducible runs.

For this writeup I compared the latest completed full 50-case runs using `llama-3.1-8b-instant`:

- `zero_shot`: `ebeb2899-6732-44d6-b5ea-1a95457a8944`
- `cot`: `131fbd23-895c-409a-9816-5f1bb8e1d66d`
- `few_shot`: `873a5702-c864-471b-9a6f-9384778cbd81`

# Results

| Strategy | Model | Cases | Aggregate F1 | Aggregate Score | Schema Failures | Hallucination Flags | Input Tokens | Output Tokens | Cache Read | Cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `few_shot` | `llama-3.1-8b-instant` | 50/50 | 0.601 | 0.661 | 0 | 36 | 80,783 | 9,319 | 0 | $0.0048 |
| `cot` | `llama-3.1-8b-instant` | 50/50 | 0.457 | 0.573 | 3 | 57 | 58,627 | 9,795 | 0 | $0.0037 |
| `zero_shot` | `llama-3.1-8b-instant` | 50/50 | 0.431 | 0.553 | 4 | 54 | 56,756 | 9,488 | 0 | $0.0036 |

Per-field winners:

| Field | Winner | zero_shot | cot | few_shot |
| --- | --- | ---: | ---: | ---: |
| Chief complaint | `few_shot` | 0.526 | 0.564 | 0.632 |
| Vitals | `few_shot` | 0.920 | 0.935 | 0.995 |
| Medications F1 | `few_shot` | 0.277 | 0.349 | 0.393 |
| Diagnoses F1 | `few_shot` | 0.517 | 0.513 | 0.787 |
| Plan F1 | `few_shot` | 0.498 | 0.509 | 0.624 |
| Follow-up | `zero_shot` | 0.581 | 0.567 | 0.535 |
| Follow-up interval | `few_shot` | 0.620 | 0.600 | 0.720 |
| Follow-up reason | `zero_shot` | 0.541 | 0.533 | 0.351 |

Overall, `few_shot` is the strategy I would ship first. It was the only Llama strategy with zero schema failures, and it won every major field except the composite follow-up score. The follow-up exception came from weaker `follow_up.reason` wording, not interval extraction.

# Rate Limit Handling

The runner limits work to at most 5 concurrent cases and also uses a provider-aware limiter before each model call. Anthropic calls are spaced with a short minimum interval. Groq/Llama calls are spaced more conservatively and use a 6,000 TPM reservation window so the run does not blast the provider with 50 simultaneous requests.

If Anthropic or Groq returns a 429, the extractor surfaces the rate-limit error to the runner. The runner retries up to 3 times. When the provider supplies `retry-after`, that delay wins; otherwise it uses exponential backoff with small jitter. This is covered by the mocked rate-limit backoff test.

Prompt caching is implemented for Anthropic by adding `cache_control: { type: "ephemeral" }` to the stable system prompt path and surfacing `cache_read_input_tokens`. These Llama runs have `cache_read_input_tokens = 0` because Groq does not report Anthropic cache-read usage. The checklist item "repeated runs demonstrate cache reads increasing" still needs a real repeated Anthropic run to verify end to end.

# Hallucination Detection

The hallucination detector is deliberately simple and deterministic: it normalizes predicted values and checks for transcript support by substring, loose substring, numeric-token support, small clinical aliases, ICD-10 support through grounded diagnosis text, and fuzzy matching over transcript windows.

Hallucination flags by strategy:

| Strategy | Total Flags | Main Pattern |
| --- | ---: | --- |
| `few_shot` | 36 | Mostly diagnoses and chief complaint phrasing; far fewer medication flags than the other strategies. |
| `cot` | 57 | Medication flags dominated, with additional diagnosis and plan drift. |
| `zero_shot` | 54 | Medication flags dominated, followed by diagnosis flags. |

Field-level hallucination counts:

| Strategy | Chief Complaint | Medications | Diagnoses | Plan | Follow-up Reason |
| --- | ---: | ---: | ---: | ---: | ---: |
| `zero_shot` | 4 | 31 | 13 | 1 | 5 |
| `cot` | 4 | 33 | 14 | 4 | 2 |
| `few_shot` | 11 | 7 | 15 | 3 | 0 |

This detector is useful for surfacing suspicious values, but it is intentionally conservative. Some flags are likely paraphrase false positives, especially for diagnosis descriptions and chief complaints.

# Why Each Strategy Wins or Loses Per Field

`few_shot` wins vitals because the examples seem to anchor the exact object shape and null/value behavior. It nearly perfects vitals with 0.995 and avoids the schema-invalid cases that hurt the other two strategies.

`few_shot` also wins medications, diagnoses, and plan because examples teach the model the extraction granularity: medications need dose and frequency, diagnoses should be concise condition descriptions, and plan items should be individual actionable items. Even so, medication F1 is still low at 0.393, which says the matcher and extraction prompt both need more work around medication normalization.

`zero_shot` loses most fields because it has less guidance and produced 4 schema failures. It still wins `follow_up.reason`, probably because it stays shorter and closer to the transcript wording instead of rewriting the reason.

`cot` does not help here. It improves medications and plan over `zero_shot`, but it adds enough schema failures and hallucination flags that it trails `few_shot` badly. For this model, "think through the encounter" appears to invite extra unsupported structure instead of cleaner extraction.

# What Surprised Me

The biggest surprise was that `cot` was not a middle ground between `zero_shot` and `few_shot`. It was only modestly better than `zero_shot` overall and had the highest hallucination count.

The second surprise was how much of the total weakness concentrates in medications. Vitals are basically solved by prompting and schema constraints; medication extraction still needs better normalization, aliasing, and perhaps a field-specific verifier.

The third surprise was the duplicate `few_shot` Llama run: it reproduced exactly, including scores and token counts. That is a good sign for determinism at `temperature: 0`.

# What I'd Build Next

I would add a field-specific medication normalizer/verifier first: route aliases, frequency aliases, dose unit cleanup, and a small support checker that understands "twice a day", "BID", and "two puffs" without over-flagging.

Next I would run the same three-strategy comparison on Anthropic Haiku to verify prompt caching with real `cache_read_input_tokens`, then paste the dashboard evidence into this note.

I would also add a regression report that lists the highest-disagreement cases across strategies. Cases like `case_029`, `case_030`, `case_038`, and `case_039` are where annotation review or prompt changes would pay off fastest.

# What I Cut

I did not add active-learning ranking or prompt-diff views beyond the required comparison screen.

I did not tune prompts case-by-case against the 50 examples; the goal was a harness that can survive a swapped eval set.

I did not verify the clean-clone command or the under-$1 full three-strategy Haiku run from this machine. The Llama three-strategy run was far under $1, but the checklist still needs a real Haiku cost run and a clean-clone smoke test before final submission.
