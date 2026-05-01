export interface SetMatch<TGold, TPrediction> {
  gold: TGold;
  prediction: TPrediction;
  score: number;
}

export interface SetF1Result<TGold, TPrediction> {
  precision: number;
  recall: number;
  f1: number;
  matches: SetMatch<TGold, TPrediction>[];
  falsePositives: TPrediction[];
  falseNegatives: TGold[];
}

export function calculateF1(precision: number, recall: number): number {
  if (precision === 0 && recall === 0) {
    return 0;
  }

  return (2 * precision * recall) / (precision + recall);
}

export function setF1<TGold, TPrediction>(
  goldItems: TGold[],
  predictionItems: TPrediction[],
  scorePair: (gold: TGold, prediction: TPrediction) => number,
  threshold: number,
): SetF1Result<TGold, TPrediction> {
  if (goldItems.length === 0 && predictionItems.length === 0) {
    return {
      precision: 1,
      recall: 1,
      f1: 1,
      matches: [],
      falsePositives: [],
      falseNegatives: [],
    };
  }

  const candidates: Array<{ goldIndex: number; predictionIndex: number; score: number }> = [];
  for (let goldIndex = 0; goldIndex < goldItems.length; goldIndex += 1) {
    const gold = goldItems[goldIndex];
    if (gold === undefined) {
      continue;
    }

    for (let predictionIndex = 0; predictionIndex < predictionItems.length; predictionIndex += 1) {
      const prediction = predictionItems[predictionIndex];
      if (prediction === undefined) {
        continue;
      }

      const score = scorePair(gold, prediction);
      if (score >= threshold) {
        candidates.push({ goldIndex, predictionIndex, score });
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score);

  const usedGold = new Set<number>();
  const usedPredictions = new Set<number>();
  const matches: SetMatch<TGold, TPrediction>[] = [];

  for (const candidate of candidates) {
    if (usedGold.has(candidate.goldIndex) || usedPredictions.has(candidate.predictionIndex)) {
      continue;
    }

    const gold = goldItems[candidate.goldIndex];
    const prediction = predictionItems[candidate.predictionIndex];
    if (gold === undefined || prediction === undefined) {
      continue;
    }

    usedGold.add(candidate.goldIndex);
    usedPredictions.add(candidate.predictionIndex);
    matches.push({ gold, prediction, score: candidate.score });
  }

  const falsePositives = predictionItems.filter((_, index) => !usedPredictions.has(index));
  const falseNegatives = goldItems.filter((_, index) => !usedGold.has(index));
  const precision = predictionItems.length === 0 ? 0 : matches.length / predictionItems.length;
  const recall = goldItems.length === 0 ? 0 : matches.length / goldItems.length;

  return {
    precision,
    recall,
    f1: calculateF1(precision, recall),
    matches,
    falsePositives,
    falseNegatives,
  };
}
