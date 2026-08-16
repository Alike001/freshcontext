export type MemoryErrorCode =
  | 'INVALID_INPUT'
  | 'INDEX_NOT_FOUND'
  | 'STALE_COMMIT'
  | 'EVIDENCE_NOT_FOUND'
  | 'MEMORY_NOT_RETRYABLE'
  | 'SYNC_CONFLICT'
  | 'CORRUPT_GRAPH';

export class MemoryDomainError extends Error {
  public readonly code: MemoryErrorCode;

  public constructor(code: MemoryErrorCode, message: string) {
    super(message);
    this.name = 'MemoryDomainError';
    this.code = code;
  }
}

export class ContextUnavailableError extends Error {
  public constructor(message = 'FreshContext is synchronizing repository context') {
    super(message);
    this.name = 'ContextUnavailableError';
  }
}
