import { realpath } from 'node:fs/promises';

import { SyncService, type SynchronizeRepositoryResult } from '@freshcontext/core';
import type { HydraQueryGateway, ImmutableGraphStore } from '@freshcontext/graph';
import {
  indexRepository,
  inspectRepository,
  RepositoryIndexError,
  type IndexRepositoryResult,
} from '@freshcontext/indexer';

export type RepositoryOperationKind = 'index' | 'sync';

export type RepositoryOperationSnapshot =
  | { readonly state: 'idle' }
  | { readonly state: 'indexing' | 'syncing' }
  | {
      readonly state: 'invalid_repository';
      readonly code: string;
      readonly message: string;
    };

export class RepositoryOperationConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'RepositoryOperationConflictError';
  }
}

export interface RepositoryOperationOptions {
  readonly repositoryId: string;
  readonly repositoryPath: string;
  readonly graph: ImmutableGraphStore;
  readonly hydra: HydraQueryGateway;
  readonly index?: typeof indexRepository;
  readonly synchronize?: (
    repositoryId: string,
    repositoryPath: string,
  ) => Promise<SynchronizeRepositoryResult>;
}

export class RepositoryOperationCoordinator {
  readonly #options: RepositoryOperationOptions;
  #active: RepositoryOperationKind | null = null;
  #snapshot: RepositoryOperationSnapshot = { state: 'idle' };

  public constructor(options: RepositoryOperationOptions) {
    this.#options = options;
  }

  public snapshot(): RepositoryOperationSnapshot {
    return this.#snapshot;
  }

  public async index(): Promise<IndexRepositoryResult> {
    return this.#run('index', async () => {
      await requireConfiguredRepositoryRoot(this.#options.repositoryPath);
      return (this.#options.index ?? indexRepository)({
        repositoryId: this.#options.repositoryId,
        repositoryPath: this.#options.repositoryPath,
        graph: this.#options.graph,
      });
    });
  }

  public async synchronize(): Promise<SynchronizeRepositoryResult> {
    return this.#run('sync', async () => {
      await requireConfiguredRepositoryRoot(this.#options.repositoryPath);
      const synchronize =
        this.#options.synchronize ??
        ((repositoryId: string, repositoryPath: string) =>
          new SyncService({ graph: this.#options.graph, hydra: this.#options.hydra }).synchronize({
            repositoryId,
            repositoryPath,
          }));
      return synchronize(this.#options.repositoryId, this.#options.repositoryPath);
    });
  }

  async #run<T>(kind: RepositoryOperationKind, operation: () => Promise<T>): Promise<T> {
    if (this.#active) {
      throw new RepositoryOperationConflictError(
        `Repository ${this.#active} is already in progress`,
      );
    }
    this.#active = kind;
    this.#snapshot = { state: kind === 'index' ? 'indexing' : 'syncing' };
    try {
      const result = await operation();
      this.#snapshot = { state: 'idle' };
      return result;
    } catch (error) {
      this.#snapshot = publicFailure(error);
      throw error;
    } finally {
      this.#active = null;
    }
  }
}

async function requireConfiguredRepositoryRoot(repositoryPath: string): Promise<void> {
  const [allowedRoot, descriptor] = await Promise.all([
    realpath(repositoryPath).catch(() => repositoryPath),
    inspectRepository(repositoryPath),
  ]);
  if (descriptor.rootPath !== allowedRoot) {
    throw new RepositoryIndexError(
      'INVALID_PATH',
      'Configured repository path must point to the Git worktree root',
    );
  }
}

function publicFailure(error: unknown): RepositoryOperationSnapshot {
  if (error instanceof RepositoryIndexError) {
    return { state: 'invalid_repository', code: error.code, message: error.message };
  }
  return {
    state: 'invalid_repository',
    code: 'OPERATION_FAILED',
    message: 'FreshContext could not verify the configured repository operation.',
  };
}
