import { describe, expect, it } from 'vitest';

import { ImmutableGraphStore } from '@freshcontext/graph';
import { HydraClient, loadHydraConfig } from '@freshcontext/hydra';

import { indexRepository } from '../src/indexer.js';
import { createGitFixture } from './helpers.js';

const runContract = process.env['HYDRA_INDEXER_CONTRACT_TEST'] === '1';

describe.skipIf(!runContract)('pinned HydraDB repository indexer contract', () => {
  it('indexes a real Git fixture and keeps an unchanged re-index duplicate-free', async () => {
    const root = await createGitFixture();
    const hydra = new HydraClient(loadHydraConfig());
    const graph = new ImmutableGraphStore(hydra);

    const first = await indexRepository({
      repositoryId: 'indexer-contract-fixture',
      repositoryPath: root,
      graph,
    });
    const second = await indexRepository({
      repositoryId: 'indexer-contract-fixture',
      repositoryPath: root,
      graph: new ImmutableGraphStore(hydra),
    });

    expect(first.snapshot.statistics.indexedFileCount).toBe(2);
    expect(first.snapshot.statistics.callEdgeCount).toBe(3);
    expect(first.snapshot.statistics.unresolvedCallCount).toBe(1);
    expect(second).toEqual(first);
  }, 60_000);
});
