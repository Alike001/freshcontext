import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import type { HydraQueryGateway, ImmutableGraphStore } from '@freshcontext/graph';
import type { IndexRepositoryResult } from '@freshcontext/indexer';

import {
  RepositoryOperationConflictError,
  RepositoryOperationCoordinator,
} from '../src/repository-operation.js';

const execFileAsync = promisify(execFile);
const temporaryRepositories: string[] = [];
const unusedGraph = {} as ImmutableGraphStore;
const unusedHydra = {} as HydraQueryGateway;
const indexResult = {} as IndexRepositoryResult;

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('configured repository operation coordinator', () => {
  it('publishes the indexing state and rejects a concurrent mutation', async () => {
    const repositoryPath = await createRepository();
    let releaseIndex: (() => void) | undefined;
    const indexGate = new Promise<void>((resolveGate) => {
      releaseIndex = resolveGate;
    });
    const coordinator = new RepositoryOperationCoordinator({
      repositoryId: 'configured-repository',
      repositoryPath,
      graph: unusedGraph,
      hydra: unusedHydra,
      index: async () => {
        await indexGate;
        return indexResult;
      },
    });

    const index = coordinator.index();
    await waitForState(coordinator, 'indexing');

    expect(coordinator.snapshot()).toEqual({ state: 'indexing' });
    await expect(coordinator.synchronize()).rejects.toBeInstanceOf(
      RepositoryOperationConflictError,
    );

    releaseIndex?.();
    await expect(index).resolves.toBe(indexResult);
    expect(coordinator.snapshot()).toEqual({ state: 'idle' });
  });

  it('publishes the syncing state until synchronization completes', async () => {
    const repositoryPath = await createRepository();
    let releaseSync: (() => void) | undefined;
    const syncGate = new Promise<void>((resolveGate) => {
      releaseSync = resolveGate;
    });
    const coordinator = new RepositoryOperationCoordinator({
      repositoryId: 'configured-repository',
      repositoryPath,
      graph: unusedGraph,
      hydra: unusedHydra,
      synchronize: async () => {
        await syncGate;
        return {
          repositoryId: 'configured-repository',
          fromCommit: 'a'.repeat(40),
          toCommit: 'a'.repeat(40),
          changeCount: 0,
          impactedMemoryIds: [],
          reused: true,
        };
      },
    });

    const synchronization = coordinator.synchronize();
    await waitForState(coordinator, 'syncing');

    expect(coordinator.snapshot()).toEqual({ state: 'syncing' });
    releaseSync?.();
    await expect(synchronization).resolves.toMatchObject({ reused: true });
    expect(coordinator.snapshot()).toEqual({ state: 'idle' });
  });

  it('keeps a safe invalid-repository state after a dirty worktree is rejected', async () => {
    const repositoryPath = await createRepository();
    await writeFile(resolve(repositoryPath, 'src.ts'), 'export const value = 2;\n', 'utf8');
    const coordinator = new RepositoryOperationCoordinator({
      repositoryId: 'configured-repository',
      repositoryPath,
      graph: unusedGraph,
      hydra: unusedHydra,
      index: () => Promise.resolve(indexResult),
    });

    await expect(coordinator.index()).rejects.toMatchObject({ code: 'DIRTY_WORKTREE' });
    expect(coordinator.snapshot()).toEqual({
      state: 'invalid_repository',
      code: 'DIRTY_WORKTREE',
      message: 'Repository must have a clean worktree so the indexed files exactly match HEAD',
    });
  });
});

async function createRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'freshcontext-operation-'));
  temporaryRepositories.push(root);
  await writeFile(
    resolve(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }),
    'utf8',
  );
  await writeFile(resolve(root, 'src.ts'), 'export const value = 1;\n', 'utf8');
  await git(root, ['init', '--initial-branch=main']);
  await git(root, ['config', 'user.name', 'FreshContext Test']);
  await git(root, ['config', 'user.email', 'test@freshcontext.local']);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'fixture']);
  return root;
}

async function waitForState(
  coordinator: RepositoryOperationCoordinator,
  state: 'indexing' | 'syncing',
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (coordinator.snapshot().state === state) return;
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 1));
  }
  throw new Error(`Coordinator did not enter ${state}`);
}

async function git(root: string, args: readonly string[]): Promise<void> {
  await execFileAsync('git', ['-C', root, ...args], { encoding: 'utf8' });
}
