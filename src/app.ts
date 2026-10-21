import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { resolve } from 'node:path';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';
import type { AppConfig } from './config.js';
import { registerChangeRoutes } from './api/routes/changes.js';
import { registerClockRoutes } from './api/routes/clock.js';
import { registerEventRoutes } from './api/routes/events.js';
import { registerHealthRoutes } from './api/routes/health.js';
import { registerLegalRoute } from './api/routes/legal.js';
import { registerMatchRoutes } from './api/routes/matches.js';
import { registerMetricsRoute } from './api/routes/metrics.js';
import { registerStoppageRoutes } from './api/routes/stoppages.js';
import { registerStreamRoute } from './api/routes/stream.js';
import { createPool } from './db/pool.js';
import { assertSchemaCurrent } from './db/schema.js';
import { loadRuleset } from './domain/ruleset.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerOpenApi } from './plugins/openapi.js';
import { RealtimeHub } from './realtime/hub.js';
import { AuditRepository } from './repositories/audit.js';
import { ChangeRepository } from './repositories/changes.js';
import { ClockRepository } from './repositories/clock.js';
import { EventRepository } from './repositories/events.js';
import { MatchRepository } from './repositories/matches.js';
import { RulesetRepository } from './repositories/rulesets.js';
import { StoppageRepository } from './repositories/stoppages.js';
import { ClockService } from './services/clock-service.js';
import { EngineService } from './services/engine-service.js';
import { EventService } from './services/event-service.js';
import { MatchService } from './services/match-service.js';
import { NotificationListener } from './services/notification-listener.js';
import { OutboxWorker } from './services/outbox-worker.js';

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const logger =
    config.nodeEnv === 'development'
      ? {
          level: config.logLevel,
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' },
          },
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers.sec-websocket-protocol',
          ],
        }
      : {
          level: config.logLevel,
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers.sec-websocket-protocol',
          ],
        };
  const options: FastifyServerOptions = {
    logger,
    trustProxy: config.trustProxy,
    bodyLimit: config.bodyLimitBytes,
    requestIdHeader: 'x-request-id',
    disableRequestLogging: false,
  };
  const app: FastifyInstance = Fastify(options);

  const pool = createPool(config);
  let ruleset;
  try {
    ruleset = await loadRuleset(config.rulesetPath, config.rulesetExpectedSha256);
    await assertSchemaCurrent(pool);
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
  const hub = new RealtimeHub();
  hub.start();
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'atas_' });
  const requests = new Counter({
    name: 'atas_http_requests_total',
    help: 'HTTP requests handled',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });
  const latency = new Histogram({
    name: 'atas_http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });

  const requestStartedAt = new WeakMap<object, bigint>();
  app.addHook('onRequest', async (request) => {
    requestStartedAt.set(request, process.hrtime.bigint());
  });
  app.addHook('onResponse', async (request, reply) => {
    const startedAt = requestStartedAt.get(request);
    const route = request.routeOptions.url ?? 'unknown';
    const labels = { method: request.method, route, status: String(reply.statusCode) };
    requests.inc(labels);
    if (typeof startedAt === 'bigint') {
      latency.observe(labels, Number(process.hrtime.bigint() - startedAt) / 1_000_000_000);
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/console/')) {
      reply.header(
        'content-security-policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
      );
    }
    return payload;
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: (origin, callback) => {
      if (origin === undefined || config.corsOrigins.includes(origin)) callback(null, true);
      else callback(new Error('Origin not allowed'), false);
    },
    credentials: false,
  });
  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
    keyGenerator: (request) => request.ip,
  });
  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: { iss: config.jwtIssuer, aud: config.jwtAudience, algorithm: 'HS256' },
    verify: {
      allowedIss: config.jwtIssuer,
      allowedAud: config.jwtAudience,
      algorithms: ['HS256'],
      requiredClaims: ['sub', 'role', 'iat', 'exp'],
      checkTyp: 'JWT',
      maxAge: '24h',
    },
  });
  await app.register(websocket, {
    options: {
      maxPayload: 16 * 1024,
      handleProtocols: (protocols) => (protocols.has('atas-v1') ? 'atas-v1' : false),
    },
  });
  await registerOpenApi(app);

  const matches = new MatchRepository(pool);
  const changes = new ChangeRepository(pool);
  const events = new EventRepository(pool, config.auditHmacSecret);
  const clocks = new ClockRepository(pool, config.auditHmacSecret);
  const stoppages = new StoppageRepository(pool, config.auditHmacSecret);
  const rulesets = new RulesetRepository(pool);
  const audit = new AuditRepository(config.auditHmacSecret);
  const matchService = new MatchService(pool, matches, rulesets, audit, ruleset);
  const eventService = new EventService(pool, events, stoppages, audit, config);
  const clockService = new ClockService(pool, clocks, audit, config);
  const engineService = new EngineService(
    pool,
    matches,
    events,
    stoppages,
    clocks,
    rulesets,
    audit,
    config,
  );
  await matchService.initialise();
  const listener = new NotificationListener(
    config.databaseUrl,
    hub,
    app.log,
    config.realtimeListenerHeartbeatMs,
    config.realtimeListenerMaxStaleMs,
  );
  const worker = new OutboxWorker(
    pool,
    app.log,
    config.outboxRetentionDays,
    config.outboxCleanupIntervalMs,
    config.outboxCleanupBatchSize,
  );

  await registerHealthRoutes(app, { pool, listener, worker });
  await registerLegalRoute(app);
  await registerMetricsRoute(app, registry);
  await registerMatchRoutes(app, {
    config,
    service: matchService,
    engine: engineService,
    repository: matches,
  });
  await registerChangeRoutes(app, { config, repository: changes });
  await registerClockRoutes(app, { config, service: clockService });
  await registerEventRoutes(app, { config, service: eventService, repository: events });
  await registerStoppageRoutes(app, { config, service: eventService, repository: stoppages });
  await registerStreamRoute(app, { config, hub, changes });

  if (config.publicConsole) {
    await app.register(fastifyStatic, {
      root: resolve('src/public'),
      prefix: '/console/',
      decorateReply: false,
    });
    app.get('/', async (_request, reply) => reply.redirect('/console/'));
  }

  registerErrorHandler(app);

  app.addHook('onClose', async () => {
    await worker.stop();
    await listener.stop();
    hub.stop();
    await pool.end();
  });
  try {
    await listener.start();
    await worker.start();
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }

  return app;
}
