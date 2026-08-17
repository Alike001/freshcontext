import { describe, expect, it } from 'vitest';

import { ImmutableGraphStore } from '@freshcontext/graph';
import { HydraClient, loadHydraConfig } from '@freshcontext/hydra';

import { createRepositoryGraphPlan } from '../src/graph-plan.js';
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

    const importRelationship = createRepositoryGraphPlan(first.snapshot).content.find(
      (relationship) => relationship.kind === 'IMPORTS',
    );
    if (!importRelationship) throw new Error('Fixture did not create an IMPORTS relationship');
    const storedImport = await graph.inspectRelationship(
      'IMPORTS',
      importRelationship.id,
      importRelationship.source.id,
      importRelationship.target.id,
    );
    expect(storedImport).toMatchObject({
      id: importRelationship.id,
      entityKey: importRelationship.entityKey,
      kind: 'IMPORTS',
      sourceId: importRelationship.source.id,
      targetId: importRelationship.target.id,
    });
  }, 60_000);
});
