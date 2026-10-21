import type { Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config.js';
import type { RealtimeHub } from '../../realtime/hub.js';
import type { ChangeRepository } from '../../repositories/changes.js';
import { hasAnyRole, isAuthenticatedUser, mayAccessMatch, READ_ROLES } from '../auth.js';
import { MatchIdParams } from '../schemas.js';

export async function registerStreamRoute(
  app: FastifyInstance,
  dependencies: { config: AppConfig; hub: RealtimeHub; changes: ChangeRepository },
): Promise<void> {
  app.get<{ Params: Static<typeof MatchIdParams> }>(
    '/v1/matches/:matchId/stream',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const origin = request.headers.origin;
        if (origin !== undefined && !dependencies.config.corsOrigins.includes(origin)) {
          await reply.code(403).send({ error: 'ORIGIN_NOT_ALLOWED' });
          return;
        }
        if (dependencies.config.authDisabled) {
          request.user = { sub: 'development-user', role: 'admin', matches: ['*'] };
          return;
        }
        const protocolHeader = request.headers['sec-websocket-protocol'];
        const tokenProtocol = protocolHeader
          ?.split(',')
          .map((value) => value.trim())
          .find((value) => value.startsWith('jwt.'));
        const token = tokenProtocol?.slice(4);
        if (token === undefined || token === '') {
          await reply.code(401).send({ error: 'UNAUTHENTICATED' });
          return;
        }
        try {
          const user: unknown = app.jwt.verify(token);
          if (!isAuthenticatedUser(user)) {
            await reply.code(401).send({ error: 'UNAUTHENTICATED' });
            return;
          }
          if (!hasAnyRole(user.role, READ_ROLES)) {
            await reply.code(403).send({ error: 'FORBIDDEN' });
            return;
          }
          if (
            dependencies.config.jwtRequireMatchScope &&
            !mayAccessMatch(user, request.params.matchId)
          ) {
            await reply.code(403).send({ error: 'MATCH_SCOPE_REQUIRED' });
            return;
          }
          request.user = user;
        } catch {
          await reply.code(401).send({ error: 'UNAUTHENTICATED' });
        }
      },
      schema: { params: MatchIdParams, tags: ['realtime'] },
    },
    (socket, request) => {
      // Subscribe before reading the cursor so a change cannot fall into the gap between the
      // snapshot and subscription. Clients still use the durable feed to reconcile ordering.
      const unsubscribe = dependencies.hub.subscribe(request.params.matchId, socket);
      void dependencies.changes
        .latestId(request.params.matchId)
        .then((cursor) => {
          if (socket.readyState === socket.OPEN) {
            socket.send(
              JSON.stringify({ type: 'connected', matchId: request.params.matchId, cursor }),
            );
          }
        })
        .catch((error: unknown) => {
          request.log.error({ err: error }, 'Failed to load realtime cursor');
          socket.close(1011, 'Cursor unavailable');
        });
      socket.on('close', unsubscribe);
      socket.on('error', unsubscribe);
    },
  );
}
