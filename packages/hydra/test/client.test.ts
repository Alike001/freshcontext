import { describe, expect, it, vi } from 'vitest';

import { HydraClient, HydraRequestError } from '../src/client.js';
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

describe('HydraClient', () => {
  it('sends an authenticated, namespaced strong query without exposing the token in output', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          query_id: 'read-1',
          columns: ['probe'],
          rows: [[{ type: 'string', value: 'ok' }]],
          read_epoch: 12,
          next_cursor: null,
          bookmark: null,
        }),
        { status: 200 },
      ),
    );
    const client = new HydraClient(config, fetchImplementation);

    const result = await client.query('MATCH (n {id: $id}) RETURN n.probe AS probe', {
      parameters: { id: 7 },
      consistency: 'strong',
      queryId: 'read-1',
    });

    expect(result.rows[0]?.[0]).toEqual({ type: 'string', value: 'ok' });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, request] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe('http://hydra.test:8443/v1/graphs/freshcontext/query');
    expect(request?.headers).toMatchObject({
      Authorization: `Bearer ${config.token}`,
      'X-Graph-Namespace': 'freshcontext',
    });
    expect(typeof request?.body).toBe('string');
    expect(JSON.parse(request?.body as string)).toMatchObject({
      cell_id: 'cell-0',
      query_id: 'read-1',
      consistency: 'strong',
      parameters: { id: 7 },
    });
    expect(JSON.stringify(result)).not.toContain(config.token);
  });

  it('rejects an unexpected response shape', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"unexpected":true}', { status: 200 }));
    const client = new HydraClient(config, fetchImplementation);

    await expect(client.query('MATCH (n) RETURN n')).rejects.toThrow(
      'HydraDB returned an unexpected response shape',
    );
  });

  it('sanitizes non-JSON upstream errors', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(`bad token: ${config.token}`, { status: 401 }));
    const client = new HydraClient(config, fetchImplementation);

    const error = await client.query('MATCH (n) RETURN n').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HydraRequestError);
    expect(String(error)).toBe('HydraRequestError: HydraDB rejected the query');
    expect(String(error)).not.toContain(config.token);
  });

  it('reports admin connection failure as not ready', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    const client = new HydraClient(config, fetchImplementation);

    await expect(client.isAdminReady()).resolves.toBe(false);
  });
});
