import type { Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config.js';
import type { EventRepository } from '../../repositories/events.js';
import type { EventService } from '../../services/event-service.js';
import {
  EVENT_INGEST_ROLES,
  READ_ROLES,
  mayAssertEventSource,
  requireAnyRole,
  requireRole,
} from '../auth.js';
import { CreateEventBody, EventParams, MatchIdParams, ReviseEventBody } from '../schemas.js';

export async function registerEventRoutes(
  app: FastifyInstance,
  dependencies: {
    config: AppConfig;
    service: EventService;
    repository: EventRepository;
  },
): Promise<void> {
  app.post<{
    Params: Static<typeof MatchIdParams>;
    Body: Static<typeof CreateEventBody>;
  }>(
    '/v1/matches/:matchId/events',
    {
      preHandler: requireAnyRole(dependencies.config, EVENT_INGEST_ROLES),
      schema: { params: MatchIdParams, body: CreateEventBody, tags: ['events'] },
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

      const result = await dependencies.service.createEvent({
        eventId: request.body.eventId,
        matchId: request.params.matchId,
        period: request.body.period,
        kind: request.body.kind,
        source: request.body.source,
        status: request.user.role === 'sensor' ? 'PROPOSED' : (request.body.status ?? 'CONFIRMED'),
        startUs: request.body.startUs,
        ...(request.body.endUs === undefined ? {} : { endUs: request.body.endUs }),
        confidence: request.body.confidence,
        evidence: request.body.evidence ?? {},
        createdBy: request.user.sub,
      });
      return reply.code(result.created ? 201 : 200).send(result.event);
    },
  );

  app.get<{ Params: Static<typeof MatchIdParams> }>(
    '/v1/matches/:matchId/events',
    {
      preHandler: requireAnyRole(dependencies.config, READ_ROLES),
      schema: { params: MatchIdParams, tags: ['events'] },
    },
    async (request) => dependencies.repository.listLatest(request.params.matchId),
  );

  app.post<{
    Params: Static<typeof EventParams>;
    Body: Static<typeof ReviseEventBody>;
  }>(
    '/v1/matches/:matchId/events/:eventId/decision',
    {
      preHandler: requireRole(dependencies.config, 'operator'),
      schema: { params: EventParams, body: ReviseEventBody, tags: ['events'] },
    },
    async (request, reply) => {
      const correctedSource = request.body.corrections?.source;
      if (
        correctedSource !== undefined &&
        !mayAssertEventSource(request.user.role, correctedSource)
      ) {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: `Role ${request.user.role} may not assert source ${correctedSource}`,
        });
      }
      const result = await dependencies.service.reviseEvent({
        matchId: request.params.matchId,
        eventId: request.params.eventId,
        status: request.body.status,
        actor: request.user.sub,
        ...(request.body.corrections === undefined
          ? {}
          : { corrections: request.body.corrections }),
      });
      return reply.code(200).send(result.event);
    },
  );
}
