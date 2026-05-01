import type {
  ClinicalExtraction,
  EvaluatedField,
  HallucinationFinding,
} from "@test-evals/shared";

import { fuzzyScore } from "./fuzzy";
import { normalizeLooseText, normalizeText, tokenize } from "./normalize";

interface PredictionValue {
  field: EvaluatedField;
  value: string;
  supportValues?: string[];
}

const MIN_GROUNDING_LENGTH = 3;
const WINDOW_PADDING = 4;
const SUPPORT_THRESHOLD = 0.65;
const GROUNDING_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "for",
  "if",
  "in",
  "need",
  "no",
  "of",
  "only",
  "or",
  "return",
  "the",
  "to",
  "up",
  "with",
]);

const TOKEN_ALIASES = new Map([
  ["congestion", ["stuffed"]],
  ["nasal", ["nose"]],
  ["oral", ["mouth"]],
  ["po", ["mouth"]],
]);

function groundingToken(token: string): string {
  return token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

function flattenPrediction(prediction: ClinicalExtraction): PredictionValue[] {
  const values: PredictionValue[] = [
    { field: "chief_complaint", value: prediction.chief_complaint },
  ];

  if (prediction.vitals.bp !== null) {
    values.push({ field: "vitals.bp", value: prediction.vitals.bp });
  }
  if (prediction.vitals.hr !== null) {
    values.push({ field: "vitals.hr", value: String(prediction.vitals.hr) });
  }
  if (prediction.vitals.temp_f !== null) {
    values.push({ field: "vitals.temp_f", value: String(prediction.vitals.temp_f) });
  }
  if (prediction.vitals.spo2 !== null) {
    values.push({ field: "vitals.spo2", value: String(prediction.vitals.spo2) });
  }

  for (const medication of prediction.medications) {
    values.push({ field: "medications", value: medication.name });
    if (medication.dose !== null) {
      values.push({ field: "medications", value: medication.dose });
    }
    if (medication.frequency !== null) {
      values.push({ field: "medications", value: medication.frequency });
    }
    if (medication.route !== null && normalizeText(medication.route).length > 3) {
      values.push({ field: "medications", value: medication.route });
    }
  }

  for (const diagnosis of prediction.diagnoses) {
    values.push({ field: "diagnoses", value: diagnosis.description });
    if (diagnosis.icd10 !== undefined) {
      values.push({ field: "diagnoses", value: diagnosis.icd10, supportValues: [diagnosis.description] });
    }
  }

  for (const item of prediction.plan) {
    values.push({ field: "plan", value: item });
  }

  if (prediction.follow_up.interval_days !== null) {
    values.push({ field: "follow_up.interval_days", value: String(prediction.follow_up.interval_days) });
  }
  if (prediction.follow_up.reason !== null) {
    values.push({ field: "follow_up.reason", value: prediction.follow_up.reason });
  }

  return values;
}

function transcriptWindows(transcript: string, value: string): string[] {
  const transcriptTokens = tokenize(transcript);
  const valueTokenCount = Math.max(1, tokenize(value).length);
  const windowSize = Math.min(
    transcriptTokens.length,
    Math.max(valueTokenCount + WINDOW_PADDING, valueTokenCount * 2),
  );
  const windows: string[] = [];

  for (let index = 0; index <= transcriptTokens.length - windowSize; index += 1) {
    windows.push(transcriptTokens.slice(index, index + windowSize).join(" "));
  }

  return windows.length === 0 ? [normalizeText(transcript)] : windows;
}

function hasNumericSupport(value: string, transcript: string): boolean {
  const numbers = normalizeText(value).match(/\d+(?:\.\d+)?/g) ?? [];
  if (numbers.length === 0) {
    return false;
  }

  const normalizedTranscript = normalizeText(transcript);
  return numbers.every((number) => normalizedTranscript.includes(number));
}

function expandTokens(value: string): Set<string> {
  const expanded = new Set<string>();

  for (const rawToken of tokenize(value)) {
    const token = groundingToken(rawToken);
    if (token.length === 0) {
      continue;
    }

    expanded.add(token);
    for (const alias of TOKEN_ALIASES.get(token) ?? []) {
      expanded.add(alias);
    }
  }

  return expanded;
}

function hasTokenSupport(value: string, transcript: string): boolean {
  const valueTokens = tokenize(value)
    .map(groundingToken)
    .filter((token) => token.length > 0 && !GROUNDING_STOP_WORDS.has(token));
  if (valueTokens.length < 2) {
    return false;
  }

  const transcriptTokens = expandTokens(transcript);
  const supported = valueTokens.filter((token) => transcriptTokens.has(token) || (TOKEN_ALIASES.get(token) ?? [])
    .some((alias) => transcriptTokens.has(alias)));

  return supported.length / valueTokens.length >= SUPPORT_THRESHOLD;
}

function isGrounded(value: string, transcript: string, supportValues: string[] = []): boolean {
  const normalizedValue = normalizeText(value);
  if (normalizedValue.length < MIN_GROUNDING_LENGTH) {
    return true;
  }

  const normalizedTranscript = normalizeText(transcript);
  if (normalizedTranscript.includes(normalizedValue)) {
    return true;
  }

  const looseValue = normalizeLooseText(value);
  if (looseValue.length >= MIN_GROUNDING_LENGTH && normalizeLooseText(transcript).includes(looseValue)) {
    return true;
  }

  if (hasNumericSupport(value, transcript)) {
    return true;
  }

  if (hasTokenSupport(value, transcript)) {
    return true;
  }

  if (supportValues.some((supportValue) => isGrounded(supportValue, transcript))) {
    return true;
  }

  return transcriptWindows(transcript, value).some((window) => fuzzyScore(value, window) >= 0.82);
}

export function detectHallucinations(
  transcript: string,
  prediction: ClinicalExtraction | null,
): HallucinationFinding[] {
  if (prediction === null) {
    return [];
  }

  const findings: HallucinationFinding[] = [];
  for (const item of flattenPrediction(prediction)) {
    const normalizedValue = normalizeText(item.value);
    if (normalizedValue.length < MIN_GROUNDING_LENGTH) {
      continue;
    }

    if (!isGrounded(item.value, transcript, item.supportValues)) {
      findings.push({
        field: item.field,
        value: item.value,
        supported: false,
        reason: "Value was not found as a normalized substring or close fuzzy match in the transcript.",
      });
    }
  }

  return findings;
}
