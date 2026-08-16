export const MEMORY_STATES = ['pending', 'current', 'needs_review', 'superseded'] as const;
export type MemoryState = (typeof MEMORY_STATES)[number];

export interface EvidenceReference {
  readonly path: string;
  readonly qualifiedName: string;
}

export interface RememberInput {
  readonly repositoryId: string;
  readonly commitSha: string;
  readonly claim: string;
  readonly evidence: readonly EvidenceReference[];
}

export interface RecallInput {
  readonly repositoryId: string;
  readonly commitSha: string;
  readonly path: string;
  readonly qualifiedName: string;
}

export interface StatusInput {
  readonly repositoryId: string;
}

export interface MemoryRecord {
  readonly memoryId: string;
  readonly claim: string;
  readonly repositoryId: string;
  readonly sourceCommit: string;
  readonly createdAt: string;
  readonly state: MemoryState;
  readonly evidence: readonly EvidenceReference[];
}

export interface RecallResult {
  readonly status: 'ready';
  readonly repositoryId: string;
  readonly indexedCommit: string;
  readonly context: EvidenceReference;
  readonly memories: readonly MemoryRecord[];
  readonly withheldCount: number;
  readonly withheldMemoryIds: readonly string[];
  readonly abstained: boolean;
  readonly abstentionReason: 'no_memory' | 'all_matching_memory_unsafe' | null;
}

export interface RepositoryStatusResult {
  readonly status: 'ready';
  readonly repositoryId: string;
  readonly indexed: boolean;
  readonly indexedCommit: string | null;
  readonly statistics: Readonly<Record<string, number>> | null;
}

export interface ContextUnavailableResult {
  readonly status: 'context_unavailable';
  readonly message: string;
}

export type SafeRecallResult = RecallResult | ContextUnavailableResult;
export type SafeStatusResult = RepositoryStatusResult | ContextUnavailableResult;
