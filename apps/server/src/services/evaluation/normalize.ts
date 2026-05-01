const FREQUENCY_ALIASES = new Map<string, string>([
  ["bid", "twice daily"],
  ["b i d", "twice daily"],
  ["twice a day", "twice daily"],
  ["twice daily", "twice daily"],
  ["2x day", "twice daily"],
  ["2 times daily", "twice daily"],
  ["tid", "three times daily"],
  ["t i d", "three times daily"],
  ["three times a day", "three times daily"],
  ["three times daily", "three times daily"],
  ["qid", "four times daily"],
  ["four times a day", "four times daily"],
  ["four times daily", "four times daily"],
  ["qd", "daily"],
  ["qday", "daily"],
  ["once daily", "daily"],
  ["once a day", "daily"],
  ["daily", "daily"],
  ["qhs", "nightly"],
  ["at bedtime", "nightly"],
  ["nightly", "nightly"],
  ["prn", "as needed"],
  ["as needed", "as needed"],
]);

const ROUTE_ALIASES = new Map<string, string>([
  ["po", "oral"],
  ["p o", "oral"],
  ["by mouth", "oral"],
  ["oral", "oral"],
  ["iv", "iv"],
  ["intravenous", "iv"],
  ["im", "im"],
  ["intramuscular", "im"],
  ["sl", "sublingual"],
  ["sublingual", "sublingual"],
]);

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9./%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeLooseText(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}

export function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  return normalized.length === 0 ? [] : normalized.split(" ");
}

export function normalizeDose(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  return normalizeText(value)
    .replace(/\bmilligrams?\b/g, "mg")
    .replace(/\bmicrograms?\b/g, "mcg")
    .replace(/\bgrams?\b/g, "g")
    .replace(/\bmilliliters?\b/g, "ml")
    .replace(/\s+/g, "");
}

export function normalizeFrequency(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = normalizeText(value)
    .replace(/\bper\b/g, "")
    .replace(/\//g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return FREQUENCY_ALIASES.get(normalized) ?? normalized;
}

export function normalizeRoute(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = normalizeText(value);
  return ROUTE_ALIASES.get(normalized) ?? normalized;
}

export function normalizeNullableText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = normalizeText(value);
  return normalized.length === 0 ? null : normalized;
}

export function valuesEqualNormalized(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return normalizeNullableText(left) === normalizeNullableText(right);
}
