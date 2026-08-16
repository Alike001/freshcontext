import { execFile } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { promisify } from 'node:util';

import { RepositoryIndexError } from './errors.js';
import type { CommitSnapshot, RepositoryDescriptor } from './types.js';

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;

export async function inspectRepository(repositoryPath: string): Promise<RepositoryDescriptor> {
  const candidate = await resolveDirectory(repositoryPath);
  const rootPath = await gitRoot(candidate);
  const [commit, status, trackedFiles] = await Promise.all([
    readCommit(rootPath),
    git(rootPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    git(rootPath, ['ls-files', '-z']),
  ]);

  if (status.length > 0) {
    throw new RepositoryIndexError(
      'DIRTY_WORKTREE',
      'Repository must have a clean worktree so the indexed files exactly match HEAD',
      { changes: parseStatusPaths(status).slice(0, 20) },
    );
  }

  const files = splitNull(trackedFiles).sort(compareText);
  if (!files.includes('tsconfig.json')) {
    throw new RepositoryIndexError(
      'MISSING_TSCONFIG',
      'Repository root must contain a tracked tsconfig.json',
      { rootPath },
    );
  }
  const typeScriptFiles = files.filter(isTypeScriptPath);
  if (typeScriptFiles.length === 0) {
    throw new RepositoryIndexError(
      'NO_TYPESCRIPT_FILES',
      'Repository does not contain tracked TypeScript source files',
      { rootPath },
    );
  }

  return { rootPath, commit, trackedFiles: files };
}

export async function assertRepositoryUnchanged(
  expected: RepositoryDescriptor,
): Promise<RepositoryDescriptor> {
  const current = await inspectRepository(expected.rootPath);
  if (current.commit.sha !== expected.commit.sha) {
    throw new RepositoryIndexError(
      'HEAD_CHANGED',
      'Repository HEAD changed while FreshContext was indexing it',
      { expected: expected.commit.sha, actual: current.commit.sha },
    );
  }
  return current;
}

async function resolveDirectory(repositoryPath: string): Promise<string> {
  if (repositoryPath.length === 0 || repositoryPath.trim() !== repositoryPath) {
    throw new RepositoryIndexError('INVALID_PATH', 'Repository path must be a non-empty path');
  }
  try {
    const resolved = await realpath(repositoryPath);
    if (!(await stat(resolved)).isDirectory()) {
      throw new RepositoryIndexError('INVALID_PATH', 'Repository path must be a directory', {
        repositoryPath,
      });
    }
    return resolved;
  } catch (error) {
    if (error instanceof RepositoryIndexError) {
      throw error;
    }
    throw new RepositoryIndexError('INVALID_PATH', 'Repository path cannot be read', {
      repositoryPath,
    });
  }
}

async function gitRoot(candidate: string): Promise<string> {
  try {
    return await realpath((await git(candidate, ['rev-parse', '--show-toplevel'])).trim());
  } catch {
    throw new RepositoryIndexError(
      'NOT_A_GIT_REPOSITORY',
      'Repository path is not inside a Git worktree',
      { repositoryPath: candidate },
    );
  }
}

async function readCommit(rootPath: string): Promise<CommitSnapshot> {
  let output: string;
  try {
    output = await git(rootPath, ['show', '-s', '--format=%H%x00%P%x00%cI', 'HEAD']);
  } catch {
    throw new RepositoryIndexError('MISSING_COMMIT', 'Repository must have a valid HEAD commit', {
      rootPath,
    });
  }
  const [sha, parents = '', committedAtWithNewline = ''] = output.split('\0');
  const committedAt = committedAtWithNewline.trim();
  if (!sha || !/^[a-f0-9]{40,64}$/u.test(sha) || committedAt.length === 0) {
    throw new RepositoryIndexError('GIT_FAILED', 'Git returned an invalid HEAD description', {
      rootPath,
    });
  }
  return {
    sha,
    parentShas: parents.length === 0 ? [] : parents.split(' '),
    committedAt,
  };
}

async function git(rootPath: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      [
        '--no-optional-locks',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.pager=cat',
        '-C',
        rootPath,
        ...args,
      ],
      {
        encoding: 'utf8',
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        env: {
          ...process.env,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_TERMINAL_PROMPT: '0',
          LC_ALL: 'C',
        },
      },
    );
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Git failure';
    throw new RepositoryIndexError('GIT_FAILED', 'Git command failed', {
      command: ['git', '-C', rootPath, ...args].join(' '),
      message,
    });
  }
}

function parseStatusPaths(status: string): string[] {
  return splitNull(status)
    .map((entry) => entry.slice(3))
    .filter((path) => path.length > 0);
}

function splitNull(value: string): string[] {
  return value.split('\0').filter((entry) => entry.length > 0);
}

function isTypeScriptPath(path: string): boolean {
  return (path.endsWith('.ts') || path.endsWith('.tsx')) && !path.endsWith('.d.ts');
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}
