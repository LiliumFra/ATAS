import { describe, expect, it } from 'vitest';
import { chainHash, GENESIS_HASH, legacyChainHash, verifyChain } from '../src/domain/hash.js';

const secret = 'a-production-like-test-secret-that-is-long-enough';

describe('hash chain', () => {
  it('verifies an intact chain', () => {
    const firstPayload = { action: 'created', value: 1 };
    const firstHash = chainHash(GENESIS_HASH, firstPayload, secret);
    const secondPayload = { action: 'confirmed', value: 2 };
    const secondHash = chainHash(firstHash, secondPayload, secret);

    expect(
      verifyChain(
        [
          { previousHash: GENESIS_HASH, hash: firstHash, payload: firstPayload },
          { previousHash: firstHash, hash: secondHash, payload: secondPayload },
        ],
        secret,
      ),
    ).toEqual({ valid: true });
  });

  it('verifies legacy locale-sorted records while new records use ordinal canonicalisation', () => {
    const payload = { ä: 1, z: 2 };
    const hash = legacyChainHash(GENESIS_HASH, payload, secret);
    expect(verifyChain([{ previousHash: GENESIS_HASH, hash, payload }], secret)).toEqual({
      valid: true,
      legacyRecords: 1,
    });
  });

  it('detects payload tampering', () => {
    const payload = { action: 'created', value: 1 };
    const hash = chainHash(GENESIS_HASH, payload, secret);
    expect(
      verifyChain(
        [{ previousHash: GENESIS_HASH, hash, payload: { ...payload, value: 99 } }],
        secret,
      ),
    ).toEqual({ valid: false, invalidIndex: 0 });
  });
});
