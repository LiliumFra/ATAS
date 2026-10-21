import type { FastifyInstance } from 'fastify';
import type { Registry } from 'prom-client';

export async function registerMetricsRoute(
  app: FastifyInstance,
  registry: Registry,
): Promise<void> {
  app.get('/metrics', { config: { rateLimit: false } }, async (_request, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });
}
