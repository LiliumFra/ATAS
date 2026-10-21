type KeyComparator = (left: string, right: string) => number;

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalize(value: unknown, compareKeys: KeyComparator): unknown {
  if (Array.isArray(value)) return value.map((item) => normalize(item, compareKeys));

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => compareKeys(left, right))
        .map(([key, item]) => [key, normalize(item, compareKeys)]),
    );
  }

  return value;
}

/** Stable ordinal-key canonical JSON used by all records created from ATAS 1.2 onward. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, ordinalCompare));
}

/** Compatibility only for records created before the ordinal canonicalisation migration. */
export function legacyCanonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, (left, right) => left.localeCompare(right)));
}
