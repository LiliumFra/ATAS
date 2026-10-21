import { ValidationError } from './errors.js';

const MAX_DEPTH = 12;
const MAX_NODES = 10_000;
const MAX_KEYS_PER_OBJECT = 1_000;
const MAX_ARRAY_ITEMS = 2_000;
const MAX_KEY_LENGTH = 256;
const MAX_STRING_LENGTH = 32_768;

type WorkItem = { value: unknown; depth: number };

/**
 * Bounds arbitrary JSON evidence before canonicalisation, persistence, logging and audit hashing.
 * This prevents deeply nested or extremely fragmented payloads from becoming a CPU/stack denial
 * of service while leaving domain-specific evidence schemas to competition adapters.
 */
export function assertBoundedJsonObject(
  value: unknown,
  field: string,
): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) throw new ValidationError(`${field} must be a JSON object`);

  const work: WorkItem[] = [{ value, depth: 0 }];
  let nodes = 0;
  while (work.length > 0) {
    const current = work.pop();
    if (current === undefined) break;
    nodes += 1;
    if (nodes > MAX_NODES) throw new ValidationError(`${field} exceeds the JSON node limit`);
    if (current.depth > MAX_DEPTH)
      throw new ValidationError(`${field} exceeds the JSON depth limit`);

    if (typeof current.value === 'string') {
      if (current.value.length > MAX_STRING_LENGTH) {
        throw new ValidationError(`${field} contains an oversized string`);
      }
      continue;
    }
    if (
      current.value === null ||
      typeof current.value === 'boolean' ||
      (typeof current.value === 'number' && Number.isFinite(current.value))
    ) {
      continue;
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > MAX_ARRAY_ITEMS) {
        throw new ValidationError(`${field} contains an oversized array`);
      }
      for (const item of current.value) work.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    if (!isPlainObject(current.value)) {
      throw new ValidationError(`${field} contains a non-JSON value`);
    }

    const entries = Object.entries(current.value);
    if (entries.length > MAX_KEYS_PER_OBJECT) {
      throw new ValidationError(`${field} contains an object with too many keys`);
    }
    for (const [key, item] of entries) {
      if (key.length > MAX_KEY_LENGTH)
        throw new ValidationError(`${field} contains an oversized key`);
      work.push({ value: item, depth: current.depth + 1 });
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
