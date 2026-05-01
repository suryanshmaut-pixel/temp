import type {
  CaseEvaluation,
  ClinicalDiagnosis,
  ClinicalExtraction,
  ClinicalMedication,
  FieldEvaluation,
} from "@test-evals/shared";

import { aggregateFieldScores, caseAggregateF1, caseAggregateScore, average } from "./evaluation/aggregate";
import { detectHallucinations } from "./evaluation/hallucination";
import {
  normalizeDose,
  normalizeFrequency,
  normalizeRoute,
  valuesEqualNormalized,
} from "./evaluation/normalize";
import { fuzzyScore } from "./evaluation/fuzzy";
import { setF1 } from "./evaluation/set-f1";

export interface EvaluateCaseInput {
  caseId: string;
  transcriptId: string;
  runId: string;
  extractionResultId?: string;
  transcript: string;
  gold: ClinicalExtraction;
  prediction: ClinicalExtraction | null;
  schemaValid: boolean;
}

const ZERO_FIELD_SCORES: FieldEvaluation[] = [
  { field: "chief_complaint", score: 0, metric: "fuzzy" },
  { field: "vitals.bp", score: 0, metric: "exact" },
  { field: "vitals.hr", score: 0, metric: "exact" },
  { field: "vitals.temp_f", score: 0, metric: "numeric_tolerance" },
  { field: "vitals.spo2", score: 0, metric: "exact" },
  { field: "vitals", score: 0, metric: "composite" },
  { field: "medications", score: 0, metric: "set_f1", precision: 0, recall: 0, f1: 0 },
  { field: "diagnoses", score: 0, metric: "set_f1", precision: 0, recall: 0, f1: 0 },
  { field: "plan", score: 0, metric: "set_f1", precision: 0, recall: 0, f1: 0 },
  { field: "follow_up.interval_days", score: 0, metric: "exact" },
  { field: "follow_up.reason", score: 0, metric: "fuzzy" },
  { field: "follow_up", score: 0, metric: "composite" },
];

function exactNullableNumber(left: number | null, right: number | null): number {
  return left === right ? 1 : 0;
}

function numericTolerance(left: number | null, right: number | null, tolerance: number): number {
  if (left === null && right === null) {
    return 1;
  }

  if (left === null || right === null) {
    return 0;
  }

  return Math.abs(left - right) <= tolerance ? 1 : 0;
}

function evaluateVitals(gold: ClinicalExtraction, prediction: ClinicalExtraction): FieldEvaluation[] {
  const bpScore = valuesEqualNormalized(gold.vitals.bp, prediction.vitals.bp) ? 1 : 0;
  const hrScore = exactNullableNumber(gold.vitals.hr, prediction.vitals.hr);
  const tempScore = numericTolerance(gold.vitals.temp_f, prediction.vitals.temp_f, 0.2);
  const spo2Score = exactNullableNumber(gold.vitals.spo2, prediction.vitals.spo2);

  return [
    { field: "vitals.bp", score: bpScore, metric: "exact" },
    { field: "vitals.hr", score: hrScore, metric: "exact" },
    {
      field: "vitals.temp_f",
      score: tempScore,
      metric: "numeric_tolerance",
      details: "Temperature accepts +/-0.2 F.",
    },
    { field: "vitals.spo2", score: spo2Score, metric: "exact" },
    {
      field: "vitals",
      score: average([bpScore, hrScore, tempScore, spo2Score]),
      metric: "composite",
    },
  ];
}

function scoreMedicationPair(gold: ClinicalMedication, prediction: ClinicalMedication): number {
  const nameScore = fuzzyScore(gold.name, prediction.name);
  if (nameScore < 0.85) {
    return 0;
  }

  if (normalizeDose(gold.dose) !== normalizeDose(prediction.dose)) {
    return 0;
  }

  if (normalizeFrequency(gold.frequency) !== normalizeFrequency(prediction.frequency)) {
    return 0;
  }

  const routeScore = normalizeRoute(gold.route) === normalizeRoute(prediction.route) ? 1 : 0.95;
  return Math.min(1, nameScore * routeScore);
}

