import type { CaseEvaluation, EvaluatedField, FieldEvaluation } from "@test-evals/shared";

const AGGREGATE_FIELDS: EvaluatedField[] = [
  "chief_complaint",
  "vitals",
  "medications",
  "diagnoses",
  "plan",
  "follow_up",
];

const F1_FIELDS = new Set<EvaluatedField>(["medications", "diagnoses", "plan"]);

export function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function caseAggregateScore(fieldScores: FieldEvaluation[]): number {
  const scores = AGGREGATE_FIELDS.map((field) => fieldScores.find((score) => score.field === field)?.score)
    .filter((score): score is number => score !== undefined);

  return average(scores);
}

export function caseAggregateF1(fieldScores: FieldEvaluation[]): number {
  const scores = fieldScores
    .filter((score) => F1_FIELDS.has(score.field))
    .map((score) => score.f1 ?? score.score);

  return average(scores);
}

export function aggregateFieldScores(cases: CaseEvaluation[]): FieldEvaluation[] {
  const byField = new Map<EvaluatedField, FieldEvaluation[]>();

  for (const evaluation of cases) {
    for (const score of evaluation.fieldScores) {
      const existing = byField.get(score.field) ?? [];
      existing.push(score);
      byField.set(score.field, existing);
    }
  }

  return Array.from(byField.entries()).map(([field, scores]) => {
    const precisionValues = scores
      .map((score) => score.precision)
      .filter((score): score is number => score !== undefined);
    const recallValues = scores
      .map((score) => score.recall)
      .filter((score): score is number => score !== undefined);
    const f1Values = scores
      .map((score) => score.f1)
      .filter((score): score is number => score !== undefined);

    return {
      field,
      score: average(scores.map((score) => score.score)),
      metric: scores[0]?.metric ?? "composite",
      precision: precisionValues.length === 0 ? undefined : average(precisionValues),
      recall: recallValues.length === 0 ? undefined : average(recallValues),
      f1: f1Values.length === 0 ? undefined : average(f1Values),
      details: `Average across ${scores.length} cases.`,
    };
  });
}
