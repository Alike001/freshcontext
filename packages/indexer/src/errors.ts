export type RepositoryIndexErrorCode =
  | 'INVALID_PATH'
  | 'NOT_A_GIT_REPOSITORY'
  | 'MISSING_COMMIT'
  | 'DIRTY_WORKTREE'
  | 'MISSING_TSCONFIG'
  | 'NO_TYPESCRIPT_FILES'
  | 'HEAD_CHANGED'
  | 'GIT_FAILED';

export class RepositoryIndexError extends Error {
  public readonly code: RepositoryIndexErrorCode;
  public readonly details: Readonly<Record<string, string | readonly string[]>>;

  public constructor(
    code: RepositoryIndexErrorCode,
    message: string,
    details: Readonly<Record<string, string | readonly string[]>> = {},
  ) {
    super(message);
    this.name = 'RepositoryIndexError';
    this.code = code;
    this.details = details;
  }
}
