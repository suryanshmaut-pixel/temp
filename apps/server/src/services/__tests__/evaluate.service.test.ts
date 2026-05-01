import { describe, expect, test } from "bun:test";
import type { ClinicalExtraction } from "@test-evals/shared";

import { evaluateCase } from "../evaluate.service";
import { loadDataset } from "../dataset.service";
import { fuzzyScore } from "../evaluation/fuzzy";
import { setF1 } from "../evaluation/set-f1";

const baseExtraction: ClinicalExtraction = {
  chief_complaint: "cough and fever",
  vitals: {
    bp: "128/82",
    hr: 88,
    temp_f: 98.6,
    spo2: 97,
  },
  medications: [
    {
      name: "amoxicillin",
      dose: "500 mg",
      frequency: "twice daily",
      route: "oral",
    },
  ],
  diagnoses: [
    {
      description: "acute bacterial sinusitis",
      icd10: "J01.90",
    },
  ],
  plan: ["start antibiotics", "use saline nasal spray"],
  follow_up: {
    interval_days: 7,
    reason: "if symptoms do not improve",
  },
};

const transcript = [
  "Patient reports cough and fever.",
  "Vitals are blood pressure 128/82, heart rate 88, temperature 98.6, and oxygen saturation 97 percent.",
  "We discussed acute bacterial sinusitis, ICD code J01.90.",
  "Start amoxicillin 500 mg twice daily by mouth.",
  "Use saline nasal spray and follow up in 7 days if symptoms do not improve.",
].join(" ");

function evaluate(prediction: ClinicalExtraction | null, schemaValid = true) {
  return evaluateCase({
    caseId: "case_001",
    transcriptId: "case_001",
    runId: "run_001",
    transcript,
    gold: baseExtraction,
    prediction,
    schemaValid,
  });
}

function scoreFor(evaluation: ReturnType<typeof evaluate>, field: string) {
  const score = evaluation.fieldScores.find((item) => item.field === field);
  if (score === undefined) {
    throw new Error(`Missing score for ${field}`);
  }
  return score;
}

describe("evaluateCase", () => {
  test("scores chief complaint with fuzzy matching", () => {
    expect(fuzzyScore("cough with fever", "fever and cough")).toBeGreaterThan(0.75);
  });

  test("accepts temperature within numeric tolerance", () => {
    const prediction: ClinicalExtraction = {
      ...baseExtraction,
      vitals: {
        ...baseExtraction.vitals,
        temp_f: 98.75,
      },
    };

    const result = evaluate(prediction);

    expect(scoreFor(result, "vitals.temp_f").score).toBe(1);
  });

  test("handles matching null vitals", () => {
    const gold: ClinicalExtraction = {
      ...baseExtraction,
      vitals: {
        ...baseExtraction.vitals,
        bp: null,
      },
    };
    const prediction: ClinicalExtraction = {
      ...gold,
      vitals: {
        ...gold.vitals,
        bp: null,
      },
    };

    const result = evaluateCase({
      caseId: "case_001",
      transcriptId: "case_001",
      runId: "run_001",
      transcript,
      gold,
      prediction,
      schemaValid: true,
    });

    expect(scoreFor(result, "vitals.bp").score).toBe(1);
  });

  test("matches medications with normalized dose and frequency", () => {
    const prediction: ClinicalExtraction = {
      ...baseExtraction,
      medications: [
        {
          name: "Amoxicillin",
          dose: "500mg",
          frequency: "BID",
          route: "PO",
        },
      ],
    };

    const result = evaluate(prediction);

    expect(scoreFor(result, "medications").f1).toBe(1);
  });

  test("computes set F1 on a tiny synthetic case", () => {
    const result = setF1(
      ["alpha", "beta"],
      ["alpha", "gamma"],
      (gold, prediction) => (gold === prediction ? 1 : 0),
      1,
    );

    expect(result.precision).toBe(0.5);
    expect(result.recall).toBe(0.5);
    expect(result.f1).toBe(0.5);
  });

  test("keeps diagnosis match when ICD-10 also matches", () => {
    const prediction: ClinicalExtraction = {
      ...baseExtraction,
      diagnoses: [
        {
          description: "bacterial sinusitis acute",
          icd10: "J01.90",
        },
      ],
    };

    const result = evaluate(prediction);

    expect(scoreFor(result, "diagnoses").f1).toBe(1);
  });

  test("flags unsupported predicted values as hallucinations", () => {
    const prediction: ClinicalExtraction = {
      ...baseExtraction,
      medications: [
        ...baseExtraction.medications,
        {
          name: "prednisone",
          dose: "40 mg",
          frequency: "daily",
          route: "oral",
        },
      ],
    };

    const result = evaluate(prediction);

    expect(result.hallucinations.some((item) => item.value === "prednisone")).toBe(true);
  });

  test("does not flag transcript-supported prediction values", () => {
    const result = evaluate(baseExtraction);

    expect(result.hallucinations.some((item) => item.value === "amoxicillin")).toBe(false);
  });

  test("does not flag the provided gold case when used as its own prediction", () => {
    const datasetCase = loadDataset({ caseIds: ["case_001"] })[0];

    if (datasetCase === undefined) {
      throw new Error("Missing dataset case case_001.");
    }

    const result = evaluateCase({
      caseId: "case_001",
      transcriptId: "case_001",
      runId: "run_001",
      transcript: datasetCase.transcript,
      gold: datasetCase.gold,
      prediction: datasetCase.gold,
      schemaValid: true,
    });

    expect(result.aggregateScore).toBe(1);
    expect(result.aggregateF1).toBe(1);
    expect(result.hallucinationCount).toBe(0);
  });

  test("returns zeroed scores for schema-invalid predictions", () => {
    const result = evaluate(null, false);

    expect(result.schemaValid).toBe(false);
    expect(result.aggregateScore).toBe(0);
    expect(result.aggregateF1).toBe(0);
    expect(result.hallucinationCount).toBe(0);
  });
});
