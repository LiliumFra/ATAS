import type { Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config.js';
import type { EngineService } from '../../services/engine-service.js';
import type { MatchService } from '../../services/match-service.js';
import type { MatchRepository } from '../../repositories/matches.js';
import { READ_ROLES, requireAnyRole, requireRole } from '../auth.js';
import {
  AnnounceBody,
  CreateMatchBody,
  EstimateQuery,
  IntegrityBody,
  LiveEstimateQuery,
  MatchIdParams,
  MatchStatusBody,
  MatchPeriodParams,
} from '../schemas.js';

export async function registerMatchRoutes(
  app: FastifyInstance,
  dependencies: {
    config: AppConfig;
    service: MatchService;
    engine: EngineService;
    repository: MatchRepository;
  },
): Promise<void> {
  app.post<{ Body: Static<typeof CreateMatchBody> }>(
    '/v1/matches',
    {
      preHandler: requireRole(dependencies.config, 'admin'),
      schema: { body: CreateMatchBody, tags: ['matches'] },
    },
    async (request, reply) => {
      const result = await dependencies.service.create({
        ...request.body,
        metadata: request.body.metadata ?? {},
        actor: request.user.sub,
      });
      return reply.code(result.created ? 201 : 200).send(result.match);
    },
  );

  app.get<{ Params: Static<typeof MatchIdParams> }>(
    '/v1/matches/:matchId',
    {
      preHandler: requireAnyRole(dependencies.config, READ_ROLES),
      schema: { params: MatchIdParams, tags: ['matches'] },
    },
    async (request, reply) => {
      const [match, periods] = await Promise.all([
        dependencies.repository.get(request.params.matchId),
        dependencies.repository.listPeriods(request.params.matchId),
      ]);
      if (match === undefined)
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Match not found' });
      return { match, periods };
    },
  );

  app.post<{ Params: Static<typeof MatchIdParams>; Body: Static<typeof IntegrityBody> }>(
    '/v1/matches/:matchId/integrity',
    {
      preHandler: requireRole(dependencies.config, 'official'),
      schema: { params: MatchIdParams, body: IntegrityBody, tags: ['matches'] },
    },
    async (request, reply) => {
      if (
        request.body.clockIntegrityOk === undefined &&
        request.body.sourceIntegrityOk === undefined
      ) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          message: 'At least one integrity field must be provided',
        });
      }
      await dependencies.service.updateIntegrity(
        request.params.matchId,
        request.body,
        request.user.sub,
      );
      return reply.code(204).send();
    },
  );

  app.post<{ Params: Static<typeof MatchIdParams>; Body: Static<typeof MatchStatusBody> }>(
    '/v1/matches/:matchId/status',
    {
      preHandler: requireRole(dependencies.config, 'official'),
      schema: { params: MatchIdParams, body: MatchStatusBody, tags: ['matches'] },
    },
    async (request, reply) => {
      await dependencies.service.updateStatus(
        request.params.matchId,
        request.body.status,
        request.body.reason,
        request.user.sub,
      );
      return reply.code(204).send();
    },
  );

  app.post<{ Params: Static<typeof MatchPeriodParams> }>(
    '/v1/matches/:matchId/periods/:period/start',
    {
      preHandler: requireRole(dependencies.config, 'official'),
      schema: { params: MatchPeriodParams, tags: ['periods'] },
    },
    async (request, reply) => {
      await dependencies.service.transitionPeriod(
        request.params.matchId,
        request.params.period,
        'RUNNING',
        request.user.sub,
      );
      return reply.code(204).send();
    },
  );

  app.post<{ Params: Static<typeof MatchPeriodParams> }>(
    '/v1/matches/:matchId/periods/:period/end',
    {
      preHandler: requireRole(dependencies.config, 'official'),
      schema: { params: MatchPeriodParams, tags: ['periods'] },
    },
    async (request, reply) => {
      await dependencies.service.transitionPeriod(
        request.params.matchId,
        request.params.period,
        'ENDED',
        request.user.sub,
      );
      return reply.code(204).send();
    },
  );

  app.post<{
    Params: Static<typeof MatchPeriodParams>;
    Body: Static<typeof AnnounceBody>;
  }>(
    '/v1/matches/:matchId/periods/:period/announcement',
    {
      preHandler: requireRole(dependencies.config, 'official'),
      schema: { params: MatchPeriodParams, body: AnnounceBody, tags: ['periods'] },
    },
    async (request, reply) => {
      await dependencies.service.announce(
        request.params.matchId,
        request.params.period,
        request.body.minutes,
        request.user.sub,
      );
      return reply.code(204).send();
    },
  );

  app.get<{
    Params: Static<typeof MatchIdParams>;
    Querystring: Static<typeof EstimateQuery>;
  }>(
    '/v1/matches/:matchId/estimate',
    {
      preHandler: requireRole(dependencies.config, 'operator'),
      schema: {
        params: MatchIdParams,
        querystring: EstimateQuery,
        tags: ['engine', 'diagnostic'],
        description: 'Diagnostic/replay calculation using an explicit client-supplied clock value.',
      },
    },
    async (request) =>
      dependencies.engine.calculate(
        request.params.matchId,
        request.query.period,
        request.query.nowUs,
      ),
  );

  app.get<{
    Params: Static<typeof MatchIdParams>;
    Querystring: Static<typeof LiveEstimateQuery>;
  }>(
    '/v1/matches/:matchId/estimate/live',
    {
      preHandler: requireAnyRole(dependencies.config, READ_ROLES),
      schema: {
        params: MatchIdParams,
        querystring: LiveEstimateQuery,
        tags: ['engine'],
        description: 'Operational estimate driven by the configured authoritative clock source.',
      },
    },
    async (request) =>
      dependencies.engine.calculateLive(request.params.matchId, request.query.period),
  );

  app.get<{ Params: Static<typeof MatchIdParams> }>(
    '/v1/matches/:matchId/audit/verify',
    {
      preHandler: requireRole(dependencies.config, 'official'),
      schema: { params: MatchIdParams, tags: ['audit'] },
    },
    async (request) => dependencies.engine.verifyAudit(request.params.matchId),
  );
}
