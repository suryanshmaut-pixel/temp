import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ClinicalExtraction, DatasetFilter } from "@test-evals/shared";
import { validateExtraction } from "@test-evals/llm";

export interface DatasetCase {
  caseId: string;
  transcriptId: string;
  transcript: string;
  gold: ClinicalExtraction;
}

function findDataDir(): string {
  const candidates = [
    join(process.cwd(), "data"),
    join(process.cwd(), "..", "..", "data"),
  ];

  const dataDir = candidates.find(
    (candidate) => existsSync(join(candidate, "transcripts")) && existsSync(join(candidate, "gold")),
  );

  if (dataDir === undefined) {
    throw new Error(`Could not find dataset directory from ${process.cwd()}. Expected data/transcripts and data/gold.`);
  }

  return dataDir;
}

function caseIdFromFilename(filename: string): string {
  return basename(filename).replace(/\.(txt|json)$/u, "");
}

function applyDatasetFilter(cases: DatasetCase[], filter?: DatasetFilter): DatasetCase[] {
  let filtered = cases;

  if (filter?.caseIds !== undefined && filter.caseIds.length > 0) {
    const selected = new Set(filter.caseIds);
    filtered = filtered.filter((item) => selected.has(item.caseId));
  }

  const offset = filter?.offset ?? 0;
  const limit = filter?.limit;

  return filtered.slice(offset, limit === undefined ? undefined : offset + limit);
}

export function loadDataset(filter?: DatasetFilter): DatasetCase[] {
  const dataDir = findDataDir();
  const transcriptsDir = join(dataDir, "transcripts");
  const goldDir = join(dataDir, "gold");

  const transcriptFiles = readdirSync(transcriptsDir)
    .filter((file) => file.endsWith(".txt"))
    .sort((left, right) => left.localeCompare(right));

  const cases = transcriptFiles.map((file) => {
    const caseId = caseIdFromFilename(file);
    const goldPath = join(goldDir, `${caseId}.json`);
    const transcript = readFileSync(join(transcriptsDir, file), "utf8");
    const goldCandidate = JSON.parse(readFileSync(goldPath, "utf8")) as unknown;
    const validation = validateExtraction(goldCandidate);

    if (!validation.schemaValid || validation.extraction === null) {
      throw new Error(`Gold file ${goldPath} does not match data/schema.json.`);
    }

    return {
      caseId,
      transcriptId: caseId,
      transcript,
      gold: validation.extraction,
    };
  });

  return applyDatasetFilter(cases, filter);
}
