import type { Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config.js';
import type { ChangeRepository } from '../../repositories/changes.js';
import { READ_ROLES, requireAnyRole } from '../auth.js';
import { ChangesQuery, MatchIdParams } from '../schemas.js';

export async function registerChangeRoutes(
  app: FastifyInstance,
  dependencies: { config: AppConfig; repository: ChangeRepository },
): Promise<void> {
  app.get<{
    Params: Static<typeof MatchIdParams>;
    Querystring: Static<typeof ChangesQuery>;
  }>(
    '/v1/matches/:matchId/changes',
    {
      preHandler: requireAnyRole(dependencies.config, READ_ROLES),
      schema: {
        params: MatchIdParams,
        querystring: ChangesQuery,
        tags: ['realtime'],
        description:
          'Durable ordered change feed. Persist the returned cursor and use it to recover after reconnects.',
      },
    },
    async (request) => {
      const requestedAfterId = request.query.afterId ?? 0;
      const limit = request.query.limit ?? 100;
      const state = await dependencies.repository.cursorState(request.params.matchId);
      const cursorExpired = requestedAfterId < state.retainedAfterId;
      const effectiveAfterId = cursorExpired ? state.retainedAfterId : requestedAfterId;
      const changes = await dependencies.repository.list(
        request.params.matchId,
        effectiveAfterId,
        limit,
      );
      return {
        changes,
        cursor: changes.at(-1)?.id ?? effectiveAfterId,
        hasMore: changes.length === limit,
        cursorExpired,
        retainedAfterId: state.retainedAfterId,
        latestId: state.latestId,
      };
    },
  );
}
