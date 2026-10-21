import type { FastifyInstance } from 'fastify';
import type { Database } from '../../db/pool.js';
import type { NotificationListener } from '../../services/notification-listener.js';
import type { OutboxWorker } from '../../services/outbox-worker.js';

export async function registerHealthRoutes(
  app: FastifyInstance,
  dependencies: {
    pool: Database;
    listener: NotificationListener;
    worker: OutboxWorker;
  },
): Promise<void> {
  app.get('/health/live', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));

  app.get('/health/ready', { config: { rateLimit: false } }, async (_request, reply) => {
    const databaseReady = await dependencies.pool
      .query('SELECT 1')
      .then(() => true)
      .catch(() => false);

    const realtime = dependencies.listener.health();
    const outbox = dependencies.worker.health();
    const ready = databaseReady && realtime.ready && outbox.ready;
    const body = {
      status: ready ? 'ready' : 'not-ready',
      components: {
        database: { ready: databaseReady },
        realtime,
        outbox,
      },
    };
    return ready ? body : reply.code(503).send(body);
  });
}
