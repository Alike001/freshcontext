import type { ImmutableGraphStore, PersistedGraphRecord } from '@freshcontext/graph';

import { assertRepositoryUnchanged, inspectRepository } from './git.js';
import { createRepositoryGraphPlan } from './graph-plan.js';
import { buildRepositorySnapshot } from './snapshot.js';
import type { RepositorySnapshot } from './types.js';

export interface IndexRepositoryInput {
  readonly repositoryId: string;
  readonly repositoryPath: string;
  readonly graph: ImmutableGraphStore;
}

export interface IndexRepositoryResult {
  readonly snapshot: RepositorySnapshot;
  readonly persistedRelationshipCount: number;
}

export async function indexRepository(input: IndexRepositoryInput): Promise<IndexRepositoryResult> {
  const descriptor = await inspectRepository(input.repositoryPath);
  const snapshot = buildRepositorySnapshot(input.repositoryId, descriptor);
  await assertRepositoryUnchanged(descriptor);
  const plan = createRepositoryGraphPlan(snapshot);
  const persisted: PersistedGraphRecord[] = [];

  for (const relationship of plan.content) {
    persisted.push(await input.graph.writeRelationship(relationship));
  }

  await assertRepositoryUnchanged(descriptor);
  for (const relationship of plan.completion) {
    persisted.push(await input.graph.writeRelationship(relationship));
  }

  return { snapshot, persistedRelationshipCount: persisted.length };
}