function evaluateMedications(gold: ClinicalExtraction, prediction: ClinicalExtraction): FieldEvaluation {
  const result = setF1(gold.medications, prediction.medications, scoreMedicationPair, 0.85);

  return {
    field: "medications",
    score: result.f1,
    metric: "set_f1",
    precision: result.precision,
    recall: result.recall,
    f1: result.f1,
    details: `${result.matches.length} matched, ${result.falsePositives.length} hallucinated/extra, ${result.falseNegatives.length} missed.`,
  };
}

function scoreDiagnosisPair(gold: ClinicalDiagnosis, prediction: ClinicalDiagnosis): number {
  const descriptionScore = fuzzyScore(gold.description, prediction.description);
  if (descriptionScore < 0.82) {
    return 0;
  }

  if (gold.icd10 !== undefined && prediction.icd10 !== undefined && gold.icd10 === prediction.icd10) {
    return Math.min(1, descriptionScore + 0.05);
  }

  return descriptionScore;
}

function evaluateDiagnoses(gold: ClinicalExtraction, prediction: ClinicalExtraction): FieldEvaluation {
  const result = setF1(gold.diagnoses, prediction.diagnoses, scoreDiagnosisPair, 0.82);
  const icd10Matches = result.matches.filter(
    (match) =>
      match.gold.icd10 !== undefined &&
      match.prediction.icd10 !== undefined &&
      match.gold.icd10 === match.prediction.icd10,
  ).length;

  return {
    field: "diagnoses",
    score: result.f1,
    metric: "set_f1",
    precision: result.precision,
    recall: result.recall,
    f1: result.f1,
    details: `${result.matches.length} matched; ${icd10Matches} ICD-10 codes matched.`,
  };
}

function evaluatePlan(gold: ClinicalExtraction, prediction: ClinicalExtraction): FieldEvaluation {
  const result = setF1(
    gold.plan,
    prediction.plan,
    (goldItem, predictionItem) => fuzzyScore(goldItem, predictionItem),
    0.78,
  );

  return {
    field: "plan",
    score: result.f1,
    metric: "set_f1",
    precision: result.precision,
    recall: result.recall,
    f1: result.f1,
    details: `${result.matches.length} matched, ${result.falsePositives.length} extra, ${result.falseNegatives.length} missed.`,
  };
}

function evaluateFollowUp(gold: ClinicalExtraction, prediction: ClinicalExtraction): FieldEvaluation[] {
  const intervalScore = exactNullableNumber(gold.follow_up.interval_days, prediction.follow_up.interval_days);
  const reasonScore = fuzzyScore(gold.follow_up.reason, prediction.follow_up.reason);

  return [
    { field: "follow_up.interval_days", score: intervalScore, metric: "exact" },
    { field: "follow_up.reason", score: reasonScore, metric: "fuzzy" },
    {
      field: "follow_up",
      score: average([intervalScore, reasonScore]),
      metric: "composite",
    },
  ];
}

function evaluateFields(gold: ClinicalExtraction, prediction: ClinicalExtraction): FieldEvaluation[] {
  return [
    {
      field: "chief_complaint",
      score: fuzzyScore(gold.chief_complaint, prediction.chief_complaint),
      metric: "fuzzy",
    },
    ...evaluateVitals(gold, prediction),
    evaluateMedications(gold, prediction),
    evaluateDiagnoses(gold, prediction),
    evaluatePlan(gold, prediction),
    ...evaluateFollowUp(gold, prediction),
  ];
}

export function evaluateCase(input: EvaluateCaseInput): CaseEvaluation {
  const fieldScores =
    input.schemaValid && input.prediction !== null
      ? evaluateFields(input.gold, input.prediction)
      : ZERO_FIELD_SCORES.map((score) => ({ ...score }));
  const hallucinations =
    input.schemaValid && input.prediction !== null
      ? detectHallucinations(input.transcript, input.prediction)
      : [];

  return {
    caseId: input.caseId,
    transcriptId: input.transcriptId,
    runId: input.runId,
    extractionResultId: input.extractionResultId,
    schemaValid: input.schemaValid,
    fieldScores,
    aggregateScore: caseAggregateScore(fieldScores),
    aggregateF1: caseAggregateF1(fieldScores),
    hallucinations,
    hallucinationCount: hallucinations.length,
    gold: input.gold,
    prediction: input.prediction,
    evaluatedAt: new Date().toISOString(),
  };
}

export { aggregateFieldScores, detectHallucinations };
