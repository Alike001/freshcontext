import { describe, expect, it } from 'vitest';

import { HydraClient, loadHydraConfig, waitForHydra } from '@freshcontext/hydra';

import { createImmutableEntity, createImmutableRelationship } from '../src/model.js';
import { GraphCollisionError, ImmutableGraphStore } from '../src/store.js';

const contractEnabled = process.env['HYDRA_CONTRACT_TEST'] === '1';

describe.skipIf(!contractEnabled)('HydraDB v0.1.1 immutable graph contract', () => {
  it('runs every persistence query shape and keeps exact retries duplicate-free', async () => {
    const hydra = new HydraClient(loadHydraConfig());
    await waitForHydra(hydra, { timeoutMs: 120_000 });
    const store = new ImmutableGraphStore(hydra);
    const root = createImmutableEntity('GraphRoot', 'freshcontext:contract-root:v1', {
      schemaVersion: 1,
    });
    const repository = createImmutableEntity('Repository', 'repository:contract-fixture', {
      name: 'Contract fixture',
    });
    const relationship = createImmutableRelationship('ROOT_HAS_REPOSITORY', root, repository);

    const first = await store.writeRelationship(relationship);
    const repeated = await store.writeRelationship(relationship);
    const inspected = await store.inspectRelationship(
      relationship.kind,
      relationship.id,
      relationship.source.id,
      relationship.target.id,
    );

    expect(repeated).toEqual(first);
    expect(inspected).toEqual(first.relationship);

    const modifiedRepository = createImmutableEntity('Repository', repository.entityKey, {
      name: 'Attempted overwrite',
    });
    await expect(
      store.writeRelationship(
        createImmutableRelationship('ROOT_HAS_REPOSITORY', root, modifiedRepository),
      ),
    ).rejects.toBeInstanceOf(GraphCollisionError);

    const preserved = await store.inspectEntity(repository.id);
    expect(preserved?.payloadHash).toBe(repository.payloadHash);
  });
});
