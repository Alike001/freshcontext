export type MemoryErrorCode =
  | 'INVALID_INPUT'
  | 'INDEX_NOT_FOUND'
  | 'STALE_COMMIT'
  | 'EVIDENCE_NOT_FOUND'
  | 'MEMORY_NOT_RETRYABLE'
  | 'CORRUPT_GRAPH';

export class MemoryDomainError extends Error {
  public readonly code: MemoryErrorCode;

  public constructor(code: MemoryErrorCode, message: string) {
    super(message);
    this.name = 'MemoryDomainError';
    this.code = code;
  }
}
