import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';

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
});
