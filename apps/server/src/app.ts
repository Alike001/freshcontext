import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';

import type { HydraHealthStatus } from '@freshcontext/hydra';

export interface HealthGateway {
  verify(): Promise<HydraHealthStatus>;
}

export interface AppOptions {
  readonly healthGateway: HealthGateway;
  readonly logger?: boolean;
  readonly staticRoot?: string;
  readonly setup?: SetupOptions;
}

export interface SetupOptions {
  readonly repositoryId: string | undefined;
  readonly repositoryPath: string | undefined;
  readonly statusGateway: RepositoryStatusGateway | undefined;
}

export interface RepositoryStatusGateway {
  status(input: { readonly repositoryId: string }): Promise<RepositoryStatus>;
}

export type RepositoryStatus =
  | {
      readonly status: 'ready';
      readonly indexed: boolean;
      readonly indexedCommit: string | null;
      readonly statistics: Readonly<Record<string, number>> | null;
    }
  | { readonly status: 'context_unavailable'; readonly message: string };

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

const setupResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'hydra', 'startupCommand', 'repository'],
  properties: {
    status: { type: 'string', const: 'ready' },
    hydra: { type: 'string', enum: ['connected', 'unavailable'] },
    startupCommand: { type: 'string', const: 'docker compose up --build --wait' },
    repository: {
      type: 'object',
      additionalProperties: false,
      required: ['state', 'id', 'path', 'indexedCommit', 'statistics', 'message'],
      properties: {
        state: {
          type: 'string',
          enum: [
            'not_configured',
            'misconfigured',
            'not_indexed',
            'indexed',
            'context_unavailable',
          ],
        },
        id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        path: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        indexedCommit: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        statistics: {
          anyOf: [{ type: 'object', additionalProperties: { type: 'integer' } }, { type: 'null' }],
        },
        message: { type: 'string' },
      },
    },
  },
} as const;

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.addHook('onSend', async (_request, reply) => {
    void reply.header(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
    );
    void reply.header('X-Content-Type-Options', 'nosniff');
    void reply.header('X-Frame-Options', 'DENY');
    void reply.header('Referrer-Policy', 'same-origin');
  });

  if (options.staticRoot) {
    void app.register(fastifyStatic, {
      root: options.staticRoot,
      prefix: '/',
      maxAge: '30d',
      immutable: true,
      wildcard: false,
      schemaHide: true,
      setHeaders: (reply, filePath) => {
        if (filePath.endsWith('.html')) {
          void reply.header('cache-control', 'public, max-age=0');
        }
      },
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || /\.[a-z0-9]+(?:\?|$)/iu.test(request.url)) {
        return reply.status(404).send({ error: 'not_found' });
      }
      return reply.sendFile('index.html', { maxAge: 0, immutable: false });
    });
  } else {
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
  }

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

  app.get(
    '/api/setup',
    {
      schema: { response: { 200: setupResponseSchema } },
    },
    async () => {
      const hydraPromise = options.healthGateway
        .verify()
        .then(() => 'connected' as const)
        .catch(() => 'unavailable' as const);
      const repositoryPromise = readRepositorySetup(options.setup);
      const [hydra, repository] = await Promise.all([hydraPromise, repositoryPromise]);
      return {
        status: 'ready' as const,
        hydra,
        startupCommand: 'docker compose up --build --wait' as const,
        repository,
      };
    },
  );

  return app;
}

async function readRepositorySetup(options: SetupOptions | undefined) {
  const repositoryId = normalizedEnvironmentValue(options?.repositoryId);
  const repositoryPath = normalizedEnvironmentValue(options?.repositoryPath);
  if (!repositoryId && !repositoryPath) {
    return repositorySetup(
      'not_configured',
      null,
      null,
      null,
      null,
      'No repository is configured. FreshContext will not invent repository activity.',
    );
  }
  if (!repositoryId || !repositoryPath || !options?.statusGateway) {
    return repositorySetup(
      'misconfigured',
      repositoryId,
      repositoryPath,
      null,
      null,
      'Repository id, repository path, and the status gateway must be configured together.',
    );
  }
  let status: RepositoryStatus;
  try {
    status = await options.statusGateway.status({ repositoryId });
  } catch {
    return repositorySetup(
      'context_unavailable',
      repositoryId,
      repositoryPath,
      null,
      null,
      'HydraDB could not verify the selected repository state.',
    );
  }
  if (status.status === 'context_unavailable') {
    return repositorySetup(
      'context_unavailable',
      repositoryId,
      repositoryPath,
      null,
      null,
      'HydraDB could not verify the selected repository state.',
    );
  }
  if (!status.indexed) {
    return repositorySetup(
      'not_indexed',
      repositoryId,
      repositoryPath,
      null,
      status.statistics,
      'The repository is selected but has no completed index.',
    );
  }
  return repositorySetup(
    'indexed',
    repositoryId,
    repositoryPath,
    status.indexedCommit,
    status.statistics,
    'The selected repository has a completed HydraDB index.',
  );
}

function repositorySetup(
  state: 'not_configured' | 'misconfigured' | 'not_indexed' | 'indexed' | 'context_unavailable',
  id: string | null,
  path: string | null,
  indexedCommit: string | null,
  statistics: Readonly<Record<string, number>> | null,
  message: string,
) {
  return { state, id, path, indexedCommit, statistics, message };
}

function normalizedEnvironmentValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
