import Fastify, { type FastifyInstance } from 'fastify';

import type { HydraHealthStatus } from '@freshcontext/hydra';

export interface HealthGateway {
  verify(): Promise<HydraHealthStatus>;
}

export interface AppOptions {
  readonly healthGateway: HealthGateway;
  readonly logger?: boolean;
}

const healthResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'service', 'hydra'],
  properties: {
    status: { type: 'string', enum: ['ready', 'unavailable'] },
    service: { type: 'string', const: 'freshcontext' },
    hydra: { type: 'string', enum: ['connected', 'unavailable'] },
    roundTrip: {
      type: 'object',
      additionalProperties: false,
      required: ['queryId', 'readEpoch'],
      properties: {
        queryId: { type: 'string' },
        readEpoch: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
      },
    },
  },
} as const;

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get(
    '/',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'purpose', 'status', 'health'],
            properties: {
              name: { type: 'string' },
              purpose: { type: 'string' },
              status: { type: 'string' },
              health: { type: 'string' },
            },
          },
        },
      },
    },
    () => ({
      name: 'FreshContext',
      purpose: 'Evidence-bound memory for coding agents, powered by HydraDB OSS.',
      status: 'runtime-foundation',
      health: '/api/health',
    }),
  );

  app.get(
    '/api/health',
    {
      schema: {
        response: {
          200: healthResponseSchema,
          503: healthResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      try {
        const health = await options.healthGateway.verify();
        return {
          status: 'ready',
          service: 'freshcontext',
          hydra: health.hydra,
          roundTrip: health.roundTrip,
        };
      } catch (error) {
        app.log.warn({ error }, 'HydraDB health verification failed');
        return reply.status(503).send({
          status: 'unavailable',
          service: 'freshcontext',
          hydra: 'unavailable',
        });
      }
    },
  );

  return app;
}
