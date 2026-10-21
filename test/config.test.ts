import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';

const VALID_RULESET_HASH = 'a'.repeat(64);
const STRONG_JWT = 'jwt-'.concat('a'.repeat(64));
const STRONG_AUDIT = 'audit-'.concat('b'.repeat(64));

function productionEnvironment(): void {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('DATABASE_URL', 'postgres://atas:secret@db.internal:5432/atas');
  vi.stubEnv('JWT_SECRET', STRONG_JWT);
  vi.stubEnv('AUDIT_HMAC_SECRET', STRONG_AUDIT);
  vi.stubEnv('CORS_ORIGINS', 'https://atas.example.org');
  vi.stubEnv('RULESET_EXPECTED_SHA256', VALID_RULESET_HASH);
  vi.stubEnv('AUTH_DISABLED', 'false');
  vi.stubEnv('PRIMARY_CLOCK_SOURCE', 'stadium-clock-primary');
  vi.stubEnv('CLOCK_SOURCE_SUBJECTS', 'stadium-clock-primary,stadium-clock-backup');
  vi.stubEnv('CLOCK_MINIMUM_FRESH_SOURCES', '2');
  vi.stubEnv('CLOCK_MAX_SOURCE_DRIFT_US', '100000');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('production configuration', () => {
  it('accepts explicit hardened production settings', () => {
    productionEnvironment();
    const config = loadConfig();
    expect(config.nodeEnv).toBe('production');
    expect(config.authDisabled).toBe(false);
    expect(config.trustProxy).toBe(false);
    expect(config.primaryClockSource).toBe('stadium-clock-primary');
    expect(config.clockSourceSubjects).toContain('stadium-clock-backup');
    expect(config.clockMinimumFreshSources).toBe(2);
    expect(config.clockMaxAdvanceSkewUs).toBe(2_000_000);
    expect(config.clockMaxWallDriftUs).toBe(2_000_000);
    expect(config.outboxRetentionDays).toBe(30);
    expect(config.outboxCleanupIntervalMs).toBe(3_600_000);
    expect(config.outboxCleanupBatchSize).toBe(10_000);
    expect(config.clockRateLimitMax).toBe(6_000);
    expect(config.realtimeListenerHeartbeatMs).toBe(5_000);
    expect(config.realtimeListenerMaxStaleMs).toBe(15_000);
    expect(config.shutdownTimeoutMs).toBe(15_000);
  });

  it('rejects disabled authentication', () => {
    productionEnvironment();
    vi.stubEnv('AUTH_DISABLED', 'true');
    expect(() => loadConfig()).toThrow('AUTH_DISABLED cannot be true in production');
  });

  it('rejects missing ruleset integrity pinning', () => {
    productionEnvironment();
    vi.stubEnv('RULESET_EXPECTED_SHA256', '');
    expect(() => loadConfig()).toThrow('RULESET_EXPECTED_SHA256 is required in production');
  });

  it('rejects wildcard or path-based CORS values', () => {
    productionEnvironment();
    vi.stubEnv('CORS_ORIGINS', 'https://atas.example.org/console');
    expect(() => loadConfig()).toThrow('Invalid CORS origin');
  });

  it('requires the primary clock source to be authorised', () => {
    productionEnvironment();
    vi.stubEnv('CLOCK_SOURCE_SUBJECTS', 'stadium-clock-backup');
    expect(() => loadConfig()).toThrow('PRIMARY_CLOCK_SOURCE must be included');
  });

  it('rejects an impossible clock quorum', () => {
    productionEnvironment();
    vi.stubEnv('CLOCK_MINIMUM_FRESH_SOURCES', '3');
    expect(() => loadConfig()).toThrow('CLOCK_MINIMUM_FRESH_SOURCES cannot exceed');
  });

  it('requires different signing and audit secrets', () => {
    productionEnvironment();
    vi.stubEnv('AUDIT_HMAC_SECRET', STRONG_JWT);
    expect(() => loadConfig()).toThrow('JWT_SECRET and AUDIT_HMAC_SECRET must be different');
  });

  it('rejects a realtime staleness window smaller than two heartbeats', () => {
    productionEnvironment();
    vi.stubEnv('REALTIME_LISTENER_HEARTBEAT_MS', '5000');
    vi.stubEnv('REALTIME_LISTENER_MAX_STALE_MS', '9000');
    expect(() => loadConfig()).toThrow('must be at least twice');
  });
});
