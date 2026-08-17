import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ProductConsoleResponse } from '../src/console.js';
import { buildApp } from '../src/app.js';
import { FileEvaluationGateway } from '../src/evaluation.js';

const evaluationReference = resolve(
  import.meta.dirname,
  '../../../evaluation/reference-result.json',
);

describe('FreshContext HTTP service', () => {
  it('returns a live HydraDB round-trip result when ready', async () => {
    const app = buildApp({
      healthGateway: {
        verify: () =>
          Promise.resolve({
            ready: true,
            hydra: 'connected',
            roundTrip: { queryId: 'health-read-1', readEpoch: 9 },
          }),
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ready',
      service: 'freshcontext',
      hydra: 'connected',
      roundTrip: { queryId: 'health-read-1', readEpoch: 9 },
    });
    await app.close();
  });

  it('fails closed without leaking the upstream error', async () => {
    const app = buildApp({
      healthGateway: {
        verify: () => Promise.reject(new Error('upstream includes a sensitive internal detail')),
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'unavailable',
      service: 'freshcontext',
      hydra: 'unavailable',
    });
    expect(response.body).not.toContain('sensitive');
    await app.close();
  });

  it('describes the foundation honestly at the root route', async () => {
    const app = buildApp({
      healthGateway: {
        verify: () =>
          Promise.resolve({
            ready: true,
            hydra: 'connected',
            roundTrip: { queryId: 'unused', readEpoch: null },
          }),
      },
    });

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'runtime-foundation', health: '/api/health' });
    await app.close();
  });

  it('reports the real empty setup state without fictional repository activity', async () => {
    const app = buildApp({
      healthGateway: {
        verify: () =>
          Promise.resolve({
            ready: true,
            hydra: 'connected',
            roundTrip: { queryId: 'setup-health', readEpoch: 12 },
          }),
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/setup' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ready',
      hydra: 'connected',
      startupCommand: 'docker compose up --build --wait',
      repository: {
        state: 'not_configured',
        source: null,
        id: null,
        path: null,
        indexedCommit: null,
        statistics: null,
        message: 'No repository is configured. FreshContext will not invent repository activity.',
      },
    });
    await app.close();
  });

  it('serves the real console gateway and forwards a validated review request', async () => {
    const consoleResponse = exampleConsoleResponse();
    const reviews: Array<{ memoryId: string; replacementClaim: string }> = [];
    const app = buildApp({
      healthGateway: {
        verify: () =>
          Promise.resolve({
            ready: true,
            hydra: 'connected',
            roundTrip: { queryId: 'x', readEpoch: 1 },
          }),
      },
      consoleGateway: {
        read: () => Promise.resolve(consoleResponse),
        review: (memoryId, replacementClaim) => {
          reviews.push({ memoryId, replacementClaim });
          return Promise.resolve(consoleResponse);
        },
      },
    });

    const read = await app.inject({ method: 'GET', url: '/api/console' });
    const review = await app.inject({
      method: 'POST',
      url: '/api/memories/memory-1/review',
      payload: { replacementClaim: 'The verified replacement.' },
    });

    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ status: 'ready', source: 'example' });
    expect(review.statusCode).toBe(200);
    expect(reviews).toEqual([
      { memoryId: 'memory-1', replacementClaim: 'The verified replacement.' },
    ]);
    await app.close();
  });

  it('rejects extra review fields before calling the domain gateway', async () => {
    let calls = 0;
    const app = buildApp({
      healthGateway: { verify: () => Promise.reject(new Error('unused')) },
      consoleGateway: {
        read: () => Promise.resolve(exampleConsoleResponse()),
        review: () => {
          calls += 1;
          return Promise.resolve(exampleConsoleResponse());
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/memories/memory-1/review',
      payload: { replacementClaim: 'Replacement', state: 'current' },
    });

    expect(response.statusCode).toBe(400);
    expect(calls).toBe(0);
    await app.close();
  });

  it('returns the verified selected repository index state', async () => {
    const app = buildApp({
      healthGateway: {
        verify: () =>
          Promise.resolve({
            ready: true,
            hydra: 'connected',
            roundTrip: { queryId: 'setup-indexed', readEpoch: 14 },
          }),
      },
      setup: {
        repositoryId: 'checkout',
        repositoryPath: '/workspace/checkout',
        statusGateway: {
          status: () =>
            Promise.resolve({
              status: 'ready',
              indexed: true,
              indexedCommit: 'a'.repeat(40),
              statistics: { symbolCount: 9 },
            }),
        },
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/setup' });

    expect(response.json()).toMatchObject({
      hydra: 'connected',
      repository: {
        state: 'indexed',
        id: 'checkout',
        path: '/workspace/checkout',
        indexedCommit: 'a'.repeat(40),
        statistics: { symbolCount: 9 },
      },
    });
    await app.close();
  });

  it('reports partial repository configuration as invalid without querying status', async () => {
    let statusCalls = 0;
    const app = buildApp({
      healthGateway: {
        verify: () => Promise.reject(new Error('HydraDB unavailable')),
      },
      setup: {
        repositoryId: 'checkout',
        repositoryPath: undefined,
        statusGateway: {
          status: () => {
            statusCalls += 1;
            return Promise.reject(new Error('must not be called'));
          },
        },
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/setup' });

    expect(response.json()).toMatchObject({
      hydra: 'unavailable',
      repository: { state: 'misconfigured', id: 'checkout', path: null },
    });
    expect(statusCalls).toBe(0);
    await app.close();
  });

  it('turns a repository status failure into an honest unavailable state', async () => {
    const app = buildApp({
      healthGateway: {
        verify: () =>
          Promise.resolve({
            ready: true,
            hydra: 'connected',
            roundTrip: { queryId: 'setup-status-failure', readEpoch: 18 },
          }),
      },
      setup: {
        repositoryId: 'checkout',
        repositoryPath: '/workspace/checkout',
        statusGateway: {
          status: () => Promise.reject(new Error('query failed with internal details')),
        },
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/setup' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      hydra: 'connected',
      repository: {
        state: 'context_unavailable',
        id: 'checkout',
        path: '/workspace/checkout',
        message: 'HydraDB could not verify the selected repository state.',
      },
    });
    expect(response.body).not.toContain('internal details');
    await app.close();
  });

  it('serves the validated offline evaluation reference without invented metrics', async () => {
    const app = buildApp({
      healthGateway: {
        verify: () =>
          Promise.resolve({
            ready: true,
            hydra: 'connected',
            roundTrip: { queryId: 'evaluation-health', readEpoch: 20 },
          }),
      },
      evaluationGateway: new FileEvaluationGateway(evaluationReference),
    });

    const response = await app.inject({ method: 'GET', url: '/api/evaluation/latest' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ready',
      source: 'verified_reference',
      evaluationId: '2fd14725009b9b93',
      dataset: { caseCount: 2, labelCount: 10 },
      aggregate: {
        graph: { precision: 1, recall: 6 / 7 },
        directFileBaseline: { precision: 0.6, recall: 3 / 7 },
      },
    });
    await app.close();
  });

  it('fails evaluation closed without leaking an artifact read error', async () => {
    const app = buildApp({
      healthGateway: {
        verify: () =>
          Promise.resolve({
            ready: true,
            hydra: 'connected',
            roundTrip: { queryId: 'evaluation-error', readEpoch: 21 },
          }),
      },
      evaluationGateway: {
        read: () => Promise.reject(new Error('private artifact path and parse detail')),
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/evaluation/latest' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'unavailable',
      message: 'The verified evaluation artifact is unavailable.',
    });
    expect(response.body).not.toContain('private artifact');
    await app.close();
  });

  it('serves the SPA for product routes while keeping API and asset misses as 404', async () => {
    const staticRoot = await mkdtemp(resolve(tmpdir(), 'freshcontext-static-'));
    try {
      await writeFile(resolve(staticRoot, 'index.html'), '<!doctype html><h1>FreshContext UI</h1>');
      const app = buildApp({
        healthGateway: {
          verify: () =>
            Promise.resolve({
              ready: true,
              hydra: 'connected',
              roundTrip: { queryId: 'unused', readEpoch: null },
            }),
        },
        staticRoot,
      });

      const product = await app.inject({ method: 'GET', url: '/setup' });
      const apiMiss = await app.inject({ method: 'GET', url: '/api/unknown' });
      const assetMiss = await app.inject({ method: 'GET', url: '/assets/missing.js' });

      expect(product.statusCode).toBe(200);
      expect(product.body).toContain('FreshContext UI');
      expect(product.headers['cache-control']).toContain('max-age=0');
      expect(product.headers['content-security-policy']).toContain("default-src 'self'");
      expect(product.headers['x-frame-options']).toBe('DENY');
      expect(apiMiss.statusCode).toBe(404);
      expect(assetMiss.statusCode).toBe(404);
      await app.close();
    } finally {
      await rm(staticRoot, { recursive: true, force: true });
    }
  });
});

function exampleConsoleResponse(): ProductConsoleResponse {
  const memory = {
    memoryId: 'memory-1',
    claim: 'A claim',
    state: 'needs_review' as const,
    sourceCommit: 'a'.repeat(40),
    createdAt: '2026-08-12T09:00:00.000Z',
    evidence: [{ path: 'src/a.ts', qualifiedName: 'a' }],
  };
  return {
    status: 'ready',
    source: 'example',
    repositoryId: 'example',
    repositoryLabel: 'Checkout example',
    selectedCommit: 'b'.repeat(40),
    memories: [memory],
    selected: {
      memory,
      impact: null,
      chronology: [],
      replacement: null,
      original: null,
      diff: null,
    },
  };
}
