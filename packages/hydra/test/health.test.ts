import { describe, expect, it, vi } from 'vitest';

import { HydraClient, HydraRequestError } from '../src/client.js';
import { HydraHealthProbe, waitForHydra } from '../src/health.js';
import type { HydraClientConfig } from '../src/types.js';

const config: HydraClientConfig = {
  queryBaseUrl: 'http://hydra.test:8443',
  adminBaseUrl: 'http://hydra.test:9090',
  graphId: 'freshcontext',
  namespace: 'freshcontext',
  cellId: 'cell-0',
  token: 'a'.repeat(64),
  timeoutMs: 1_000,
};

describe('HydraHealthProbe', () => {
  it('initializes with a write and verifies with a strong read', async () => {
    let savedProbe = '';
    const fetchImplementation = vi.fn<typeof fetch>((_url, request) => {
      if (typeof request?.body !== 'string') {
        throw new Error('Expected a serialized HydraDB request body');
      }
      const body = JSON.parse(request.body) as {
        query: string;
        parameters: { probe?: string };
        consistency?: string;
        query_id: string;
      };
      if (body.query.startsWith('CREATE')) {
        savedProbe = body.parameters.probe ?? '';
      }
      const isWrite = body.query.startsWith('CREATE');
      return Promise.resolve(
        new Response(
          JSON.stringify({
            query_id: body.query_id,
            columns: isWrite ? [] : ['probe'],
            rows: isWrite ? [] : [[{ type: 'string', value: savedProbe }]],
            read_epoch: 3,
            next_cursor: null,
            bookmark: null,
          }),
          { status: 200 },
        ),
      );
    });
    const client = new HydraClient(config, fetchImplementation);

    const probe = await HydraHealthProbe.initialize(client);
    const status = await probe.verify();

    expect(status).toMatchObject({ ready: true, hydra: 'connected' });
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    const finalRequestBody = fetchImplementation.mock.calls[2]?.[1]?.body;
    expect(typeof finalRequestBody).toBe('string');
    const finalBody = JSON.parse(finalRequestBody as string) as Record<string, unknown>;
    expect(finalBody['consistency']).toBe('strong');
  });

  it('fails when HydraDB does not return the written probe on the verification read', async () => {
    let callCount = 0;
    const fetchImplementation = vi.fn<typeof fetch>(() => {
      callCount += 1;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            query_id: 'wrong',
            columns: callCount === 1 ? [] : ['probe'],
            rows: callCount === 1 ? [] : [[{ type: 'string', value: 'wrong' }]],
            read_epoch: null,
            next_cursor: null,
            bookmark: null,
          }),
          { status: 200 },
        ),
      );
    });
    const client = new HydraClient(config, fetchImplementation);

    await expect(HydraHealthProbe.initialize(client)).rejects.toBeInstanceOf(HydraRequestError);
  });
});

describe('waitForHydra', () => {
  it('times out when the admin endpoint never becomes ready', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('', { status: 503 }));
    const client = new HydraClient(config, fetchImplementation);

    await expect(waitForHydra(client, { timeoutMs: 5, intervalMs: 1 })).rejects.toThrow(
      'did not become ready',
    );
  });
});
