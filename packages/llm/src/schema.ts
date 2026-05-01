import { readFileSync } from "node:fs";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import type { ClinicalExtraction, SchemaValidationIssue } from "@test-evals/shared";

const DEFAULT_SCHEMA_URL = new URL("../../../data/schema.json", import.meta.url);

export type ExtractionSchema = Record<string, unknown>;

let cachedSchema: ExtractionSchema | null = null;
let cachedValidator: ReturnType<typeof compileExtractionValidator> | null = null;

export function loadExtractionSchema(schemaUrl: URL = DEFAULT_SCHEMA_URL): ExtractionSchema {
  if (schemaUrl.href === DEFAULT_SCHEMA_URL.href && cachedSchema !== null) {
    return cachedSchema;
  }

  const schema = JSON.parse(readFileSync(schemaUrl, "utf8")) as ExtractionSchema;

  if (schemaUrl.href === DEFAULT_SCHEMA_URL.href) {
    cachedSchema = schema;
  }

  return schema;
}

function issueFromAjvError(error: ErrorObject): SchemaValidationIssue {
  const path = error.instancePath.length === 0 ? "/" : error.instancePath;

  return {
    path,
    message: error.message ?? "Schema validation failed.",
    keyword: error.keyword,
  };
}

export function compileExtractionValidator(schema: ExtractionSchema) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  return (value: unknown): { valid: boolean; issues: SchemaValidationIssue[] } => {
    const valid = validate(value);

    return {
      valid,
      issues: valid ? [] : (validate.errors ?? []).map(issueFromAjvError),
    };
  };
}

export function validateExtraction(
  value: unknown,
  schema: ExtractionSchema = loadExtractionSchema(),
): { extraction: ClinicalExtraction | null; schemaValid: boolean; validationErrors: SchemaValidationIssue[] } {
  const validator =
    schema === cachedSchema && cachedValidator !== null
      ? cachedValidator
      : compileExtractionValidator(schema);

  if (schema === cachedSchema && cachedValidator === null) {
    cachedValidator = validator;
  }

  const result = validator(value);

  return {
    extraction: result.valid ? (value as ClinicalExtraction) : null,
    schemaValid: result.valid,
    validationErrors: result.issues,
  };
}
