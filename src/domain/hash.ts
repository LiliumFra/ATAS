import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson, legacyCanonicalJson } from './canonical.js';

export const GENESIS_HASH = '0'.repeat(64);

type Canonicalizer = (payload: unknown) => string;

function calculateHash(
  previousHash: string,
  payload: unknown,
  secret: string,
  canonicalize: Canonicalizer,
): string {
  return createHmac('sha256', secret)
    .update(previousHash, 'utf8')
    .update('\n', 'utf8')
    .update(canonicalize(payload), 'utf8')
    .digest('hex');
}

export function chainHash(previousHash: string, payload: unknown, secret: string): string {
  return calculateHash(previousHash, payload, secret, canonicalJson);
}

export function legacyChainHash(previousHash: string, payload: unknown, secret: string): string {
  return calculateHash(previousHash, payload, secret, legacyCanonicalJson);
}

export function hashesEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyChain(
  records: readonly { previousHash: string; hash: string; payload: unknown }[],
  secret: string,
): { valid: boolean; invalidIndex?: number; legacyRecords?: number } {
  let expectedPrevious = GENESIS_HASH;
  let legacyRecords = 0;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined) continue;

    if (!hashesEqual(record.previousHash, expectedPrevious)) {
      return { valid: false, invalidIndex: index };
    }

    const currentHash = chainHash(record.previousHash, record.payload, secret);
    if (!hashesEqual(record.hash, currentHash)) {
      const legacyHash = legacyChainHash(record.previousHash, record.payload, secret);
      if (!hashesEqual(record.hash, legacyHash)) {
        return { valid: false, invalidIndex: index };
      }
      legacyRecords += 1;
    }

    expectedPrevious = record.hash;
  }

  return legacyRecords === 0 ? { valid: true } : { valid: true, legacyRecords };
}
