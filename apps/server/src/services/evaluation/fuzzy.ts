import { normalizeText, tokenize } from "./normalize";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "of",
  "the",
  "to",
  "with",
]);

function bigrams(value: string): Set<string> {
  const compact = normalizeText(value).replace(/\s+/g, "");
  if (compact.length < 2) {
    return new Set(compact.length === 0 ? [] : [compact]);
  }

  const grams = new Set<string>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    grams.add(compact.slice(index, index + 2));
  }
  return grams;
}

function diceCoefficient(left: string, right: string): number {
  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);

  if (leftGrams.size === 0 && rightGrams.size === 0) {
    return 1;
  }

  if (leftGrams.size === 0 || rightGrams.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) {
      overlap += 1;
    }
  }

  return (2 * overlap) / (leftGrams.size + rightGrams.size);
}

function tokenSetScore(left: string, right: string): number {
  const leftMeaningfulTokens = tokenize(left).filter((token) => !STOP_WORDS.has(token));
  const rightMeaningfulTokens = tokenize(right).filter((token) => !STOP_WORDS.has(token));
  const leftTokens = new Set(leftMeaningfulTokens.length === 0 ? tokenize(left) : leftMeaningfulTokens);
  const rightTokens = new Set(rightMeaningfulTokens.length === 0 ? tokenize(right) : rightMeaningfulTokens);

  if (leftTokens.size === 0 && rightTokens.size === 0) {
    return 1;
  }

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  const smaller = Math.min(leftTokens.size, rightTokens.size);
  const larger = Math.max(leftTokens.size, rightTokens.size);
  const containment = smaller === 0 ? 0 : intersection / smaller;
  const jaccard = intersection / (leftTokens.size + rightTokens.size - intersection);

  return Math.max(jaccard, containment * 0.92, intersection / larger);
}

export function fuzzyScore(left: string | null | undefined, right: string | null | undefined): number {
  if ((left === null || left === undefined) && (right === null || right === undefined)) {
    return 1;
  }

  if (left === null || left === undefined || right === null || right === undefined) {
    return 0;
  }

  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);

  if (normalizedLeft.length === 0 && normalizedRight.length === 0) {
    return 1;
  }

  if (normalizedLeft.length === 0 || normalizedRight.length === 0) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return Math.max(0.9, tokenSetScore(normalizedLeft, normalizedRight));
  }

  return Math.max(
    tokenSetScore(normalizedLeft, normalizedRight),
    diceCoefficient(normalizedLeft, normalizedRight),
  );
}

export function fuzzyPass(
  left: string | null | undefined,
  right: string | null | undefined,
  threshold: number,
): boolean {
  return fuzzyScore(left, right) >= threshold;
}
