export type SyncCheckpoint = 'locked' | 'indexed' | 'proofs-persisted';

export interface SynchronizeRepositoryInput {
  readonly repositoryId: string;
  readonly repositoryPath: string;
}

export interface SynchronizeRepositoryResult {
  readonly repositoryId: string;
  readonly fromCommit: string;
  readonly toCommit: string;
  readonly changeCount: number;
  readonly impactedMemoryIds: readonly string[];
  readonly reused: boolean;
}
