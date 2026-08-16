import type { EvidenceReference, MemoryRecord } from './types.js';

export type ReviewCheckpoint = 'original-superseded';

export interface ReviewMemoryInput {
  readonly repositoryId: string;
  readonly originalMemoryId: string;
  readonly commitSha: string;
  readonly replacementClaim: string;
  readonly evidence: readonly EvidenceReference[];
}

export interface ReviewMemoryResult {
  readonly operationId: string;
  readonly original: MemoryRecord;
  readonly replacement: MemoryRecord;
}
