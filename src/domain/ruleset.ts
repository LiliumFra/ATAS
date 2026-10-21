import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EVENT_KINDS, PERIODS, type CompensationMode, type Ruleset } from './types.js';

const MODES = new Set<CompensationMode>(['FULL', 'EXCESS', 'MANUAL', 'NONE']);

export async function loadRuleset(path: string, expectedSha256?: string): Promise<Ruleset> {
  const raw = await readFile(resolve(path), 'utf8');
  const sha256 = createHash('sha256').update(raw).digest('hex');

  if (expectedSha256 !== undefined && sha256 !== expectedSha256.toLowerCase()) {
    throw new Error(
      `Ruleset SHA-256 mismatch: expected ${expectedSha256.toLowerCase()}, received ${sha256}`,
    );
  }

  const parsed: unknown = JSON.parse(raw);
  assertRuleset(parsed);
  return parsed;
}

function assertRuleset(value: unknown): asserts value is Ruleset {
  if (!isRecord(value)) throw new Error('Ruleset must be a JSON object');

  for (const field of ['id', 'version', 'effectiveFrom', 'description'] as const) {
    if (typeof value[field] !== 'string' || value[field].trim() === '') {
      throw new Error(`Ruleset ${field} must be a non-empty string`);
    }
  }

  if (!isRecord(value.nominalPeriodUs)) {
    throw new Error('Ruleset nominalPeriodUs must be an object');
  }
  for (const period of PERIODS) {
    const duration = value.nominalPeriodUs[period];
    if (!Number.isSafeInteger(duration) || (duration as number) <= 0) {
      throw new Error(`Ruleset nominal duration for ${period} must be a positive safe integer`);
    }
  }

  if (!isRecord(value.policies)) throw new Error('Ruleset policies must be an object');
  for (const kind of EVENT_KINDS) {
    const policy = value.policies[kind];
    if (!isRecord(policy)) throw new Error(`Missing policy for ${kind}`);
    if (typeof policy.mode !== 'string' || !MODES.has(policy.mode as CompensationMode)) {
      throw new Error(`Invalid policy mode for ${kind}`);
    }
    if (!Number.isSafeInteger(policy.graceUs) || (policy.graceUs as number) < 0) {
      throw new Error(`Invalid graceUs for ${kind}`);
    }
    if (typeof policy.description !== 'string' || policy.description.trim() === '') {
      throw new Error(`Missing policy description for ${kind}`);
    }
  }

  if (
    !isRecord(value.boardPolicy) ||
    value.boardPolicy.suggestion !== 'FLOOR_AND_CEIL' ||
    value.boardPolicy.refereeApprovalRequired !== true
  ) {
    throw new Error('Ruleset boardPolicy must require referee approval and FLOOR_AND_CEIL');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
