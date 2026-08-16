import { randomBytes, randomUUID } from 'node:crypto';

import { HydraRequestError } from './client.js';
import type { HydraClient } from './client.js';
import type { HydraRoundTrip, HydraValue } from './types.js';

const HEALTH_KIND = 'FreshContextHealth';

export interface HydraHealthStatus {
  readonly ready: true;
  readonly hydra: 'connected';
  readonly roundTrip: HydraRoundTrip;
}

export class HydraHealthProbe {
  readonly #client: HydraClient;
  readonly #sourceId: number;
  readonly #targetId: number;
  readonly #probe: string;

  private constructor(client: HydraClient, sourceId: number, targetId: number, probe: string) {
    this.#client = client;
    this.#sourceId = sourceId;
    this.#targetId = targetId;
    this.#probe = probe;
  }

  public static async initialize(client: HydraClient): Promise<HydraHealthProbe> {
    const sourceId = randomVertexId();
    let targetId = randomVertexId();
    while (targetId === sourceId) {
      targetId = randomVertexId();
    }
    const probe = randomUUID();
    const healthProbe = new HydraHealthProbe(client, sourceId, targetId, probe);

    await client.query(
      'CREATE (source {id: $sourceId, kind: $kind, probe: $probe})-[:HEALTH_CHECK]->(target {id: $targetId, kind: $kind})',
      {
        parameters: { sourceId, targetId, kind: HEALTH_KIND, probe },
        queryId: `freshcontext-health-write-${probe}`,
      },
    );
    await healthProbe.verify();
    return healthProbe;
  }

  public async verify(): Promise<HydraHealthStatus> {
    const read = await this.#client.query(
      'MATCH (source {id: $sourceId, kind: $kind})-[:HEALTH_CHECK]->(target {id: $targetId, kind: $kind}) RETURN source.probe AS probe',
      {
        parameters: { sourceId: this.#sourceId, targetId: this.#targetId, kind: HEALTH_KIND },
        consistency: 'strong',
        queryId: `freshcontext-health-read-${randomUUID()}`,
      },
    );
    assertProbe(read.columns, read.rows, this.#probe);

    return {
      ready: true,
      hydra: 'connected',
      roundTrip: {
        queryId: read.query_id,
        readEpoch: read.read_epoch,
      },
    };
  }
}

function randomVertexId(): number {
  return Math.max(1, randomBytes(6).readUIntBE(0, 6));
}

function assertProbe(
  columns: readonly string[],
  rows: readonly (readonly HydraValue[])[],
  expected: string,
): void {
  const probeIndex = columns.indexOf('probe');
  const value = probeIndex >= 0 ? rows[0]?.[probeIndex] : undefined;
  if (value?.type !== 'string' || value.value !== expected) {
    throw new HydraRequestError('HydraDB failed the authenticated write-read health proof', {});
  }
}

export async function waitForHydra(
  client: HydraClient,
  options: { timeoutMs: number; intervalMs?: number },
): Promise<void> {
  const startedAt = Date.now();
  const intervalMs = options.intervalMs ?? 500;

  while (Date.now() - startedAt < options.timeoutMs) {
    if (await client.isAdminReady()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new HydraRequestError('HydraDB did not become ready before startup timed out', {});
}
