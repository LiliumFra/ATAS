import type { Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config.js';
import type { StoppageRepository } from '../../repositories/stoppages.js';
import type { EventService } from '../../services/event-service.js';
import { READ_ROLES, mayAssertEventSource, requireAnyRole, requireRole } from '../auth.js';
import {
  CloseStoppageBody,
  CreateStoppageBody,
  MatchIdParams,
  StoppageParams,
} from '../schemas.js';

export async function registerStoppageRoutes(
  app: FastifyInstance,
  dependencies: {
    config: AppConfig;
    service: EventService;
    repository: StoppageRepository;
  },
): Promise<void> {
  app.post<{
    Params: Static<typeof MatchIdParams>;
    Body: Static<typeof CreateStoppageBody>;
  }>(
    '/v1/matches/:matchId/stoppages',
    {
      preHandler: requireRole(dependencies.config, 'operator'),
      schema: { params: MatchIdParams, body: CreateStoppageBody, tags: ['stoppages'] },
    },
    async (request, reply) => {
      if (request.body.endUs !== undefined && request.body.endUs <= request.body.startUs) {
        return reply
          .code(400)
          .send({ error: 'VALIDATION_ERROR', message: 'endUs must be greater than startUs' });
      }

      if (!mayAssertEventSource(request.user.role, request.body.source)) {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: `Role ${request.user.role} may not assert source ${request.body.source}`,
        });
      }

      const result = await dependencies.service.createStoppage({
        stoppageId: request.body.stoppageId,
        matchId: request.params.matchId,
        period: request.body.period,
        startUs: request.body.startUs,
        ...(request.body.endUs === undefined ? {} : { endUs: request.body.endUs }),
        source: request.body.source,
        status: request.body.status ?? 'CONFIRMED',
        createdBy: request.user.sub,
        evidence: request.body.evidence ?? {},
      });
      return reply.code(result.created ? 201 : 200).send(result.stoppage);
    },
  );

  app.get<{
    Params: Static<typeof MatchIdParams>;
    Querystring: { period: 'FIRST_HALF' | 'SECOND_HALF' | 'ET_FIRST' | 'ET_SECOND' };
  }>(
    '/v1/matches/:matchId/stoppages',
    {
      preHandler: requireAnyRole(dependencies.config, READ_ROLES),
      schema: {
        params: MatchIdParams,
        querystring: {
          type: 'object',
          required: ['period'],
          properties: {
            period: {
              type: 'string',
              enum: ['FIRST_HALF', 'SECOND_HALF', 'ET_FIRST', 'ET_SECOND'],
            },
          },
        },
        tags: ['stoppages'],
      },
    },
    async (request) =>
      dependencies.repository.listLatest(request.params.matchId, request.query.period),
  );

  app.post<{
    Params: Static<typeof StoppageParams>;
    Body: Static<typeof CloseStoppageBody>;
  }>(
    '/v1/matches/:matchId/stoppages/:stoppageId/close',
    {
      preHandler: requireRole(dependencies.config, 'operator'),
      schema: { params: StoppageParams, body: CloseStoppageBody, tags: ['stoppages'] },
    },
    async (request, reply) => {
      const result = await dependencies.service.closeStoppage({
        matchId: request.params.matchId,
        stoppageId: request.params.stoppageId,
        endUs: request.body.endUs,
        status: request.body.status ?? 'CONFIRMED',
        actor: request.user.sub,
      });
      return reply.code(result.created ? 200 : 200).send(result.stoppage);
    },
  );
}
