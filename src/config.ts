export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  databasePoolMax: number;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  jwtRequireMatchScope: boolean;
  auditHmacSecret: string;
  authDisabled: boolean;
  corsOrigins: string[];
  trustProxy: boolean;
  rateLimitMax: number;
  rateLimitWindow: string;
  clockRateLimitMax: number;
  bodyLimitBytes: number;
  rulesetPath: string;
  rulesetExpectedSha256?: string;
  publicConsole: boolean;
  primaryClockSource: string;
  clockSourceSubjects: string[];
  clockMaxSampleAgeMs: number;
  clockFutureToleranceUs: number;
  clockMaxAdvanceSkewUs: number;
  clockMinimumFreshSources: number;
  clockMaxSourceDriftUs: number;
  clockMaxWallDriftUs: number;
  outboxRetentionDays: number;
  outboxCleanupIntervalMs: number;
  outboxCleanupBatchSize: number;
  realtimeListenerHeartbeatMs: number;
  realtimeListenerMaxStaleMs: number;
  shutdownTimeoutMs: number;
};

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function boolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function list(name: string, fallback: string): string[] {
  const values = (process.env[name] ?? fallback)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) throw new Error(`${name} must contain at least one value`);
  return [...new Set(values)];
}

export function loadConfig(): AppConfig {
  const nodeEnvRaw = process.env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnvRaw)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  const nodeEnv = nodeEnvRaw as AppConfig['nodeEnv'];
  const authDisabled = boolean('AUTH_DISABLED', nodeEnv !== 'production');
  if (nodeEnv === 'production' && authDisabled) {
    throw new Error('AUTH_DISABLED cannot be true in production');
  }

  const jwtSecret = authDisabled
    ? (process.env.JWT_SECRET ?? 'development-only-secret-change-me-now')
    : required('JWT_SECRET');
  const auditHmacSecret = authDisabled
    ? (process.env.AUDIT_HMAC_SECRET ?? 'development-audit-secret-change-me-now')
    : required('AUDIT_HMAC_SECRET');

  if (
    nodeEnv === 'production' &&
    (jwtSecret.length < 32 || /change-me|replace|development/i.test(jwtSecret))
  ) {
    throw new Error('JWT_SECRET must contain at least 32 characters in production');
  }
  if (
    nodeEnv === 'production' &&
    (auditHmacSecret.length < 32 || /change-me|replace|development/i.test(auditHmacSecret))
  ) {
    throw new Error('AUDIT_HMAC_SECRET must contain at least 32 characters in production');
  }
  if (jwtSecret === auditHmacSecret) {
    throw new Error('JWT_SECRET and AUDIT_HMAC_SECRET must be different');
  }

  const rulesetDigestRaw = process.env.RULESET_EXPECTED_SHA256?.trim().toLowerCase();
  const rulesetExpectedSha256 =
    rulesetDigestRaw === undefined || rulesetDigestRaw === '' ? undefined : rulesetDigestRaw;
  if (rulesetExpectedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(rulesetExpectedSha256)) {
    throw new Error('RULESET_EXPECTED_SHA256 must be a 64-character lowercase hexadecimal digest');
  }
  if (nodeEnv === 'production' && rulesetExpectedSha256 === undefined) {
    throw new Error('RULESET_EXPECTED_SHA256 is required in production');
  }

  const databaseUrl =
    nodeEnv === 'production'
      ? required('DATABASE_URL')
      : (process.env.DATABASE_URL ?? 'postgres://atas:atas@localhost:5432/atas');
  const corsRaw =
    nodeEnv === 'production'
      ? required('CORS_ORIGINS')
      : (process.env.CORS_ORIGINS ?? 'http://localhost:8080');
  const corsOrigins = corsRaw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (corsOrigins.length === 0) throw new Error('CORS_ORIGINS must contain at least one origin');
  for (const origin of corsOrigins) {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error(`Invalid CORS origin: ${origin}`);
    }
  }

  const clockSourceSubjects = list(
    'CLOCK_SOURCE_SUBJECTS',
    nodeEnv === 'production' ? required('PRIMARY_CLOCK_SOURCE') : 'development-user',
  );
  const primaryClockSource =
    nodeEnv === 'production'
      ? required('PRIMARY_CLOCK_SOURCE').trim()
      : (process.env.PRIMARY_CLOCK_SOURCE ?? clockSourceSubjects[0] ?? 'development-user').trim();
  if (!clockSourceSubjects.includes(primaryClockSource)) {
    throw new Error('PRIMARY_CLOCK_SOURCE must be included in CLOCK_SOURCE_SUBJECTS');
  }
  const clockMinimumFreshSources = integer(
    'CLOCK_MINIMUM_FRESH_SOURCES',
    nodeEnv === 'production' ? 2 : 1,
  );
  if (clockMinimumFreshSources > clockSourceSubjects.length) {
    throw new Error('CLOCK_MINIMUM_FRESH_SOURCES cannot exceed CLOCK_SOURCE_SUBJECTS count');
  }
  const realtimeListenerHeartbeatMs = integer('REALTIME_LISTENER_HEARTBEAT_MS', 5_000);
  const realtimeListenerMaxStaleMs = integer('REALTIME_LISTENER_MAX_STALE_MS', 15_000);
  if (realtimeListenerMaxStaleMs < realtimeListenerHeartbeatMs * 2) {
    throw new Error(
      'REALTIME_LISTENER_MAX_STALE_MS must be at least twice REALTIME_LISTENER_HEARTBEAT_MS',
    );
  }

  return {
    nodeEnv,
    host: process.env.HOST ?? '0.0.0.0',
    port: integer('PORT', 8080),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    databaseUrl,
    databasePoolMax: integer('DATABASE_POOL_MAX', 20),
    jwtSecret,
    jwtIssuer: process.env.JWT_ISSUER ?? 'atas.local',
    jwtAudience: process.env.JWT_AUDIENCE ?? 'atas-api',
    jwtRequireMatchScope: boolean('JWT_REQUIRE_MATCH_SCOPE', nodeEnv === 'production'),
    auditHmacSecret,
    authDisabled,
    corsOrigins,
    trustProxy: boolean('TRUST_PROXY', false),
    rateLimitMax: integer('RATE_LIMIT_MAX', 300),
    rateLimitWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
    clockRateLimitMax: integer('CLOCK_RATE_LIMIT_MAX', 6_000),
    bodyLimitBytes: integer('BODY_LIMIT_BYTES', 1_048_576),
    rulesetPath: process.env.RULESET_PATH ?? 'rulesets/ifab-2026-27.json',
    ...(rulesetExpectedSha256 === undefined ? {} : { rulesetExpectedSha256 }),
    publicConsole: boolean('PUBLIC_CONSOLE', true),
    primaryClockSource,
    clockSourceSubjects,
    clockMaxSampleAgeMs: integer('CLOCK_MAX_SAMPLE_AGE_MS', 2_000),
    clockFutureToleranceUs: integer('CLOCK_FUTURE_TOLERANCE_US', 2_000_000),
    clockMaxAdvanceSkewUs: integer('CLOCK_MAX_ADVANCE_SKEW_US', 2_000_000),
    clockMinimumFreshSources,
    clockMaxSourceDriftUs: integer('CLOCK_MAX_SOURCE_DRIFT_US', 100_000),
    clockMaxWallDriftUs: integer('CLOCK_MAX_WALL_DRIFT_US', 2_000_000),
    outboxRetentionDays: integer('OUTBOX_RETENTION_DAYS', 30),
    outboxCleanupIntervalMs: integer('OUTBOX_CLEANUP_INTERVAL_MS', 3_600_000),
    outboxCleanupBatchSize: integer('OUTBOX_CLEANUP_BATCH_SIZE', 10_000),
    realtimeListenerHeartbeatMs,
    realtimeListenerMaxStaleMs,
    shutdownTimeoutMs: integer('SHUTDOWN_TIMEOUT_MS', 15_000),
  };
}
