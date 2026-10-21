import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson, legacyCanonicalJson } from '../src/domain/canonical.js';

function optionalArgument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${name}`);
  return value;
}

function requiredArgument(name: string): string {
  const value = optionalArgument(name);
  if (value === undefined) throw new Error(`Missing --${name}`);
  return value;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function equalHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

type SignatureEnvelope = {
  algorithm: string;
  keyFingerprintSha256: string;
  publicKeyPem: string;
  valueBase64: string;
};

type CheckpointEnvelope = {
  checkpoint: unknown;
  canonicalSha256: string;
  signature: SignatureEnvelope | null;
};

const inputPath = resolve(requiredArgument('input'));
const trustedPublicKeyPath = optionalArgument('public-key');
const expectedFingerprint = optionalArgument('expected-fingerprint')?.toLowerCase();
const allowUnsigned = hasFlag('allow-unsigned');
const parsed = JSON.parse(await readFile(inputPath, 'utf8')) as Partial<CheckpointEnvelope>;

if (parsed.checkpoint === undefined || typeof parsed.canonicalSha256 !== 'string') {
  throw new Error('Invalid checkpoint envelope');
}

if (typeof parsed.checkpoint !== 'object' || parsed.checkpoint === null) {
  throw new Error('Checkpoint body must be an object');
}
const checkpointMetadata = parsed.checkpoint as {
  schema?: unknown;
  canonicalization?: unknown;
  verification?: { valid?: unknown };
};
if (
  checkpointMetadata.schema !== 'atas.audit-checkpoint.v1' &&
  checkpointMetadata.schema !== 'atas.audit-checkpoint.v2'
) {
  throw new Error('Unsupported checkpoint schema');
}
if (
  checkpointMetadata.schema === 'atas.audit-checkpoint.v2' &&
  checkpointMetadata.canonicalization !== 'ATAS-ORDINAL-1'
) {
  throw new Error('Unsupported checkpoint canonicalization');
}
if (checkpointMetadata.verification?.valid !== true) {
  throw new Error('Checkpoint does not attest valid internal chains');
}

let canonical = canonicalJson(parsed.checkpoint);
let calculatedDigest = createHash('sha256').update(canonical).digest('hex');
let canonicalization = 'ATAS-ORDINAL-1';
if (!equalHex(calculatedDigest, parsed.canonicalSha256)) {
  if (checkpointMetadata.schema !== 'atas.audit-checkpoint.v1') {
    throw new Error('Checkpoint canonical SHA-256 does not match its contents');
  }
  canonical = legacyCanonicalJson(parsed.checkpoint);
  calculatedDigest = createHash('sha256').update(canonical).digest('hex');
  canonicalization = 'ATAS-LEGACY-LOCALE-1';
  if (!equalHex(calculatedDigest, parsed.canonicalSha256)) {
    throw new Error('Checkpoint canonical SHA-256 does not match its contents');
  }
}

const signature = parsed.signature;
if (signature === null || signature === undefined) {
  if (!allowUnsigned)
    throw new Error('Checkpoint is unsigned; pass --allow-unsigned only for diagnostics');
  process.stdout.write(
    `${JSON.stringify({ valid: true, signed: false, canonicalSha256: calculatedDigest, canonicalization }, null, 2)}\n`,
  );
  process.exit(0);
}

if (signature.algorithm !== 'Ed25519')
  throw new Error('Unsupported checkpoint signature algorithm');
const publicKeyPem =
  trustedPublicKeyPath === undefined
    ? signature.publicKeyPem
    : await readFile(resolve(trustedPublicKeyPath), 'utf8');
const publicKey = createPublicKey(publicKeyPem);
if (publicKey.asymmetricKeyType !== 'ed25519')
  throw new Error('Trusted public key must be Ed25519');
const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });
const actualFingerprint = createHash('sha256').update(publicKeyDer).digest('hex');

if (!equalHex(actualFingerprint, signature.keyFingerprintSha256)) {
  throw new Error('Embedded signature fingerprint does not match the selected public key');
}
if (expectedFingerprint !== undefined && !equalHex(actualFingerprint, expectedFingerprint)) {
  throw new Error('Checkpoint signing key does not match the expected trusted fingerprint');
}

const validSignature = verifySignature(
  null,
  Buffer.from(canonical),
  publicKey,
  Buffer.from(signature.valueBase64, 'base64'),
);
if (!validSignature) throw new Error('Checkpoint Ed25519 signature is invalid');

process.stdout.write(
  `${JSON.stringify(
    {
      valid: true,
      signed: true,
      canonicalSha256: calculatedDigest,
      keyFingerprintSha256: actualFingerprint,
      trustSource: trustedPublicKeyPath === undefined ? 'embedded-key' : 'external-key',
      canonicalization,
    },
    null,
    2,
  )}\n`,
);
