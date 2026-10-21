import type { Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config.js';
import type { ClockService } from '../../services/clock-service.js';
import { CLOCK_INGEST_ROLES, requireAnyRole } from '../auth.js';
import { ClockSampleBody, MatchIdParams } from '../schemas.js';

export async function registerClockRoutes(
  app: FastifyInstance,
  dependencies: { config: AppConfig; service: ClockService },
): Promise<void> {
  app.post<{
    Params: Static<typeof MatchIdParams>;
    Body: Static<typeof ClockSampleBody>;
  }>(
    '/v1/matches/:matchId/clock-samples',
    {
      preHandler: requireAnyRole(dependencies.config, CLOCK_INGEST_ROLES),
      config: {
        rateLimit: {
          max: dependencies.config.clockRateLimitMax,
          timeWindow: dependencies.config.rateLimitWindow,
        },
      },
      schema: { params: MatchIdParams, body: ClockSampleBody, tags: ['clock'] },
    },
    async (request, reply) => {
      const sample = await dependencies.service.append({
        matchId: request.params.matchId,
        period: request.body.period,
        sourceId: request.user.sub,
        sourceSequence: request.body.sourceSequence,
        elapsedUs: request.body.elapsedUs,
        ...(request.body.sourceTimestamp === undefined
          ? {}
          : { sourceTimestamp: request.body.sourceTimestamp }),
        evidence: request.body.evidence ?? {},
      });
      return reply.code(202).send(sample);
    },
  );
}
