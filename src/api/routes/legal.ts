import type { FastifyInstance } from 'fastify';

export const ATAS_ATTRIBUTION =
  'ATAS — Added Time Assistance System. Created by José Francisco Bustamante Ocampo. Copyright 2026 José Francisco Bustamante Ocampo and ATAS contributors.';

export async function registerLegalRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/v1/legal',
    {
      config: { rateLimit: false },
      schema: {
        tags: ['system'],
        summary: 'Return ATAS licensing and mandatory attribution information',
        security: [],
        response: {
          200: {
            type: 'object',
            required: ['project', 'license', 'attribution', 'repository'],
            properties: {
              project: { type: 'string' },
              license: { type: 'string' },
              attribution: { type: 'string' },
              repository: { type: 'string' },
              certification: { type: 'string' },
            },
          },
        },
      },
    },
    async () => ({
      project: 'ATAS — Added Time Assistance System',
      license: 'ATAS Attribution License 1.0 (LicenseRef-ATAS-Attribution-1.0)',
      attribution: ATAS_ATTRIBUTION,
      repository: 'https://github.com/LiliumFra/ATAS',
      certification:
        'Independent project; not affiliated with, endorsed by, approved by, or certified by FIFA or The IFAB.',
    }),
  );
}
